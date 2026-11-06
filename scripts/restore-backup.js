/**
 * ============================================================================
 * RESTORE DATABASE FROM LATEST BACKUP SNAPSHOT
 * ============================================================================
 * Reverts data/db.json, data/seed-db.json, and default-db-template.json
 * to the most recent clean backup snapshot in data/backups/.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const BACKUPS_DIR = path.join(ROOT_DIR, 'data', 'backups');
const DB_FILE = path.join(ROOT_DIR, 'data', 'db.json');
const SEED_FILE = path.join(ROOT_DIR, 'data', 'seed-db.json');
const TEMPLATE_FILE = path.join(ROOT_DIR, 'src', 'config', 'default-db-template.json');

console.log('============================================================');
console.log(' 🛡️ RESTORE DATABASE FROM LATEST BACKUP');
console.log('============================================================');

if (!fs.existsSync(BACKUPS_DIR)) {
  console.error('❌ Error: No backups directory found at data/backups/.');
  process.exit(1);
}

const backups = fs.readdirSync(BACKUPS_DIR)
  .filter(f => f.endsWith('.json'))
  .map(f => {
    const full = path.join(BACKUPS_DIR, f);
    return { file: f, full, mtime: fs.statSync(full).mtimeMs };
  })
  .sort((a, b) => b.mtime - a.mtime); // Newest first

if (backups.length === 0) {
  console.error('❌ Error: No backup files found in data/backups/.');
  process.exit(1);
}

const latest = backups[0];
console.log(`Found ${backups.length} backup snapshot(s).`);
console.log(`Restoring from newest: ${latest.file}...`);

try {
  const content = fs.readFileSync(latest.full, 'utf8');
  const parsed = JSON.parse(content); // Ensure valid JSON

  const userCount = Object.keys(parsed.users || {}).length;
  const easyCount = parsed.runs?.easy?.length || 0;
  const medCount = parsed.runs?.medium?.length || 0;
  const hardCount = parsed.runs?.hard?.length || 0;

  fs.writeFileSync(DB_FILE, content, 'utf8');
  console.log(`💾 Restored: data/db.json`);

  fs.writeFileSync(SEED_FILE, content, 'utf8');
  console.log(`💾 Restored: data/seed-db.json`);

  if (fs.existsSync(path.dirname(TEMPLATE_FILE))) {
    fs.writeFileSync(TEMPLATE_FILE, content, 'utf8');
    console.log(`💾 Restored: src/config/default-db-template.json`);
  }

  console.log('\n============================================================');
  console.log(`🎉 RESTORE SUCCESSFUL!`);
  console.log(`   👥 Total Registered Players: ${userCount}`);
  console.log(`   🏃 Total Verified Runs: ${easyCount + medCount + hardCount} (Easy: ${easyCount}, Med: ${medCount}, Hard: ${hardCount})`);
  console.log(`All local records have been reverted to: ${latest.file}`);
  console.log('============================================================\n');
} catch (err) {
  console.error('❌ Error restoring backup:', err.message);
  process.exit(1);
}
