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

let BIRD_SKINS = [];
let PIPE_SKINS = [];
let BACKGROUND_SKINS = [];
let BACKGROUND_CASES = [];
const BACKGROUND_SKIN_IDS = new Set();
const VALID_QUEST_IDS = new Set();
try {
  const skinsModule = require(path.join(__dirname, '..', '..', 'public', 'js', 'skins-data.js'));
  BIRD_SKINS = skinsModule.BIRD_SKINS || [];
  PIPE_SKINS = skinsModule.PIPE_SKINS || [];
  BACKGROUND_SKINS = skinsModule.BACKGROUND_SKINS || [];
  BACKGROUND_CASES = skinsModule.BACKGROUND_CASES || [];
  for (const b of BACKGROUND_SKINS) {
    if (b && b.id) BACKGROUND_SKIN_IDS.add(String(b.id));
  }
  for (const s of [...BIRD_SKINS, ...PIPE_SKINS]) {
    if (s && s.pokeQuestId) VALID_QUEST_IDS.add(String(s.pokeQuestId));
    if (s && s.trollQuestId) VALID_QUEST_IDS.add(String(s.trollQuestId));
  }
} catch (_) {}

/**
 * Safely merges client-synced Career Stats & Meme/Pokémon Quest progress onto a user record
 * using monotonic max/union so quest-unlocked skins persist across devices & /api/skin validation.
 * Never alters verified `user.records` best scores.
 */
function mergeUserProgressionData(user, payload = {}, shouldSave = false) {
  if (!user || !payload || typeof payload !== 'object') return false;
  let changed = false;

  if (payload.careerStats && typeof payload.careerStats === 'object') {
    const src = payload.careerStats;
    if (!user.careerStats || typeof user.careerStats !== 'object') {
      user.careerStats = {
        totalRuns: 0,
        totalScore: 0,
        totalFlaps: 0,
        lastScore: 0,
        lastMode: 'medium',
        modes: {
          easy: { runs: 0, totalScore: 0, totalFlaps: 0, lastScore: 0 },
          medium: { runs: 0, totalScore: 0, totalFlaps: 0, lastScore: 0 },
          hard: { runs: 0, totalScore: 0, totalFlaps: 0, lastScore: 0 }
        }
      };
      changed = true;
    }
    const cs = user.careerStats;
    const clampInt = (v, maxVal = 10000000) => Math.max(0, Math.min(maxVal, Math.floor(Number(v) || 0)));
    for (const k of ['totalRuns', 'totalScore', 'totalFlaps']) {
      const nextVal = clampInt(src[k]);
      if (nextVal > (Number(cs[k]) || 0)) {
        cs[k] = nextVal;
        changed = true;
      }
    }
    if (src.lastScore !== undefined && Number.isFinite(Number(src.lastScore))) {
      const ls = clampInt(src.lastScore, 10000);
      if (cs.lastScore !== ls) { cs.lastScore = ls; changed = true; }
    }
    if (typeof src.lastMode === 'string' && ['easy', 'medium', 'hard'].includes(src.lastMode) && cs.lastMode !== src.lastMode) {
      cs.lastMode = src.lastMode;
      changed = true;
    }
    if (src.modes && typeof src.modes === 'object') {
      if (!cs.modes || typeof cs.modes !== 'object') cs.modes = {};
      for (const dk of ['easy', 'medium', 'hard']) {
        const sm = src.modes[dk];
        if (!sm || typeof sm !== 'object') continue;
        if (!cs.modes[dk] || typeof cs.modes[dk] !== 'object') {
          cs.modes[dk] = { runs: 0, totalScore: 0, totalFlaps: 0, lastScore: 0 };
        }
        const dm = cs.modes[dk];
        for (const mk of ['runs', 'totalScore', 'totalFlaps']) {
          const v = clampInt(sm[mk]);
          if (v > (Number(dm[mk]) || 0)) { dm[mk] = v; changed = true; }
        }
        if (sm.lastScore !== undefined && Number.isFinite(Number(sm.lastScore))) {
          const lms = clampInt(sm.lastScore, 10000);
          if (dm.lastScore !== lms) { dm.lastScore = lms; changed = true; }
        }
      }
    }
  }

  if (payload.trollQuests && typeof payload.trollQuests === 'object') {
    const src = payload.trollQuests;
    if (!user.trollQuests || typeof user.trollQuests !== 'object') {
      user.trollQuests = {
        unlockedIds: {},
        scoreDeaths: {},
        recentScores: [],
        recentModes: [],
        zeroFlapDeaths: 0,
        chokeMilestones: 0,
        bestFlapsUnder5: 0,
        bestFlapsUnder8: 0,
        bestFlapsSingleRun: 0,
        totalBonks: 0
      };
      changed = true;
    }
    const tq = user.trollQuests;
    if (!tq.unlockedIds || typeof tq.unlockedIds !== 'object') tq.unlockedIds = {};
    if (!tq.scoreDeaths || typeof tq.scoreDeaths !== 'object') tq.scoreDeaths = {};

    if (src.unlockedIds && typeof src.unlockedIds === 'object') {
      for (const [qid, val] of Object.entries(src.unlockedIds)) {
        if (val && VALID_QUEST_IDS.has(qid) && !tq.unlockedIds[qid]) {
          tq.unlockedIds[qid] = true;
          changed = true;
        }
      }
    }

    if (src.scoreDeaths && typeof src.scoreDeaths === 'object') {
      const entries = Object.entries(src.scoreDeaths).slice(0, 400);
      for (const [scoreKey, cnt] of entries) {
        const sInt = Math.floor(Number(scoreKey));
        const cInt = Math.max(0, Math.min(100000, Math.floor(Number(cnt) || 0)));
        if (Number.isInteger(sInt) && sInt >= 0 && sInt <= 1000 && cInt > (Number(tq.scoreDeaths[sInt]) || 0)) {
          tq.scoreDeaths[sInt] = cInt;
          changed = true;
        }
      }
    }

    for (const nk of ['zeroFlapDeaths', 'chokeMilestones', 'bestFlapsUnder5', 'bestFlapsUnder8', 'bestFlapsSingleRun', 'totalBonks']) {
      const nVal = Math.max(0, Math.min(1000000, Math.floor(Number(src[nk]) || 0)));
      if (nVal > (Number(tq[nk]) || 0)) {
        tq[nk] = nVal;
        changed = true;
      }
    }

    if (Array.isArray(src.recentScores) && src.recentScores.length > 0) {
      const cleanRS = src.recentScores.slice(-10).map(n => Math.max(0, Math.min(10000, Math.floor(Number(n) || 0))));
      if (JSON.stringify(tq.recentScores || []) !== JSON.stringify(cleanRS)) {
        tq.recentScores = cleanRS;
        changed = true;
      }
    }
    if (Array.isArray(src.recentModes) && src.recentModes.length > 0) {
      const cleanRM = src.recentModes.slice(-10).filter(m => m === 'easy' || m === 'medium' || m === 'hard');
      if (cleanRM.length > 0 && JSON.stringify(tq.recentModes || []) !== JSON.stringify(cleanRM)) {
        tq.recentModes = cleanRM;
        changed = true;
      }
    }
  }

  if (changed && shouldSave) {
    saveDatabase(false);
  }
  return changed;
}

/**
 * Checks whether a skin is naturally unlocked by the user's score records, quests, or default status
 * (independent of `grantedSkins` or currently equipped skin).
 */
function isSkinNaturallyUnlockedForUser(skinId, user) {
  if (!skinId || skinId === 'classic' || skinId === 'classic_pipe') return true;
  if (!user) return false;

  const lockedList = Array.isArray(user.adminLockedSkins) ? user.adminLockedSkins : [];
  if (lockedList.includes(skinId)) return false;

  const item = [...BIRD_SKINS, ...PIPE_SKINS].find(s => s && s.id === skinId);
  if (!item) return false;
  if (item.reqScore <= 0) return true;

  const rec = user.records || {};
  const easyBest = Number(rec.easy) || 0;
  const medBest = Number(rec.medium) || 0;
  const hardBest = Number(rec.hard) || 0;
  const anyBest = Math.max(easyBest, medBest, hardBest, Number(user.allTimeBest) || 0);

  if (item.altScore && anyBest >= item.altScore) return true;
  if (item.reqMode === 'any') return anyBest >= item.reqScore;
  if (item.reqMode === 'easy') return easyBest >= item.reqScore;
  if (item.reqMode === 'medium') return medBest >= item.reqScore;
  if (item.reqMode === 'hard') return hardBest >= item.reqScore;

  const tq = user.trollQuests || {};
  const tqUnlocked = (tq.unlockedIds && typeof tq.unlockedIds === 'object') ? tq.unlockedIds : {};
  const sd = (tq.scoreDeaths && typeof tq.scoreDeaths === 'object') ? tq.scoreDeaths : {};
  const careerPipes = Number(user.careerStats && user.careerStats.totalScore) || 0;
  const bestFlapsUnder8 = Number(tq.bestFlapsUnder8) || 0;

  if (item.reqMode === 'pokemon' && item.pokeQuestId) {
    const qid = item.pokeQuestId;
    if (tqUnlocked[qid]) return true;
    const checkPoke = (mReq, eReq, hReq) => (medBest >= mReq || easyBest >= eReq || hardBest >= hReq);
    switch (qid) {
      case 'poke_pikachu': return checkPoke(50, 95, 32);
      case 'poke_charmander':
      case 'poke_eevee': return checkPoke(48, 90, 30);
      case 'poke_squirtle': return checkPoke(45, 85, 28);
      case 'poke_bulbasaur': return checkPoke(42, 80, 26);
      case 'poke_pipe_pokeball': return checkPoke(40, 75, 25);
      case 'poke_mew': return checkPoke(65, 125, 42);
      case 'poke_masterball': return checkPoke(70, 135, 46);
      case 'poke_charizard': return checkPoke(60, 115, 38);
      case 'poke_gengar': return checkPoke(55, 105, 35);
      case 'poke_lucario': return checkPoke(58, 110, 36);
      case 'poke_greninja': return checkPoke(56, 108, 35);
      case 'poke_mewtwo': return checkPoke(72, 140, 48);
      case 'poke_rayquaza': return checkPoke(80, 155, 55);
      case 'poke_snorlax': return careerPipes >= 500 || checkPoke(52, 100, 34);
      case 'poke_bidoof': return (Number(sd[15]) || 0) >= 4 || checkPoke(45, 85, 28);
      case 'poke_jigglypuff': return (Number(sd[39]) || 0) >= 2 || checkPoke(44, 85, 28);
      case 'poke_magikarp': return bestFlapsUnder8 >= 50 || checkPoke(46, 88, 29);
      case 'poke_meowth': return careerPipes >= 350 || checkPoke(50, 95, 32);
      default:
        if (item.reqScore) return checkPoke(item.reqScore, Math.round(item.reqScore * 1.9), Math.round(item.reqScore * 0.65));
        return checkPoke(50, 95, 32);
    }
  }

  if (item.reqMode === 'meme') {
    return true;
  }

  return false;
}

/**
 * Validates whether a specific bird or pipe skin is unlocked for a user based on their current records,
 * admin-granted status, or admin-locked status.
 */
function isSkinUnlockedForUser(skinId, user) {
  if (!skinId || skinId === 'classic' || skinId === 'classic_pipe' || skinId === 'bg_classic') return true;
  if (!user) return false;

  // 1. Admin-locked skins are strictly locked
  const lockedList = Array.isArray(user.adminLockedSkins) ? user.adminLockedSkins : [];
  if (lockedList.includes(skinId)) return false;

  // 2. Admin-granted skins are always unlocked
  const grantedList = Array.isArray(user.grantedSkins) ? user.grantedSkins : [];
  if (grantedList.includes(skinId)) return true;

  // 2.5. Any case-unlocked background or currently equipped skin is unlocked
  if (Array.isArray(user.unlockedBackgrounds) && user.unlockedBackgrounds.includes(skinId)) return true;
  if (user.selectedSkin === skinId || user.selectedPipeSkin === skinId || user.selectedBackground === skinId) return true;

  if (BACKGROUND_SKIN_IDS.has(skinId)) {
    return false;
  }

  return isSkinNaturallyUnlockedForUser(skinId, user);
}

/**
 * Automatically maintains at most `maxBackups` (default 3) latest backup snapshots in `data/backups/`.
 * Any older backups are safely removed to prevent storage accumulation.
 */
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

// Cached Intl formatters for extreme speed (avoids re-instantiating C++ objects)
const danishWindowFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Copenhagen',
  weekday: 'short',
  hour: 'numeric',
  minute: 'numeric',
  hour12: false
});

const danishTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Copenhagen',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

const danishDateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Copenhagen',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

const readableTimestampCache = new Map();
const danishWindowCache = new Map();
const danishTimeCache = new Map();

function formatReadableTimestamp(ms) {
  if (!ms || ms <= 0) return 'Never';
  const secKey = Math.floor(ms / 1000);
  if (readableTimestampCache.has(secKey)) {
    return readableTimestampCache.get(secKey);
  }
  let formatted;
  try {
    const parts = danishDateTimeFormatter.formatToParts(new Date(ms));
    let year = '0000', month = '00', day = '00', hour = '00', minute = '00', second = '00';
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.type === 'year') year = p.value;
      else if (p.type === 'month') month = p.value;
      else if (p.type === 'day') day = p.value;
      else if (p.type === 'hour') hour = p.value;
      else if (p.type === 'minute') minute = p.value;
      else if (p.type === 'second') second = p.value;
    }
    formatted = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  } catch (_) {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    formatted = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  if (readableTimestampCache.size < 12000) {
    readableTimestampCache.set(secKey, formatted);
  }
  return formatted;
}

/**
 * Checks whether a given timestamp falls within the allowed Danish competition hours:
 * - Automatically hidden on SATURDAY & SUNDAY (the whole weekend, regardless of time).
 * - Monday through Friday: 07:50 to 14:10 Danish Time (Europe/Copenhagen).
 */
function isWithinDanishWindow(timestampMs = Date.now()) {
  if (!timestampMs || timestampMs <= 0) return true;
  const minKey = Math.floor(timestampMs / 60000);
  if (danishWindowCache.has(minKey)) {
    return danishWindowCache.get(minKey);
  }
  let allowed = true;
  try {
    const parts = danishWindowFormatter.formatToParts(new Date(timestampMs));
    let weekday = '';
    let hour = 0;
    let minute = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.type === 'weekday') weekday = p.value;
      else if (p.type === 'hour') hour = parseInt(p.value, 10) % 24;
      else if (p.type === 'minute') minute = parseInt(p.value, 10);
    }
    if (weekday === 'Sat' || weekday === 'Sun') {
      allowed = false;
    } else {
      const totalMinutes = hour * 60 + minute;
      allowed = totalMinutes >= 470 && totalMinutes <= 850;
    }
  } catch (_) {
    allowed = true;
  }
  if (danishWindowCache.size < 12000) {
    danishWindowCache.set(minKey, allowed);
  }
  return allowed;
}

function formatDanishTime(timestampMs = Date.now()) {
  if (!timestampMs || timestampMs <= 0) return '';
  const minKey = Math.floor(timestampMs / 60000);
  if (danishTimeCache.has(minKey)) {
    return danishTimeCache.get(minKey);
  }
  let res = '';
  try {
    res = danishTimeFormatter.format(new Date(timestampMs));
  } catch (_) {
    res = '';
  }
  if (danishTimeCache.size < 12000) {
    danishTimeCache.set(minKey, res);
  }
  return res;
}

// --------------------------------------------------------------------------
// DANISH TIMEZONE (Europe/Copenhagen) LEADERBOARD RESET CALCULATIONS
// --------------------------------------------------------------------------
const danishFullDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Copenhagen',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  weekday: 'short',
  hour12: false
});

function getCopenhagenOffsetMs(utcMs) {
  const date = new Date(utcMs);
  const parts = danishFullDateFormatter.formatToParts(date);
  const res = {};
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.type !== 'literal') res[p.type] = p.value;
  }
  const copenhagenAsUtc = Date.UTC(
    parseInt(res.year, 10),
    parseInt(res.month, 10) - 1,
    parseInt(res.day, 10),
    parseInt(res.hour, 10) % 24,
    parseInt(res.minute, 10),
    parseInt(res.second, 10)
  );
  return copenhagenAsUtc - utcMs;
}

function danishTimeToUtcMs(year, month, day, hour = 7, minute = 0, second = 0) {
  const guessUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset1 = getCopenhagenOffsetMs(guessUtc);
  const candidateUtc = guessUtc - offset1;
  const offset2 = getCopenhagenOffsetMs(candidateUtc);
  return guessUtc - offset2;
}

