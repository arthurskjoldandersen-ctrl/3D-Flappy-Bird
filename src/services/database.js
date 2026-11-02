/**
 * ============================================================================
 * LIVE AUTO-UPDATING PLAYER & LEADERBOARD DATABASE SERVICE
 * ============================================================================
 * Features:
 * - Stores all player accounts, records, Top 100 multi-entry runs, and sessions
 *   in human-readable `data/db.json` (with automatic `data/seed-db.json` backup).
 * - Automatically updates `databaseStatus`, `playerRecordsOverview`, and
 *   `activityFeed` whenever players:
 *     1. Log in / Quick-switch accounts (tracks login count, timestamp & status)
 *     2. Register a new account
 *     3. Achieve a NEW BEST score in Easy, Medium, or Hard mode!
 *     4. Complete a verified run or change skins
 * - Supports live manual editing of `data/db.json` OR editing via the built-in
 *   Database Manager UI (`/database`): if you change a player's record in
 *   `playerRecordsOverview` or `users`, it automatically syncs to the
 *   leaderboards and player profile!
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : ROOT_DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SEED_FILE = path.join(ROOT_DATA_DIR, 'seed-db.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function formatReadableTimestamp(ms) {
  if (!ms || ms <= 0) return 'Never';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

let isInternalWrite = false;

let db = {
  databaseStatus: {},
  playerRecordsOverview: {},
  activityFeed: [],
  users: {},
  runs: { easy: [], medium: [], hard: [] },
  sessions: {}
};

/**
 * Adds a human-readable entry to the top of `db.activityFeed` and updates `databaseStatus.latestEventBanner`
 */
function logDatabaseEvent(type, username, message, details = {}) {
  const now = Date.now();
  const readableTime = formatReadableTimestamp(now);
  if (!Array.isArray(db.activityFeed)) {
    db.activityFeed = [];
  }

  const entry = {
    id: crypto.randomBytes(6).toString('hex'),
    timestampMs: now,
    time: readableTime,
    type,
    username: username || 'System',
    message,
    ...details
  };

  db.activityFeed.unshift(entry);
  if (db.activityFeed.length > 250) {
    db.activityFeed.length = 250;
  }

  if (!db.databaseStatus || typeof db.databaseStatus !== 'object') {
    db.databaseStatus = {};
  }
  db.databaseStatus.latestEventBanner = `[${readableTime}] ${message}`;
  db.databaseStatus.lastEventType = type;
  db.databaseStatus.lastEventPlayer = username || 'System';
}

/**
 * Synchronizes `playerRecordsOverview`, `users`, and `runs` (Top 100 per mode).
 * If someone manually edited `playerRecordsOverview[username].records` or `users[key].records`
 * in `data/db.json`, this applies those edits and ensures the Top 100 leaderboard reflects them!
 */
