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
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const TEMPLATE_FILE = path.join(__dirname, '..', 'config', 'default-db-template.json');
const SEED_FILE = path.join(ROOT_DATA_DIR, 'seed-db.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(BACKUPS_DIR)) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
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
  loginHistory: [],
  adminSettings: {},
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
 * Synchronizes a user's runs in `db.runs[diff]` when their Best Score is changed to `newBest`.
 * - If `newBest === 0`: removes any non-hidden runs for that user in `diff` (or marks them hidden if already hidden) so they no longer appear on the leaderboard.
 * - If `newBest > 0`:
 *   1. Any run for this user in `db.runs[diff]` with `score > newBest` is clamped down to `newBest`.
 *   2. If the user's highest visible run in `db.runs[diff]` is `< newBest`, updates their top run to `newBest` (or inserts a new visible run if they have none).
 *   3. Deduplicates multiple identical top-score runs created by clamping.
 */
function syncUserRunsToBestScore(username, diff, newBest, timestampMs = Date.now()) {
  if (!db.runs || !Array.isArray(db.runs[diff])) return;
  const uLower = String(username || '').toLowerCase();
  const cleanBest = Math.max(0, Math.floor(Number(newBest) || 0));

  if (cleanBest === 0) {
    // Remove visible runs for this user in this mode so they are removed from the leaderboard
    db.runs[diff] = db.runs[diff].filter(
      r => !r || !r.username || r.username.toLowerCase() !== uLower || r.hidden === true
    );
    return;
  }

  const userRuns = db.runs[diff].filter(r => r && r.username && r.username.toLowerCase() === uLower);
  if (userRuns.length === 0) {
    db.runs[diff].push({
      id: crypto.randomBytes(8).toString('hex'),
      username,
      score: cleanBest,
      hidden: false,
      createdAt: timestampMs
    });
    return;
  }

  // Clamp any runs that exceed `cleanBest` down to `cleanBest`
  let hasRunWithNewBest = false;
  for (const r of userRuns) {
    if (r.score > cleanBest) {
      r.score = cleanBest;
      r.createdAt = timestampMs;
    }
    if (!r.hidden && r.score === cleanBest) {
      hasRunWithNewBest = true;
    }
  }

  // If no visible run has `cleanBest`, update their highest run to `cleanBest` (and make it visible)
  if (!hasRunWithNewBest) {
    const visibleRuns = userRuns.filter(r => !r.hidden);
    const targetRun = (visibleRuns.length > 0 ? visibleRuns : userRuns).reduce(
      (bestR, curR) => (!bestR || curR.score > bestR.score ? curR : bestR),
      null
    );
    if (targetRun) {
      targetRun.score = cleanBest;
      targetRun.hidden = false;
      targetRun.createdAt = timestampMs;
    } else {
      db.runs[diff].push({
        id: crypto.randomBytes(8).toString('hex'),
        username,
        score: cleanBest,
        hidden: false,
        createdAt: timestampMs
      });
    }
  }
}

/**
 * Recalculates `user.records[diff]` from the user's highest visible (`!r.hidden`) run in `db.runs[diff]`.
 */
function recalculateUserBestFromVisibleRuns(username, diff) {
  const uLower = String(username || '').toLowerCase();
  const user = db.users && db.users[uLower];
  if (!user) return 0;
  if (!user.records) user.records = { easy: 0, medium: 0, hard: 0 };

  const list = (db.runs && Array.isArray(db.runs[diff])) ? db.runs[diff] : [];
  const highestVisible = list
    .filter(r => r && r.username && r.username.toLowerCase() === uLower && !r.hidden)
    .reduce((max, r) => Math.max(max, Number(r.score) || 0), 0);

  user.records[diff] = highestVisible;
  if (user._lastSyncedRecords) {
    user._lastSyncedRecords[diff] = highestVisible;
  }
  return highestVisible;
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
          const cleanVal = Math.max(0, Math.floor(ovScore));
          user.records[diff] = cleanVal;
          if (!user.recordTimestamps) user.recordTimestamps = { easy: 0, medium: 0, hard: 0 };
          user.recordTimestamps[diff] = Date.now();
          user.lastNewBestAt = Date.now();
          user.lastNewBestText = `🏆 Updated ${diff.toUpperCase()} Best: ${cleanVal} pts (was ${prev} pts)`;
          syncUserRunsToBestScore(user.username, diff, cleanVal, Date.now());
          logDatabaseEvent(
            'RECORD_EDITED',
            user.username,
            `✏️ ${user.username}'s ${diff.toUpperCase()} record was updated in db.json: ${prev} -> ${cleanVal} pts`,
            { difficulty: diff, oldScore: prev, newScore: cleanVal }
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
  const sessionList = Object.values(db.sessions || {});
  for (const user of Object.values(db.users)) {
    if (!user || !user.username) continue;
    if (!user.records) user.records = { easy: 0, medium: 0, hard: 0 };
    if (!user.recordTimestamps) user.recordTimestamps = { easy: 0, medium: 0, hard: 0 };

    // Backfill historical login count & last login timestamp from active sessions + account registration
    const uKeyLower = user.username.toLowerCase();
    const userSessions = sessionList.filter(
      s => s && ((s.usernameKey && s.usernameKey.toLowerCase() === uKeyLower) || (s.username && s.username.toLowerCase() === uKeyLower))
    );
    const maxSessionTime = userSessions.reduce((maxT, s) => Math.max(maxT, Number(s.createdAt) || 0), 0);
    const derivedLoginCount = Math.max(userSessions.length, user.createdAt ? 1 : 0);
    if (typeof user.loginCount !== 'number' || user.loginCount < derivedLoginCount) {
      user.loginCount = derivedLoginCount;
    }
    const derivedLastLogin = Math.max(Number(user.lastLoginAt) || 0, maxSessionTime, Number(user.createdAt) || 0);
    if (derivedLastLogin > 0) {
      user.lastLoginAt = derivedLastLogin;
      user.lastLoginReadable = formatReadableTimestamp(derivedLastLogin);
    }

    // Also check if `user.records` was directly edited in `db.users`
    if (fromExternalFileLoad && user._lastSyncedRecords) {
      ['easy', 'medium', 'hard'].forEach(diff => {
        const cur = Math.max(0, Math.floor(Number(user.records[diff]) || 0));
        const prev = Number(user._lastSyncedRecords[diff]) || 0;
        if (cur !== prev) {
          user.records[diff] = cur;
          user.recordTimestamps[diff] = Date.now();
          user.lastNewBestAt = Date.now();
          user.lastNewBestText = `🏆 Updated ${diff.toUpperCase()} Best: ${cur} pts (was ${prev} pts)`;
          syncUserRunsToBestScore(user.username, diff, cur, Date.now());
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
            hidden: false,
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

  // 3. Sort and trim `db.runs` (keep up to 300 runs per difficulty so hidden & historical runs are preserved)
  ['easy', 'medium', 'hard'].forEach(diff => {
    db.runs[diff] = db.runs[diff]
      .filter(r => r && typeof r.score === 'number' && r.score > 0 && r.username)
      .map(r => ({
        ...r,
        hidden: Boolean(r.hidden)
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (a.createdAt || 0) - (b.createdAt || 0);
      })
      .slice(0, 300);
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
    const uLower = u.username.toLowerCase();

    // Count how many VISIBLE placements this player currently holds across the leaderboards
    const easySpots = db.runs.easy.filter(r => r.username.toLowerCase() === uLower && !r.hidden).length;
    const medSpots = db.runs.medium.filter(r => r.username.toLowerCase() === uLower && !r.hidden).length;
    const hardSpots = db.runs.hard.filter(r => r.username.toLowerCase() === uLower && !r.hidden).length;

    // Also count total runs (including hidden) per mode
    const easyTotalRuns = db.runs.easy.filter(r => r.username.toLowerCase() === uLower).length;
    const medTotalRuns = db.runs.medium.filter(r => r.username.toLowerCase() === uLower).length;
    const hardTotalRuns = db.runs.hard.filter(r => r.username.toLowerCase() === uLower).length;
    const hiddenRunsCount = (easyTotalRuns - easySpots) + (medTotalRuns - medSpots) + (hardTotalRuns - hardSpots);

    const latestBestTime = Math.max(
      Number(u.recordTimestamps?.easy) || 0,
      Number(u.recordTimestamps?.medium) || 0,
      Number(u.recordTimestamps?.hard) || 0,
      Number(u.lastNewBestAt) || 0
    );

    if (!u.grantedSkins) u.grantedSkins = [];
    if (!u.adminLockedSkins) u.adminLockedSkins = [];
    if (!u.loginHistory) u.loginHistory = [];

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
        hard: hardSpots,
        totalRecordedRuns: easyTotalRuns + medTotalRuns + hardTotalRuns,
        hiddenRuns: hiddenRunsCount
      },
      selectedSkin: u.selectedSkin || 'classic',
      selectedPipeSkin: u.selectedPipeSkin || 'classic_pipe',
      grantedSkins: u.grantedSkins || [],
      adminLockedSkins: u.adminLockedSkins || [],
      loginHistory: (u.loginHistory || []).slice(0, 30),
      loginCount: u.loginCount || 0,
      lastLoginAtReadable: formatReadableTimestamp(u.lastLoginAt),
      lastNewBestAtReadable: formatReadableTimestamp(latestBestTime),
      createdAtReadable: formatReadableTimestamp(u.createdAt)
    };
  }
  if (!db.loginHistory) db.loginHistory = [];
  db.playerRecordsOverview = overview;

  // 5. Update `databaseStatus` summary header at the very top of `db.json`
  const visibleEasy = db.runs.easy.filter(r => !r.hidden);
  const visibleMed = db.runs.medium.filter(r => !r.hidden);
  const visibleHard = db.runs.hard.filter(r => !r.hidden);
  const easyChamp = visibleEasy[0] ? `${visibleEasy[0].username} (${visibleEasy[0].score} pts)` : 'None';
  const medChamp = visibleMed[0] ? `${visibleMed[0].username} (${visibleMed[0].score} pts)` : 'None';
  const hardChamp = visibleHard[0] ? `${visibleHard[0].username} (${visibleHard[0].score} pts)` : 'None';

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
    // 1. If runtime DB does not exist, initialize from template or seed
    if (!fs.existsSync(DB_FILE)) {
      if (fs.existsSync(TEMPLATE_FILE)) {
        fs.copyFileSync(TEMPLATE_FILE, DB_FILE);
        console.log('📦 Initialized fresh database from template: ' + TEMPLATE_FILE);
      } else if (fs.existsSync(SEED_FILE)) {
        fs.copyFileSync(SEED_FILE, DB_FILE);
        console.log('📦 Initialized fresh database from seed: ' + SEED_FILE);
      }
    }

    let parsed = null;
    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        parsed = JSON.parse(raw);
      } catch (parseErr) {
        console.error('⚠️ Warning: db.json was corrupted or unreadable:', parseErr.message);
        // Try recovering from backup snapshot
        const backupFile = path.join(BACKUPS_DIR, 'db-backup-last.json');
        if (fs.existsSync(backupFile)) {
          try {
            parsed = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
            console.log('🛡️ Successfully recovered database from backup: ' + backupFile);
          } catch (bkErr) {
            console.error('Failed to parse backup:', bkErr.message);
          }
        }
      }
    }

    // 2. Safe schema migration and default field enforcement
    if (parsed && typeof parsed.users === 'object') {
      db = {
        databaseStatus: parsed.databaseStatus || {},
        playerRecordsOverview: parsed.playerRecordsOverview || {},
        activityFeed: Array.isArray(parsed.activityFeed) ? parsed.activityFeed : [],
        loginHistory: Array.isArray(parsed.loginHistory) ? parsed.loginHistory : [],
        adminSettings: (parsed.adminSettings && typeof parsed.adminSettings === 'object') ? parsed.adminSettings : {},
        users: parsed.users || {},
        runs: parsed.runs || { easy: [], medium: [], hard: [] },
        sessions: parsed.sessions || {}
      };
    }

    // Guarantee runs structure exists
    if (!db.runs || typeof db.runs !== 'object') {
      db.runs = { easy: [], medium: [], hard: [] };
    }
    ['easy', 'medium', 'hard'].forEach(diff => {
      if (!Array.isArray(db.runs[diff])) db.runs[diff] = [];
    });

    if (db.activityFeed.length === 0) {
      logDatabaseEvent(
        'DATABASE_READY',
        'System',
        '🚀 3D Flappy Bird Live Database initialized with all player accounts & Top 100 leaderboard records.'
      );
    }

    syncAndRebuildOverview(fromWatcher);
    saveDatabase(true);
  } catch (err) {
    console.error('Error loading database:', err.message);
  }
}

let lastBackupTimestamp = 0;

function saveDatabase(forceBackup = false) {
  try {
    syncAndRebuildOverview(false);
    isInternalWrite = true;
    const orderedDb = {
      databaseStatus: db.databaseStatus,
      playerRecordsOverview: db.playerRecordsOverview,
      activityFeed: db.activityFeed,
      loginHistory: db.loginHistory || [],
      adminSettings: db.adminSettings || {},
      users: db.users,
      runs: db.runs,
      sessions: db.sessions
    };
    const tmpFile = DB_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(orderedDb, null, 2), 'utf8');
    try {
      fs.renameSync(tmpFile, DB_FILE);
    } catch (renameErr) {
      // Fallback on Windows if file handle is held open by file watchers
      fs.copyFileSync(tmpFile, DB_FILE);
      try { fs.unlinkSync(tmpFile); } catch (_) {}
    }

    // Maintain a rolling backup every 15 minutes or when forced
    const now = Date.now();
    if (forceBackup || now - lastBackupTimestamp > 15 * 60 * 1000) {
      lastBackupTimestamp = now;
      try {
        const backupTarget = path.join(BACKUPS_DIR, 'db-backup-last.json');
        fs.writeFileSync(backupTarget, JSON.stringify(orderedDb, null, 2), 'utf8');
      } catch (backupErr) {
        console.error('Backup write error:', backupErr.message);
      }
    }

    setTimeout(() => { isInternalWrite = false; }, 250);
  } catch (err) {
    isInternalWrite = false;
    console.error('Error saving database:', err.message);
  }
}

/**
 * Resets all scores, runs, and career records for all players for Season 2.
 * Preserves user accounts, passwords, and cosmetics.
 */
function resetAllRecordsAdmin(adminUsername = 'MeDonut') {
  const now = Date.now();
  const readable = formatReadableTimestamp(now);

  // Clear all runs
  db.runs = { easy: [], medium: [], hard: [] };

  // Clear all user scores
  if (db.users && typeof db.users === 'object') {
    for (const user of Object.values(db.users)) {
      if (!user) continue;
      user.records = { easy: 0, medium: 0, hard: 0 };
      user.recordTimestamps = { easy: 0, medium: 0, hard: 0 };
      user._lastSyncedRecords = { easy: 0, medium: 0, hard: 0 };
      delete user.lastNewBestAt;
      delete user.lastNewBestReadable;
      delete user.lastNewBestMode;
      delete user.lastNewBestScore;
      delete user.lastNewBestPrevious;
      user.lastNewBestText = 'No personal best set yet';
    }
  }

  // Clear active sessions
  db.sessions = {};

  // Log Season Reset Event
  logDatabaseEvent(
    'SEASON_RESET',
    adminUsername,
    `🚀 Season 2 Reset: All player records and leaderboard runs have been reset by ${adminUsername}!`,
    { admin: adminUsername, timestamp: now }
  );

  if (!db.databaseStatus || typeof db.databaseStatus !== 'object') db.databaseStatus = {};
  db.databaseStatus.latestEventBanner = '🟢 Database Active — Season 2 Reset (0 Runs Recorded)';
  db.databaseStatus.currentChampions = { easy: 'None', medium: 'None', hard: 'None' };
  db.databaseStatus.totalLeaderboardRuns = { easy: 0, medium: 0, hard: 0, total: 0 };

  saveDatabase(true);
  return {
    ok: true,
    message: 'All player records and leaderboard entries have been successfully reset for Season 2.',
    timestamp: now,
    readable
  };
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
 * Builds the 3-Difficulty Leaderboards (Top 100 or All Players/Runs if limit is 0/null)
 */
function buildLeaderboards(limit = 100) {
  const result = { easy: [], medium: [], hard: [] };

  ['easy', 'medium', 'hard'].forEach(diff => {
    const runsList = (db.runs && Array.isArray(db.runs[diff])) ? db.runs[diff] : [];
    let filtered = runsList
      .filter(entry => entry && typeof entry.score === 'number' && entry.score > 0 && !entry.hidden)
      .slice()
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (a.createdAt || 0) - (b.createdAt || 0);
      });

    if (limit && limit > 0) {
      filtered = filtered.slice(0, limit);
    }

    result[diff] = filtered.map((entry, idx) => ({
      id: entry.id,
      username: entry.username,
      score: entry.score,
      rank: idx + 1,
      updatedAt: entry.createdAt
    }));
  });

  return result;
}

/**
 * Records a user login (password login or quick-switch) in the database and audit history
 */
function recordUserLogin(user, method = 'login') {
  const now = Date.now();
  user.loginCount = (Number(user.loginCount) || 0) + 1;
  user.lastLoginAt = now;
  user.lastLoginReadable = formatReadableTimestamp(now);
  user.lastLoginMethod = method;

  if (!user.loginHistory) user.loginHistory = [];
  user.loginHistory.unshift({
    timestamp: now,
    readable: formatReadableTimestamp(now),
    method: method || 'login',
    loginNumber: user.loginCount
  });
  if (user.loginHistory.length > 50) user.loginHistory.length = 50;

  if (!db.loginHistory) db.loginHistory = [];
  db.loginHistory.unshift({
    id: 'login_' + now + '_' + Math.random().toString(36).substr(2, 6),
    username: user.username,
    timestamp: now,
    readable: formatReadableTimestamp(now),
    method: method || 'login',
    loginCount: user.loginCount,
    records: { ...(user.records || {}) }
  });
  if (db.loginHistory.length > 500) db.loginHistory.length = 500;

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
      hidden: false,
      createdAt: now
    });

    db.runs[diffKey].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
    if (db.runs[diffKey].length > 300) {
      db.runs[diffKey].length = 300;
    }
  }

  saveDatabase();
  return { isNewRecord, newRunId, previousBest };
}