function getDanishDateParts(timestamp = Date.now()) {
  try {
    const parts = danishFullDateFormatter.formatToParts(new Date(timestamp));
    const res = {};
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.type !== 'literal') res[p.type] = p.value;
    }
    return {
      year: parseInt(res.year, 10),
      month: parseInt(res.month, 10),
      day: parseInt(res.day, 10),
      hour: parseInt(res.hour, 10) % 24,
      minute: parseInt(res.minute, 10),
      second: parseInt(res.second, 10),
      weekday: res.weekday || 'Mon'
    };
  } catch (_) {
    const d = new Date(timestamp);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
      weekday: dayNames[d.getUTCDay()]
    };
  }
}

const WEEKDAY_INDEX = { 'Mon': 0, 'Tue': 1, 'Wed': 2, 'Thu': 3, 'Fri': 4, 'Sat': 5, 'Sun': 6 };

/**
 * Returns exact start and next reset timestamps in milliseconds UTC for:
 * - Daily: resets every day at 07:00:00 Danish Time (Europe/Copenhagen)
 * - Weekly: resets every Monday at 07:00:00 Danish Time (Europe/Copenhagen)
 */
function getLeaderboardResetBoundaries(nowMs = Date.now()) {
  const parts = getDanishDateParts(nowMs);
  const today7amMs = danishTimeToUtcMs(parts.year, parts.month, parts.day, 7, 0, 0);

  let currentDailyResetMs;
  let nextDailyResetMs;

  if (nowMs >= today7amMs) {
    currentDailyResetMs = today7amMs;
    const tomorrowParts = getDanishDateParts(today7amMs + 28 * 3600 * 1000);
    nextDailyResetMs = danishTimeToUtcMs(tomorrowParts.year, tomorrowParts.month, tomorrowParts.day, 7, 0, 0);
  } else {
    const yesterdayParts = getDanishDateParts(today7amMs - 12 * 3600 * 1000);
    currentDailyResetMs = danishTimeToUtcMs(yesterdayParts.year, yesterdayParts.month, yesterdayParts.day, 7, 0, 0);
    nextDailyResetMs = today7amMs;
  }

  const dayOfWeek = WEEKDAY_INDEX[parts.weekday] ?? 0;
  let currentWeeklyResetMs;
  let nextWeeklyResetMs;

  if (dayOfWeek === 0 && nowMs < today7amMs) {
    nextWeeklyResetMs = today7amMs;
    const prevMonParts = getDanishDateParts(today7amMs - 7 * 24 * 3600 * 1000 + 4 * 3600 * 1000);
    currentWeeklyResetMs = danishTimeToUtcMs(prevMonParts.year, prevMonParts.month, prevMonParts.day, 7, 0, 0);
  } else {
    const daysSinceMon = dayOfWeek;
    const thisMonApprox = today7amMs - daysSinceMon * 24 * 3600 * 1000;
    const thisMonParts = getDanishDateParts(thisMonApprox + 4 * 3600 * 1000);
    currentWeeklyResetMs = danishTimeToUtcMs(thisMonParts.year, thisMonParts.month, thisMonParts.day, 7, 0, 0);

    const daysUntilNextMon = 7 - daysSinceMon;
    const nextMonApprox = today7amMs + daysUntilNextMon * 24 * 3600 * 1000;
    const nextMonParts = getDanishDateParts(nextMonApprox + 4 * 3600 * 1000);
    nextWeeklyResetMs = danishTimeToUtcMs(nextMonParts.year, nextMonParts.month, nextMonParts.day, 7, 0, 0);
  }

  return {
    serverTime: nowMs,
    daily: {
      currentResetMs: currentDailyResetMs,
      nextResetMs: nextDailyResetMs,
      remainingMs: Math.max(0, nextDailyResetMs - nowMs)
    },
    weekly: {
      currentResetMs: currentWeeklyResetMs,
      nextResetMs: nextWeeklyResetMs,
      remainingMs: Math.max(0, nextWeeklyResetMs - nowMs)
    }
  };
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

let isInternalWrite = false;
let lastInternalSavedMtime = 0;
let lastInternalWriteAt = 0;
let cachedLeaderboards = null;
let cachedAllLeaderboards = null;

let db = {
  databaseStatus: {},
  playerRecordsOverview: {},
  activityFeed: [],
  loginHistory: [],
  adminSettings: { defaultMaxAccounts: 5 },
  banRegistry: { groups: {} },
  users: {},
  runs: { easy: [], medium: [], hard: [] },
  sessions: {},
  chatMessages: []
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

  // 3. Keep the 100 highest runs in each mode from EACH PLAYER + ALL runs from the current Weekly/Daily window!
  const resetBounds = getLeaderboardResetBoundaries();
  const weeklyResetStartMs = (resetBounds && resetBounds.weekly && resetBounds.weekly.currentResetMs) || 0;

  ['easy', 'medium', 'hard'].forEach(diff => {
    const list = Array.isArray(db.runs[diff]) ? db.runs[diff] : [];
    const validRuns = list
      .filter(r => r && typeof r.score === 'number' && r.score > 0 && r.username)
      .map(r => {
        if (r.adminOverride) {
          return { ...r, hidden: Boolean(r.hidden) };
        }
        const isOffHours = !isWithinDanishWindow(r.createdAt);
        return {
          ...r,
          hidden: r.hidden !== undefined ? Boolean(r.hidden) : isOffHours
        };
      });

    // Group runs by player (lowercase username)
    const runsByPlayer = new Map();
    for (const r of validRuns) {
      const uKey = String(r.username).toLowerCase();
      if (!runsByPlayer.has(uKey)) {
        runsByPlayer.set(uKey, []);
      }
      runsByPlayer.get(uKey).push(r);
    }

    // Keep up to 100 highest all-time runs for EACH PLAYER + preserve ALL runs from the active Weekly/Daily timeframe!
    const prunedRuns = [];
    for (const pRuns of runsByPlayer.values()) {
      pRuns.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
      const keptIds = new Set();
      for (let i = 0; i < pRuns.length; i++) {
        const item = pRuns[i];
        if (i < 100 || (weeklyResetStartMs > 0 && (item.createdAt || 0) >= weeklyResetStartMs)) {
          keptIds.add(item.id);
          prunedRuns.push(item);
        }
      }
    }

    // Sort all combined runs across all players by score descending
    prunedRuns.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });

    db.runs[diff] = prunedRuns;
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

  // Pre-index run counts per user in a single O(Runs) pass instead of O(Users * Runs)
  const runCountsByUser = new Map();
  ['easy', 'medium', 'hard'].forEach(diff => {
    const list = db.runs[diff] || [];
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (!r || !r.username) continue;
      const uLower = r.username.toLowerCase();
      let stats = runCountsByUser.get(uLower);
      if (!stats) {
        stats = { easyVis: 0, medVis: 0, hardVis: 0, easyTot: 0, medTot: 0, hardTot: 0 };
        runCountsByUser.set(uLower, stats);
      }
      const isVis = !r.hidden;
      if (diff === 'easy') {
        stats.easyTot++;
        if (isVis) stats.easyVis++;
      } else if (diff === 'medium') {
        stats.medTot++;
        if (isVis) stats.medVis++;
      } else if (diff === 'hard') {
        stats.hardTot++;
        if (isVis) stats.hardVis++;
      }
    }
  });

  const overview = {};
  for (const u of sortedUsers) {
    const eBest = Number(u.records?.easy) || 0;
    const mBest = Number(u.records?.medium) || 0;
    const hBest = Number(u.records?.hard) || 0;
    const allTimeBest = Math.max(eBest, mBest, hBest);
    const uLower = u.username.toLowerCase();

    const rStats = runCountsByUser.get(uLower) || { easyVis: 0, medVis: 0, hardVis: 0, easyTot: 0, medTot: 0, hardTot: 0 };
    const easySpots = rStats.easyVis;
    const medSpots = rStats.medVis;
    const hardSpots = rStats.hardVis;
    const easyTotalRuns = rStats.easyTot;
    const medTotalRuns = rStats.medTot;
    const hardTotalRuns = rStats.hardTot;
    const hiddenRunsCount = (easyTotalRuns - easySpots) + (medTotalRuns - medSpots) + (hardTotalRuns - hardSpots);

    const latestBestTime = Math.max(
      Number(u.recordTimestamps?.easy) || 0,
      Number(u.recordTimestamps?.medium) || 0,
      Number(u.recordTimestamps?.hard) || 0,
      Number(u.lastNewBestAt) || 0
    );

    if (!u.grantedSkins) u.grantedSkins = [];
    if (!u.adminLockedSkins) u.adminLockedSkins = [];
    if (!Array.isArray(u.unlockedBackgrounds)) u.unlockedBackgrounds = [];
    if (!u.selectedBackground || typeof u.selectedBackground !== 'string') u.selectedBackground = 'bg_classic';
    if (!u.loginHistory) u.loginHistory = [];
    if (typeof u.duelElo !== 'number' || Number.isNaN(u.duelElo)) u.duelElo = 1000;
    if (typeof u.duelWins !== 'number' || Number.isNaN(u.duelWins)) u.duelWins = 0;
    if (typeof u.duelLosses !== 'number' || Number.isNaN(u.duelLosses)) u.duelLosses = 0;
    if (typeof u.duelDraws !== 'number' || Number.isNaN(u.duelDraws)) u.duelDraws = 0;
    if (typeof u.duelMatches !== 'number' || Number.isNaN(u.duelMatches)) u.duelMatches = 0;
    if (typeof u.duelCoins !== 'number' || Number.isNaN(u.duelCoins)) u.duelCoins = 0;
    if (typeof u.duelBestMatchPoints !== 'number' || Number.isNaN(u.duelBestMatchPoints)) u.duelBestMatchPoints = 0;
    u.duelBestMatchPoints = Math.max(0, Math.floor(u.duelBestMatchPoints));
    if (u.duelBestMatchBreakdown && typeof u.duelBestMatchBreakdown !== 'object') u.duelBestMatchBreakdown = null;

    // Clean grantedSkins: never count default skins or skins the player already naturally unlocked via their scores!
    u.grantedSkins = u.grantedSkins.filter(id => id && id !== 'classic' && id !== 'classic_pipe' && id !== 'bg_classic' && !isSkinNaturallyUnlockedForUser(id, u));

    // Ensure equipped skins are strictly valid for current records or granted/case status
    if (u.selectedSkin && !isSkinUnlockedForUser(u.selectedSkin, u)) {
      u.selectedSkin = 'classic';
    }
    if (u.selectedPipeSkin && !isSkinUnlockedForUser(u.selectedPipeSkin, u)) {
      u.selectedPipeSkin = 'classic_pipe';
    }
    if (u.selectedBackground && !isSkinUnlockedForUser(u.selectedBackground, u)) {
      u.selectedBackground = 'bg_classic';
    }

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
      duelElo: u.duelElo,
      duelWins: u.duelWins,
      duelLosses: u.duelLosses,
      duelCoins: Math.round(Number(u.duelCoins) || 0),
      duelBestMatchPoints: u.duelBestMatchPoints || 0,
      duelBestMatchBreakdown: u.duelBestMatchBreakdown || null,
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
      selectedBackground: u.selectedBackground || 'bg_classic',
      cosmeticsVersion: Number(u.cosmeticsVersion) || 0,
      unlockedBackgrounds: Array.isArray(u.unlockedBackgrounds) ? u.unlockedBackgrounds : [],
      hasCustomImage: Boolean(u.customBackgroundImage),
      hasCustomVideo: Boolean(u.customBackgroundVideo && Array.isArray(u.customBackgroundVideo.frames) && u.customBackgroundVideo.frames.length > 0),
      grantedSkins: u.grantedSkins || [],
      adminLockedSkins: u.adminLockedSkins || [],
      banned: Boolean(u.banned),
      banInfo: u.banInfo || null,
      maxAccounts: (typeof u.maxAccounts === 'number' && u.maxAccounts >= 1) ? Math.floor(u.maxAccounts) : null,
      effectiveMaxAccounts: Math.max(1, Math.min(50, Math.floor(Number(u.maxAccounts || (db.adminSettings && db.adminSettings.defaultMaxAccounts) || 5)))),
      overAccountLimit: Boolean(u.overAccountLimit),
      isPrimaryBestAccount: u.isPrimaryBestAccount !== undefined ? Boolean(u.isPrimaryBestAccount) : true,
      primaryBestUsername: u.primaryBestUsername || u.username,
      clusterRank: Number(u.clusterRank) || 1,
      clusterAccountCount: Number(u.clusterAccountCount) || 1,
      loginHistory: (u.loginHistory || []).slice(0, 30),
      loginCount: u.loginCount || 0,
      lastLoginAtReadable: formatReadableTimestamp(u.lastLoginAt),
      lastNewBestAtReadable: formatReadableTimestamp(latestBestTime),
      createdAtReadable: formatReadableTimestamp(u.createdAt)
    };
  }
  if (!db.loginHistory) db.loginHistory = [];
  if (!Array.isArray(db.duelMatchHighScores)) db.duelMatchHighScores = [];

  // Ensure every registered user's duelBestMatchPoints is reflected in db.duelMatchHighScores (and vice versa)
  const bestInListByUser = new Map();
  for (const entry of db.duelMatchHighScores) {
    if (!entry || !entry.username) continue;
    const uKey = String(entry.username).toLowerCase();
    const pts = Math.max(0, Math.floor(Number(entry.points) || 0));
    if (pts <= 0) continue;
    if (!bestInListByUser.has(uKey) || pts > bestInListByUser.get(uKey)) {
      bestInListByUser.set(uKey, pts);
    }
    const usr = db.users[uKey];
    if (usr && pts > (Number(usr.duelBestMatchPoints) || 0)) {
      usr.duelBestMatchPoints = pts;
      usr.duelBestMatchBreakdown = {
        easyRaw: Number(entry.easyRaw) || 0,
        mediumRaw: Number(entry.mediumRaw) || 0,
        hardRaw: Number(entry.hardRaw) || 0,
        easyPts: Number(entry.easyPts) || 0,
        mediumPts: Number(entry.mediumPts) || 0,
        hardPts: Number(entry.hardPts) || 0,
        opponent: entry.opponent || '',
        achievedAt: Number(entry.createdAt) || Date.now()
      };
      if (overview[usr.username]) {
        overview[usr.username].duelBestMatchPoints = pts;
        overview[usr.username].duelBestMatchBreakdown = usr.duelBestMatchBreakdown;
      }
    }
  }
  for (const u of Object.values(db.users)) {
    if (!u || !u.username) continue;
    const uKey = u.username.toLowerCase();
    const bestPts = Math.max(0, Math.floor(Number(u.duelBestMatchPoints) || 0));
    if (bestPts > 0 && bestPts > (bestInListByUser.get(uKey) || 0)) {
      const bd = u.duelBestMatchBreakdown || {};
      db.duelMatchHighScores.push({
        id: crypto.randomBytes(6).toString('hex'),
        username: u.username,
        points: bestPts,
        easyRaw: Number(bd.easyRaw) || 0,
        mediumRaw: Number(bd.mediumRaw) || 0,
        hardRaw: Number(bd.hardRaw) || 0,
        easyPts: Number(bd.easyPts) || 0,
        mediumPts: Number(bd.mediumPts) || 0,
        hardPts: Number(bd.hardPts) || 0,
        opponent: bd.opponent || '',
        createdAt: Number(bd.achievedAt) || Date.now()
      });
    }
  }
  db.duelMatchHighScores = db.duelMatchHighScores
    .filter(e => e && e.username && Number(e.points) > 0)
    .sort((a, b) => (b.points - a.points) || ((a.createdAt || 0) - (b.createdAt || 0)))
    .slice(0, 200);

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
    defaultMaxAccounts: Math.max(1, Math.min(50, Math.floor(Number(db.adminSettings && db.adminSettings.defaultMaxAccounts) || 5))),
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
        // Try recovering from latest available backup snapshot
        if (fs.existsSync(BACKUPS_DIR)) {
          const backupFiles = fs.readdirSync(BACKUPS_DIR)
            .filter(f => f.endsWith('.json'))
            .map(f => ({ path: path.join(BACKUPS_DIR, f), mtime: fs.statSync(path.join(BACKUPS_DIR, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
          if (backupFiles.length > 0) {
            try {
              parsed = JSON.parse(fs.readFileSync(backupFiles[0].path, 'utf8'));
              console.log('🛡️ Successfully recovered database from latest backup: ' + backupFiles[0].path);
            } catch (bkErr) {
              console.error('Failed to parse backup:', bkErr.message);
            }
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
        banRegistry: (parsed.banRegistry && typeof parsed.banRegistry === 'object' && typeof parsed.banRegistry.groups === 'object')
          ? parsed.banRegistry
          : { groups: {} },
        users: parsed.users || {},
        runs: parsed.runs || { easy: [], medium: [], hard: [] },
        duelMatchHighScores: Array.isArray(parsed.duelMatchHighScores) ? parsed.duelMatchHighScores : [],
        duelMatchHistory: Array.isArray(parsed.duelMatchHistory) ? parsed.duelMatchHistory : [],
        sessions: parsed.sessions || {},
        chatMessages: Array.isArray(parsed.chatMessages) ? parsed.chatMessages : []
      };
    }

    if (!db.banRegistry || typeof db.banRegistry !== 'object' || typeof db.banRegistry.groups !== 'object') {
      db.banRegistry = { groups: {} };
    }
    if (!db.adminSettings || typeof db.adminSettings !== 'object') {
      db.adminSettings = {};
    }
    if (typeof db.adminSettings.defaultMaxAccounts !== 'number' || !Number.isFinite(db.adminSettings.defaultMaxAccounts) || db.adminSettings.defaultMaxAccounts < 1) {
      db.adminSettings.defaultMaxAccounts = 5;
    }

    // Guarantee runs structure exists
    if (!db.runs || typeof db.runs !== 'object') {
      db.runs = { easy: [], medium: [], hard: [] };
    }
    ['easy', 'medium', 'hard'].forEach(diff => {
      if (!Array.isArray(db.runs[diff])) db.runs[diff] = [];
    });
    if (!Array.isArray(db.duelMatchHighScores)) db.duelMatchHighScores = [];
    if (!Array.isArray(db.duelMatchHistory)) db.duelMatchHistory = [];

    if (db.activityFeed.length === 0) {
      logDatabaseEvent(
        'DATABASE_READY',
        'System',
        '🚀 3D Flappy Bird Live Database initialized with all player accounts & Top 100 leaderboard records.'
      );
    }

    syncAndRebuildOverview(fromWatcher);
    enrichOverviewWithClientSignals();
    if (!fromWatcher) {
      saveDatabase(false);
    }
  } catch (err) {
    console.error('Error loading database:', err.message);
  }
}

let lastBackupTimestamp = 0;
let pendingSaveTimer = null;

function writeOrderedDbToDisk(forceBackup = false) {
  try {
    isInternalWrite = true;
    lastInternalWriteAt = Date.now();
    const orderedDb = {
      databaseStatus: db.databaseStatus,
      playerRecordsOverview: db.playerRecordsOverview,
      activityFeed: db.activityFeed,
      loginHistory: db.loginHistory || [],
      adminSettings: db.adminSettings || {},
      banRegistry: db.banRegistry || { groups: {} },
      users: db.users,
      runs: db.runs,
      duelMatchHighScores: db.duelMatchHighScores || [],
      duelMatchHistory: db.duelMatchHistory || [],
      sessions: db.sessions,
      chatMessages: db.chatMessages || []
    };
    const jsonStr = JSON.stringify(orderedDb, null, 2);
    const tmpFile = DB_FILE + '.tmp';
    fs.writeFileSync(tmpFile, jsonStr, 'utf8');
    try {
      fs.renameSync(tmpFile, DB_FILE);
    } catch (renameErr) {
      fs.copyFileSync(tmpFile, DB_FILE);
      try { fs.unlinkSync(tmpFile); } catch (_) {}
    }

    try {
      const stat = fs.statSync(DB_FILE);
      lastInternalSavedMtime = stat.mtimeMs;
    } catch (_) {}

    const now = Date.now();
    if (forceBackup || now - lastBackupTimestamp > 15 * 60 * 1000) {
      lastBackupTimestamp = now;
      try {
        const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
        const backupTarget = path.join(BACKUPS_DIR, `db-backup-${stamp}.json`);
        fs.writeFileSync(backupTarget, jsonStr, 'utf8');
        pruneBackups(3);
      } catch (backupErr) {
        console.error('Backup write error:', backupErr.message);
      }
    }

    setTimeout(() => { isInternalWrite = false; }, 1200);
  } catch (err) {
    isInternalWrite = false;
    console.error('Error saving database:', err.message);
  }
}

function saveDatabase(forceBackup = false) {
  try {
    lastInternalWriteAt = Date.now();
    cachedLeaderboards = null;
    cachedAllLeaderboards = null;
    cachedAllRunsAdmin = null;
    syncAndRebuildOverview(false);
    enrichOverviewWithClientSignals();

    if (forceBackup) {
      if (pendingSaveTimer) {
        clearTimeout(pendingSaveTimer);
        pendingSaveTimer = null;
      }
      writeOrderedDbToDisk(true);
    } else {
      if (pendingSaveTimer) clearTimeout(pendingSaveTimer);
      pendingSaveTimer = setTimeout(() => {
        pendingSaveTimer = null;
        writeOrderedDbToDisk(false);
      }, 30);
      if (typeof pendingSaveTimer.unref === 'function') {
        pendingSaveTimer.unref();
      }
    }
  } catch (err) {
    console.error('Error scheduling database save:', err.message);
  }
}

/**
 * Bulk reset of all records is disabled to protect all-time, weekly, and daily leaderboards.
 * MeDonut can add, edit, or delete individual records at any time.
 */
function resetAllRecordsAdmin() {
  return {
    ok: false,
    error: 'Bulk reset of all records is disabled. Use individual player/run controls to add, edit, or delete records.'
  };
}

// Watch `data/db.json` so if the owner edits & saves `db.json` in a text editor, changes apply live!
fs.watchFile(DB_FILE, { interval: 2500, persistent: false }, (curr, prev) => {
  if (isInternalWrite || pendingSaveTimer !== null) return;
  if (lastInternalWriteAt && (Date.now() - lastInternalWriteAt < 4000)) return;
  if (lastInternalSavedMtime && Math.abs(curr.mtimeMs - lastInternalSavedMtime) < 250) return;
  if (curr.mtimeMs !== prev.mtimeMs) {
    console.log('🔄 Detected genuine external edit to data/db.json — reloading & syncing records...');
    loadDatabase(true);
  }
});

/**
 * Builds the 3-Difficulty Leaderboards for a specific timeframe (all, weekly, daily).
 * - all: all-time non-hidden records
 * - weekly: runs achieved since the most recent Monday 07:00:00 Danish Time
 * - daily: runs achieved since the most recent 07:00:00 Danish Time
 */
function buildLeaderboards(limit = 100, timeframe = 'all', nowMs = Date.now()) {
  const boundaries = getLeaderboardResetBoundaries(nowMs);
  let minCreatedAt = 0;
  if (timeframe === 'daily') {
    minCreatedAt = boundaries.daily.currentResetMs;
  } else if (timeframe === 'weekly') {
    minCreatedAt = boundaries.weekly.currentResetMs;
  }

  const result = { easy: [], medium: [], hard: [] };

  ['easy', 'medium', 'hard'].forEach(diff => {
    const runsList = (db.runs && Array.isArray(db.runs[diff])) ? db.runs[diff] : [];
    let filtered = runsList
      .filter(entry => {
        if (!entry || typeof entry.score !== 'number' || entry.score <= 0 || entry.hidden) return false;
        const usr = entry.username && db.users && db.users[String(entry.username).toLowerCase()];
        if (usr && (usr.banned || usr.overAccountLimit)) return false;
        if (minCreatedAt > 0 && (!entry.createdAt || entry.createdAt < minCreatedAt)) return false;
        if (entry.adminOverride) return true;
        if (entry.isWithinDanishWindow !== undefined) return entry.isWithinDanishWindow;
        entry.isWithinDanishWindow = isWithinDanishWindow(entry.createdAt);
        return entry.isWithinDanishWindow;
      })
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
 * Builds all 3 timeframes (All Time, Weekly, Daily) simultaneously along with reset boundaries
 */
function buildAllTimeframeLeaderboards(limit = 100, nowMs = Date.now()) {
  const boundaries = getLeaderboardResetBoundaries(nowMs);
  return {
    all: buildLeaderboards(limit, 'all', nowMs),
    weekly: buildLeaderboards(limit, 'weekly', nowMs),
    daily: buildLeaderboards(limit, 'daily', nowMs),
    resetBoundaries: boundaries
  };
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
 * Runs achieved outside 07:50 - 14:10 Danish Time are automatically saved with hidden: true
 * so they do not show on the public leaderboard.
 */
function recordVerifiedRun(user, diffKey, verifiedScore) {
  const now = Date.now();
  if (!user.records) user.records = { easy: 0, medium: 0, hard: 0 };
  if (!user.recordTimestamps) user.recordTimestamps = { easy: 0, medium: 0, hard: 0 };

  const withinWindow = isWithinDanishWindow(now);
  const previousBest = Number(user.records[diffKey]) || 0;
  let isNewRecord = false;
  let autoHidden = false;

  if (withinWindow) {
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
  } else {
    // Achieved on weekend or outside Danish competition hours -> Automatically hidden from leaderboard!
    autoHidden = true;
    logDatabaseEvent(
      'OFF_HOURS_RUN',
      user.username,
      `🕒 ${user.username} finished a ${diffKey.toUpperCase()} run of ${verifiedScore} pts on weekend or outside allowed hours (7:50-14:10) — Run automatically hidden from leaderboard.`,
      {
        difficulty: diffKey,
        score: verifiedScore,
        danishTime: formatDanishTime(now),
        hidden: true
      }
    );
  }

  let newRunId = null;
  if (verifiedScore > 0) {
    if (!db.runs) db.runs = { easy: [], medium: [], hard: [] };
    if (!Array.isArray(db.runs[diffKey])) db.runs[diffKey] = [];

    newRunId = crypto.randomBytes(8).toString('hex');
    // Always append the new run so Daily and Weekly leaderboards NEVER drop a run even if the player has 100+ historical runs!
    // syncAndRebuildOverview() automatically retains all active Weekly/Daily runs + up to 100 top historical runs per player.
    db.runs[diffKey].push({
      id: newRunId,
      username: user.username,
      score: verifiedScore,
      hidden: !withinWindow,
      createdAt: now
    });

    db.runs[diffKey].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  saveDatabase();
  return { isNewRecord, newRunId, previousBest, autoHidden, withinWindow };
}

/**
 * Allows the game owner (MeDonut) to directly update a player's records or skins via the `/database` manager
 * AND immediately syncs `db.runs[diff]` so the leaderboard reflects the new best score (whether raised, lowered, or set to 0)!
 */
function updatePlayerRecordsAdmin(username, newRecords, selectedSkin, selectedPipeSkin, newDuelElo = undefined) {
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
      if (val !== oldVal) {
        syncUserRunsToBestScore(user.username, diff, val, now);
        user.recordTimestamps[diff] = now;
        changes.push(`${diff.toUpperCase()}: ${oldVal} -> ${val}`);
      }
    }
  });

  if (newDuelElo !== undefined && newDuelElo !== null && newDuelElo !== '') {
    const cleanElo = Math.max(0, Math.floor(Number(newDuelElo) || 0));
    const oldElo = typeof user.duelElo === 'number' ? user.duelElo : 1000;
    user.duelElo = cleanElo;
    if (cleanElo !== oldElo) {
      changes.push(`DUEL ELO: ${oldElo} -> ${cleanElo}`);
    }
  }

  if (typeof selectedSkin === 'string' && selectedSkin.trim()) {
    user.selectedSkin = selectedSkin.trim();
  }
  if (typeof selectedPipeSkin === 'string' && selectedPipeSkin.trim()) {
    user.selectedPipeSkin = selectedPipeSkin.trim();
  }

  // Validate that currently equipped skins are still unlocked after record updates
  if (user.selectedSkin && !isSkinUnlockedForUser(user.selectedSkin, user)) {
    user.selectedSkin = 'classic';
  }
  if (user.selectedPipeSkin && !isSkinUnlockedForUser(user.selectedPipeSkin, user)) {
    user.selectedPipeSkin = 'classic_pipe';
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
      run.adminOverride = true;
      actionParts.push(`score ${oldScore} -> ${newScore} pts`);
    }
  }

  if (updates.hidden !== undefined) {
    const newHidden = Boolean(updates.hidden);
    run.hidden = newHidden;
    run.adminOverride = true;
    if (newHidden !== oldHidden) {
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
  const cleanHidden = Boolean(hidden);

  if (!db.runs[difficulty]) db.runs[difficulty] = [];

  const newRun = {
    id: crypto.randomBytes(8).toString('hex'),
    username: canonicalUsername,
    score: cleanScore,
    hidden: cleanHidden,
    adminOverride: true,
    createdAt: now
  };
  db.runs[difficulty].push(newRun);
  db.runs[difficulty].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });

  if (user) {
    recalculateUserBestFromVisibleRuns(user.username, difficulty);
  }

  logDatabaseEvent(
    'ADMIN_ADD_RUN',
    canonicalUsername,
    `➕ Added ${difficulty.toUpperCase()} run of ${cleanScore} pts for ${canonicalUsername} (${cleanHidden ? 'Hidden' : 'Visible'})`,
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
        r.adminOverride = true;
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

let cachedAllRunsAdmin = null;

/**
 * Returns all runs across Easy, Medium, and Hard (including hidden runs) with formatted timestamps and visible rank.
 */
function getAllRunsAdmin() {
  if (cachedAllRunsAdmin) return cachedAllRunsAdmin;
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
        const isOffHours = !isWithinDanishWindow(r.createdAt);
        const isHidden = r.adminOverride ? Boolean(r.hidden) : (Boolean(r.hidden) || isOffHours);
        if (!isHidden) visibleRankCounter++;
        return {
          id: r.id,
          username: r.username,
          score: r.score,
          hidden: isHidden,
          isOffHours,
          danishTime: formatDanishTime(r.createdAt),
          visibleRank: isHidden ? null : visibleRankCounter,
          createdAt: r.createdAt || 0,
          readableTime: formatReadableTimestamp(r.createdAt)
        };
      });
  });
  cachedAllRunsAdmin = result;
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
 * Equipping a skin does NOT add it to `grantedSkins`!
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
  if (!Array.isArray(user.unlockedBackgrounds)) user.unlockedBackgrounds = [];
  if (!user.selectedBackground) user.selectedBackground = 'bg_classic';

  const {
    grantSkinId,
    revokeSkinId,
    lockSkinId,
    unlockSkinId,
    selectedSkin,
    selectedPipeSkin,
    selectedBackground,
    clearCustomImage,
    clearCustomVideo
  } = options;
  let changed = false;
  const actionLog = [];

  if (grantSkinId) {
    const skinId = String(grantSkinId).trim();
    if (!isSkinNaturallyUnlockedForUser(skinId, user) && !user.grantedSkins.includes(skinId)) {
      user.grantedSkins.push(skinId);
    }
    if (BACKGROUND_SKIN_IDS.has(skinId) && skinId !== 'bg_classic' && !user.unlockedBackgrounds.includes(skinId)) {
      user.unlockedBackgrounds.push(skinId);
    }
    user.adminLockedSkins = user.adminLockedSkins.filter(id => id !== skinId);
    actionLog.push(`Granted skin "${skinId}"`);
    changed = true;
  }

  if (revokeSkinId) {
    const skinId = String(revokeSkinId).trim();
    user.grantedSkins = user.grantedSkins.filter(id => id !== skinId);
    if (BACKGROUND_SKIN_IDS.has(skinId)) {
      user.unlockedBackgrounds = user.unlockedBackgrounds.filter(id => id !== skinId);
      if (user.selectedBackground === skinId) user.selectedBackground = 'bg_classic';
    }
    actionLog.push(`Revoked skin "${skinId}"`);
    changed = true;
  }

  if (lockSkinId) {
    const skinId = String(lockSkinId).trim();
    if (!user.adminLockedSkins.includes(skinId)) {
      user.adminLockedSkins.push(skinId);
    }
    user.grantedSkins = user.grantedSkins.filter(id => id !== skinId);
    if (BACKGROUND_SKIN_IDS.has(skinId)) {
      user.unlockedBackgrounds = user.unlockedBackgrounds.filter(id => id !== skinId);
      if (user.selectedBackground === skinId) user.selectedBackground = 'bg_classic';
    }
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
    // Do NOT add equipped skin to grantedSkins!
    user.grantedSkins = user.grantedSkins.filter(id => id && id !== 'classic' && id !== 'classic_pipe' && id !== 'bg_classic' && !isSkinNaturallyUnlockedForUser(id, user));
    actionLog.push(`Set bird skin to "${user.selectedSkin}"`);
    changed = true;
  }

  if (typeof selectedPipeSkin === 'string' && selectedPipeSkin.trim()) {
    user.selectedPipeSkin = selectedPipeSkin.trim();
    // Do NOT add equipped pipe skin to grantedSkins!
    user.grantedSkins = user.grantedSkins.filter(id => id && id !== 'classic' && id !== 'classic_pipe' && id !== 'bg_classic' && !isSkinNaturallyUnlockedForUser(id, user));
    actionLog.push(`Set pipe skin to "${user.selectedPipeSkin}"`);
    changed = true;
  }

  if (typeof selectedBackground === 'string' && selectedBackground.trim()) {
    const bgId = selectedBackground.trim();
    if (BACKGROUND_SKIN_IDS.has(bgId) || bgId === 'bg_classic') {
      user.selectedBackground = bgId;
      actionLog.push(`Set background skin to "${bgId}"`);
      changed = true;
    }
  }

  if (clearCustomImage) {
    user.customBackgroundImage = null;
    user.customBgUpdatedAt = Date.now();
    if (user.selectedBackground === 'bg_custom_image') user.selectedBackground = 'bg_classic';
    actionLog.push('Cleared uploaded custom picture');
    changed = true;
  }

  if (clearCustomVideo) {
    user.customBackgroundVideo = null;
    user.customBgUpdatedAt = Date.now();
    if (user.selectedBackground === 'bg_custom_video') user.selectedBackground = 'bg_classic';
    actionLog.push('Cleared uploaded custom video');
    changed = true;
  }

  if (changed) {
    user.cosmeticsVersion = (Number(user.cosmeticsVersion) || 0) + 1;
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
    unlockedBackgrounds: user.unlockedBackgrounds,
    selectedSkin: user.selectedSkin,
    selectedPipeSkin: user.selectedPipeSkin,
    selectedBackground: user.selectedBackground,
    cosmeticsVersion: Number(user.cosmeticsVersion) || 0,
    hasCustomImage: Boolean(user.customBackgroundImage),
    hasCustomVideo: Boolean(user.customBackgroundVideo && Array.isArray(user.customBackgroundVideo.frames) && user.customBackgroundVideo.frames.length > 0),
    user
  };
}

/**
 * Retrieves the latest chat messages up to `limit` (default 60),
 * optionally filtering for messages created after `sinceTimestamp`.
 */
function getChatMessages(limit = 60, sinceTimestamp = 0) {
  if (!Array.isArray(db.chatMessages)) db.chatMessages = [];
  const since = Number(sinceTimestamp) || 0;
  let list = db.chatMessages;
  if (since > 0) {
    list = list.filter(m => m && m.timestampMs > since);
  }
  const max = Math.max(1, Math.min(Number(limit) || 60, 150));
  return list.slice(-max);
}

/**
 * Appends a new chat message or system announcement to `db.chatMessages`.
 * Automatically manages timestamps, ID, Danish time format, and caps storage at 200 items.
 */
function addChatMessage({ type = 'user', subtype = null, tagLabel = null, leaderboardType = null, username = 'Player', usernameKey = '', isMeDonut = false, avatar = '🐤', text = '', replyTo = null, timestampMs = null }) {
  if (!Array.isArray(db.chatMessages)) db.chatMessages = [];

  const now = Number(timestampMs) || Date.now();
  const timeStr = formatDanishTime(now) || 'Just now';

  const message = {
    id: crypto.randomBytes(6).toString('hex'),
    type: type === 'system' ? 'system' : 'user',
    subtype: subtype || null,
    tagLabel: tagLabel ? String(tagLabel).slice(0, 50) : null,
    leaderboardType: leaderboardType ? String(leaderboardType).slice(0, 30) : null,
    username: String(username || 'Player').slice(0, 32),
    usernameKey: String(usernameKey || '').toLowerCase(),
    isMeDonut: Boolean(isMeDonut),
    avatar: String(avatar || '🐤'),
    text: String(text || '').slice(0, 500),
    replyTo: (replyTo && typeof replyTo === 'object' && replyTo.username) ? {
      id: String(replyTo.id || ''),
      username: String(replyTo.username || '').slice(0, 32),
      snippet: String(replyTo.snippet || '').slice(0, 60)
    } : null,
    timestampMs: now,
    timeStr
  };

  db.chatMessages.push(message);
  if (db.chatMessages.length > 200) {
    db.chatMessages = db.chatMessages.slice(-200);
  }

  saveDatabase(false);
  return message;
}

/**
 * Calculates Ranked Duel Elo changes using the competitive Elo formula.
 * Winning against a higher-Elo opponent yields MORE Elo (up to +36);
 * winning against a lower-Elo opponent yields LESS Elo (down to +4).
 * Losing against a lower-Elo opponent loses MORE Elo; losing against a higher-Elo opponent loses LESS Elo.
 */
function calculateDuelEloUpdate(eloA, eloB, pointsA, pointsB) {
  const rA = (typeof eloA === 'number' && !Number.isNaN(eloA)) ? eloA : 1000;
  const rB = (typeof eloB === 'number' && !Number.isNaN(eloB)) ? eloB : 1000;
  const K = 40;

  const expectedA = 1 / (1 + Math.pow(10, (rB - rA) / 400));
  const expectedB = 1 - expectedA;

  let actualA = 0.5;
  let actualB = 0.5;
  if (pointsA > pointsB) {
    actualA = 1;
    actualB = 0;
  } else if (pointsB > pointsA) {
    actualA = 0;
    actualB = 1;
  }

  let deltaA = Math.round(K * (actualA - expectedA));
  let deltaB = Math.round(K * (actualB - expectedB));

  if (actualA === 1) {
    deltaA = Math.max(4, deltaA);
    const lossReduction = deltaA >= 16 ? 2 : 1;
    deltaB = -Math.max(2, deltaA - lossReduction);
  } else if (actualB === 1) {
    deltaB = Math.max(4, deltaB);
    const lossReduction = deltaB >= 16 ? 2 : 1;
    deltaA = -Math.max(2, deltaB - lossReduction);
  } else {
    if (deltaA > 0) deltaB = -Math.max(0, deltaA - 1);
    else if (deltaB > 0) deltaA = -Math.max(0, deltaB - 1);
    else deltaB = -deltaA;
  }

  // Enforce strict ELO gap scaling limits based on |rA - rB|
  const eloDiff = Math.abs(rA - rB);
  if (eloDiff > 300) {
    deltaA = 0;
    deltaB = 0;
  } else if (eloDiff > 200) {
    // Over 200 difference: strictly less than 3 ELO gained or lost (max +/- 2)
    if (actualA === 1) {
      deltaA = Math.min(2, Math.max(1, deltaA));
      deltaB = -Math.min(2, Math.max(1, deltaA > 1 ? deltaA - 1 : 1));
    } else if (actualB === 1) {
      deltaB = Math.min(2, Math.max(1, deltaB));
      deltaA = -Math.min(2, Math.max(1, deltaB > 1 ? deltaB - 1 : 1));
    } else {
      deltaA = Math.max(-2, Math.min(2, deltaA));
      deltaB = Math.max(-2, Math.min(2, deltaB));
    }
  } else if (eloDiff > 150) {
    // Over 150 difference: cannot gain or lose more than 10 ELO
    if (actualA === 1) {
      deltaA = Math.min(10, Math.max(4, deltaA));
      deltaB = -Math.min(10, Math.max(2, deltaA - 1));
    } else if (actualB === 1) {
      deltaB = Math.min(10, Math.max(4, deltaB));
      deltaA = -Math.min(10, Math.max(2, deltaB - 1));
    } else {
      deltaA = Math.max(-10, Math.min(10, deltaA));
      deltaB = Math.max(-10, Math.min(10, deltaB));
    }
  }

  const newEloA = Math.max(100, rA + deltaA);
  const newEloB = Math.max(100, rB + deltaB);

  return {
    oldEloA: rA,
    oldEloB: rB,
    newEloA,
    newEloB,
    deltaA: newEloA - rA,
    deltaB: newEloB - rB
  };
}

/**
 * Records the final outcome of a 3-round Ranked Duel in the database and updates both players' Elo.
 */
function recordDuelMatchResult(usernameA, usernameB, pointsA, pointsB, details = {}) {
  if (!db.users) db.users = {};
  if (!Array.isArray(db.duelMatchHighScores)) db.duelMatchHighScores = [];
  const keyA = String(usernameA || '').toLowerCase();
  const keyB = String(usernameB || '').toLowerCase();
  const userA = db.users[keyA];
  const userB = db.users[keyB];

  const eloA = (userA && typeof userA.duelElo === 'number') ? userA.duelElo : 1000;
  const eloB = (userB && typeof userB.duelElo === 'number') ? userB.duelElo : 1000;

  if (details && details.isFriendly) {
    return {
      oldEloA: eloA,
      newEloA: eloA,
      deltaA: 0,
      oldEloB: eloB,
      newEloB: eloB,
      deltaB: 0,
      coinsEarnedA: 0,
      coinsEarnedB: 0,
      newCoinsA: userA ? Math.round(Number(userA.duelCoins) || 0) : 0,
      newCoinsB: userB ? Math.round(Number(userB.duelCoins) || 0) : 0
    };
  }

  const eloRes = calculateDuelEloUpdate(eloA, eloB, pointsA, pointsB);

  const safePointsA = Math.max(0, Math.round(Number(pointsA) || 0));
  const safePointsB = Math.max(0, Math.round(Number(pointsB) || 0));
  let coinsA = safePointsA;
  let coinsB = safePointsB;
  if (safePointsA > safePointsB) {
    coinsA = Math.round(safePointsA * 1.5);
    coinsB = Math.round(safePointsB * 0.7);
  } else if (safePointsB > safePointsA) {
    coinsA = Math.round(safePointsA * 0.7);
    coinsB = Math.round(safePointsB * 1.5);
  }

  const now = Date.now();
  const recordUserMatchHighScore = (userObj, pts, roundsObj, oppName) => {
    if (!userObj || pts <= 0) return;
    const rE = (roundsObj && roundsObj.easy) || {};
    const rM = (roundsObj && roundsObj.medium) || {};
    const rH = (roundsObj && roundsObj.hard) || {};
    const entry = {
      id: crypto.randomBytes(6).toString('hex'),
      username: userObj.username,
      points: pts,
      easyRaw: Number(rE.rawScore) || 0,
      mediumRaw: Number(rM.rawScore) || 0,
      hardRaw: Number(rH.rawScore) || 0,
      easyPts: Number(rE.weightedScore) || 0,
      mediumPts: Number(rM.weightedScore) || 0,
      hardPts: Number(rH.weightedScore) || 0,
      opponent: String(oppName || ''),
      createdAt: now
    };
    db.duelMatchHighScores.push(entry);
    if (pts > (Number(userObj.duelBestMatchPoints) || 0)) {
      userObj.duelBestMatchPoints = pts;
      userObj.duelBestMatchBreakdown = {
        easyRaw: entry.easyRaw,
        mediumRaw: entry.mediumRaw,
        hardRaw: entry.hardRaw,
        easyPts: entry.easyPts,
        mediumPts: entry.mediumPts,
        hardPts: entry.hardPts,
        opponent: entry.opponent,
        achievedAt: now
      };
    }
  };

  if (userA && keyA !== keyB) {
    userA.duelElo = eloRes.newEloA;
    userA.duelMatches = (userA.duelMatches || 0) + 1;
    userA.duelCoins = Math.max(0, Math.round(Number(userA.duelCoins) || 0) + coinsA);
    if (pointsA > pointsB) userA.duelWins = (userA.duelWins || 0) + 1;
    else if (pointsB > pointsA) userA.duelLosses = (userA.duelLosses || 0) + 1;
    else userA.duelDraws = (userA.duelDraws || 0) + 1;
    recordUserMatchHighScore(userA, safePointsA, details.roundsA, usernameB);
  }

  if (userB && keyA !== keyB) {
    userB.duelElo = eloRes.newEloB;
    userB.duelMatches = (userB.duelMatches || 0) + 1;
    userB.duelCoins = Math.max(0, Math.round(Number(userB.duelCoins) || 0) + coinsB);
    if (pointsB > pointsA) userB.duelWins = (userB.duelWins || 0) + 1;
    else if (pointsA > pointsB) userB.duelLosses = (userB.duelLosses || 0) + 1;
    else userB.duelDraws = (userB.duelDraws || 0) + 1;
    recordUserMatchHighScore(userB, safePointsB, details.roundsB, usernameA);
  }

  db.duelMatchHighScores = db.duelMatchHighScores
    .filter(e => e && e.username && Number(e.points) > 0)
    .sort((a, b) => (b.points - a.points) || ((a.createdAt || 0) - (b.createdAt || 0)))
    .slice(0, 200);

  if (!Array.isArray(db.duelMatchHistory)) db.duelMatchHistory = [];
  if (keyA !== keyB && (userA || userB)) {
    const normRounds = (roundsObj) => {
      const rE = (roundsObj && roundsObj.easy) || {};
      const rM = (roundsObj && roundsObj.medium) || {};
      const rH = (roundsObj && roundsObj.hard) || {};
      const eRaw = Math.max(0, Math.floor(Number(rE.rawScore) || 0));
      const mRaw = Math.max(0, Math.floor(Number(rM.rawScore) || 0));
      const hRaw = Math.max(0, Math.floor(Number(rH.rawScore) || 0));
      return {
        easy: { raw: eRaw, pts: Number(rE.weightedScore) || eRaw },
        medium: { raw: mRaw, pts: Number(rM.weightedScore) || (mRaw * 2) },
        hard: { raw: hRaw, pts: Number(rH.weightedScore) || (hRaw * 3) }
      };
    };
    const dispA = userA ? userA.username : String(usernameA || 'Player 1');
    const dispB = userB ? userB.username : String(usernameB || 'Player 2');
    const isDrawMatch = safePointsA === safePointsB;
    const winnerName = isDrawMatch ? null : (safePointsA > safePointsB ? dispA : dispB);
    db.duelMatchHistory.unshift({
      id: 'dm_' + crypto.randomBytes(6).toString('hex'),
      createdAt: now,
      readableAt: formatReadableTimestamp(now),
      isDraw: isDrawMatch,
      winnerUsername: winnerName,
      playerA: {
        username: dispA,
        oldElo: eloRes.oldEloA,
        newElo: eloRes.newEloA,
        eloDelta: eloRes.deltaA,
        coinsEarned: coinsA,
        totalPoints: safePointsA,
        rounds: normRounds(details.roundsA)
      },
      playerB: {
        username: dispB,
        oldElo: eloRes.oldEloB,
        newElo: eloRes.newEloB,
        eloDelta: eloRes.deltaB,
        coinsEarned: coinsB,
        totalPoints: safePointsB,
        rounds: normRounds(details.roundsB)
      }
    });
    if (db.duelMatchHistory.length > 500) {
      db.duelMatchHistory = db.duelMatchHistory.slice(0, 500);
    }
  }

  saveDatabase(false);
  return {
    ...eloRes,
    coinsEarnedA: coinsA,
    coinsEarnedB: coinsB,
    newCoinsA: userA ? Math.round(userA.duelCoins || 0) : coinsA,
    newCoinsB: userB ? Math.round(userB.duelCoins || 0) : coinsB
  };
}

/**
 * Returns full Ranked Duel match history for a player (recorded matches + historical pairs
 * reconstructed from `duelMatchHighScores` so past games also display Easy/Med/Hard & opponents).
 */
function getPlayerRankedDuelHistory(username, limit = 60) {
  const cleanName = typeof username === 'string' ? username.trim() : '';
  const targetKey = cleanName.toLowerCase();
  if (!targetKey) return [];

  const history = [];
  const recorded = Array.isArray(db.duelMatchHistory) ? db.duelMatchHistory : [];

  for (const m of recorded) {
    if (!m || !m.playerA || !m.playerB) continue;
    const aKey = String(m.playerA.username || '').toLowerCase();
    const bKey = String(m.playerB.username || '').toLowerCase();
    if (aKey !== targetKey && bKey !== targetKey) continue;

    const amA = aKey === targetKey;
    const me = amA ? m.playerA : m.playerB;
    const opp = amA ? m.playerB : m.playerA;
    const myTotal = Number(me.totalPoints) || 0;
    const oppTotal = Number(opp.totalPoints) || 0;
    const outcome = m.isDraw ? 'draw' : (myTotal > oppTotal ? 'win' : (oppTotal > myTotal ? 'loss' : 'draw'));

    history.push({
      id: m.id,
      createdAt: Number(m.createdAt) || 0,
      readableAt: m.readableAt || formatReadableTimestamp(m.createdAt),
      outcome,
      opponent: opp.username || 'Opponent',
      myTotal,
      oppTotal,
      myRounds: me.rounds || { easy: { raw: 0, pts: 0 }, medium: { raw: 0, pts: 0 }, hard: { raw: 0, pts: 0 } },
      oppRounds: opp.rounds || { easy: { raw: 0, pts: 0 }, medium: { raw: 0, pts: 0 }, hard: { raw: 0, pts: 0 } },
      oldElo: me.oldElo ?? null,
      newElo: me.newElo ?? null,
      eloDelta: typeof me.eloDelta === 'number' ? me.eloDelta : null,
      oppOldElo: opp.oldElo ?? null,
      oppNewElo: opp.newElo ?? null,
      coinsEarned: Number(me.coinsEarned) || 0,
      eloRecorded: true
    });
  }

  // Reconstruct older ranked matches from `duelMatchHighScores` that happened before `duelMatchHistory` existed
  const hs = Array.isArray(db.duelMatchHighScores) ? db.duelMatchHighScores : [];
  for (let i = 0; i < hs.length; i++) {
    const e = hs[i];
    if (!e || !e.username || String(e.username).toLowerCase() !== targetKey) continue;
    const eTime = Number(e.createdAt) || 0;
    const eOpp = String(e.opponent || '').trim();
    const eOppKey = eOpp.toLowerCase();

    const alreadyRecorded = history.some(h =>
      Math.abs((h.createdAt || 0) - eTime) <= 3000 &&
      String(h.opponent || '').toLowerCase() === eOppKey
    );
    if (alreadyRecorded) continue;

    // Look for reciprocal opponent entry at the exact same match finish timestamp
    const oppEntry = hs.find((o, j) =>
      j !== i &&
      o && o.username && String(o.username).toLowerCase() === eOppKey &&
      String(o.opponent || '').toLowerCase() === targetKey &&
      Math.abs((Number(o.createdAt) || 0) - eTime) <= 2000
    ) || null;

    const myTotal = Math.max(0, Math.round(Number(e.points) || 0));
    const oppTotal = oppEntry ? Math.max(0, Math.round(Number(oppEntry.points) || 0)) : null;
    const outcome = oppEntry
      ? (myTotal > oppTotal ? 'win' : (oppTotal > myTotal ? 'loss' : 'draw'))
      : 'recorded';

    const myE = Number(e.easyRaw) || 0;
    const myM = Number(e.mediumRaw) || 0;
    const myH = Number(e.hardRaw) || 0;
    const opE = oppEntry ? (Number(oppEntry.easyRaw) || 0) : null;
    const opM = oppEntry ? (Number(oppEntry.mediumRaw) || 0) : null;
    const opH = oppEntry ? (Number(oppEntry.hardRaw) || 0) : null;

    history.push({
      id: 'hs_' + (e.id || `${i}_${eTime}`),
      createdAt: eTime,
      readableAt: formatReadableTimestamp(eTime),
      outcome,
      opponent: (oppEntry && oppEntry.username) || eOpp || 'Opponent',
      myTotal,
      oppTotal,
      myRounds: {
        easy: { raw: myE, pts: Number(e.easyPts) || myE },
        medium: { raw: myM, pts: Number(e.mediumPts) || (myM * 2) },
        hard: { raw: myH, pts: Number(e.hardPts) || (myH * 3) }
      },
      oppRounds: oppEntry ? {
        easy: { raw: opE, pts: Number(oppEntry.easyPts) || opE },
        medium: { raw: opM, pts: Number(oppEntry.mediumPts) || (opM * 2) },
        hard: { raw: opH, pts: Number(oppEntry.hardPts) || (opH * 3) }
      } : null,
      oldElo: null,
      newElo: null,
      eloDelta: null,
      oppOldElo: null,
      oppNewElo: null,
      coinsEarned: null,
      eloRecorded: false
    });
  }

  history.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return limit > 0 ? history.slice(0, limit) : history;
}

/**
 * Builds the Ranked Duels High-Score Leaderboard (most points in 1 ranked 3-round game).
 * Uses `db.duelMatchHighScores` + `users[*].duelBestMatchPoints` so nothing is ever lost.
 */
function buildDuelHighScoreLeaderboard(uniqueOnly = false, limit = 100) {
  const rawList = Array.isArray(db.duelMatchHighScores) ? db.duelMatchHighScores.slice() : [];
  const seenBestByUser = new Set();
  for (const e of rawList) {
    if (e && e.username) seenBestByUser.add(String(e.username).toLowerCase());
  }

  if (db.users && typeof db.users === 'object') {
    for (const u of Object.values(db.users)) {
      if (!u || !u.username || u.banned || u.overAccountLimit) continue;
      const pts = Math.max(0, Math.floor(Number(u.duelBestMatchPoints) || 0));
      if (pts > 0 && !seenBestByUser.has(u.username.toLowerCase())) {
        const bd = u.duelBestMatchBreakdown || {};
        rawList.push({
          id: 'best_' + u.username.toLowerCase(),
          username: u.username,
          points: pts,
          easyRaw: Number(bd.easyRaw) || 0,
          mediumRaw: Number(bd.mediumRaw) || 0,
          hardRaw: Number(bd.hardRaw) || 0,
          easyPts: Number(bd.easyPts) || 0,
          mediumPts: Number(bd.mediumPts) || 0,
          hardPts: Number(bd.hardPts) || 0,
          opponent: bd.opponent || '',
          createdAt: Number(bd.achievedAt) || Number(u.lastNewBestAt) || 0
        });
      }
    }
  }

  const sorted = rawList
    .filter(e => e && e.username && Number(e.points) > 0)
    .sort((a, b) => (b.points - a.points) || ((a.createdAt || 0) - (b.createdAt || 0)));

  const finalItems = [];
  const uniqueUsers = new Set();
  for (const e of sorted) {
    const uKey = String(e.username).toLowerCase();
    const usr = db.users && db.users[uKey];
    if (usr && (usr.banned || usr.overAccountLimit)) continue;
    if (uniqueOnly) {
      if (uniqueUsers.has(uKey)) continue;
      uniqueUsers.add(uKey);
    }
    finalItems.push({
      rank: finalItems.length + 1,
      id: e.id || '',
      username: usr ? usr.username : e.username,
      points: Math.round(Number(e.points) || 0),
      easyRaw: Number(e.easyRaw) || 0,
      mediumRaw: Number(e.mediumRaw) || 0,
      hardRaw: Number(e.hardRaw) || 0,
      easyPts: Number(e.easyPts) || 0,
      mediumPts: Number(e.mediumPts) || 0,
      hardPts: Number(e.hardPts) || 0,
      opponent: e.opponent || '',
      createdAt: Number(e.createdAt) || 0
    });
    if (finalItems.length >= limit) break;
  }
  return finalItems;
}

/**
 * Builds the Ranked Duels Leaderboard with strictly 1 placement per player, sorted by highest Elo.
 */
function buildDuelRankedLeaderboard() {
  if (!db.users || typeof db.users !== 'object') return [];
  const seenKeys = new Set();
  const list = [];

  for (const u of Object.values(db.users)) {
    if (!u || !u.username || u.banned || u.overAccountLimit) continue;
    const uKey = String(u.username).toLowerCase();
    if (seenKeys.has(uKey)) continue;
    seenKeys.add(uKey);

    const duelElo = (typeof u.duelElo === 'number' && !Number.isNaN(u.duelElo)) ? u.duelElo : 1000;
    const duelWins = Number(u.duelWins) || 0;
    const duelLosses = Number(u.duelLosses) || 0;
    const duelDraws = Number(u.duelDraws) || 0;
    const duelMatches = Number(u.duelMatches) || (duelWins + duelLosses + duelDraws);
    const bestSingle = Math.max(
      Number(u.records?.easy) || 0,
      Number(u.records?.medium) || 0,
      Number(u.records?.hard) || 0
    );

    list.push({
      username: u.username,
      duelElo,
      duelWins,
      duelLosses,
      duelDraws,
      duelMatches,
      bestSingle,
      selectedSkin: u.selectedSkin || 'classic',
      avatarSkinId: u.avatarSkinId || u.selectedSkin || 'classic'
    });
  }

  list.sort((a, b) => {
    if (b.duelElo !== a.duelElo) return b.duelElo - a.duelElo;
    if (b.duelWins !== a.duelWins) return b.duelWins - a.duelWins;
    if (b.bestSingle !== a.bestSingle) return b.bestSingle - a.bestSingle;
    return a.username.localeCompare(b.username);
  });

  return list.map((item, idx) => ({
    rank: idx + 1,
    username: item.username,
    duelElo: item.duelElo,
    duelWins: item.duelWins,
    duelLosses: item.duelLosses,
    duelDraws: item.duelDraws,
    duelMatches: item.duelMatches,
    selectedSkin: item.selectedSkin,
    avatarSkinId: item.avatarSkinId
  }));
}

/**
 * Allows MeDonut Admin to directly set or change any player's Ranked Duel Elo.
 */
function adminUpdatePlayerDuelElo(username, newElo) {
  const cleanName = typeof username === 'string' ? username.trim() : '';
  const uKey = cleanName.toLowerCase();
  const user = db.users && db.users[uKey];
  if (!user) {
    throw new Error(`Player "${cleanName}" not found in database.`);
  }
  const cleanVal = Math.max(0, Math.floor(Number(newElo) || 0));
  const oldVal = typeof user.duelElo === 'number' ? user.duelElo : 1000;
  user.duelElo = cleanVal;

  logDatabaseEvent(
    'ADMIN_ELO_CHANGE',
    user.username,
    `👑 MeDonut updated ${user.username}'s Ranked Duel Elo: ${oldVal} -> ${cleanVal} ELO`,
    { oldElo: oldVal, newElo: cleanVal }
  );
  saveDatabase();
  return {
    username: user.username,
    oldElo: oldVal,
    newElo: cleanVal
  };
}

function normalizeClientIp(rawIp) {
  if (!rawIp || typeof rawIp !== 'string') return '';
  let ip = rawIp.split(',')[0].trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  return ip.slice(0, 64);
}

function appendUniqueLimited(arr, val, maxLen = 15) {
  if (!val) return { list: Array.isArray(arr) ? arr : [], changed: false };
  const clean = String(val).trim().slice(0, 128);
  if (!clean) return { list: Array.isArray(arr) ? arr : [], changed: false };
  const existing = Array.isArray(arr) ? arr.slice() : [];
  if (existing[0] === clean) return { list: existing, changed: false };
  const idx = existing.indexOf(clean);
  if (idx !== -1) {
    existing.splice(idx, 1);
  }
  existing.unshift(clean);
  if (existing.length > maxLen) existing.length = maxLen;
  return { list: existing, changed: idx === -1 };
}

/**
 * Records client network/device signals (IP, persistent Browser Device ID, Hardware Fingerprint,
 * and Browser Known Accounts) onto a user account so alt accounts can be detected reliably
 * beyond IP alone and across older accounts when returning.
 */
function trackUserClientSignals(user, clientInfo = {}, persistIfNew = true) {
  if (!user || typeof user !== 'object') return false;
  let dirty = false;

  const ip = normalizeClientIp(clientInfo.ip || '');
  const deviceId = typeof clientInfo.deviceId === 'string' ? clientInfo.deviceId.trim().slice(0, 80) : '';
  const cookieId = typeof clientInfo.cookieId === 'string' ? clientInfo.cookieId.trim().slice(0, 80) : '';
  const cookieAccepted = Boolean(clientInfo.cookieAccepted);
  const fingerprint = typeof clientInfo.fingerprint === 'string' ? clientInfo.fingerprint.trim().slice(0, 80) : '';
  const knownAccounts = Array.isArray(clientInfo.knownAccounts) ? clientInfo.knownAccounts : [];

  if (cookieAccepted && !user.cookieAccepted) {
    user.cookieAccepted = true;
    dirty = true;
  }

  if (cookieId && cookieId.length >= 6) {
    const res = appendUniqueLimited(user.cookieIds, cookieId, 15);
    user.cookieIds = res.list;
    if (user.lastCookieId !== cookieId) {
      user.lastCookieId = cookieId;
      dirty = true;
    }
    if (res.changed) dirty = true;
  }

  if (ip && ip !== 'unknown') {
    const res = appendUniqueLimited(user.ips, ip, 15);
    user.ips = res.list;
    if (user.lastIp !== ip) {
      user.lastIp = ip;
      dirty = true;
    }
    if (res.changed) dirty = true;
  }

  if (deviceId && deviceId.length >= 6) {
    const res = appendUniqueLimited(user.deviceIds, deviceId, 15);
    user.deviceIds = res.list;
    if (user.lastDeviceId !== deviceId) {
      user.lastDeviceId = deviceId;
      dirty = true;
    }
    if (res.changed) dirty = true;
  }

  if (fingerprint && fingerprint.length >= 6) {
    const res = appendUniqueLimited(user.fingerprints, fingerprint, 15);
    user.fingerprints = res.list;
    if (user.lastFingerprint !== fingerprint) {
      user.lastFingerprint = fingerprint;
      dirty = true;
    }
    if (res.changed) dirty = true;
  }

  const selfKey = String(user.username || '').toLowerCase();
  for (const rawName of knownAccounts) {
    const k = String(rawName || '').trim().toLowerCase();
    if (!k || k === selfKey || !db.users || !db.users[k]) continue;
    const res = appendUniqueLimited(user.linkedAccounts, k, 20);
    user.linkedAccounts = res.list;
    if (res.changed) dirty = true;

    const otherUser = db.users[k];
    if (selfKey && otherUser && typeof otherUser === 'object') {
      const otherRes = appendUniqueLimited(otherUser.linkedAccounts, selfKey, 20);
      otherUser.linkedAccounts = otherRes.list;
      if (otherRes.changed) dirty = true;
    }
  }

  if (dirty) {
    user.lastSignalAt = Date.now();
    if (persistIfNew) {
      saveDatabase(false);
    }
  }
  return dirty;
}

const MIN_ALT_CONFIDENCE = 80;

/**
 * Builds clean server-side alt detection context using ONLY accepted browser cookies,
 * persistent browser device IDs, and same-browser account history chains.
 * Strictly excludes login/logout timing guesses, usernames, Wi-Fi/IPs, and PC hardware specs.
 */
function buildAltForensicContext(allUsersObj = null) {
  const usersMap = allUsersObj || (db && db.users) || {};

  // Build transitive browser/cookie/device cluster graph (A <-> B <-> C across linkedAccounts + cookieIds + deviceIds)
  const adj = new Map();
  const devOwners = new Map();
  const cookieOwners = new Map();
  const linkNodes = (k1, k2) => {
    if (!k1 || !k2 || k1 === k2) return;
    if (!adj.has(k1)) adj.set(k1, new Set());
    if (!adj.has(k2)) adj.set(k2, new Set());
    adj.get(k1).add(k2);
    adj.get(k2).add(k1);
  };
  for (const [k, u] of Object.entries(usersMap)) {
    if (!u || !u.username) continue;
    const uk = String(u.username || k).toLowerCase();
    if (Array.isArray(u.linkedAccounts)) {
      for (const lk of u.linkedAccounts) {
        const lkl = String(lk || '').toLowerCase();
        if (lkl && usersMap[lkl]) linkNodes(uk, lkl);
      }
    }
    const devs = Array.isArray(u.deviceIds) ? u.deviceIds : (u.lastDeviceId ? [u.lastDeviceId] : []);
    for (const d of devs) {
      if (!d) continue;
      if (!devOwners.has(d)) devOwners.set(d, []);
      devOwners.get(d).push(uk);
    }
    const cookies = Array.isArray(u.cookieIds) ? u.cookieIds : (u.lastCookieId ? [u.lastCookieId] : []);
    for (const c of cookies) {
      if (!c) continue;
      if (!cookieOwners.has(c)) cookieOwners.set(c, []);
      cookieOwners.get(c).push(uk);
    }
  }
  for (const owners of devOwners.values()) {
    for (let i = 1; i < owners.length; i++) {
      linkNodes(owners[0], owners[i]);
    }
  }
  for (const owners of cookieOwners.values()) {
    for (let i = 1; i < owners.length; i++) {
      linkNodes(owners[0], owners[i]);
    }
  }

  const browserClusterId = new Map();
  let nextClusterId = 1;
  for (const uk of adj.keys()) {
    if (browserClusterId.has(uk)) continue;
    const cid = nextClusterId++;
    const stack = [uk];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (browserClusterId.has(cur)) continue;
      browserClusterId.set(cur, cid);
      const neighbors = adj.get(cur);
      if (neighbors) {
        for (const nb of neighbors) {
          if (!browserClusterId.has(nb)) stack.push(nb);
        }
      }
    }
  }

  const getClusterHopDistance = (kA, kB) => {
    const cA = browserClusterId.get(kA);
    const cB = browserClusterId.get(kB);
    if (!cA || !cB || cA !== cB) return Infinity;
    const visited = new Set([kA]);
    const queue = [[kA, 0]];
    while (queue.length > 0) {
      const [cur, dist] = queue.shift();
      if (cur === kB) return dist;
      const nbs = adj.get(cur);
      if (!nbs) continue;
      for (const nb of nbs) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push([nb, dist + 1]);
        }
      }
    }
    return Infinity;
  };

  return {
    browserClusterId,
    getClusterHopDistance
  };
}

