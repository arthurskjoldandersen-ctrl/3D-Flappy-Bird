/**
 * ============================================================================
 * API ROUTES HANDLER (AUTH, LEADERBOARDS, ANTI-CHEAT RUNS & LIVE DB MANAGER)
 * ============================================================================
 */

const crypto = require('crypto');
const os = require('os');
const { SIM_CONFIG } = require('../config/physicsConfig');
const { verifyGameReplay } = require('../services/antiCheat');
const {
  getDb,
  DB_FILE,
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
  formatReadableTimestamp
} = require('../services/database');

// In-memory active single-use game runs
const activeRuns = new Map(); // runId -> { runId, seed, difficulty, usernameKey, startedAt }

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
    const { username, password } = await readJsonBody(req);
    const cleanName = typeof username === 'string' ? username.trim() : '';
    const cleanPass = typeof password === 'string' ? password : '';

    if (!/^[a-zA-Z0-9_]{3,16}$/.test(cleanName)) {
      return sendJSON(res, 400, {
        error: 'Username must be 3-16 characters (letters, numbers, or underscores).'
      });
    }
    if (cleanPass.length < 4 || cleanPass.length > 64) {
      return sendJSON(res, 400, {
        error: 'Password must be at least 4 characters.'
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

    db.users[usernameKey] = {
      username: cleanName,
      salt,
      passwordHash,
      createdAt: now,
      loginCount: 1,
      lastLoginAt: now,
      lastLoginReadable: formatReadableTimestamp(now),
      lastNewBestAt: 0,
      lastNewBestText: 'Account created — no personal best set yet',
      selectedSkin: 'classic',
      selectedPipeSkin: 'classic_pipe',
      records: { easy: 0, medium: 0, hard: 0 },
      recordTimestamps: { easy: now, medium: now, hard: now }
    };

    const token = crypto.randomBytes(24).toString('hex');
    db.sessions[token] = { usernameKey, username: cleanName, createdAt: now };

    logDatabaseEvent(
      'REGISTER',
      cleanName,
      `✨ New player account registered & logged in: ${cleanName}`,
      { records: { easy: 0, medium: 0, hard: 0 } }
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
    const cleanName = typeof username === 'string' ? username.trim() : '';
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
        grantedSkins: auth.user.grantedSkins || [],
        adminLockedSkins: auth.user.adminLockedSkins || [],
        records: auth.user.records
      },
      leaderboards: buildLeaderboards()
    });
  }

  // 7. Save Equipped Bird Skin & Pipe Skin
  if (req.method === 'POST' && pathname === '/api/skin') {
    const auth = getAuthenticatedUser(req);
    if (!auth) {
      return sendJSON(res, 401, { error: 'Not authenticated' });
    }
    const { skinId, pipeSkinId } = await readJsonBody(req);
    const lockedSkins = auth.user.adminLockedSkins || [];

    if (typeof skinId === 'string' && skinId.length <= 40) {
      if (lockedSkins.includes(skinId)) {
        return sendJSON(res, 403, { error: `The skin "${skinId}" has been locked by Administrator and cannot be equipped.` });
      }
      auth.user.selectedSkin = skinId;
    }
    if (typeof pipeSkinId === 'string' && pipeSkinId.length <= 40) {
      if (lockedSkins.includes(pipeSkinId)) {
        return sendJSON(res, 403, { error: `The pipe skin "${pipeSkinId}" has been locked by Administrator and cannot be equipped.` });
      }
      auth.user.selectedPipeSkin = pipeSkinId;
    }
    saveDatabase();
    return sendJSON(res, 200, {
      ok: true,
      selectedSkin: auth.user.selectedSkin || 'classic',
      selectedPipeSkin: auth.user.selectedPipeSkin || 'classic_pipe'
    });
  }

  // 8. Get All 3 Difficulty Leaderboards (Supports ?all=true for full leaderboard beyond Top 100)
  if (req.method === 'GET' && pathname === '/api/leaderboard') {
    const showAll = parsedUrl.query && (parsedUrl.query.all === 'true' || parsedUrl.query.all === '1');
    const limit = showAll ? 0 : 100;
    return sendJSON(res, 200, {
      leaderboards: buildLeaderboards(limit),
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

    const { isNewRecord, newRunId, previousBest } = recordVerifiedRun(user, diffKey, verifiedScore);

    return sendJSON(res, 200, {
      verified: true,
      verifiedScore,
      difficulty: diffKey,
      isNewRecord,
      previousBest,
      entryId: newRunId,
      records: user.records,
      leaderboards: buildLeaderboards()
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
