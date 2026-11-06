/**
 * ============================================================================
 * API ROUTES HANDLER (AUTH, LEADERBOARDS, ANTI-CHEAT RUNS & LIVE DB MANAGER)
 * ============================================================================
 */

const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { SIM_CONFIG } = require('../config/physicsConfig');
const { verifyGameReplay } = require('../services/antiCheat');
const { checkProhibitedLanguage } = require('../services/antiSlur');
const {
  getDb,
  DB_FILE,
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
  resetAllRecordsAdmin,
  formatReadableTimestamp,
  isSkinUnlockedForUser,
  isWithinDanishWindow,
  getChatMessages,
  addChatMessage
} = require('../services/database');

let BIRD_SKINS_LIST = [];
try {
  const skinsModule = require(path.join(__dirname, '..', '..', 'public', 'js', 'skins-data.js'));
  BIRD_SKINS_LIST = skinsModule.BIRD_SKINS || [];
} catch (_) {}

function getSkinEmoji(skinId) {
  if (!skinId || skinId === 'classic') return '🐤';
  const found = BIRD_SKINS_LIST.find(s => s && s.id === skinId);
  return (found && found.emoji) ? found.emoji : '🐤';
}

// In-memory active single-use game runs
const activeRuns = new Map(); // runId -> { runId, seed, difficulty, usernameKey, startedAt }

// 3-second cooldown tracker per user/sender
const chatCooldowns = new Map(); // key -> lastSentTimestamp

// Clean up expired active runs older than 45 minutes
setInterval(() => {
  const now = Date.now();
  for (const [runId, run] of activeRuns.entries()) {
    if (now - run.startedAt > 45 * 60 * 1000) {
      activeRuns.delete(runId);
    }
  }
}, 60 * 1000).unref();

function sendJSON(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 512 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function getAuthenticatedUser(req) {
  const db = getDb();
  let token = '';
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.url && req.url.includes('token=')) {
    try {
      const parsedUrl = new URL(req.url, 'http://localhost');
      token = (parsedUrl.searchParams.get('token') || '').trim();
    } catch (_) {}
  }
  if (!token) return null;
  const session = db.sessions && db.sessions[token];
  if (!session) return null;
  const user = db.users[session.usernameKey];
  if (!user) return null;
  return { token, user, usernameKey: session.usernameKey };
}

function isMeDonutAdmin(req) {
  const auth = getAuthenticatedUser(req);
  if (!auth || !auth.user || typeof auth.user.username !== 'string') return null;
  if (auth.user.username.toLowerCase() !== 'medonut') return null;
  return auth;
}

function getLocalAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