function computeAltAccountMatches(targetUser, allUsersObj, forensicCtx = null) {
  if (!targetUser || !allUsersObj || typeof allUsersObj !== 'object') {
    return { matches: [], sameNetworkUsers: [] };
  }
  const ctx = forensicCtx || buildAltForensicContext(allUsersObj);
  const targetKey = String(targetUser.username || '').toLowerCase();
  const tCookies = new Set(Array.isArray(targetUser.cookieIds) ? targetUser.cookieIds : (targetUser.lastCookieId ? [targetUser.lastCookieId] : []));
  const tDevices = new Set(Array.isArray(targetUser.deviceIds) ? targetUser.deviceIds : (targetUser.lastDeviceId ? [targetUser.lastDeviceId] : []));
  const tLinked = new Set(Array.isArray(targetUser.linkedAccounts) ? targetUser.linkedAccounts : []);
  const tCluster = ctx.browserClusterId ? ctx.browserClusterId.get(targetKey) : null;

  const matches = [];

  for (const [uKey, other] of Object.entries(allUsersObj)) {
    if (!other || !other.username) continue;
    const oKey = String(other.username || uKey).toLowerCase();
    if (oKey === targetKey) continue;

    const oCookies = Array.isArray(other.cookieIds) ? other.cookieIds : (other.lastCookieId ? [other.lastCookieId] : []);
    const oDevices = Array.isArray(other.deviceIds) ? other.deviceIds : (other.lastDeviceId ? [other.lastDeviceId] : []);
    const oLinked = Array.isArray(other.linkedAccounts) ? other.linkedAccounts : [];

    const sharedCookieIds = oCookies.filter(c => tCookies.has(c));
    const sharedDeviceIds = oDevices.filter(d => tDevices.has(d));
    const sameBrowserSwitch = tLinked.has(oKey) || oLinked.includes(targetKey);
    const oCluster = ctx.browserClusterId ? ctx.browserClusterId.get(oKey) : null;
    const transitiveBrowserLink = Boolean(tCluster && oCluster && tCluster === oCluster) && !sameBrowserSwitch && sharedCookieIds.length === 0 && sharedDeviceIds.length === 0;

    // Strictly exclude timing/switch guesses, usernames, Wi-Fi/IPs, and PC hardware specs!
    let score = 0;
    const forensicReasons = [];
    const labelParts = [];

    if (sharedCookieIds.length > 0 || sameBrowserSwitch || sharedDeviceIds.length > 0) {
      score = 100;
      if (sharedCookieIds.length > 0) {
        forensicReasons.push('Confirmed Same Accepted Browser Cookie ID (100%)');
        labelParts.push('Accepted Cookie ID');
      }
      if (sameBrowserSwitch) {
        forensicReasons.push('Confirmed Same-Browser Account History (both accounts used in same browser)');
        labelParts.push('Same-Browser Account History');
      }
      if (sharedDeviceIds.length > 0) {
        forensicReasons.push('Confirmed Same Persistent Browser Device ID');
        labelParts.push('Device ID');
      }
    } else if (transitiveBrowserLink) {
      const hops = ctx.getClusterHopDistance ? ctx.getClusterHopDistance(targetKey, oKey) : 2;
      score = hops <= 2 ? 95 : 91;
      forensicReasons.push(`Confirmed via Linked Cookie / Browser Device Chain (${hops}-hop)`);
      labelParts.push('Linked Cookie/Device Chain');
    }

    if (score < MIN_ALT_CONFIDENCE) continue;

    const confidenceTier = score === 100 ? 'certain' : 'high';
    const oCreated = Number(other.createdAt) || 0;
    const oLoginCount = Number(other.loginCount) || 0;

    matches.push({
      username: other.username,
      usernameKey: oKey,
      confidenceScore: score,
      confidenceTier,
      confidenceLabel: score === 100
        ? `Confirmed 100% (${labelParts.join(' + ')})`
        : `High Confidence (${labelParts.join(' + ')})`,
      differentPcConfirmed: false,
      sameBrowserSwitch,
      transitiveBrowserLink,
      forensicReasons,
      sharedCookieIds,
      sharedDeviceIds,
      sharedFingerprints: [],
      sharedIps: [],
      cookieAccepted: Boolean(other.cookieAccepted),
      lastCookieId: other.lastCookieId || oCookies[0] || '',
      cookieIds: oCookies,
      lastDeviceId: other.lastDeviceId || oDevices[0] || '',
      deviceIds: oDevices,
      createdAt: oCreated,
      lastLoginAt: Number(other.lastLoginAt) || 0,
      lastLoginReadable: other.lastLoginReadable || formatReadableTimestamp(other.lastLoginAt) || 'Unknown',
      loginCount: oLoginCount,
      duelElo: typeof other.duelElo === 'number' ? other.duelElo : 1000,
      records: other.records || { easy: 0, medium: 0, hard: 0 },
      duelCoins: Math.round(Number(other.duelCoins) || 0),
      banned: Boolean(other.banned),
      overAccountLimit: Boolean(other.overAccountLimit),
      isPrimaryBestAccount: Boolean(other.isPrimaryBestAccount),
      clusterRank: Number(other.clusterRank) || 1,
      effectiveMaxAccounts: Number(other.effectiveMaxAccounts) || 5,
      priorityScore: scoreUserAccountPriority(other)
    });
  }

  matches.sort((a, b) => (b.confidenceScore - a.confidenceScore) || ((b.priorityScore || 0) - (a.priorityScore || 0)) || ((b.lastLoginAt || 0) - (a.lastLoginAt || 0)));
  return { matches, sameNetworkUsers: [] };
}