/**
 * Allows the game owner (MeDonut) to directly update a player's records or skins via the `/database` manager
 * AND immediately syncs `db.runs[diff]` so the leaderboard reflects the new best score (whether raised, lowered, or set to 0)!
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
      user.records[diff] = val;
      if (user._lastSyncedRecords) user._lastSyncedRecords[diff] = val;
      syncUserRunsToBestScore(user.username, diff, val, now);
      if (val !== oldVal) {
        user.recordTimestamps[diff] = now;
        changes.push(`${diff.toUpperCase()}: ${oldVal} -> ${val}`);
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
      `🛠️ Updated ${user.username}'s records & leaderboard: ${changes.join(', ')}`,
      { changes, records: { ...user.records } }
    );
  }

  saveDatabase();
  return db.playerRecordsOverview[user.username];
}

/**
 * Updates a specific run's score and/or leaderboard visibility (`hidden: true/false`) for any user.
 * Automatically recalculates the user's best score in that mode from their visible runs so leaderboard & profile stay in sync.
 */
function updateLeaderboardRunAdmin(difficulty, entryId, updates = {}) {
  if (!['easy', 'medium', 'hard'].includes(difficulty)) {
    throw new Error('Invalid difficulty.');
  }
  const list = db.runs[difficulty] || [];
  const run = list.find(r => r && r.id === entryId);
  if (!run) {
    throw new Error('Run entry not found.');
  }

  const oldScore = run.score;
  const oldHidden = Boolean(run.hidden);
  const actionParts = [];

  if (updates.score !== undefined) {
    const newScore = Math.max(1, Math.floor(Number(updates.score) || 1));
    if (newScore !== oldScore) {
      run.score = newScore;
      actionParts.push(`score ${oldScore} -> ${newScore} pts`);
    }
  }

  if (updates.hidden !== undefined) {
    const newHidden = Boolean(updates.hidden);
    if (newHidden !== oldHidden) {
      run.hidden = newHidden;
      actionParts.push(newHidden ? 'visibility OFF (hidden from leaderboard)' : 'visibility ON (shown on leaderboard)');
    }
  }

  // Sync user's personal best in this difficulty to their highest visible run
  const newBest = recalculateUserBestFromVisibleRuns(run.username, difficulty);

  if (actionParts.length > 0) {
    logDatabaseEvent(
      'ADMIN_EDIT_RUN',
      run.username,
      `🛠️ Edited ${run.username}'s ${difficulty.toUpperCase()} run (${actionParts.join(', ')}) • Visible Best: ${newBest} pts`,
      { difficulty, entryId, oldScore, newScore: run.score, hidden: run.hidden, newBest }
    );
  }

  saveDatabase();
  return { run, newBest };
}