async function handleApiRequest(req, res, pathname, port) {
  const db = getDb();
  const parsedUrl = new URL(req.url, 'http://localhost');
  const query = Object.fromEntries(parsedUrl.searchParams.entries());
  parsedUrl.query = query;

  // 1. Server Info & Healthcheck (Used by Render healthCheckPath)
  if (req.method === 'GET' && pathname === '/api/server-info') {
    return sendJSON(res, 200, {
      status: 'ok',
      port,
      lanAddresses: getLocalAddresses(),
      difficulties: SIM_CONFIG.difficulties,
      databaseStatus: db.databaseStatus
    });
  }

  // 2. Register Account
  if (req.method === 'POST' && pathname === '/api/register') {
    const { username, password, records: reqRecords } = await readJsonBody(req);
    const cleanName = typeof username === 'string' ? username.trim().replace(/\s+/g, ' ') : '';
    const cleanPass = typeof password === 'string' ? password : '';

    // Allow Unicode letters (Danish æ, ø, å, accents, etc.), digits, spaces, hyphens, underscores, dots (2-20 chars)
    const isValidUsername = /^[\p{L}\p{N}_\-\. ]{2,20}$/u.test(cleanName);
    if (!isValidUsername) {
      return sendJSON(res, 400, {
        error: 'Username must be 2-20 characters (letters, numbers, spaces, hyphens, or underscores).'
      });
    }
    if (cleanPass.length < 1 || cleanPass.length > 64) {
      return sendJSON(res, 400, {
        error: 'Password must be between 1 and 64 characters.'
      });
    }

    const usernameKey = cleanName.toLowerCase();
    if (db.users[usernameKey]) {
      return sendJSON(res, 409, {
        error: 'That username is already taken. Try logging in or pick another name!'
      });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(cleanPass, salt);
    const now = Date.now();

    const initialRecords = {
      easy: Math.max(0, Math.floor(Number(reqRecords && reqRecords.easy) || 0)),
      medium: Math.max(0, Math.floor(Number(reqRecords && reqRecords.medium) || 0)),
      hard: Math.max(0, Math.floor(Number(reqRecords && reqRecords.hard) || 0))
    };

    db.users[usernameKey] = {
      username: cleanName,
      salt,
      passwordHash,
      createdAt: now,
      loginCount: 0,
      lastLoginAt: now,
      lastLoginReadable: formatReadableTimestamp(now),
      lastNewBestAt: 0,
      lastNewBestText: 'Account created — no personal best set yet',
      selectedSkin: 'classic',
      selectedPipeSkin: 'classic_pipe',
      grantedSkins: [],
      adminLockedSkins: [],
      records: initialRecords,
      recordTimestamps: { easy: now, medium: now, hard: now }
    };

    const token = crypto.randomBytes(24).toString('hex');
    db.sessions[token] = { usernameKey, username: cleanName, createdAt: now };

    recordUserLogin(db.users[usernameKey], 'register');

    logDatabaseEvent(
      'REGISTER',
      cleanName,
      `✨ New player account registered & logged in: ${cleanName}`,
      { records: initialRecords }
    );
    saveDatabase();

    return sendJSON(res, 201, {
      token,
      user: {
        username: cleanName,
        selectedSkin: 'classic',
        selectedPipeSkin: 'classic_pipe',
        grantedSkins: db.users[usernameKey].grantedSkins || [],
        adminLockedSkins: db.users[usernameKey].adminLockedSkins || [],
        records: db.users[usernameKey].records
      },
      leaderboards: buildLeaderboards()
    });
  }

  // 3. Password Login
  if (req.method === 'POST' && pathname === '/api/login') {
    const { username, password } = await readJsonBody(req);
    const cleanName = typeof username === 'string' ? username.trim().replace(/\s+/g, ' ') : '';
    const cleanPass = typeof password === 'string' ? password : '';
    const usernameKey = cleanName.toLowerCase();

    const user = db.users[usernameKey];
    if (!user) {
      return sendJSON(res, 401, { error: 'Account not found. Check your username or Register!' });
    }

    const computedHash = hashPassword(cleanPass, user.salt);
    const validPass = crypto.timingSafeEqual(
      Buffer.from(computedHash, 'hex'),
      Buffer.from(user.passwordHash, 'hex')
    );
    if (!validPass) {
      return sendJSON(res, 401, { error: 'Incorrect password.' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    db.sessions[token] = { usernameKey, username: user.username, createdAt: Date.now() };
    recordUserLogin(user, 'password');

    return sendJSON(res, 200, {
      token,
      user: {
        username: user.username,
        selectedSkin: user.selectedSkin || 'classic',
        selectedPipeSkin: user.selectedPipeSkin || 'classic_pipe',
        grantedSkins: user.grantedSkins || [],
        adminLockedSkins: user.adminLockedSkins || [],
        records: user.records
      },
      leaderboards: buildLeaderboards()
    });
  }

  // 5. Logout
  if (req.method === 'POST' && pathname === '/api/logout') {
    const auth = getAuthenticatedUser(req);
    if (auth && db.sessions[auth.token]) {
      delete db.sessions[auth.token];
      logDatabaseEvent('LOGOUT', auth.user.username, `🚪 ${auth.user.username} logged out`);
      saveDatabase();
    }
    return sendJSON(res, 200, { ok: true });
  }

  // 6. Get Current Logged-in User Profile
  if (req.method === 'GET' && pathname === '/api/me') {
    const auth = getAuthenticatedUser(req);
    if (!auth) {
      return sendJSON(res, 401, { error: 'Not authenticated' });
    }
    return sendJSON(res, 200, {
      user: {
        username: auth.user.username,
        selectedSkin: auth.user.selectedSkin || 'classic',
        selectedPipeSkin: auth.user.selectedPipeSkin || 'classic_pipe',
        avatarSkinId: auth.user.avatarSkinId || auth.user.selectedSkin || 'classic',
        grantedSkins: auth.user.grantedSkins || [],
        adminLockedSkins: auth.user.adminLockedSkins || [],
        records: auth.user.records
      },
      leaderboards: buildLeaderboards(),
      timeframeLeaderboards: {
        all: buildLeaderboards(100, 'all'),
        weekly: buildLeaderboards(100, 'weekly'),
        daily: buildLeaderboards(100, 'daily')
      },
      resetBoundaries: getLeaderboardResetBoundaries()
    });
  }

  // 7. Save Equipped Bird Skin & Pipe Skin
  if (req.method === 'POST' && pathname === '/api/skin') {
    const auth = getAuthenticatedUser(req);
    if (!auth) {
      return sendJSON(res, 401, { error: 'Not authenticated' });
    }
    const { skinId, pipeSkinId, avatarSkinId } = await readJsonBody(req);
    const lockedSkins = auth.user.adminLockedSkins || [];

    if (typeof skinId === 'string' && skinId.length <= 40) {
      if (lockedSkins.includes(skinId)) {
        return sendJSON(res, 403, { error: `The skin "${skinId}" has been locked by Administrator and cannot be equipped.` });
      }
      if (!isSkinUnlockedForUser(skinId, auth.user)) {
        return sendJSON(res, 403, { error: `The skin "${skinId}" is locked and cannot be equipped.` });
      }
      auth.user.selectedSkin = skinId;
    }
    if (typeof pipeSkinId === 'string' && pipeSkinId.length <= 40) {
      if (lockedSkins.includes(pipeSkinId)) {
        return sendJSON(res, 403, { error: `The pipe skin "${pipeSkinId}" has been locked by Administrator and cannot be equipped.` });
      }
      if (!isSkinUnlockedForUser(pipeSkinId, auth.user)) {
        return sendJSON(res, 403, { error: `The pipe skin "${pipeSkinId}" is locked and cannot be equipped.` });
      }
      auth.user.selectedPipeSkin = pipeSkinId;
    }
    if (typeof avatarSkinId === 'string' && avatarSkinId.length <= 40) {
      auth.user.avatarSkinId = avatarSkinId;
    }
    saveDatabase();
    return sendJSON(res, 200, {
      ok: true,
      selectedSkin: auth.user.selectedSkin || 'classic',
      selectedPipeSkin: auth.user.selectedPipeSkin || 'classic_pipe',
      avatarSkinId: auth.user.avatarSkinId || auth.user.selectedSkin || 'classic'
    });
  }

  // 7b. Dedicated Set Avatar Profile Picture Endpoint
  if (req.method === 'POST' && pathname === '/api/user/set-avatar') {
    const auth = getAuthenticatedUser(req);
    if (!auth) {
      return sendJSON(res, 401, { error: 'Not authenticated' });
    }
    const { avatarSkinId } = await readJsonBody(req);
    if (typeof avatarSkinId === 'string' && avatarSkinId.length <= 40) {
      auth.user.avatarSkinId = avatarSkinId.trim();
      saveDatabase();
      return sendJSON(res, 200, {
        ok: true,
        avatarSkinId: auth.user.avatarSkinId
      });
    }
    return sendJSON(res, 400, { error: 'Invalid avatarSkinId provided' });
  }

  // 7c. Public Player Profile Inspector Endpoint
  if (req.method === 'GET' && pathname === '/api/user/profile') {
    const targetUsername = (parsedUrl.query && parsedUrl.query.username) ? String(parsedUrl.query.username).trim() : '';
    if (!targetUsername) {
      return sendJSON(res, 400, { error: 'Missing username parameter' });
    }
    const lower = targetUsername.toLowerCase();
    const user = db.users && db.users[lower];
    if (!user) {
      return sendJSON(res, 404, { error: `Player profile for "${targetUsername}" not found.` });
    }

    // Count user's runs across all modes
    let totalRuns = 0;
    ['easy', 'medium', 'hard'].forEach(diff => {
      if (Array.isArray(db.runs[diff])) {
        totalRuns += db.runs[diff].filter(r => r.username.toLowerCase() === lower && !r.hidden).length;
      }
    });

    // Compute leaderboard ranks
    const leaderboards = buildLeaderboards(0);
    const ranks = {};
    ['easy', 'medium', 'hard'].forEach(diff => {
      const idx = (leaderboards[diff] || []).findIndex(e => e.username.toLowerCase() === lower);
      ranks[diff] = idx !== -1 ? `#${idx + 1}` : 'Unranked';
    });

    return sendJSON(res, 200, {
      profile: {
        username: user.username,
        records: user.records || { easy: 0, medium: 0, hard: 0 },
        recordTimestamps: user.recordTimestamps || {},
        selectedSkin: user.selectedSkin || 'classic',
        selectedPipeSkin: user.selectedPipeSkin || 'classic_pipe',
        avatarSkinId: user.avatarSkinId || user.selectedSkin || 'classic',
        createdAt: user.createdAt || Date.now(),
        totalRuns,
        ranks
      }
    });
  }

  // 8. Get All 3 Difficulty Leaderboards (Supports ?timeframe=all|weekly|daily and ?all=true for full beyond Top 100)
  if (req.method === 'GET' && pathname === '/api/leaderboard') {
    const showAll = parsedUrl.query && (parsedUrl.query.all === 'true' || parsedUrl.query.all === '1');
    const requestedTimeframe = parsedUrl.query && parsedUrl.query.timeframe;
    const timeframe = (requestedTimeframe === 'daily' || requestedTimeframe === 'weekly') ? requestedTimeframe : 'all';
    const limit = showAll ? 0 : 100;
    const boundaries = getLeaderboardResetBoundaries();
    return sendJSON(res, 200, {
      leaderboards: buildLeaderboards(limit, timeframe),
      timeframeLeaderboards: {
        all: buildLeaderboards(limit, 'all'),
        weekly: buildLeaderboards(limit, 'weekly'),
        daily: buildLeaderboards(limit, 'daily')
      },
      timeframe,
      resetBoundaries: boundaries,
      isAll: Boolean(showAll),
      databaseStatus: db.databaseStatus
    });
  }

  // 9. Start an Anti-Cheat Tracked Run
  if (req.method === 'POST' && pathname === '/api/run/start') {
    const auth = getAuthenticatedUser(req);
    if (!auth) {
      return sendJSON(res, 401, { error: 'Please log in to start an official ranked run.' });
    }

    const { difficulty } = await readJsonBody(req);
    const diffKey = SIM_CONFIG.difficulties[difficulty] ? difficulty : 'medium';

    const runId = crypto.randomBytes(16).toString('hex');
    const seed = crypto.randomInt(1, 0x7fffffff);

    activeRuns.set(runId, {
      runId,
      seed,
      difficulty: diffKey,
      usernameKey: auth.usernameKey,
      startedAt: Date.now()
    });

    return sendJSON(res, 200, {
      runId,
      seed,
      difficulty: diffKey,
      simConfig: SIM_CONFIG
    });
  }

  // 10. Finish Run & Verify Replay via Authoritative Server Physics Anti-Cheat
  if (req.method === 'POST' && pathname === '/api/run/finish') {
    const auth = getAuthenticatedUser(req);
    if (!auth) {
      return sendJSON(res, 401, { error: 'Authentication required to submit scores.' });
    }

    const { runId, flapTicks, totalTicks, claimedScore } = await readJsonBody(req);
    if (!runId || !activeRuns.has(runId)) {
      return sendJSON(res, 400, {
        error: 'Anti-Cheat Rejection: Invalid or expired run token. Scores cannot be submitted manually from the console.'
      });
    }

    const run = activeRuns.get(runId);
    activeRuns.delete(runId);

    if (run.usernameKey !== auth.usernameKey) {
      return sendJSON(res, 403, { error: 'Anti-Cheat Rejection: Run token belongs to a different player.' });
    }

    const elapsedWallMs = Date.now() - run.startedAt;
    const simulatedDurationMs = (totalTicks / SIM_CONFIG.tickRate) * 1000;
    if (simulatedDurationMs > elapsedWallMs + 3500) {
      return sendJSON(res, 400, {
        error: 'Anti-Cheat Rejection: Speedhack / fast-forward time manipulation detected.'
      });
    }

    const verification = verifyGameReplay({
      seed: run.seed,
      difficulty: run.difficulty,
      flapTicks,
      totalTicks,
      claimedScore
    });

    if (!verification.valid) {
      return sendJSON(res, 400, {
        error: verification.reason || 'Anti-Cheat Rejection: Replay verification failed.'
      });
    }

    const verifiedScore = verification.verifiedScore;
    const diffKey = run.difficulty;
    const user = auth.user;

    const { isNewRecord, newRunId, previousBest, autoHidden, withinWindow } = recordVerifiedRun(user, diffKey, verifiedScore);

    // Automatic Chat Announcements for Personal Bests, Placements & Top Runs across Timeframes (Daily, Weekly, All-Time)
    let timeframePlacements = { daily: 1, weekly: 1, all: 1 };
    try {
      const db = getDb();
      const modeLabel = diffKey === 'easy' ? 'EASY' : (diffKey === 'hard' ? 'HARD' : 'MEDIUM');
      const now = Date.now();
      const boundaries = getLeaderboardResetBoundaries(now);
      const dailyResetMs = boundaries.daily.currentResetMs;
      const weeklyResetMs = boundaries.weekly.currentResetMs;

      const allVisibleRuns = (db.runs && Array.isArray(db.runs[diffKey]))
        ? db.runs[diffKey].filter(r => !r.hidden && (r.isWithinDanishWindow !== undefined ? r.isWithinDanishWindow : isWithinDanishWindow(r.createdAt)))
        : [];

      const weeklyVisibleRuns = allVisibleRuns.filter(r => (r.createdAt || 0) >= weeklyResetMs);
      const dailyVisibleRuns = allVisibleRuns.filter(r => (r.createdAt || 0) >= dailyResetMs);

      const getTimeframeStats = (runsList, targetRunId, username, isNewPb) => {
        const sorted = runsList.slice().sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return (a.createdAt || 0) - (b.createdAt || 0);
        });

        // Rank of THIS specific run among all runs in this timeframe
        const runIdx = targetRunId ? sorted.findIndex(r => r.id === targetRunId) : -1;
        const runRank = runIdx !== -1 ? (runIdx + 1) : (sorted.length + 1);

        // Unique players ranking (each player's best score in this timeframe)
        const uKey = (username || '').toLowerCase();
        const maxScoreMap = new Map();
        for (const r of sorted) {
          const k = (r.username || '').toLowerCase();
          const cur = maxScoreMap.get(k);
          if (cur === undefined || r.score > cur) {
            maxScoreMap.set(k, r.score);
          }
        }

        const uniquePlayers = [];
        const seen = new Set();
        for (const r of sorted) {
          const k = (r.username || '').toLowerCase();
          if (!seen.has(k) && r.score === maxScoreMap.get(k)) {
            seen.add(k);
            uniquePlayers.push(r);
          }
        }

        const playerIdx = uniquePlayers.findIndex(r => (r.username || '').toLowerCase() === uKey);
        const playerRank = playerIdx !== -1 ? (playerIdx + 1) : (uniquePlayers.length + 1);

        // CRITICAL FIX: If this run is NOT a new Personal Best, it cannot claim
        // the player's historical rank! The rank of THIS run is strictly its runRank!
        // Only if this run IS a new Personal Best does it represent their new playerRank!
        const placementRank = isNewPb ? playerRank : runRank;

        // A run is #1 ONLY if THIS SPECIFIC RUN is #1 in this timeframe!
        const isTop1 = runRank === 1;
        const isTop5 = isNewPb ? (playerRank <= 5) : (runRank <= 5);
        const isTop10 = isNewPb ? (playerRank <= 10) : (runRank <= 10);

        return {
          runRank,
          playerRank,
          placementRank,
          totalRuns: sorted.length,
          totalPlayers: uniquePlayers.length,
          isTop1,
          isTop5,
          isTop10
        };
      };

      const dailyStats = getTimeframeStats(dailyVisibleRuns, newRunId, user.username, isNewRecord);
      const weeklyStats = getTimeframeStats(weeklyVisibleRuns, newRunId, user.username, isNewRecord);
      const allStats = getTimeframeStats(allVisibleRuns, newRunId, user.username, isNewRecord);

      timeframePlacements = {
        daily: dailyStats.placementRank,
        weekly: weeklyStats.placementRank,
        all: allStats.placementRank
      };

      if (withinWindow && verifiedScore > 0) {
        // Tier 1: All-Time #1 Record
        if (allStats.isTop1) {
          addChatMessage({
            type: 'system',
            subtype: 'top1',
            tagLabel: 'ALL-TIME #1',
            leaderboardType: 'all',
            username: 'Leaderboard Bot',
            avatar: '👑',
            text: `👑 NEW #1 ALL-TIME! ${user.username} scored ${verifiedScore} pts in ${modeLabel}!`
          });
        } else if (allStats.isTop5 && (isNewRecord || verifiedScore >= 5)) {
          // Tier 2: All-Time Top 5
          if (isNewRecord) {
            addChatMessage({
              type: 'system',
              subtype: 'top5',
              tagLabel: 'ALL-TIME TOP 5',
              leaderboardType: 'all',
              username: 'Leaderboard Bot',
              avatar: '🔥',
              text: `🔥 TOP 5 & NEW BEST! ${user.username} scored ${verifiedScore} pts in ${modeLabel} (Rank #${allStats.placementRank} All-Time)!`
            });
          } else {
            addChatMessage({
              type: 'system',
              subtype: 'top5',
              tagLabel: 'ALL-TIME TOP 5',
              leaderboardType: 'all',
              username: 'Leaderboard Bot',
              avatar: '⭐',
              text: `⭐ TOP 5 RUN! ${user.username} scored ${verifiedScore} pts in ${modeLabel} (Rank #${allStats.placementRank} All-Time)!`
            });
          }
        } else if (weeklyStats.isTop1 && (isNewRecord || verifiedScore >= 10)) {
          // Tier 3: Weekly #1 Record
          addChatMessage({
            type: 'system',
            subtype: 'top1',
            tagLabel: 'WEEKLY #1',
            leaderboardType: 'weekly',
            username: 'Leaderboard Bot',
            avatar: '👑',
            text: `👑 NEW #1 WEEKLY! ${user.username} scored ${verifiedScore} pts in ${modeLabel}!`
          });
        } else if (weeklyStats.isTop5 && (isNewRecord || verifiedScore >= 10)) {
          // Tier 4: Weekly Top 5
          if (isNewRecord) {
            addChatMessage({
              type: 'system',
              subtype: 'top5',
              tagLabel: 'WEEKLY TOP 5',
              leaderboardType: 'weekly',
              username: 'Leaderboard Bot',
              avatar: '🔥',
              text: `🔥 TOP 5 & NEW BEST! ${user.username} scored ${verifiedScore} pts in ${modeLabel} (Rank #${weeklyStats.placementRank} Weekly)!`
            });
          } else {
            addChatMessage({
              type: 'system',
              subtype: 'top5',
              tagLabel: 'WEEKLY TOP 5',
              leaderboardType: 'weekly',
              username: 'Leaderboard Bot',
              avatar: '⭐',
              text: `⭐ TOP 5 RUN! ${user.username} scored ${verifiedScore} pts in ${modeLabel} (Rank #${weeklyStats.placementRank} Weekly)!`
            });
          }
        } else if (dailyStats.isTop1 && (isNewRecord || verifiedScore >= 10)) {
          // Tier 5: Daily #1 Record
          addChatMessage({
            type: 'system',
            subtype: 'top1',
            tagLabel: 'DAILY #1',
            leaderboardType: 'daily',
            username: 'Leaderboard Bot',
            avatar: '👑',
            text: `👑 NEW #1 DAILY! ${user.username} scored ${verifiedScore} pts in ${modeLabel}!`
          });
        } else if (dailyStats.isTop5 && (isNewRecord || verifiedScore >= 10)) {
          // Tier 6: Daily Top 5
          if (isNewRecord) {
            addChatMessage({
              type: 'system',
              subtype: 'top5',
              tagLabel: 'DAILY TOP 5',
              leaderboardType: 'daily',
              username: 'Leaderboard Bot',
              avatar: '🔥',
              text: `🔥 TOP 5 & NEW BEST! ${user.username} scored ${verifiedScore} pts in ${modeLabel} (Rank #${dailyStats.placementRank} Daily)!`
            });
          } else {
            addChatMessage({
              type: 'system',
              subtype: 'top5',
              tagLabel: 'DAILY TOP 5',
              leaderboardType: 'daily',
              username: 'Leaderboard Bot',
              avatar: '⭐',
              text: `⭐ TOP 5 RUN! ${user.username} scored ${verifiedScore} pts in ${modeLabel} (Rank #${dailyStats.placementRank} Daily)!`
            });
          }
        } else if (isNewRecord && allStats.isTop10) {
          // Tier 7: All-Time Top 10
          addChatMessage({
            type: 'system',
            subtype: 'top10',
            tagLabel: 'ALL-TIME TOP 10',
            leaderboardType: 'all',
            username: 'Leaderboard Bot',
            avatar: '⭐',
            text: `⭐ TOP 10 ALL-TIME! ${user.username} scored ${verifiedScore} pts in ${modeLabel} (Rank #${allStats.placementRank} All-Time)!`
          });
        } else if (isNewRecord && weeklyStats.isTop10) {
          // Tier 8: Weekly Top 10
          addChatMessage({
            type: 'system',
            subtype: 'top10',
            tagLabel: 'WEEKLY TOP 10',
            leaderboardType: 'weekly',
            username: 'Leaderboard Bot',
            avatar: '⭐',
            text: `⭐ TOP 10 WEEKLY! ${user.username} scored ${verifiedScore} pts in ${modeLabel} (Rank #${weeklyStats.placementRank} Weekly)!`
          });
        } else if (isNewRecord && dailyStats.isTop10) {
          // Tier 9: Daily Top 10
          addChatMessage({
            type: 'system',
            subtype: 'top10',
            tagLabel: 'DAILY TOP 10',
            leaderboardType: 'daily',
            username: 'Leaderboard Bot',
            avatar: '⭐',
            text: `⭐ TOP 10 DAILY! ${user.username} scored ${verifiedScore} pts in ${modeLabel} (Rank #${dailyStats.placementRank} Daily)!`
          });
        } else if (isNewRecord) {
          // Tier 10: Personal Best beyond Top 10
          addChatMessage({
            type: 'system',
            subtype: 'new_best',
            tagLabel: 'PERSONAL BEST',
            leaderboardType: 'personal',
            username: 'Record Bot',
            avatar: '🎉',
            text: `🎉 NEW BEST! ${user.username} scored ${verifiedScore} pts in ${modeLabel} (Rank #${allStats.placementRank} All-Time)!`
          });
        }
      }
    } catch (annErr) {
      console.warn('Chat announcement notice:', annErr.message);
    }

    return sendJSON(res, 200, {
      verified: true,
      verifiedScore,
      difficulty: diffKey,
      isNewRecord,
      previousBest,
      autoHidden: Boolean(autoHidden),
      withinWindow: Boolean(withinWindow),
      entryId: newRunId,
      timeframePlacements,
      records: user.records,
      leaderboards: buildLeaderboards(),
      timeframeLeaderboards: {
        all: buildLeaderboards(100, 'all'),
        weekly: buildLeaderboards(100, 'weekly'),
        daily: buildLeaderboards(100, 'daily')
      },
      resetBoundaries: getLeaderboardResetBoundaries()
    });
  }

  // --------------------------------------------------------------------------
  // 10.5. GLOBAL LIVE CHAT SYSTEM (/api/chat & /api/chat/send)
  // --------------------------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/chat') {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const since = parseInt(parsedUrl.searchParams.get('since') || '0', 10);
    const limit = parseInt(parsedUrl.searchParams.get('limit') || '60', 10);
    const auth = getAuthenticatedUser(req);
    let userSync = null;
    if (auth && auth.user) {
      userSync = {
        username: auth.user.username,
        selectedSkin: auth.user.selectedSkin || 'classic',
        selectedPipeSkin: auth.user.selectedPipeSkin || 'classic_pipe',
        grantedSkins: Array.isArray(auth.user.grantedSkins) ? auth.user.grantedSkins : [],
        adminLockedSkins: Array.isArray(auth.user.adminLockedSkins) ? auth.user.adminLockedSkins : [],
        records: auth.user.records || {}
      };
    }
    return sendJSON(res, 200, {
      messages: getChatMessages(limit, since),
      serverTime: Date.now(),
      userSync
    });
  }

  if (req.method === 'POST' && pathname === '/api/chat/send') {
    const auth = getAuthenticatedUser(req);
    const body = await readJsonBody(req);
    const rawText = String(body.text || '').trim();

    if (!rawText) {
      return sendJSON(res, 400, { error: 'Message cannot be empty.' });
    }
    if (rawText.length > 200) {
      return sendJSON(res, 400, { error: 'Message cannot exceed 200 characters.' });
    }

    // Anti-Slur & Profanity Bypass Verification
    const slurCheck = checkProhibitedLanguage(rawText);
    if (slurCheck.isBlocked) {
      return sendJSON(res, 400, {
        error: 'Message blocked: Prohibited language or bypass attempt detected. Please keep the chat friendly and respectful!'
      });
    }

    // Determine sender identity & avatar
    let username = '';
    let usernameKey = '';
    let isMeDonut = false;
    let avatar = '🐤';

    if (auth && auth.user) {
      username = auth.user.username;
      usernameKey = auth.usernameKey;
      isMeDonut = Boolean(usernameKey === 'medonut');
      avatar = isMeDonut ? '👑' : getSkinEmoji(auth.user.selectedSkin);
    } else {
      const guestRaw = String(body.guestName || 'Guest').trim();
      const guestCheck = checkProhibitedLanguage(guestRaw);
      username = (guestCheck.isBlocked ? 'Player' : guestRaw.slice(0, 20)) || 'Guest';
      usernameKey = 'guest_' + username.toLowerCase().replace(/[^a-z0-9]/g, '');
      isMeDonut = false;
      avatar = '🐤';
    }

    // Enforce 3-second cooldown per sender
    const cooldownKey = auth ? auth.usernameKey : (req.headers['x-forwarded-for'] || req.socket.remoteAddress || usernameKey);
    const now = Date.now();
    const lastChatTime = chatCooldowns.get(cooldownKey) || 0;
    const elapsed = now - lastChatTime;

    if (elapsed < 3000) {
      const waitSeconds = Math.ceil((3000 - elapsed) / 1000);
      return sendJSON(res, 429, {
        error: `Please wait ${waitSeconds}s before sending another message.`,
        cooldownRemainingMs: 3000 - elapsed
      });
    }
    chatCooldowns.set(cooldownKey, now);

    // Escape text against HTML/XSS injection
    const sanitizedText = rawText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

    // Handle reply context if provided
    let replyTo = null;
    if (body.replyTo && typeof body.replyTo === 'object' && body.replyTo.username) {
      const replyCheck = checkProhibitedLanguage(body.replyTo.snippet || '');
      replyTo = {
        id: String(body.replyTo.id || ''),
        username: String(body.replyTo.username || '').slice(0, 32),
        snippet: replyCheck.isBlocked ? '***' : String(body.replyTo.snippet || '').slice(0, 60)
      };
    }

    const newMsg = addChatMessage({
      type: 'user',
      username,
      usernameKey,
      isMeDonut,
      avatar,
      text: sanitizedText,
      replyTo,
      timestampMs: now
    });

    return sendJSON(res, 201, {
      success: true,
      message: newMsg,
      messages: getChatMessages(60)
    });
  }

  // --------------------------------------------------------------------------
  // 11. LIVE DATABASE VIEWER & RECORD EDITOR ENDPOINTS (/api/database/*)
  // RESTRICTED STRICTLY TO MEDONUT ONLY!
  // --------------------------------------------------------------------------
  if (pathname.startsWith('/api/database')) {
    const adminAuth = isMeDonutAdmin(req);
    if (!adminAuth) {
      return sendJSON(res, 403, {
        error: 'Access Denied: Only the user MeDonut has access to the database.'
      });
    }
  }

  if (req.method === 'GET' && pathname === '/api/database') {
    return sendJSON(res, 200, {
      dbFilePath: DB_FILE,
      databaseStatus: db.databaseStatus,
      playerRecordsOverview: db.playerRecordsOverview,
      activityFeed: (db.activityFeed || []).slice(0, 100),
      leaderboards: buildLeaderboards(),
      allRuns: getAllRunsAdmin(),
      loginHistory: (db.loginHistory || []).slice(0, 300)
    });
  }

  if (req.method === 'GET' && pathname === '/api/database/export') {
    const safeExport = {
      databaseStatus: db.databaseStatus,
      playerRecordsOverview: db.playerRecordsOverview,
      activityFeed: db.activityFeed,
      loginHistory: db.loginHistory || [],
      adminSettings: db.adminSettings || {},
      users: db.users,
      runs: db.runs
    };
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="db.json"',
      'Cache-Control': 'no-store'
    });
    return res.end(JSON.stringify(safeExport, null, 2));
  }

  if (req.method === 'POST' && pathname === '/api/database/update-record') {
    const { username, records, selectedSkin, selectedPipeSkin } = await readJsonBody(req);
    if (!username) {
      return sendJSON(res, 400, { error: 'Username is required.' });
    }
    const updatedOverview = updatePlayerRecordsAdmin(username, records, selectedSkin, selectedPipeSkin);
    return sendJSON(res, 200, {
      ok: true,
      updatedPlayer: updatedOverview,
      databaseStatus: db.databaseStatus,
      playerRecordsOverview: db.playerRecordsOverview,
      activityFeed: (db.activityFeed || []).slice(0, 100),
      leaderboards: buildLeaderboards(),
      allRuns: getAllRunsAdmin()
    });
  }

  if (req.method === 'POST' && pathname === '/api/database/update-run') {
    const { difficulty, entryId, score, hidden } = await readJsonBody(req);
    if (!difficulty || !entryId) {
      return sendJSON(res, 400, { error: 'difficulty and entryId are required.' });
    }
    const result = updateLeaderboardRunAdmin(difficulty, entryId, { score, hidden });
    return sendJSON(res, 200, {
      ok: true,
      ...result,
      databaseStatus: db.databaseStatus,
      playerRecordsOverview: db.playerRecordsOverview,
      activityFeed: (db.activityFeed || []).slice(0, 100),
      leaderboards: buildLeaderboards(),
      allRuns: getAllRunsAdmin()
    });
  }

  if (req.method === 'POST' && pathname === '/api/database/add-run') {
    const { username, difficulty, score, hidden } = await readJsonBody(req);
    if (!username || !difficulty || score === undefined) {
      return sendJSON(res, 400, { error: 'username, difficulty, and score are required.' });
    }
    const newRun = addLeaderboardRunAdmin(username, difficulty, score, hidden);
    return sendJSON(res, 200, {
      ok: true,
      run: newRun,
      databaseStatus: db.databaseStatus,
      playerRecordsOverview: db.playerRecordsOverview,
      activityFeed: (db.activityFeed || []).slice(0, 100),
      leaderboards: buildLeaderboards(),
      allRuns: getAllRunsAdmin()
    });
  }

  if (req.method === 'POST' && pathname === '/api/database/toggle-user-visibility') {
    const { username, difficulty, hidden } = await readJsonBody(req);
    if (!username || hidden === undefined) {
      return sendJSON(res, 400, { error: 'username and hidden boolean are required.' });
    }
    const result = toggleUserRunsVisibilityAdmin(username, difficulty, hidden);
    return sendJSON(res, 200, {
      ok: true,
      ...result,
      databaseStatus: db.databaseStatus,
      playerRecordsOverview: db.playerRecordsOverview,
      activityFeed: (db.activityFeed || []).slice(0, 100),
      leaderboards: buildLeaderboards(),
      allRuns: getAllRunsAdmin()
    });
  }

  if (req.method === 'POST' && pathname === '/api/database/delete-run') {
    const { difficulty, entryId } = await readJsonBody(req);
    const removed = deleteLeaderboardEntryAdmin(difficulty, entryId);
    return sendJSON(res, 200, {
      ok: true,
      removed,
      databaseStatus: db.databaseStatus,
      playerRecordsOverview: db.playerRecordsOverview,
      activityFeed: (db.activityFeed || []).slice(0, 100),
      leaderboards: buildLeaderboards(),
      allRuns: getAllRunsAdmin(),
      loginHistory: (db.loginHistory || []).slice(0, 300)
    });
  }

  // 11b. Season Reset All Records Admin Endpoint (MeDonut Only)
  if (req.method === 'POST' && pathname === '/api/database/reset-records') {
    const adminAuth = isMeDonutAdmin(req);
    if (!adminAuth) {
      return sendJSON(res, 403, { error: 'Access Denied: Only MeDonut can reset records.' });
    }
    const adminName = adminAuth.user ? adminAuth.user.username : 'MeDonut';
    const result = resetAllRecordsAdmin(adminName);
    return sendJSON(res, 200, {
      ...result,
      databaseStatus: db.databaseStatus,
      playerRecordsOverview: db.playerRecordsOverview,
      activityFeed: (db.activityFeed || []).slice(0, 100),
      leaderboards: buildLeaderboards(),
      allRuns: getAllRunsAdmin(),
      loginHistory: (db.loginHistory || []).slice(0, 300)
    });
  }

  // 12. Admin Skin Inventory & Lock Manager (Grant, Revoke, Lock, or Change Equipped)
  if (req.method === 'POST' && pathname === '/api/database/update-user-skins') {
    const { username, grantSkinId, revokeSkinId, lockSkinId, unlockSkinId, selectedSkin, selectedPipeSkin } = await readJsonBody(req);
    if (!username) {
      return sendJSON(res, 400, { error: 'Username is required.' });
    }
    try {
      const result = adminUpdateUserSkins(username, {
        grantSkinId,
        revokeSkinId,
        lockSkinId,
        unlockSkinId,
        selectedSkin,
        selectedPipeSkin
      });
      return sendJSON(res, 200, {
        ok: true,
        userSkins: result,
        databaseStatus: db.databaseStatus,
        playerRecordsOverview: db.playerRecordsOverview,
        activityFeed: (db.activityFeed || []).slice(0, 100),
        leaderboards: buildLeaderboards(),
        allRuns: getAllRunsAdmin(),
        loginHistory: (db.loginHistory || []).slice(0, 300)
      });
    } catch (err) {
      return sendJSON(res, 400, { error: err.message });
    }
  }

  return sendJSON(res, 404, { error: 'API endpoint not found: ' + pathname });
}

module.exports = {
  handleApiRequest,
  getLocalAddresses
};