/**
 * Enriches `db.playerRecordsOverview` entries with browser/cookie & 80%+ alt counts
 * and enforces per-player / global account limit rules cleanly without auto-deleting accounts.
 */
function enrichOverviewWithClientSignals() {
  if (!db || !db.playerRecordsOverview || !db.users) return;
  const forensicCtx = buildAltForensicContext(db.users);
  enforceAllClusterAccountLimits(forensicCtx);
  for (const [ovName, ovData] of Object.entries(db.playerRecordsOverview)) {
    if (!ovData || typeof ovData !== 'object') continue;
    const uKey = String(ovData.username || ovName).toLowerCase();
    const user = db.users[uKey];
    if (!user) continue;

    const ips = Array.isArray(user.ips) ? user.ips : (user.lastIp ? [user.lastIp] : []);
    const cookies = Array.isArray(user.cookieIds) ? user.cookieIds : (user.lastCookieId ? [user.lastCookieId] : []);
    const deviceIds = Array.isArray(user.deviceIds) ? user.deviceIds : (user.lastDeviceId ? [user.lastDeviceId] : []);
    const fingerprints = Array.isArray(user.fingerprints) ? user.fingerprints : (user.lastFingerprint ? [user.lastFingerprint] : []);
    const { matches } = computeAltAccountMatches(user, db.users, forensicCtx);

    ovData.cookieAccepted = Boolean(user.cookieAccepted);
    ovData.lastCookieId = user.lastCookieId || cookies[0] || '';
    ovData.cookieIds = cookies;
    ovData.lastIp = user.lastIp || ips[0] || '';
    ovData.ips = ips;
    ovData.lastDeviceId = user.lastDeviceId || deviceIds[0] || '';
    ovData.deviceIds = deviceIds;
    ovData.lastFingerprint = user.lastFingerprint || fingerprints[0] || '';
    ovData.fingerprints = fingerprints;
    ovData.linkedAccounts = Array.isArray(user.linkedAccounts) ? user.linkedAccounts : [];
    ovData.altAccountCount = matches.length;
    ovData.highConfidenceAltCount = matches.filter(m => m.confidenceScore >= MIN_ALT_CONFIDENCE).length;
    ovData.sameNetworkCount = 0;
    ovData.maxAccounts = (typeof user.maxAccounts === 'number' && user.maxAccounts >= 1) ? Math.floor(user.maxAccounts) : null;
    ovData.effectiveMaxAccounts = Number(user.effectiveMaxAccounts) || Math.max(1, Math.min(50, Math.floor(Number(db.adminSettings && db.adminSettings.defaultMaxAccounts) || 5)));
    ovData.overAccountLimit = Boolean(user.overAccountLimit);
    ovData.isPrimaryBestAccount = user.isPrimaryBestAccount !== undefined ? Boolean(user.isPrimaryBestAccount) : true;
    ovData.primaryBestUsername = user.primaryBestUsername || user.username;
    ovData.clusterRank = Number(user.clusterRank) || 1;
    ovData.clusterAccountCount = Number(user.clusterAccountCount) || 1;
  }
}

