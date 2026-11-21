/**
 * ============================================================================
 * ONE-CLICK LIVE DATABASE SYNC TOOL FOR CLOUDFLARE WORKERS & GITHUB
 * ============================================================================
 * Downloads the live production database directly from your Cloudflare server
 * and updates local `data/db.json`, `data/seed-db.json`, and `src/config/default-db-template.json`.
 *
 * Enforces:
 *   - Max 3 backups in data/backups/ (retains only the 3 latest snapshots)
 *   - Preserves all runs from the last 14 days + Top 100 all-time runs per player/mode
 *
 * Usage:
 *   npm run sync-db
 *   or double-click sync-live-data.bat
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DEFAULT_LIVE_URL = 'https://3d-flappy-bird.arthurskjold.workers.dev';
const LIVE_SERVER_URL = String(
  process.env.LIVE_SERVER_URL ||
  process.env.CLOUDFLARE_URL ||
  process.env.RENDER_URL ||
  DEFAULT_LIVE_URL
).trim().replace(/\/+$/, '');
const ADMIN_USER = process.env.ADMIN_USER || 'MeDonut';
const ADMIN_PASS = process.env.ADMIN_PASS || 'JohnPork';

const ROOT_DIR = path.resolve(__dirname, '..');
const DB_FILE = path.join(ROOT_DIR, 'data', 'db.json');
const SEED_FILE = path.join(ROOT_DIR, 'data', 'seed-db.json');
const TEMPLATE_FILE = path.join(ROOT_DIR, 'src', 'config', 'default-db-template.json');
const BACKUPS_DIR = path.join(ROOT_DIR, 'data', 'backups');

function httpRequest(url, options = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'http:' ? http : https;
    const reqHeaders = {
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept': 'application/json',
      'User-Agent': 'FlappyBird3D-Sync/2.5',
      ...(options.headers || {})
    };
    const req = transport.request(parsed, { ...options, headers: reqHeaders }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirectCount < 3) {
        const nextUrl = new URL(res.headers.location, parsed).toString();
        res.resume();
        return httpRequest(nextUrl, options, redirectCount + 1).then(resolve, reject);
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        try {
          const rawBuf = Buffer.concat(chunks);
          const enc = String(res.headers['content-encoding'] || '').toLowerCase();
          let finalBuf = rawBuf;
          if (enc.includes('br') && typeof zlib.brotliDecompressSync === 'function') {
            finalBuf = zlib.brotliDecompressSync(rawBuf);
          } else if (enc.includes('gzip')) {
            finalBuf = zlib.gunzipSync(rawBuf);
          } else if (enc.includes('deflate')) {
            finalBuf = zlib.inflateSync(rawBuf);
          }
          resolve({ status: res.statusCode, headers: res.headers, body: finalBuf.toString('utf8') });
        } catch (decErr) {
          reject(decErr);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Connection timed out while reaching Cloudflare server (' + url + ')'));
    });
    if (options.body) req.write(options.body);
    req.end();
  });
}

function pruneBackups(maxBackups = 3) {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) return;
    const backupFiles = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const full = path.join(BACKUPS_DIR, f);
        return { file: f, full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime); // Newest first

    if (backupFiles.length > maxBackups) {
      const toDelete = backupFiles.slice(maxBackups);
      for (const item of toDelete) {
        try {
          fs.unlinkSync(item.full);
          console.log(`🧹 Pruned old backup (kept ${maxBackups} latest): ${item.file}`);
        } catch (_) {}
      }
    }
  } catch (err) {
    console.error('Backup pruning error:', err.message);
  }
}

async function syncLiveDatabase() {
  console.log('============================================================');
  console.log('🔄 SYNCING LIVE DATABASE FROM CLOUDFLARE SERVER...');
  console.log('🌐 Target URL: ' + LIVE_SERVER_URL);
  console.log('============================================================\n');

  try {
    // 1. Authenticate as MeDonut on live server
    console.log('🔑 Logging in as ' + ADMIN_USER + '...');
    const loginRes = await httpRequest(`${LIVE_SERVER_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS })
    });

    if (loginRes.status !== 200) {
      throw new Error(`Login failed with HTTP status ${loginRes.status}: ${loginRes.body}`);
    }

    const loginData = JSON.parse(loginRes.body);
    const token = loginData.token;
    if (!token) {
      throw new Error('Authentication succeeded but received no session token.');
    }
    console.log('✅ Authenticated successfully!');

    // 2. Fetch entire database export
    console.log('📥 Exporting live production database...');
    const exportRes = await httpRequest(`${LIVE_SERVER_URL}/api/database/export`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (exportRes.status !== 200) {
      throw new Error(`Database export failed with status ${exportRes.status}: ${exportRes.body}`);
    }

    const liveDb = JSON.parse(exportRes.body);

    // Guarantee all core collections exist while preserving EVERY field exported by the live server
    // (including active & past giveaways, globalAnnouncements, feedbackSubmissions, banRegistry,
    // leaderboardSkinLedger, chatMessages, sessions, adminSettings, custom drawings/media, etc.)
    if (!liveDb.runs || typeof liveDb.runs !== 'object') {
      liveDb.runs = { easy: [], medium: [], hard: [], extreme: [] };
    }
    if (!Array.isArray(liveDb.giveaways)) liveDb.giveaways = [];
    if (!Array.isArray(liveDb.globalAnnouncements)) liveDb.globalAnnouncements = [];
    if (!Array.isArray(liveDb.feedbackSubmissions)) liveDb.feedbackSubmissions = [];
    if (!Array.isArray(liveDb.chatMessages)) liveDb.chatMessages = [];
    if (!liveDb.banRegistry || typeof liveDb.banRegistry !== 'object') liveDb.banRegistry = { groups: {} };
    if (!liveDb.adminSettings || typeof liveDb.adminSettings !== 'object') liveDb.adminSettings = {};
    if (!liveDb.sessions || typeof liveDb.sessions !== 'object') liveDb.sessions = {};
    if (!liveDb.users || typeof liveDb.users !== 'object') liveDb.users = {};

    // Preserve ALL runs from the last 14 days (active Daily + Weekly windows!) + up to Top 100 all-time runs per player per mode
    const recentPreserveCutoffMs = Date.now() - 14 * 24 * 60 * 60 * 1000;
    ['easy', 'medium', 'hard', 'extreme'].forEach(diff => {
      const list = Array.isArray(liveDb.runs?.[diff]) ? liveDb.runs[diff] : [];
      const runsByPlayer = new Map();
      for (const r of list) {
        if (!r || !r.username) continue;
        const uKey = String(r.username).toLowerCase();
        if (!runsByPlayer.has(uKey)) runsByPlayer.set(uKey, []);
        runsByPlayer.get(uKey).push(r);
      }
      const prunedRuns = [];
      for (const pRuns of runsByPlayer.values()) {
        pRuns.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return (b.createdAt || 0) - (a.createdAt || 0);
        });
        for (let i = 0; i < pRuns.length; i++) {
          const item = pRuns[i];
          if (i < 100 || (Number(item.createdAt) || 0) >= recentPreserveCutoffMs) {
            prunedRuns.push(item);
          }
        }
      }
      prunedRuns.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (a.createdAt || 0) - (b.createdAt || 0);
      });
      liveDb.runs[diff] = prunedRuns;
    });

    const rawHighScores = Array.isArray(liveDb.duelMatchHighScores) ? liveDb.duelMatchHighScores : [];
    liveDb.duelMatchHighScores = rawHighScores
      .filter(e => e && e.username && Number(e.points) > 0)
      .sort((a, b) => (b.points - a.points) || ((a.createdAt || 0) - (b.createdAt || 0)))
      .slice(0, 200);

    const rawHistory = Array.isArray(liveDb.duelMatchHistory) ? liveDb.duelMatchHistory : [];
    liveDb.duelMatchHistory = rawHistory.slice(0, 500);

    const userCount = Object.keys(liveDb.users || {}).length;
    const easyCount = liveDb.runs?.easy?.length || 0;
    const medCount = liveDb.runs?.medium?.length || 0;
    const hardCount = liveDb.runs?.hard?.length || 0;
    const extremeCount = liveDb.runs?.extreme?.length || 0;
    const rankedMatchCount = liveDb.duelMatchHighScores.length;
    const totalRuns = easyCount + medCount + hardCount + extremeCount;
    const activeGiveawaysCount = liveDb.giveaways.filter(g => g && g.status === 'active').length;
    const totalGiveawaysCount = liveDb.giveaways.length;
    const feedbackCount = liveDb.feedbackSubmissions.length;
    const announcementsCount = liveDb.globalAnnouncements.length;
    const banGroupsCount = Object.keys((liveDb.banRegistry && liveDb.banRegistry.groups) || {}).length;
    const chatCount = liveDb.chatMessages.length;
    const sessionCount = Object.keys(liveDb.sessions || {}).length;

    console.log(`✅ Complete Live Database Retrieved!`);
    console.log(`   👥 Total Registered Players: ${userCount} (Sessions: ${sessionCount})`);
    console.log(`   🏃 Total Verified Runs: ${totalRuns} (Easy: ${easyCount}, Med: ${medCount}, Hard: ${hardCount}, Extreme: ${extremeCount})`);
    console.log(`   ⚔️ Ranked Match High Scores: ${rankedMatchCount} | Match History: ${liveDb.duelMatchHistory.length}`);
    console.log(`   🎁 Giveaways: ${activeGiveawaysCount} active / ${totalGiveawaysCount} total`);
    console.log(`   📣 Global Announcements: ${announcementsCount} | 💡 Feedback: ${feedbackCount} | 💬 Chat: ${chatCount} | 🔨 Ban Groups: ${banGroupsCount}`);

    // 3. Create a safety backup of local db.json if it exists
    if (!fs.existsSync(BACKUPS_DIR)) {
      fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    }
    if (fs.existsSync(DB_FILE)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(BACKUPS_DIR, `local-backup-before-sync-${stamp}.json`);
      fs.copyFileSync(DB_FILE, backupPath);
      console.log(`🛡️ Created local backup: ${path.basename(backupPath)}`);
    }

    // Enforce max 3 backups in backups dir
    pruneBackups(3);

    // 4. Write live database into local project targets
    const formattedJson = JSON.stringify(liveDb, null, 2);

    fs.writeFileSync(DB_FILE, formattedJson, 'utf8');
    console.log(`💾 Saved to: data/db.json`);

    fs.writeFileSync(SEED_FILE, formattedJson, 'utf8');
    console.log(`💾 Saved to: data/seed-db.json`);

    if (fs.existsSync(path.dirname(TEMPLATE_FILE))) {
      fs.writeFileSync(TEMPLATE_FILE, formattedJson, 'utf8');
      console.log(`💾 Saved to: src/config/default-db-template.json`);
    }

    console.log('\n============================================================');
    console.log('🎉 SYNC COMPLETE! ALL LIVE RECORDS SECURED!');
    console.log('Max 3 backups maintained and Top 100 runs per mode enforced.');
    console.log('You can now push your code updates to GitHub safely.');
    console.log('============================================================\n');

  } catch (err) {
    console.error('\n❌ SYNC FAILED:', err.message);
    console.error('\nMake sure your Cloudflare server (' + LIVE_SERVER_URL + ') is online and reachable.');
    process.exit(1);
  }
}

syncLiveDatabase();
