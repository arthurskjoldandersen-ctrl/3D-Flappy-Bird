/**
 * ============================================================================
 * 1-CLICK ZERO-LOSS DATABASE RECOVERY (OLD RENDER + LOCAL -> CLOUDFLARE)
 * ============================================================================
 * Recovers any records, runs, coins, quests, or skins lost when switching
 * from Render to Cloudflare:
 *   1. Connects to old Render server (https://threed-flappy-bird.onrender.com)
 *      and exports its latest live db.json (waits up to 90s for cold wake-up).
 *   2. Also checks local `data/db.json` (in case Render is offline or local
 *      has extra runs/records).
 *   3. Safely MERGES all recovered players, best records, verified runs,
 *      unlocked backgrounds, granted skins, quest skins, coins, and duels
 *      into your new Cloudflare server (https://3d-flappy-bird.arthurskjold.workers.dev)
 *      via POST /api/database/import (mode: "merge" — never deletes existing data!).
 *   4. Syncs the final unified Cloudflare database back to local data/db.json,
 *      data/seed-db.json, and src/config/default-db-template.json.
 *
 * Usage:
 *   npm run recover-db
 *   or double-click recover-from-render.bat
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OLD_RENDER_URL = String(process.env.OLD_RENDER_URL || process.env.RENDER_URL || 'https://threed-flappy-bird.onrender.com').trim().replace(/\/+$/, '');
const NEW_CF_URL = String(process.env.LIVE_SERVER_URL || process.env.CLOUDFLARE_URL || 'https://3d-flappy-bird.arthurskjold.workers.dev').trim().replace(/\/+$/, '');
const ADMIN_USER = process.env.ADMIN_USER || 'MeDonut';
const ADMIN_PASS = process.env.ADMIN_PASS || 'JohnPork';

const ROOT_DIR = path.resolve(__dirname, '..');
const DB_FILE = path.join(ROOT_DIR, 'data', 'db.json');
const SEED_FILE = path.join(ROOT_DIR, 'data', 'seed-db.json');
const TEMPLATE_FILE = path.join(ROOT_DIR, 'src', 'config', 'default-db-template.json');
const BACKUPS_DIR = path.join(ROOT_DIR, 'data', 'backups');

function httpRequest(url, options = {}, timeoutMs = 90000, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'http:' ? http : https;
    const reqHeaders = {
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept': 'application/json',
      'User-Agent': 'FlappyBird3D-Recovery/2.5',
      ...(options.headers || {})
    };
    const req = transport.request(parsed, { ...options, headers: reqHeaders }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirectCount < 3) {
        const nextUrl = new URL(res.headers.location, parsed).toString();
        res.resume();
        return httpRequest(nextUrl, options, timeoutMs, redirectCount + 1).then(resolve, reject);
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
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Timed out connecting to ${url}`));
    });
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function loginAdmin(baseUrl, label, timeoutMs = 90000) {
  console.log(`🔑 Logging into ${label} (${baseUrl}) as ${ADMIN_USER}...`);
  const res = await httpRequest(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS })
  }, timeoutMs);
  if (res.status !== 200) {
    throw new Error(`${label} login failed (HTTP ${res.status}): ${res.body.slice(0, 300)}`);
  }
  const data = JSON.parse(res.body);
  if (!data.token) throw new Error(`${label} returned no session token.`);
  return data.token;
}

async function exportDb(baseUrl, token, label, timeoutMs = 90000) {
  console.log(`📥 Downloading database from ${label}...`);
  const res = await httpRequest(`${baseUrl}/api/database/export`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  }, timeoutMs);
  if (res.status !== 200) {
    throw new Error(`${label} export failed (HTTP ${res.status}): ${res.body.slice(0, 300)}`);
  }
  return JSON.parse(res.body);
}

async function importMergeToCloudflare(cfToken, snapshotObj, sourceLabel) {
  console.log(`🚀 Merging ${sourceLabel} into Cloudflare (${NEW_CF_URL})...`);
  const payloadStr = JSON.stringify({ mode: 'merge', snapshot: snapshotObj });
  const res = await httpRequest(`${NEW_CF_URL}/api/database/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfToken}`
    },
    body: payloadStr
  }, 90000);

  if (res.status === 404) {
    throw new Error(
      'Your Cloudflare server does not have the new /api/database/import endpoint deployed yet!\n' +
      '   Please upload the updated files to GitHub so Cloudflare finishes deploying first, then run this script again.'
    );
  }
  if (res.status !== 200) {
    throw new Error(`Cloudflare merge failed (HTTP ${res.status}): ${res.body.slice(0, 400)}`);
  }
  const result = JSON.parse(res.body);
  console.log(`✅ ${result.message}`);
  if (Array.isArray(result.changes) && result.changes.length > 0) {
    console.log('   Recovered highlights:');
    result.changes.slice(0, 30).forEach(line => console.log('     ' + line));
    if (result.changes.length > 30) {
      console.log(`     ...and ${result.changes.length - 30} more updates`);
    }
  }
  return result;
}

async function runRecovery() {
  console.log('============================================================');
  console.log(' 🛡️  3D FLAPPY BIRD — ZERO-LOSS DATA RECOVERY TOOL');
  console.log('============================================================');
  console.log(' Old Render Server:    ' + OLD_RENDER_URL);
  console.log(' New Cloudflare URL:   ' + NEW_CF_URL);
  console.log('============================================================\n');

  let renderDb = null;
  if (process.env.SKIP_RENDER !== '1') {
    try {
      console.log('⏳ Reaching old Render server (may take 30-60s if sleeping)...');
      const renderToken = await loginAdmin(OLD_RENDER_URL, 'Old Render Server', 90000);
      renderDb = await exportDb(OLD_RENDER_URL, renderToken, 'Old Render Server', 90000);
      const rUsers = Object.keys(renderDb.users || {}).length;
      const rRuns = ['easy', 'medium', 'hard', 'extreme'].reduce((s, m) => s + ((renderDb.runs && renderDb.runs[m]) ? renderDb.runs[m].length : 0), 0);
      console.log(`✅ Retrieved Old Render Database: ${rUsers} players, ${rRuns} verified runs!\n`);
    } catch (renderErr) {
      console.warn(`⚠️  Could not pull from Old Render Server: ${renderErr.message}`);
      console.warn('   Continuing recovery using your local data/db.json backup!\n');
    }
  }

  let localDb = null;
  if (fs.existsSync(DB_FILE)) {
    try {
      localDb = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      const lUsers = Object.keys(localDb.users || {}).length;
      const lRuns = ['easy', 'medium', 'hard', 'extreme'].reduce((s, m) => s + ((localDb.runs && localDb.runs[m]) ? localDb.runs[m].length : 0), 0);
      console.log(`📦 Loaded local data/db.json: ${lUsers} players, ${lRuns} verified runs.\n`);
    } catch (e) {
      console.warn('⚠️  Could not read local data/db.json:', e.message);
    }
  }

  if (!renderDb && !localDb) {
    throw new Error('Neither the old Render server nor local data/db.json could be read!');
  }

  // Authenticate on Cloudflare
  const cfToken = await loginAdmin(NEW_CF_URL, 'Cloudflare Server', 60000);

  // Merge Render data first (most recent pre-switch data!)
  if (renderDb) {
    await importMergeToCloudflare(cfToken, renderDb, 'Old Render Server Database');
  }
  // Also merge local data/db.json so any extra runs/skins saved locally are recovered too!
  if (localDb) {
    await importMergeToCloudflare(cfToken, localDb, 'Local data/db.json');
  }

  // Pull final unified database back from Cloudflare and save locally
  const finalDb = await exportDb(NEW_CF_URL, cfToken, 'Cloudflare Server (Final Unified DB)', 60000);
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(DB_FILE, path.join(BACKUPS_DIR, `pre-recovery-backup-${stamp}.json`));
  }
  const formatted = JSON.stringify(finalDb, null, 2);
  fs.writeFileSync(DB_FILE, formatted, 'utf8');
  fs.writeFileSync(SEED_FILE, formatted, 'utf8');
  if (fs.existsSync(path.dirname(TEMPLATE_FILE))) {
    fs.writeFileSync(TEMPLATE_FILE, formatted, 'utf8');
  }

  console.log('\n============================================================');
  console.log(' 🎉 ALL LOST RECORDS, RUNS, COINS & SKINS RECOVERED!');
  console.log(' ✅ Merged into Cloudflare: ' + NEW_CF_URL);
  console.log(' ✅ Saved locally to: data/db.json, data/seed-db.json & default-db-template.json');
  console.log('============================================================\n');
}

runRecovery().catch((err) => {
  console.error('\n❌ RECOVERY FAILED:', err.message);
  process.exit(1);
});