function syncAndRebuildOverview(fromExternalFileLoad = false) {
  if (!db.users || typeof db.users !== 'object') db.users = {};
  if (!db.runs || typeof db.runs !== 'object') db.runs = { easy: [], medium: [], hard: [] };
  ['easy', 'medium', 'hard'].forEach(diff => {
    if (!Array.isArray(db.runs[diff])) db.runs[diff] = [];
  });
  if (!db.sessions || typeof db.sessions !== 'object') db.sessions = {};
  if (!Array.isArray(db.activityFeed)) db.activityFeed = [];

  // 1. If loaded from external file edit, check if the owner edited `playerRecordsOverview` directly
  if (fromExternalFileLoad && db.playerRecordsOverview && typeof db.playerRecordsOverview === 'object') {
    for (const [ovKey, ovData] of Object.entries(db.playerRecordsOverview)) {
      if (!ovData || !ovData.records) continue;
      const uKey = (ovData.username || ovKey).toLowerCase();
      const user = db.users[uKey];
      if (!user) continue;
      if (!user.records) user.records = { easy: 0, medium: 0, hard: 0 };

      ['easy', 'medium', 'hard'].forEach(diff => {
        const ovScore = Number(ovData.records[diff]);
        const oldUserScore = Number(user._lastSyncedRecords && user._lastSyncedRecords[diff]);
        if (!Number.isNaN(ovScore) && ovScore >= 0 && ovScore !== oldUserScore && ovScore !== Number(user.records[diff])) {
          const prev = Number(user.records[diff]) || 0;
          user.records[diff] = ovScore;
          if (!user.recordTimestamps) user.recordTimestamps = { easy: 0, medium: 0, hard: 0 };
          user.recordTimestamps[diff] = Date.now();
          user.lastNewBestAt = Date.now();
          user.lastNewBestText = `🏆 Updated ${diff.toUpperCase()} Best: ${ovScore} pts (was ${prev} pts)`;
          logDatabaseEvent(
            'RECORD_EDITED',
            user.username,
            `✏️ ${user.username}'s ${diff.toUpperCase()} record was updated in db.json: ${prev} -> ${ovScore} pts`,
            { difficulty: diff, oldScore: prev, newScore: ovScore }
          );
        }
      });

      if (typeof ovData.selectedSkin === 'string' && ovData.selectedSkin) {
        user.selectedSkin = ovData.selectedSkin;
      }
      if (typeof ovData.selectedPipeSkin === 'string' && ovData.selectedPipeSkin) {
        user.selectedPipeSkin = ovData.selectedPipeSkin;
      }
    }
  }

  // 2. Ensure every user's best records exist in `db.runs` and track synced state
  for (const user of Object.values(db.users)) {
    if (!user || !user.username) continue;
    if (!user.records) user.records = { easy: 0, medium: 0, hard: 0 };
    if (!user.recordTimestamps) user.recordTimestamps = { easy: 0, medium: 0, hard: 0 };
    if (typeof user.loginCount !== 'number') user.loginCount = 0;

    // Also check if `user.records` was directly edited in `db.users`
    if (fromExternalFileLoad && user._lastSyncedRecords) {
      ['easy', 'medium', 'hard'].forEach(diff => {
        const cur = Number(user.records[diff]) || 0;
        const prev = Number(user._lastSyncedRecords[diff]) || 0;
        if (cur !== prev) {
          user.recordTimestamps[diff] = Date.now();
          user.lastNewBestAt = Date.now();
          user.lastNewBestText = `🏆 Updated ${diff.toUpperCase()} Best: ${cur} pts (was ${prev} pts)`;
          logDatabaseEvent(
            'RECORD_EDITED',
            user.username,
            `✏️ ${user.username}'s ${diff.toUpperCase()} record was updated: ${prev} -> ${cur} pts`,
            { difficulty: diff, oldScore: prev, newScore: cur }
          );
        }
      });
    }

    ['easy', 'medium', 'hard'].forEach(diff => {
      const best = Number(user.records[diff]) || 0;
      if (best > 0) {
        const alreadyInRuns = db.runs[diff].some(
          r => r && r.username && r.username.toLowerCase() === user.username.toLowerCase() && r.score === best
        );
        if (!alreadyInRuns) {
          db.runs[diff].push({
            id: crypto.randomBytes(8).toString('hex'),
            username: user.username,
            score: best,
            createdAt: (user.recordTimestamps && user.recordTimestamps[diff]) || user.createdAt || Date.now()
          });
        }
      }
    });

    user._lastSyncedRecords = {
      easy: Number(user.records.easy) || 0,
      medium: Number(user.records.medium) || 0,
      hard: Number(user.records.hard) || 0
    };
  }

  // 3. Sort and trim `db.runs` (Top 100 per difficulty)
  ['easy', 'medium', 'hard'].forEach(diff => {
    db.runs[diff] = db.runs[diff]
      .filter(r => r && typeof r.score === 'number' && r.score > 0 && r.username)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (a.createdAt || 0) - (b.createdAt || 0);
      })
      .slice(0, 100);
  });

  // 4. Rebuild `playerRecordsOverview` sorted by highest all-time best score so `db.json` is super easy to inspect & edit
  const sortedUsers = Object.values(db.users)
    .filter(u => u && u.username)
    .sort((a, b) => {
      const maxA = Math.max(Number(a.records?.easy) || 0, Number(a.records?.medium) || 0, Number(a.records?.hard) || 0);
      const maxB = Math.max(Number(b.records?.easy) || 0, Number(b.records?.medium) || 0, Number(b.records?.hard) || 0);
      if (maxB !== maxA) return maxB - maxA;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });

  const overview = {};
  for (const u of sortedUsers) {
    const eBest = Number(u.records?.easy) || 0;
    const mBest = Number(u.records?.medium) || 0;
    const hBest = Number(u.records?.hard) || 0;
    const allTimeBest = Math.max(eBest, mBest, hBest);

    // Count how many placements this player currently holds across the Top 100 leaderboards
    const easySpots = db.runs.easy.filter(r => r.username.toLowerCase() === u.username.toLowerCase()).length;
    const medSpots = db.runs.medium.filter(r => r.username.toLowerCase() === u.username.toLowerCase()).length;
    const hardSpots = db.runs.hard.filter(r => r.username.toLowerCase() === u.username.toLowerCase()).length;

    const latestBestTime = Math.max(
      Number(u.recordTimestamps?.easy) || 0,
      Number(u.recordTimestamps?.medium) || 0,
      Number(u.recordTimestamps?.hard) || 0,
      Number(u.lastNewBestAt) || 0
    );

    overview[u.username] = {
      username: u.username,
      summary: `🏆 Best: ${allTimeBest} pts (Easy: ${eBest} | Medium: ${mBest} | Hard: ${hBest})`,
      loginStatus: u.lastLoginAt
        ? `🔑 Logged in ${u.loginCount || 1} time(s) • Last login: ${formatReadableTimestamp(u.lastLoginAt)}`
        : `⚪ Registered ${formatReadableTimestamp(u.createdAt)} • Logins tracked: ${u.loginCount || 0}`,
      newBestStatus: u.lastNewBestText || (allTimeBest > 0
        ? `🔥 Personal Bests — Easy: ${eBest}, Medium: ${mBest}, Hard: ${hBest} (Updated: ${formatReadableTimestamp(latestBestTime)})`
        : 'No personal best set yet'),
      records: {
        easy: eBest,
        medium: mBest,
        hard: hBest
      },
      allTimeBest,
      leaderboardPlacements: {
        total: easySpots + medSpots + hardSpots,
        easy: easySpots,
        medium: medSpots,
        hard: hardSpots
      },
      selectedSkin: u.selectedSkin || 'classic',
      selectedPipeSkin: u.selectedPipeSkin || 'classic_pipe',
      loginCount: u.loginCount || 0,
      lastLoginAtReadable: formatReadableTimestamp(u.lastLoginAt),
      lastNewBestAtReadable: formatReadableTimestamp(latestBestTime),
      createdAtReadable: formatReadableTimestamp(u.createdAt)
    };
  }
  db.playerRecordsOverview = overview;

  // 5. Update `databaseStatus` summary header at the very top of `db.json`
  const easyChamp = db.runs.easy[0] ? `${db.runs.easy[0].username} (${db.runs.easy[0].score} pts)` : 'None';
  const medChamp = db.runs.medium[0] ? `${db.runs.medium[0].username} (${db.runs.medium[0].score} pts)` : 'None';
  const hardChamp = db.runs.hard[0] ? `${db.runs.hard[0].username} (${db.runs.hard[0].score} pts)` : 'None';

  const now = Date.now();
  db.databaseStatus = {
    lastUpdatedISO: new Date(now).toISOString(),
    lastUpdatedReadable: formatReadableTimestamp(now),
    latestEventBanner: (db.databaseStatus && db.databaseStatus.latestEventBanner) ||
      `🟢 Database Active — ${sortedUsers.length} Players & ${db.runs.easy.length + db.runs.medium.length + db.runs.hard.length} Verified Runs`,
    lastEventType: (db.databaseStatus && db.databaseStatus.lastEventType) || 'STARTUP',
    lastEventPlayer: (db.databaseStatus && db.databaseStatus.lastEventPlayer) || 'System',
    currentChampions: {
      easy: easyChamp,
      medium: medChamp,
      hard: hardChamp
    },
    totalRegisteredPlayers: sortedUsers.length,
    totalLeaderboardRuns: {
      easy: db.runs.easy.length,
      medium: db.runs.medium.length,
      hard: db.runs.hard.length,
      total: db.runs.easy.length + db.runs.medium.length + db.runs.hard.length
    },
    howToViewOrEdit: 'Open /database in your browser OR edit records directly in playerRecordsOverview / users below and save this file!'
  };
}