/**
 * Finds all 80%+ confidence alt accounts for a target player using Accepted Cookies,
 * Browser Device IDs, and Same-Browser Account History chains.
 * Excludes login/logout timing guesses, usernames, Wi-Fi/IPs, and shared laptop hardware specs.
 */
function findAltAccountsForUser(username) {
  const cleanName = typeof username === 'string' ? username.trim() : '';
  const uKey = cleanName.toLowerCase();
  const user = db.users && db.users[uKey];
  if (!user) {
    throw new Error(`Player "${cleanName}" not found in database.`);
  }
  const forensicCtx = buildAltForensicContext(db.users);
  const { matches } = computeAltAccountMatches(user, db.users, forensicCtx);
  return {
    target: {
      username: user.username,
      usernameKey: uKey,
      cookieAccepted: Boolean(user.cookieAccepted),
      lastCookieId: user.lastCookieId || '',
      cookieIds: Array.isArray(user.cookieIds) ? user.cookieIds : (user.lastCookieId ? [user.lastCookieId] : []),
      deviceIds: Array.isArray(user.deviceIds) ? user.deviceIds : (user.lastDeviceId ? [user.lastDeviceId] : []),
      lastDeviceId: user.lastDeviceId || '',
      linkedAccounts: Array.isArray(user.linkedAccounts) ? user.linkedAccounts : [],
      createdAt: Number(user.createdAt) || 0,
      lastLoginAt: Number(user.lastLoginAt) || 0,
      lastLoginReadable: user.lastLoginReadable || formatReadableTimestamp(user.lastLoginAt) || 'Unknown',
      records: user.records || { easy: 0, medium: 0, hard: 0 },
      duelElo: typeof user.duelElo === 'number' ? user.duelElo : 1000,
      banned: Boolean(user.banned),
      maxAccounts: (typeof user.maxAccounts === 'number' && user.maxAccounts >= 1) ? Math.floor(user.maxAccounts) : null,
      effectiveMaxAccounts: Number(user.effectiveMaxAccounts) || 5,
      overAccountLimit: Boolean(user.overAccountLimit),
      isPrimaryBestAccount: user.isPrimaryBestAccount !== undefined ? Boolean(user.isPrimaryBestAccount) : true,
      primaryBestUsername: user.primaryBestUsername || user.username,
      clusterRank: Number(user.clusterRank) || 1,
      clusterAccountCount: Number(user.clusterAccountCount) || (1 + matches.length),
      priorityScore: scoreUserAccountPriority(user),
      sameNetworkUsers: []
    },
    matches,
    sameNetworkUsers: []
  };
}

