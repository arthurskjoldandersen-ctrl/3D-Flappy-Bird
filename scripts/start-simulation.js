/**
 * ============================================================================
 * LOCAL TEST & SIMULATION SERVER LAUNCHER
 * ============================================================================
 * Launches a safe, private local instance of the 3D Flappy Bird server
 * with all real player accounts, records, high scores, skins, and leaderboards.
 *
 * Safety Guarantees:
 * 1. Automatically creates a pre-test safety backup snapshot in `data/backups/`.
 * 2. Enforces maximum 3 latest backup snapshots.
 * 3. Completely isolated from Render: only YOU are playing on your machine.
 * 4. Automatically launches your default web browser to http://localhost:3000.
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SEED_FILE = path.join(DATA_DIR, 'seed-db.json');
const TEMPLATE_FILE = path.join(ROOT_DIR, 'src', 'config', 'default-db-template.json');

// 1. Ensure data directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(BACKUPS_DIR)) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

// 2. Ensure db.json exists, copy from seed or template if missing
if (!fs.existsSync(DB_FILE)) {
  if (fs.existsSync(SEED_FILE)) {
    fs.copyFileSync(SEED_FILE, DB_FILE);
    console.log('📦 Initialized data/db.json from data/seed-db.json.');
  } else if (fs.existsSync(TEMPLATE_FILE)) {
    fs.copyFileSync(TEMPLATE_FILE, DB_FILE);
    console.log('📦 Initialized data/db.json from default-db-template.json.');
  }
}

// 3. Create a safety snapshot of db.json before running test session
if (fs.existsSync(DB_FILE)) {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(BACKUPS_DIR, `test-session-backup-${stamp}.json`);
    fs.copyFileSync(DB_FILE, backupPath);
    console.log(`🛡️ Created pre-test safety backup: ${path.basename(backupPath)}`);
  } catch (err) {
    console.warn('⚠️ Could not create pre-test backup:', err.message);
  }
}

// 4. Prune backups to keep only 3 latest snapshots
function pruneBackups(maxBackups = 3) {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) return;
    const backupFiles = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const full = path.join(BACKUPS_DIR, f);
        return { file: f, full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

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
    console.warn('⚠️ Backup pruning notice:', err.message);
  }
}
pruneBackups(3);

// 5. Flag simulation mode in environment
process.env.SIMULATION_MODE = '1';
process.env.LOCAL_TEST = '1';
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// 6. Automatically open web browser to the game after server starts
if (process.env.NO_BROWSER !== '1') {
  setTimeout(() => {
    const url = `http://localhost:${PORT}`;
    console.log(`🌐 Opening default browser to: ${url}\n`);

    if (process.platform === 'win32') {
      exec(`start "" "${url}"`);
    } else if (process.platform === 'darwin') {
      exec(`open "${url}"`);
    } else {
      exec(`xdg-open "${url}"`);
    }
  }, 1200);
}

// 7. Start server
require('../server.js');