function loadDatabase(fromWatcher = false) {
  try {
    if (!fs.existsSync(DB_FILE) && fs.existsSync(SEED_FILE)) {
      fs.copyFileSync(SEED_FILE, DB_FILE);
    }
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.users === 'object') {
        db = {
          databaseStatus: parsed.databaseStatus || {},
          playerRecordsOverview: parsed.playerRecordsOverview || {},
          activityFeed: Array.isArray(parsed.activityFeed) ? parsed.activityFeed : [],
          users: parsed.users || {},
          runs: parsed.runs || { easy: [], medium: [], hard: [] },
          sessions: parsed.sessions || {}
        };
      }
    }

    if (db.activityFeed.length === 0) {
      logDatabaseEvent(
        'DATABASE_READY',
        'System',
        '🚀 3D Flappy Bird Live Database initialized with all player accounts & Top 100 leaderboard records.'
      );
    }

    syncAndRebuildOverview(fromWatcher);
    saveDatabase();
  } catch (err) {
    console.error('Error loading database:', err.message);
  }
}

function saveDatabase() {
  try {
    syncAndRebuildOverview(false);
    isInternalWrite = true;
    const orderedDb = {
      databaseStatus: db.databaseStatus,
      playerRecordsOverview: db.playerRecordsOverview,
      activityFeed: db.activityFeed,
      users: db.users,
      runs: db.runs,
      sessions: db.sessions
    };
    const tmpFile = DB_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(orderedDb, null, 2), 'utf8');
    fs.renameSync(tmpFile, DB_FILE);
    setTimeout(() => { isInternalWrite = false; }, 250);
  } catch (err) {
    isInternalWrite = false;
    console.error('Error saving database:', err.message);
  }
}