/**
 * Permanently deletes a player account and purges their sessions, leaderboard runs, and duel high scores.
 * Uses debounced single-file save (fast bulk deletion without redundant full backups per click).
 */
function deletePlayerAccountAdmin(username) {
  const cleanName = typeof username === 'string' ? username.trim() : '';
  const uKey = cleanName.toLowerCase();
  if (!uKey || !db.users || !db.users[uKey]) {
    throw new Error(`Player "${cleanName}" not found in database.`);
  }
  if (uKey === 'medonut') {
    throw new Error('Cannot delete the primary MeDonut admin account.');
  }

  const deletedUser = db.users[uKey];
  const displayName = deletedUser.username || cleanName;
  delete db.users[uKey];

  for (const other of Object.values(db.users)) {
    if (other && Array.isArray(other.linkedAccounts)) {
      const idx = other.linkedAccounts.indexOf(uKey);
      if (idx !== -1) other.linkedAccounts.splice(idx, 1);
    }
  }

  let removedSessions = 0;
  if (db.sessions && typeof db.sessions === 'object') {
    for (const [tok, sess] of Object.entries(db.sessions)) {
      if (sess && ((sess.usernameKey && sess.usernameKey.toLowerCase() === uKey) || (sess.username && sess.username.toLowerCase() === uKey))) {
        delete db.sessions[tok];
        removedSessions++;
      }
    }
  }

  let removedRuns = 0;
  if (db.runs && typeof db.runs === 'object') {
    ['easy', 'medium', 'hard'].forEach(diff => {
      if (!Array.isArray(db.runs[diff])) return;
      const before = db.runs[diff].length;
      db.runs[diff] = db.runs[diff].filter(r => !r || !r.username || r.username.toLowerCase() !== uKey);
      removedRuns += (before - db.runs[diff].length);
    });
  }

  if (Array.isArray(db.duelMatchHighScores)) {
    db.duelMatchHighScores = db.duelMatchHighScores.filter(
      e => !e || !e.username || e.username.toLowerCase() !== uKey
    );
  }
  if (Array.isArray(db.duelMatchHistory)) {
    db.duelMatchHistory = db.duelMatchHistory.filter(
      m => !m || (
        (!m.playerA || !m.playerA.username || m.playerA.username.toLowerCase() !== uKey) &&
        (!m.playerB || !m.playerB.username || m.playerB.username.toLowerCase() !== uKey)
      )
    );
  }

  if (db.playerRecordsOverview && typeof db.playerRecordsOverview === 'object') {
    for (const ovKey of Object.keys(db.playerRecordsOverview)) {
      if (ovKey.toLowerCase() === uKey) {
        delete db.playerRecordsOverview[ovKey];
      }
    }
  }

  logDatabaseEvent(
    'ACCOUNT_DELETED',
    displayName,
    `🗑️ MeDonut permanently deleted account "${displayName}" (${removedRuns} runs & ${removedSessions} sessions removed)`,
    { deletedUsername: displayName, lastIp: deletedUser.lastIp || '', removedRuns, removedSessions }
  );

  saveDatabase(false);
  return {
    deletedUsername: displayName,
    removedRuns,
    removedSessions
  };
}

function pickWeightedCaseItem(pool) {
  let totalWeight = 0;
  for (const item of pool) {
    totalWeight += Math.max(1, Math.round(Number(item.weight) || 0));
  }
  if (totalWeight <= 0) return pool[0];
  let roll = crypto.randomInt(0, totalWeight);
  for (const item of pool) {
    const w = Math.max(1, Math.round(Number(item.weight) || 0));
    if (roll < w) return item;
    roll -= w;
  }
  return pool[pool.length - 1];
}

/**
 * Authoritative server-side RNG case opening for the 250 / 500 / 1000 Duel Coins cases.
 */