/**
 * Adds a new run for any user in a given difficulty mode.
 */
function addLeaderboardRunAdmin(username, difficulty, score, hidden = false) {
  if (!['easy', 'medium', 'hard'].includes(difficulty)) {
    throw new Error('Invalid difficulty.');
  }
  const cleanName = typeof username === 'string' ? username.trim() : '';
  const uKey = cleanName.toLowerCase();
  const user = db.users[uKey];
  const canonicalUsername = user ? user.username : cleanName;
  if (!canonicalUsername) {
    throw new Error('Username is required.');
  }
  const cleanScore = Math.max(1, Math.floor(Number(score) || 0));
  const now = Date.now();

  if (!db.runs[difficulty]) db.runs[difficulty] = [];
  const newRun = {
    id: crypto.randomBytes(8).toString('hex'),
    username: canonicalUsername,
    score: cleanScore,
    hidden: Boolean(hidden),
    createdAt: now
  };
  db.runs[difficulty].push(newRun);

  if (user) {
    recalculateUserBestFromVisibleRuns(user.username, difficulty);
  }

  logDatabaseEvent(
    'ADMIN_ADD_RUN',
    canonicalUsername,
    `➕ Added ${difficulty.toUpperCase()} run of ${cleanScore} pts for ${canonicalUsername} (${hidden ? 'Hidden' : 'Visible'})`,
    { difficulty, run: newRun }
  );
  saveDatabase();
  return newRun;
}

