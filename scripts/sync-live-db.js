/**
 * ============================================================================
 * ONE-CLICK LIVE DATABASE SYNC TOOL FOR RENDER & GITHUB
 * ============================================================================
 * Downloads the live production database directly from your Render server
 * and updates local `data/db.json`, `data/seed-db.json`, and `src/config/default-db-template.json`.
 *
 * Enforces:
 *   - Max 3 backups in data/backups/ (retains only the 3 latest snapshots)
 *   - Max 100 highest runs saved per gamemode (max 300 total across all modes)
 *
 * Usage:
 *   npm run sync-db
 *   or double-click sync-live-data.bat
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const RENDER_URL = process.env.RENDER_URL || 'https://threed-flappy-bird.onrender.com';
const ADMIN_USER = process.env.ADMIN_USER || 'MeDonut';
const ADMIN_PASS = process.env.ADMIN_PASS || 'JohnPork';

const ROOT_DIR = path.resolve(__dirname, '..');
const DB_FILE = path.join(ROOT_DIR, 'data', 'db.json');
const SEED_FILE = path.join(ROOT_DIR, 'data', 'seed-db.json');
const TEMPLATE_FILE = path.join(ROOT_DIR, 'src', 'config', 'default-db-template.json');
const BACKUPS_DIR = path.join(ROOT_DIR, 'data', 'backups');

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => {
      req.destroy();
      reject(new Error('Connection timed out while reaching Render server (' + url + ')'));
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
  console.log('🔄 SYNCING LIVE DATABASE FROM RENDER...');
  console.log('🌐 Target URL: ' + RENDER_URL);
  console.log('============================================================\n');

  try {
    // 1. Authenticate as MeDonut on live server
    console.log('🔑 Logging in as ' + ADMIN_USER + '...');
    const loginRes = await httpRequest(`${RENDER_URL}/api/login`, {
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
    const exportRes = await httpRequest(`${RENDER_URL}/api/database/export`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (exportRes.status !== 200) {
      throw new Error(`Database export failed with status ${exportRes.status}: ${exportRes.body}`);
    }

    const liveDb = JSON.parse(exportRes.body);

    // Enforce top 100 highest runs per difficulty from EACH PLAYER
    ['easy', 'medium', 'hard'].forEach(diff => {
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
          return (a.createdAt || 0) - (b.createdAt || 0);
        });
        prunedRuns.push(...pRuns.slice(0, 100));
      }
      prunedRuns.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (a.createdAt || 0) - (b.createdAt || 0);
      });
      liveDb.runs[diff] = prunedRuns;
    });

    const userCount = Object.keys(liveDb.users || {}).length;
    const easyCount = liveDb.runs?.easy?.length || 0;
    const medCount = liveDb.runs?.medium?.length || 0;
    const hardCount = liveDb.runs?.hard?.length || 0;
    const totalRuns = easyCount + medCount + hardCount;

    console.log(`✅ Live Database Retrieved!`);
    console.log(`   👥 Total Registered Players: ${userCount}`);
    console.log(`   🏃 Total Verified Runs: ${totalRuns} (Easy: ${easyCount}, Med: ${medCount}, Hard: ${hardCount} — capped at Top 100 runs per player per mode)`);

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
    console.error('\nMake sure your Render server is awake and online.');
    process.exit(1);
  }
}

syncLiveDatabase();