function openBackgroundCaseForUser(username, caseId) {
  const cleanName = typeof username === 'string' ? username.trim() : '';
  const uKey = cleanName.toLowerCase();
  const user = db.users && db.users[uKey];
  if (!user) throw new Error('Player account not found.');
  if (user.banned) throw new Error('Banned accounts cannot open cases.');

  const caseObj = (BACKGROUND_CASES || []).find(c => c.id === caseId);
  if (!caseObj) throw new Error('Invalid case selected.');

  const price = Math.max(1, Math.round(Number(caseObj.price) || 0));
  const currentCoins = Math.max(0, Math.round(Number(user.duelCoins) || 0));
  if (currentCoins < price) {
    throw new Error(`Not enough Duel Coins! Need ${price} 🪙 (you have ${currentCoins} 🪙). Play Ranked Duels to earn coins!`);
  }

  const allCaseItems = (BACKGROUND_SKINS || []).filter(b => b.caseId === caseId && (Number(b.weight) || 0) > 0);
  if (allCaseItems.length === 0) throw new Error('No background skins configured in this case.');

  const lockedList = Array.isArray(user.adminLockedSkins) ? user.adminLockedSkins : [];
  const eligiblePool = allCaseItems.filter(b => !lockedList.includes(b.id));
  const pool = eligiblePool.length > 0 ? eligiblePool : allCaseItems;

  const wonItem = pickWeightedCaseItem(pool);
  user.duelCoins = currentCoins - price;

  if (!Array.isArray(user.unlockedBackgrounds)) user.unlockedBackgrounds = [];
  if (!Array.isArray(user.grantedSkins)) user.grantedSkins = [];

  const alreadyOwned = user.unlockedBackgrounds.includes(wonItem.id) || user.grantedSkins.includes(wonItem.id);
  let refundCoins = 0;
  if (alreadyOwned) {
    refundCoins = Math.round(price * 0.5);
    user.duelCoins += refundCoins;
  } else if (!lockedList.includes(wonItem.id)) {
    user.unlockedBackgrounds.push(wonItem.id);
  }
  user.cosmeticsVersion = (Number(user.cosmeticsVersion) || 0) + 1;

  // Build 45-slot CS:GO-style weighted roulette strip with wonItem pinned cleanly at index 38
  const WIN_INDEX = 38;
  const TOTAL_SLOTS = 45;
  const spinReel = [];
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    const pick = (i === WIN_INDEX) ? wonItem : pickWeightedCaseItem(allCaseItems);
    spinReel.push({
      id: pick.id,
      name: pick.name,
      emoji: pick.emoji,
      rarity: pick.rarity,
      dropPct: pick.dropPct,
      colors: pick.colors,
      pattern: pick.pattern,
      specialType: pick.specialType || null
    });
  }

  const extraMsg = alreadyOwned
    ? ` (duplicate -> +${refundCoins} 🪙 refund)`
    : (wonItem.dropPct <= 1 ? ` 🎉 RARE ${wonItem.dropPct}% DROP!` : '');
  logDatabaseEvent(
    'CASE_OPENED',
    user.username,
    `📦 ${user.username} opened "${caseObj.name}" (${price} 🪙) and unboxed ${wonItem.emoji} ${wonItem.name} (${wonItem.dropPct}%)${extraMsg}`,
    { caseId, price, wonId: wonItem.id, isDuplicate: alreadyOwned, refundCoins, newBalance: user.duelCoins }
  );
  saveDatabase(false);

  return {
    ok: true,
    caseId: caseObj.id,
    caseName: caseObj.name,
    price,
    wonItem: {
      id: wonItem.id,
      name: wonItem.name,
      emoji: wonItem.emoji,
      rarity: wonItem.rarity,
      dropPct: wonItem.dropPct,
      desc: wonItem.desc,
      colors: wonItem.colors,
      pattern: wonItem.pattern,
      specialType: wonItem.specialType || null
    },
    isDuplicate: alreadyOwned,
    refundCoins,
    newBalance: Math.round(Number(user.duelCoins) || 0),
    unlockedBackgrounds: user.unlockedBackgrounds,
    spinReel,
    winIndex: WIN_INDEX
  };
}

/**
 * Validates and persists a user's Custom Picture (`bg_custom_image`) or automatically
 * sliced 15-frame Custom Video (`bg_custom_video`). Forces strict <= 15 frames server-side.
 */
function saveUserCustomBackgroundMedia(username, payload = {}) {
  const cleanName = typeof username === 'string' ? username.trim() : '';
  const uKey = cleanName.toLowerCase();
  const user = db.users && db.users[uKey];
  if (!user) throw new Error('Player account not found.');
  if (user.banned) throw new Error('Banned accounts cannot upload custom backgrounds.');

  const mediaType = payload.mediaType === 'video' ? 'video' : 'image';
  const now = Date.now();
  const validImageUrl = (s) => (
    typeof s === 'string' &&
    s.length >= 32 &&
    s.length <= 750000 &&
    /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(s)
  );

  if (mediaType === 'image') {
    if (!isSkinUnlockedForUser('bg_custom_image', user)) {
      throw new Error('You must unlock "Custom Picture Background" (1% drop in the 1000 🪙 Case) first!');
    }
    const img = payload.imageDataUrl;
    if (!validImageUrl(img)) {
      throw new Error('Invalid or oversized image file (must be compressed PNG/JPG/WebP under 550 KB).');
    }
    user.customBackgroundImage = img;
    user.customBgUpdatedAt = now;
    user.cosmeticsVersion = (Number(user.cosmeticsVersion) || 0) + 1;
    if (payload.autoEquip !== false) {
      user.selectedBackground = 'bg_custom_image';
    }
    logDatabaseEvent('CUSTOM_BG_UPLOAD', user.username, `🖼️ ${user.username} uploaded a Custom Picture Background!`);
    saveDatabase(false);
    return {
      ok: true,
      mediaType: 'image',
      selectedBackground: user.selectedBackground,
      customBackgroundImage: user.customBackgroundImage,
      customBgUpdatedAt: user.customBgUpdatedAt
    };
  }

  // Video -> strictly 1..15 pre-extracted frames so gameplay never lags
  if (!isSkinUnlockedForUser('bg_custom_video', user)) {
    throw new Error('You must unlock "Custom Video (15-Frame Loop)" (0.1% drop in the 1000 🪙 Case) first!');
  }
  if (!Array.isArray(payload.frames) || payload.frames.length === 0) {
    throw new Error('Video frame extraction produced no frames. Please pick another video file.');
  }
  const cappedFrames = payload.frames.slice(0, 15).filter(f => validImageUrl(f));
  if (cappedFrames.length === 0) {
    throw new Error('Invalid video frame data received.');
  }
  const totalChars = cappedFrames.reduce((sum, f) => sum + f.length, 0);
  if (totalChars > 2800000) {
    throw new Error('Extracted 15-frame video exceeds maximum compressed size. Please try a shorter/smaller clip.');
  }

  user.customBackgroundVideo = {
    frames: cappedFrames,
    frameCount: cappedFrames.length,
    fps: 7.5,
    updatedAt: now
  };
  user.customBgUpdatedAt = now;
  user.cosmeticsVersion = (Number(user.cosmeticsVersion) || 0) + 1;
  if (payload.autoEquip !== false) {
    user.selectedBackground = 'bg_custom_video';
  }
  logDatabaseEvent(
    'CUSTOM_BG_UPLOAD',
    user.username,
    `🎬 ${user.username} uploaded a Custom Video Background (auto-cut to ${cappedFrames.length} lag-free frames)!`
  );
  saveDatabase(false);
  return {
    ok: true,
    mediaType: 'video',
    frameCount: cappedFrames.length,
    selectedBackground: user.selectedBackground,
    customBackgroundVideo: user.customBackgroundVideo,
    customBgUpdatedAt: user.customBgUpdatedAt
  };
}

function ensureBanRegistry() {
  if (!db.banRegistry || typeof db.banRegistry !== 'object') {
    db.banRegistry = { groups: {} };
  }
  if (!db.banRegistry.groups || typeof db.banRegistry.groups !== 'object') {
    db.banRegistry.groups = {};
  }
  return db.banRegistry;
}

/**
 * Checks if a request/client/account belongs to an active Ban Group
 * (via HttpOnly ban token, accepted cookieId, persistent browser deviceId, or browser account history).
 * Strictly exempts MeDonut Admin and ignores shared WiFi/IP or shared laptop hardware specs.
 */
function checkBanForSignals(clientInfo = {}, extraUsernameKey = null, reqBanToken = '') {
  const cleanExtraKey = (typeof extraUsernameKey === 'string' && extraUsernameKey.trim())
    ? extraUsernameKey.trim().toLowerCase()
    : '';
  if (cleanExtraKey === 'medonut') {
    return { banned: false };
  }

  const registry = ensureBanRegistry();
  const cookieId = typeof clientInfo.cookieId === 'string' ? clientInfo.cookieId.trim() : '';
  const deviceId = typeof clientInfo.deviceId === 'string' ? clientInfo.deviceId.trim() : '';
  const banToken = typeof reqBanToken === 'string' ? reqBanToken.trim() : '';
  const known = Array.isArray(clientInfo.knownAccounts)
    ? clientInfo.knownAccounts.map(n => String(n || '').trim().toLowerCase()).filter(k => k && k !== 'medonut')
    : [];

  // Direct account ban flag check
  if (cleanExtraKey && db.users && db.users[cleanExtraKey] && db.users[cleanExtraKey].banned) {
    const u = db.users[cleanExtraKey];
    const bInfo = u.banInfo || {};
    const grp = (bInfo.banId && registry.groups[bInfo.banId]) || null;
    if (!grp || grp.active !== false) {
      return {
        banned: true,
        matchedBy: 'account',
        banId: bInfo.banId || (grp && grp.id) || 'banned',
        banToken: (grp && Array.isArray(grp.banTokens) && grp.banTokens[0]) || '',
        reason: bInfo.reason || (grp && grp.reason) || 'Banned by Administrator.',
        bannedAt: bInfo.bannedAt || (grp && grp.bannedAt) || Date.now(),
        readableAt: bInfo.readableAt || (grp && grp.readableAt) || '',
        rootUsername: bInfo.rootUsername || u.username
      };
    }
  }

  for (const grp of Object.values(registry.groups)) {
    if (!grp || grp.active === false) continue;
    const gUsers = Array.isArray(grp.usernames) ? grp.usernames : [];
    const gCookies = Array.isArray(grp.cookieIds) ? grp.cookieIds : [];
    const gDevices = Array.isArray(grp.deviceIds) ? grp.deviceIds : [];
    const gTokens = Array.isArray(grp.banTokens) ? grp.banTokens : [];

    let matchedBy = '';
    if (banToken && gTokens.includes(banToken)) matchedBy = 'ban_token';
    else if (cookieId && gCookies.includes(cookieId)) matchedBy = 'cookie_id';
    else if (deviceId && gDevices.includes(deviceId)) matchedBy = 'device_id';
    else if (cleanExtraKey && gUsers.includes(cleanExtraKey)) matchedBy = 'account';
    else if (known.some(k => gUsers.includes(k))) matchedBy = 'known_account_history';

    if (matchedBy) {
      let dirty = false;
      if (cookieId && !gCookies.includes(cookieId)) {
        grp.cookieIds.unshift(cookieId);
        if (grp.cookieIds.length > 50) grp.cookieIds.length = 50;
        dirty = true;
      }
      if (deviceId && !gDevices.includes(deviceId)) {
        grp.deviceIds.unshift(deviceId);
        if (grp.deviceIds.length > 50) grp.deviceIds.length = 50;
        dirty = true;
      }
      if (dirty) saveDatabase(false);
      return {
        banned: true,
        matchedBy,
        banId: grp.id,
        banToken: gTokens[0] || '',
        reason: grp.reason || 'Banned by Administrator.',
        bannedAt: grp.bannedAt || Date.now(),
        readableAt: grp.readableAt || formatReadableTimestamp(grp.bannedAt || Date.now()),
        rootUsername: grp.rootUsername || gUsers[0] || ''
      };
    }
  }

  return { banned: false };
}

/**
 * Bans a player AND all their confirmed 80%+ alt accounts, plus records persistent browser/cookie/device identifiers
 * to block evasion and prevent creating new accounts. Never affects MeDonut or unrelated schoolmates on same WiFi/PC specs.
 */
function banPlayerAndAltsAdmin(username, options = {}) {
  const cleanName = typeof username === 'string' ? username.trim() : '';
  const rootKey = cleanName.toLowerCase();
  if (!rootKey || !db.users || !db.users[rootKey]) {
    throw new Error(`Player "${cleanName}" not found in database.`);
  }
  if (rootKey === 'medonut') {
    throw new Error('Cannot ban the primary MeDonut admin account.');
  }

  const includeAlts = options.includeAlts !== false;
  const reason = (typeof options.reason === 'string' && options.reason.trim())
    ? options.reason.trim().slice(0, 160)
    : 'Breaking game rules (banned by MeDonut)';

  const targetUser = db.users[rootKey];
  const targetKeys = new Set([rootKey]);
  if (includeAlts) {
    try {
      const altRes = findAltAccountsForUser(targetUser.username);
      if (altRes && Array.isArray(altRes.matches)) {
        for (const m of altRes.matches) {
          const mKey = String(m.usernameKey || m.username || '').toLowerCase();
          if (mKey && mKey !== 'medonut' && db.users[mKey]) {
            targetKeys.add(mKey);
          }
        }
      }
    } catch (_) {}
  }

  const registry = ensureBanRegistry();
  const now = Date.now();
  const readableAt = formatReadableTimestamp(now);
  const banId = 'ban_' + crypto.randomBytes(6).toString('hex');
  const banToken = 'bantok_' + crypto.randomBytes(16).toString('hex');

  const cookieSet = new Set();
  const deviceSet = new Set();
  const bannedDisplayNames = [];

  for (const uk of targetKeys) {
    const u = db.users[uk];
    if (!u || uk === 'medonut') continue;
    u.banned = true;
    u.banInfo = {
      banId,
      reason,
      bannedAt: now,
      readableAt,
      bannedBy: 'MeDonut',
      rootUsername: targetUser.username
    };
    bannedDisplayNames.push(u.username);
    const cList = Array.isArray(u.cookieIds) ? u.cookieIds : (u.lastCookieId ? [u.lastCookieId] : []);
    for (const c of cList) if (c) cookieSet.add(String(c));
    const dList = Array.isArray(u.deviceIds) ? u.deviceIds : (u.lastDeviceId ? [u.lastDeviceId] : []);
    for (const d of dList) if (d) deviceSet.add(String(d));
  }

  registry.groups[banId] = {
    id: banId,
    active: true,
    rootUsername: targetUser.username,
    reason,
    bannedAt: now,
    readableAt,
    bannedBy: 'MeDonut',
    usernames: Array.from(targetKeys),
    cookieIds: Array.from(cookieSet).slice(0, 50),
    deviceIds: Array.from(deviceSet).slice(0, 50),
    banTokens: [banToken]
  };

  let kickedSessions = 0;
  if (db.sessions && typeof db.sessions === 'object') {
    for (const [tok, sess] of Object.entries(db.sessions)) {
      const sKey = sess && (sess.usernameKey || sess.username || '').toLowerCase();
      if (sKey && targetKeys.has(sKey)) {
        delete db.sessions[tok];
        kickedSessions++;
      }
    }
  }

  logDatabaseEvent(
    'PLAYER_BANNED',
    targetUser.username,
    `🔨 MeDonut banned ${bannedDisplayNames.join(', ')} (${bannedDisplayNames.length} account${bannedDisplayNames.length === 1 ? '' : 's'} — blocks new account creation) • Reason: ${reason}`,
    { banId, bannedUsernames: bannedDisplayNames, includeAlts, reason, kickedSessions }
  );
  saveDatabase(false);

  return {
    ok: true,
    banId,
    reason,
    bannedUsernames: bannedDisplayNames,
    kickedSessions
  };
}

/**
 * Unbans a player (and optionally all linked accounts in their ban group) so they and their browser can play again.
 */
function unbanPlayerAdmin(username, options = {}) {
  const cleanName = typeof username === 'string' ? username.trim() : '';
  const uKey = cleanName.toLowerCase();
  if (!uKey || !db.users || !db.users[uKey]) {
    throw new Error(`Player "${cleanName}" not found in database.`);
  }

  const includeAlts = options.includeAlts !== false;
  const registry = ensureBanRegistry();
  const matchedGroupIds = new Set();

  if (db.users[uKey].banInfo && db.users[uKey].banInfo.banId) {
    matchedGroupIds.add(db.users[uKey].banInfo.banId);
  }
  for (const [gid, grp] of Object.entries(registry.groups)) {
    if (!grp || grp.active === false) continue;
    if (Array.isArray(grp.usernames) && grp.usernames.includes(uKey)) {
      matchedGroupIds.add(gid);
    }
  }

  const unbanKeys = new Set([uKey]);
  if (includeAlts) {
    for (const gid of matchedGroupIds) {
      const grp = registry.groups[gid];
      if (grp && Array.isArray(grp.usernames)) {
        grp.usernames.forEach(k => unbanKeys.add(String(k).toLowerCase()));
      }
    }
    for (const [uk, u] of Object.entries(db.users)) {
      if (u && u.banInfo && u.banInfo.banId && matchedGroupIds.has(u.banInfo.banId)) {
        unbanKeys.add(uk);
      }
    }
  }

  const now = Date.now();
  const unbannedNames = [];
  for (const uk of unbanKeys) {
    const u = db.users[uk];
    if (!u) continue;
    if (u.banned || uk === uKey) {
      u.banned = false;
      delete u.banInfo;
      unbannedNames.push(u.username);
    }
  }

  for (const gid of matchedGroupIds) {
    const grp = registry.groups[gid];
    if (!grp) continue;
    if (includeAlts) {
      grp.active = false;
      grp.unbannedAt = now;
    } else {
      grp.usernames = (grp.usernames || []).filter(k => !unbanKeys.has(k));
      if (grp.usernames.length === 0) {
        grp.active = false;
        grp.unbannedAt = now;
      }
    }
  }

  logDatabaseEvent(
    'PLAYER_UNBANNED',
    db.users[uKey].username,
    `✅ MeDonut unbanned ${unbannedNames.join(', ')} (${unbannedNames.length} account${unbannedNames.length === 1 ? '' : 's'} restored)`,
    { unbannedUsernames: unbannedNames, includeAlts }
  );
  saveDatabase(false);

  return {
    ok: true,
    unbannedUsernames: unbannedNames
  };
}