/**
 * Toggles visibility (`hidden: true/false`) on all runs for a specific user (either in one mode or all modes).
 */
function toggleUserRunsVisibilityAdmin(username, difficulty, hidden) {
  const cleanName = typeof username === 'string' ? username.trim() : '';
  const uLower = cleanName.toLowerCase();
  if (!uLower) throw new Error('Username is required.');

  const targetModes = (difficulty && ['easy', 'medium', 'hard'].includes(difficulty))
    ? [difficulty]
    : ['easy', 'medium', 'hard'];
  const makeHidden = Boolean(hidden);
  let count = 0;

  targetModes.forEach(diff => {
    const list = db.runs[diff] || [];
    list.forEach(r => {
      if (r && r.username && r.username.toLowerCase() === uLower) {
        r.hidden = makeHidden;
        count++;
      }
    });
    recalculateUserBestFromVisibleRuns(cleanName, diff);
  });

  logDatabaseEvent(
    'ADMIN_VISIBILITY_BULK',
    cleanName,
    `${makeHidden ? '🚫 Hid' : '👁️ Unhid'} ${count} run(s) for ${cleanName} (${targetModes.join(', ').toUpperCase()})`,
    { username: cleanName, modes: targetModes, hidden: makeHidden, affectedRuns: count }
  );
  saveDatabase();
  return { affectedRuns: count, hidden: makeHidden };
}