// Watch `data/db.json` so if the owner edits & saves `db.json` in a text editor, changes apply live!
fs.watchFile(DB_FILE, { interval: 1500, persistent: false }, (curr, prev) => {
  if (isInternalWrite) return;
  if (curr.mtimeMs !== prev.mtimeMs) {
    console.log('🔄 Detected external edit to data/db.json — reloading & syncing records...');
    loadDatabase(true);
  }
});

/**
 * Builds the 3-Difficulty Leaderboards (Top 100 per difficulty)
 */
function buildLeaderboards() {
  const result = { easy: [], medium: [], hard: [] };

  ['easy', 'medium', 'hard'].forEach(diff => {
    const runsList = (db.runs && Array.isArray(db.runs[diff])) ? db.runs[diff] : [];
    result[diff] = runsList
      .filter(entry => entry && typeof entry.score === 'number' && entry.score > 0)
      .slice()
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (a.createdAt || 0) - (b.createdAt || 0);
      })
      .slice(0, 100)
      .map(entry => ({
        id: entry.id,
        username: entry.username,
        score: entry.score,
        updatedAt: entry.createdAt
      }));
  });

  return result;
}

/**
 * Records a user login (password login or quick-switch) in the database
 */
function recordUserLogin(user, method = 'login') {
  const now = Date.now();
  user.loginCount = (Number(user.loginCount) || 0) + 1;
  user.lastLoginAt = now;
  user.lastLoginReadable = formatReadableTimestamp(now);
  user.lastLoginMethod = method;

  const r = user.records || { easy: 0, medium: 0, hard: 0 };
  const msg = `🔑 ${user.username} logged in (${method === 'quick-switch' ? 'Quick Login' : 'Password Login'} #${user.loginCount}) — Current Bests: Easy ${r.easy || 0} | Medium ${r.medium || 0} | Hard ${r.hard || 0}`;

  logDatabaseEvent('LOGIN', user.username, msg, {
    loginCount: user.loginCount,
    records: { ...r }
  });
  saveDatabase();
}

/**
 * Records a verified game run and checks/logs if the player achieved a NEW BEST!
 */
function recordVerifiedRun(user, diffKey, verifiedScore) {
  const now = Date.now();
  if (!user.records) user.records = { easy: 0, medium: 0, hard: 0 };
  if (!user.recordTimestamps) user.recordTimestamps = { easy: 0, medium: 0, hard: 0 };

  const previousBest = Number(user.records[diffKey]) || 0;
  let isNewRecord = false;

  if (verifiedScore > previousBest) {
    user.records[diffKey] = verifiedScore;
    user.recordTimestamps[diffKey] = now;
    user.lastNewBestAt = now;
    user.lastNewBestReadable = formatReadableTimestamp(now);
    user.lastNewBestMode = diffKey;
    user.lastNewBestScore = verifiedScore;
    user.lastNewBestPrevious = previousBest;
    user.lastNewBestText = `🔥 NEW BEST in ${diffKey.toUpperCase()}: ${verifiedScore} pts (beat old best of ${previousBest} pts on ${formatReadableTimestamp(now)})`;
    isNewRecord = true;

    logDatabaseEvent(
      'NEW_BEST',
      user.username,
      `🏆 NEW BEST! ${user.username} achieved a new ${diffKey.toUpperCase()} record of ${verifiedScore} pts! (Previous best: ${previousBest} pts)`,
      {
        difficulty: diffKey,
        newBest: verifiedScore,
        previousBest,
        records: { ...user.records }
      }
    );
  } else {
    logDatabaseEvent(
      'VERIFIED_RUN',
      user.username,
      `🎮 ${user.username} finished a verified ${diffKey.toUpperCase()} run with ${verifiedScore} pts (Personal Best: ${previousBest} pts)`,
      {
        difficulty: diffKey,
        score: verifiedScore,
        personalBest: previousBest
      }
    );
  }

  let newRunId = null;
  if (verifiedScore > 0) {
    if (!db.runs) db.runs = { easy: [], medium: [], hard: [] };
    if (!Array.isArray(db.runs[diffKey])) db.runs[diffKey] = [];

    newRunId = crypto.randomBytes(8).toString('hex');
    db.runs[diffKey].push({
      id: newRunId,
      username: user.username,
      score: verifiedScore,
      createdAt: now
    });

    db.runs[diffKey].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
    if (db.runs[diffKey].length > 100) {
      db.runs[diffKey].length = 100;
    }
  }

  saveDatabase();
  return { isNewRecord, newRunId, previousBest };
}