/**
 * Ranks an account to select the best/most-played primary account in a cluster:
 * 1) Higher weighted highscores (Easy 1x + Med 2x + Hard 3x) & highest single best
 * 2) Higher Ranked Duel ELO
 * 3) Most total playtime/activity (duel matches, career runs, login count)
 */
function scoreUserAccountPriority(user) {
  if (!user) return 0;
  const rec = user.records || {};
  const e = Number(rec.easy) || 0;
  const m = Number(rec.medium) || 0;
  const h = Number(rec.hard) || 0;
  const weightedHigh = e + m * 2 + h * 3;
  const maxSingle = Math.max(e, m, h);
  const elo = typeof user.duelElo === 'number' && !Number.isNaN(user.duelElo) ? user.duelElo : 1000;
  const duelMatches = Number(user.duelMatches) || 0;
  const careerRuns = Number(user.careerStats && user.careerStats.totalRuns) || 0;
  const logins = Number(user.loginCount) || 0;
  const playScore = duelMatches * 4 + careerRuns + logins;

  return (weightedHigh * 1000000) + (maxSingle * 50000) + (elo * 100) + Math.min(99999, playScore);
}

function compareUserAccountsByPriority(a, b) {
  const aIsAdmin = String(a.username || '').toLowerCase() === 'medonut';
  const bIsAdmin = String(b.username || '').toLowerCase() === 'medonut';
  if (aIsAdmin !== bIsAdmin) return aIsAdmin ? -1 : 1;

  const aBan = Boolean(a.banned);
  const bBan = Boolean(b.banned);
  if (aBan !== bBan) return aBan ? 1 : -1;

  const sDiff = scoreUserAccountPriority(b) - scoreUserAccountPriority(a);
  if (sDiff !== 0) return sDiff;

  const logDiff = (Number(b.lastLoginAt) || 0) - (Number(a.lastLoginAt) || 0);
  if (logDiff !== 0) return logDiff;

  return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
}

function getDefaultMaxAccountsLimit() {
  const raw = Number(db && db.adminSettings && db.adminSettings.defaultMaxAccounts);
  return (Number.isFinite(raw) && raw >= 1) ? Math.min(50, Math.floor(raw)) : 5;
}

function resolveClusterEffectiveLimit(memberUsers) {
  let chosenLimit = null;
  let chosenUpdatedAt = -1;
  for (const u of memberUsers) {
    if (!u || typeof u.maxAccounts !== 'number' || !Number.isFinite(u.maxAccounts) || u.maxAccounts < 1) continue;
    const updAt = Number(u.maxAccountsUpdatedAt) || 0;
    if (updAt > chosenUpdatedAt || (updAt === chosenUpdatedAt && (chosenLimit === null || u.maxAccounts < chosenLimit))) {
      chosenLimit = Math.min(50, Math.floor(u.maxAccounts));
      chosenUpdatedAt = updAt;
    }
  }
  return chosenLimit !== null ? chosenLimit : getDefaultMaxAccountsLimit();
}

function enforceAllClusterAccountLimits(forensicCtx = null) {
  if (!db || !db.users || typeof db.users !== 'object') return;
  const ctx = forensicCtx || buildAltForensicContext(db.users);
  const clusters = new Map(); // clusterKey -> User[]

  for (const [uKey, u] of Object.entries(db.users)) {
    if (!u || !u.username) continue;
    const low = String(u.username || uKey).toLowerCase();
    const cid = ctx.browserClusterId ? ctx.browserClusterId.get(low) : null;
    const cKey = cid ? `cluster_${cid}` : `single_${low}`;
    if (!clusters.has(cKey)) clusters.set(cKey, []);
    clusters.get(cKey).push(u);
  }

  const nowSuspendedKeys = new Set();
  for (const members of clusters.values()) {
    const nonAdmin = members.filter(m => String(m.username).toLowerCase() !== 'medonut');
    const sortedAll = members.slice().sort(compareUserAccountsByPriority);
    const sortedNonAdmin = nonAdmin.slice().sort(compareUserAccountsByPriority);
    const effectiveLimit = resolveClusterEffectiveLimit(members);
    const primaryUser = sortedNonAdmin[0] || sortedAll[0] || null;
    const primaryName = primaryUser ? primaryUser.username : '';

    for (const u of members) {
      const low = String(u.username).toLowerCase();
      if (low === 'medonut') {
        u.overAccountLimit = false;
        u.isPrimaryBestAccount = true;
        u.primaryBestUsername = u.username;
        u.clusterRank = 1;
        u.clusterAccountCount = members.length;
        u.effectiveMaxAccounts = effectiveLimit;
        continue;
      }
      const rankIdx = sortedNonAdmin.indexOf(u);
      const rank = rankIdx >= 0 ? (rankIdx + 1) : 1;
      const isOver = rank > effectiveLimit;
      u.overAccountLimit = isOver;
      u.isPrimaryBestAccount = rank === 1;
      u.primaryBestUsername = primaryName;
      u.clusterRank = rank;
      u.clusterAccountCount = nonAdmin.length;
      u.effectiveMaxAccounts = effectiveLimit;
      if (isOver) {
        nowSuspendedKeys.add(low);
      }
    }
  }

  if (nowSuspendedKeys.size > 0 && db.sessions && typeof db.sessions === 'object') {
    for (const [tok, sess] of Object.entries(db.sessions)) {
      if (sess && sess.usernameKey && nowSuspendedKeys.has(String(sess.usernameKey).toLowerCase())) {
        delete db.sessions[tok];
      }
    }
  }
}

function getClusterUsersForClientSignals(clientInfo = {}, extraUserKeys = []) {
  const ctx = buildAltForensicContext(db.users || {});
  const matchedKeys = new Set();
  const cCookie = String(clientInfo.cookieId || '').trim();
  const cDevice = String(clientInfo.deviceId || '').trim();
  const knownLower = new Set(
    (Array.isArray(clientInfo.knownAccounts) ? clientInfo.knownAccounts : [])
      .map(n => String(n || '').trim().toLowerCase())
      .filter(Boolean)
  );
  for (const ek of (Array.isArray(extraUserKeys) ? extraUserKeys : [extraUserKeys])) {
    if (ek) knownLower.add(String(ek).trim().toLowerCase());
  }

  for (const [uKey, u] of Object.entries(db.users || {})) {
    if (!u || !u.username) continue;
    const low = String(u.username || uKey).toLowerCase();
    const uCookies = Array.isArray(u.cookieIds) ? u.cookieIds : (u.lastCookieId ? [u.lastCookieId] : []);
    const uDevices = Array.isArray(u.deviceIds) ? u.deviceIds : (u.lastDeviceId ? [u.lastDeviceId] : []);
    const uLinked = Array.isArray(u.linkedAccounts) ? u.linkedAccounts : [];
    const hit =
      (cCookie && uCookies.includes(cCookie)) ||
      (cDevice && uDevices.includes(cDevice)) ||
      knownLower.has(low) ||
      uLinked.some(lk => knownLower.has(String(lk).toLowerCase()));
    if (hit) matchedKeys.add(low);
  }

  // Transitively expand to whole linked cluster
  const expanded = new Set(matchedKeys);
  const seedClusters = new Set();
  for (const k of matchedKeys) {
    const cid = ctx.browserClusterId ? ctx.browserClusterId.get(k) : null;
    if (cid) seedClusters.add(cid);
  }
  if (seedClusters.size > 0 && ctx.browserClusterId) {
    for (const [uKey, cid] of ctx.browserClusterId.entries()) {
      if (seedClusters.has(cid)) expanded.add(uKey);
    }
  }

  const members = [];
  for (const k of expanded) {
    if (db.users[k]) members.push(db.users[k]);
  }
  members.sort(compareUserAccountsByPriority);
  return members;
}

/**
 * Checks if a browser/person is allowed to register another account under their Account Limit.
 */
function checkAccountRegistrationAllowance(clientInfo = {}) {
  const members = getClusterUsersForClientSignals(clientInfo);
  const nonAdminMembers = members.filter(u => u && String(u.username).toLowerCase() !== 'medonut');
  const effectiveMaxAccounts = resolveClusterEffectiveLimit(members);
  const currentCount = nonAdminMembers.length;
  const primary = nonAdminMembers[0] || members[0] || null;

  if (currentCount >= effectiveMaxAccounts) {
    return {
      allowed: false,
      currentCount,
      effectiveMaxAccounts,
      primaryUsername: primary ? primary.username : ''
    };
  }
  return {
    allowed: true,
    currentCount,
    effectiveMaxAccounts,
    inheritedLimit: members.some(u => typeof u.maxAccounts === 'number' && u.maxAccounts >= 1) ? effectiveMaxAccounts : null,
    primaryUsername: primary ? primary.username : ''
  };
}

/**
 * Allows MeDonut Admin to change how many accounts a player / alt group is allowed to have,
 * storing it in `db.json` and automatically keeping only the best/most-played N account(s) active.
 */
function adminSetUserAccountLimit(username, limitValue) {
  const cleanName = typeof username === 'string' ? username.trim() : '';
  const uKey = cleanName.toLowerCase();
  const user = db.users && db.users[uKey];
  if (!user) {
    throw new Error(`Player "${cleanName}" not found in database.`);
  }
  if (uKey === 'medonut') {
    throw new Error('MeDonut admin account limit cannot be restricted.');
  }

  const useDefault = limitValue === null || limitValue === undefined || limitValue === '' || String(limitValue).toLowerCase() === 'default';
  const cleanLimit = useDefault ? null : Math.max(1, Math.min(50, Math.floor(Number(limitValue) || 1)));
  const now = Date.now();

  const ctx = buildAltForensicContext(db.users);
  const cid = ctx.browserClusterId ? ctx.browserClusterId.get(uKey) : null;
  const affectedUsers = [user];
  if (cid && ctx.browserClusterId) {
    for (const [k, otherCid] of ctx.browserClusterId.entries()) {
      if (otherCid === cid && k !== uKey && db.users[k] && k !== 'medonut') {
        affectedUsers.push(db.users[k]);
      }
    }
  }

  for (const au of affectedUsers) {
    if (cleanLimit === null) {
      delete au.maxAccounts;
      au.maxAccountsUpdatedAt = now;
    } else {
      au.maxAccounts = cleanLimit;
      au.maxAccountsUpdatedAt = now;
    }
  }

  syncAndRebuildOverview();
  enrichOverviewWithClientSignals();

  const effLimit = Number(user.effectiveMaxAccounts) || getDefaultMaxAccountsLimit();
  const overList = affectedUsers.filter(u => u.overAccountLimit).map(u => u.username);
  logDatabaseEvent(
    'ACCOUNT_LIMIT_UPDATED',
    user.username,
    `👥 MeDonut set account limit for ${user.username} (${affectedUsers.length} linked account(s)) to ${cleanLimit === null ? `Default (${effLimit})` : effLimit}${overList.length > 0 ? ` — kept best ${effLimit}, paused: ${overList.join(', ')}` : ''}`,
    { username: user.username, maxAccounts: cleanLimit, effectiveMaxAccounts: effLimit, pausedAlts: overList }
  );
  saveDatabase(true);

  return {
    ok: true,
    username: user.username,
    maxAccounts: cleanLimit,
    effectiveMaxAccounts: effLimit,
    affectedUsernames: affectedUsers.map(u => u.username),
    pausedAlts: overList,
    primaryBestUsername: user.primaryBestUsername || user.username
  };
}

/**
 * Checks whether two Duel participants are the same user or linked alt accounts (80%+ cookie/device/history),
 * strictly ignoring shared school Wi-Fi IP addresses and identical shared laptop hardware specs.
 */
function areUsersAltLinked(uKeyA, uKeyB, clientInfoA = null, clientInfoB = null) {
  const kA = String(uKeyA || '').trim().toLowerCase();
  const kB = String(uKeyB || '').trim().toLowerCase();
  if (kA && kB && kA === kB) {
    return { isAlt: true, reason: 'Same account cannot duel itself' };
  }

  const userA = kA && db.users ? db.users[kA] : null;
  const userB = kB && db.users ? db.users[kB] : null;

  if (userA && userB) {
    const ctx = buildAltForensicContext(db.users);
    const cA = ctx.browserClusterId ? ctx.browserClusterId.get(kA) : null;
    const cB = ctx.browserClusterId ? ctx.browserClusterId.get(kB) : null;
    if (cA && cB && cA === cB) {
      return { isAlt: true, reason: 'Confirmed Alt Cluster (Cookie / Browser ID / Account History)' };
    }
  }

  const collectSignals = (usr, info, selfKey) => {
    const cookies = new Set(Array.isArray(usr && usr.cookieIds) ? usr.cookieIds : ((usr && usr.lastCookieId) ? [usr.lastCookieId] : []));
    const devices = new Set(Array.isArray(usr && usr.deviceIds) ? usr.deviceIds : ((usr && usr.lastDeviceId) ? [usr.lastDeviceId] : []));
    const known = new Set((Array.isArray(usr && usr.linkedAccounts) ? usr.linkedAccounts : []).map(x => String(x).toLowerCase()));
    if (selfKey) known.add(selfKey);
    if (info && info.cookieId) cookies.add(String(info.cookieId).trim());
    if (info && info.deviceId) devices.add(String(info.deviceId).trim());
    if (info && Array.isArray(info.knownAccounts)) {
      info.knownAccounts.forEach(x => {
        const clean = String(x || '').trim().toLowerCase();
        if (clean) known.add(clean);
      });
    }
    return { cookies, devices, known };
  };

  const sA = collectSignals(userA, clientInfoA, kA);
  const sB = collectSignals(userB, clientInfoB, kB);

  for (const ck of sA.cookies) {
    if (ck && sB.cookies.has(ck)) {
      return { isAlt: true, reason: 'Same Browser Cookie ID' };
    }
  }
  for (const dev of sA.devices) {
    if (dev && sB.devices.has(dev)) {
      return { isAlt: true, reason: 'Same Browser Device ID' };
    }
  }
  if ((kB && sA.known.has(kB)) || (kA && sB.known.has(kA))) {
    return { isAlt: true, reason: 'Same Browser Account History' };
  }
  for (const acct of sA.known) {
    if (acct && acct !== 'guestpilot' && sB.known.has(acct)) {
      return { isAlt: true, reason: 'Shared Browser Known Accounts' };
    }
  }

  return { isAlt: false, reason: '' };
}

loadDatabase(false);

module.exports = {
  getDb: () => db,
  DB_FILE,
  loadDatabase,
  saveDatabase,
  hashPassword,
  buildLeaderboards,
  buildAllTimeframeLeaderboards,
  getLeaderboardResetBoundaries,
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
  adminUpdatePlayerDuelElo,
  resetAllRecordsAdmin,
  BACKUPS_DIR,
  TEMPLATE_FILE,
  formatReadableTimestamp,
  formatDanishTime,
  isWithinDanishWindow,
  pruneBackups,
  isSkinUnlockedForUser,
  isSkinNaturallyUnlockedForUser,
  mergeUserProgressionData,
  openBackgroundCaseForUser,
  saveUserCustomBackgroundMedia,
  checkBanForSignals,
  banPlayerAndAltsAdmin,
  unbanPlayerAdmin,
  getChatMessages,
  addChatMessage,
  calculateDuelEloUpdate,
  recordDuelMatchResult,
  getPlayerRankedDuelHistory,
  buildDuelRankedLeaderboard,
  buildDuelHighScoreLeaderboard,
  trackUserClientSignals,
  enrichOverviewWithClientSignals,
  findAltAccountsForUser,
  deletePlayerAccountAdmin,
  scoreUserAccountPriority,
  checkAccountRegistrationAllowance,
  adminSetUserAccountLimit,
  areUsersAltLinked
};