/**
 * Returns all runs across Easy, Medium, and Hard (including hidden runs) with formatted timestamps and visible rank.
 */
function getAllRunsAdmin() {
  const result = { easy: [], medium: [], hard: [] };
  ['easy', 'medium', 'hard'].forEach(diff => {
    const list = (db.runs && Array.isArray(db.runs[diff])) ? db.runs[diff] : [];
    let visibleRankCounter = 0;
    result[diff] = list
      .slice()
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (a.createdAt || 0) - (b.createdAt || 0);
      })
      .map(r => {
        const isHidden = Boolean(r.hidden);
        if (!isHidden) visibleRankCounter++;
        return {
          id: r.id,
          username: r.username,
          score: r.score,
          hidden: isHidden,
          visibleRank: isHidden ? null : visibleRankCounter,
          createdAt: r.createdAt || 0,
          readableTime: formatReadableTimestamp(r.createdAt)
        };
      });
  });
  return result;
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

  // Recalculate that player's highest remaining visible score in this mode
  recalculateUserBestFromVisibleRuns(removed.username, difficulty);

  logDatabaseEvent(
    'ADMIN_DELETE_RUN',
    removed.username,
    `🗑️ Removed ${removed.username}'s ${difficulty.toUpperCase()} score of ${removed.score} pts from the database`,
    { difficulty, removed }
  );
  saveDatabase();
  return removed;
}