/**
 * Allows the game owner to directly update a player's records or skins via the `/database` manager
 */
function updatePlayerRecordsAdmin(username, newRecords, selectedSkin, selectedPipeSkin) {
  const cleanName = typeof username === 'string' ? username.trim() : '';
  const uKey = cleanName.toLowerCase();
  const user = db.users[uKey];
  if (!user) {
    throw new Error(`Player "${cleanName}" not found in database.`);
  }

  const now = Date.now();
  if (!user.records) user.records = { easy: 0, medium: 0, hard: 0 };
  if (!user.recordTimestamps) user.recordTimestamps = { easy: 0, medium: 0, hard: 0 };

  const changes = [];
  ['easy', 'medium', 'hard'].forEach(diff => {
    if (newRecords && newRecords[diff] !== undefined) {
      const val = Math.max(0, Math.floor(Number(newRecords[diff]) || 0));
      const oldVal = Number(user.records[diff]) || 0;
      if (val !== oldVal) {
        user.records[diff] = val;
        user.recordTimestamps[diff] = now;
        changes.push(`${diff.toUpperCase()}: ${oldVal} -> ${val}`);

        // Also update or insert into db.runs[diff]
        if (val > 0) {
          db.runs[diff].push({
            id: crypto.randomBytes(8).toString('hex'),
            username: user.username,
            score: val,
            createdAt: now
          });
        }
      }
    }
  });

  if (typeof selectedSkin === 'string' && selectedSkin.trim()) {
    user.selectedSkin = selectedSkin.trim();
  }
  if (typeof selectedPipeSkin === 'string' && selectedPipeSkin.trim()) {
    user.selectedPipeSkin = selectedPipeSkin.trim();
  }

  if (changes.length > 0) {
    user.lastNewBestAt = now;
    user.lastNewBestReadable = formatReadableTimestamp(now);
    user.lastNewBestText = `✏️ Records updated (${changes.join(', ')}) on ${formatReadableTimestamp(now)}`;
    logDatabaseEvent(
      'ADMIN_RECORD_UPDATE',
      user.username,
      `🛠️ Updated ${user.username}'s records: ${changes.join(', ')}`,
      { changes, records: { ...user.records } }
    );
  }

  saveDatabase();
  return db.playerRecordsOverview[user.username];
}

/**
 * Deletes a specific leaderboard run entry by ID and recalculates the player's best if needed
 */
function deleteLeaderboardEntryAdmin(difficulty, entryId) {
  if (!['easy', 'medium', 'hard'].includes(difficulty)) {
    throw new Error('Invalid difficulty.');
  }
  const list = db.runs[difficulty] || [];
  const idx = list.findIndex(r => r.id === entryId);
  if (idx === -1) {
    throw new Error('Leaderboard entry not found.');
  }
  const removed = list.splice(idx, 1)[0];

  // Recalculate that player's highest remaining score in this mode if their best matched the removed run
  const uKey = removed.username.toLowerCase();
  const user = db.users[uKey];
  if (user && user.records && user.records[difficulty] === removed.score) {
    const highestRemaining = list
      .filter(r => r.username.toLowerCase() === uKey)
      .reduce((max, r) => Math.max(max, r.score), 0);
    user.records[difficulty] = highestRemaining;
  }

  logDatabaseEvent(
    'ADMIN_DELETE_RUN',
    removed.username,
    `🗑️ Removed ${removed.username}'s ${difficulty.toUpperCase()} score of ${removed.score} pts from the leaderboard`,
    { difficulty, removed }
  );
  saveDatabase();
  return removed;
}

loadDatabase(false);

module.exports = {
  getDb: () => db,
  DB_FILE,
  loadDatabase,
  saveDatabase,
  hashPassword,
  buildLeaderboards,
  logDatabaseEvent,
  recordUserLogin,
  recordVerifiedRun,
  updatePlayerRecordsAdmin,
  deleteLeaderboardEntryAdmin,
  formatReadableTimestamp
};