/**
 * Allows MeDonut Admin to grant skins, lock/ban skins for a player, or change their equipped skin.
 */
function adminUpdateUserSkins(username, options = {}) {
  const cleanName = typeof username === 'string' ? username.trim() : '';
  const uKey = cleanName.toLowerCase();
  const user = db.users && db.users[uKey];
  if (!user) {
    throw new Error(`Player "${username}" does not exist in database.`);
  }

  if (!user.grantedSkins) user.grantedSkins = [];
  if (!user.adminLockedSkins) user.adminLockedSkins = [];

  const { grantSkinId, revokeSkinId, lockSkinId, unlockSkinId, selectedSkin, selectedPipeSkin } = options;
  let changed = false;
  const actionLog = [];

  if (grantSkinId) {
    const skinId = String(grantSkinId).trim();
    if (!user.grantedSkins.includes(skinId)) {
      user.grantedSkins.push(skinId);
    }
    user.adminLockedSkins = user.adminLockedSkins.filter(id => id !== skinId);
    actionLog.push(`Granted skin "${skinId}"`);
    changed = true;
  }

  if (revokeSkinId) {
    const skinId = String(revokeSkinId).trim();
    user.grantedSkins = user.grantedSkins.filter(id => id !== skinId);
    actionLog.push(`Revoked skin "${skinId}"`);
    changed = true;
  }

  if (lockSkinId) {
    const skinId = String(lockSkinId).trim();
    if (!user.adminLockedSkins.includes(skinId)) {
      user.adminLockedSkins.push(skinId);
    }
    user.grantedSkins = user.grantedSkins.filter(id => id !== skinId);
    if (user.selectedSkin === skinId) user.selectedSkin = 'classic';
    if (user.selectedPipeSkin === skinId) user.selectedPipeSkin = 'classic_pipe';
    actionLog.push(`Admin-locked skin "${skinId}" (player cannot unlock)`);
    changed = true;
  }

  if (unlockSkinId) {
    const skinId = String(unlockSkinId).trim();
    user.adminLockedSkins = user.adminLockedSkins.filter(id => id !== skinId);
    actionLog.push(`Removed admin-lock on skin "${skinId}"`);
    changed = true;
  }

  if (typeof selectedSkin === 'string' && selectedSkin.trim()) {
    user.selectedSkin = selectedSkin.trim();
    actionLog.push(`Set bird skin to "${user.selectedSkin}"`);
    changed = true;
  }

  if (typeof selectedPipeSkin === 'string' && selectedPipeSkin.trim()) {
    user.selectedPipeSkin = selectedPipeSkin.trim();
    actionLog.push(`Set pipe skin to "${user.selectedPipeSkin}"`);
    changed = true;
  }

  if (changed) {
    syncAndRebuildOverview();
    logDatabaseEvent(
      'ADMIN_SKIN_CHANGE',
      user.username,
      `👑 MeDonut updated skins for ${user.username}: ${actionLog.join(', ')}`,
      { options }
    );
    saveDatabase();
  }

  return {
    success: true,
    username: user.username,
    grantedSkins: user.grantedSkins,
    adminLockedSkins: user.adminLockedSkins,
    selectedSkin: user.selectedSkin,
    selectedPipeSkin: user.selectedPipeSkin,
    user
  };
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
  updateLeaderboardRunAdmin,
  addLeaderboardRunAdmin,
  toggleUserRunsVisibilityAdmin,
  getAllRunsAdmin,
  deleteLeaderboardEntryAdmin,
  adminUpdateUserSkins,
  resetAllRecordsAdmin,
  BACKUPS_DIR,
  TEMPLATE_FILE,
  formatReadableTimestamp
};
