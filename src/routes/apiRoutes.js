/**
 * ============================================================================
 * API ROUTES HANDLER (AUTH, LEADERBOARDS, ANTI-CHEAT RUNS & LIVE DB MANAGER)
 * ============================================================================
 */

const crypto = require('crypto');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { SIM_CONFIG, createSeededPRNG, getDifficultyParams, collidesExtremePipe, createExtremePipeSolver } = require('../config/physicsConfig');
const { verifyGameReplay } = require('../services/antiCheat');
const { checkProhibitedLanguage } = require('../services/antiSlur');
const {
  getDb,
  getFullDatabaseSnapshot,
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
  adminUpdatePlayerDuelElo,
  adminUpdatePlayerDuelPoints,
  resetAllRecordsAdmin,
  formatReadableTimestamp,
  isSkinUnlockedForUser,
  settleCompletedLeaderboardPeriods,
  getUserActiveAllTimeLbSkins,
  getUserAllTimePlacements,
  mergeUserProgressionData,
  openBackgroundCaseForUser,
  saveUserCustomBackgroundMedia,
  checkBanForSignals,
  banPlayerAndAltsAdmin,
  unbanPlayerAdmin,
  isWithinDanishWindow,
  getChatMessages,
  addChatMessage,
  createGlobalAnnouncementAdmin,
  getRecentGlobalAnnouncements,
  createCoinGiveawayAdmin,
  enterCoinGiveaway,
  settleExpiredGiveaways,
  getActiveGiveawaysForClient,
  addFeedbackSubmission,
  getFeedbackSubmissions,
  deleteFeedbackSubmissionAdmin,
  calculateDuelEloUpdate,
  recordDuelMatchResult,
  getPlayerRankedDuelHistory,
  buildDuelRankedLeaderboard,
  buildDuelHighScoreLeaderboard,
  trackUserClientSignals,
  enrichOverviewWithClientSignals,
  findAltAccountsForUser,
  deletePlayerAccountAdmin,
  checkAccountRegistrationAllowance,
  adminSetUserAccountLimit,
  areUsersAltLinked,
  ALL_MODES,
  EXTREME_UNLOCK_REQS,
  hasUnlockedExtremeMode,
  adminSetExtremeAccess
} = require('../services/database');

function parseCookies(req) {
  const cookies = {};
  const rawCookie = (req && req.headers && req.headers.cookie) ? String(req.headers.cookie) : '';
  if (!rawCookie) return cookies;
  rawCookie.split(';').forEach(pair => {
    const eqIdx = pair.indexOf('=');
    if (eqIdx <= 0) return;
    const k = pair.slice(0, eqIdx).trim();
    const v = pair.slice(eqIdx + 1).trim();
    if (!k) return;
    try {
      cookies[k] = decodeURIComponent(v);
    } catch (_) {
      cookies[k] = v;
    }
  });
  return cookies;
}

function buildBanSetCookie(banToken) {
  if (!banToken) return '';
  return `f3d_ban=${encodeURIComponent(banToken)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`;
}

function buildClearBanCookie() {
  return 'f3d_ban=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax';
}

function buildUserAccountSetCookies(req, usernameKey = null, bodyKnown = null, forceIssueUid = false) {
  const cookies = parseCookies(req);
  const hdrs = (req && req.headers) ? req.headers : {};
  const hasConsent = forceIssueUid || cookies.f3d_consent === '1' || cookies.flappy3d_cookie_consent === '1' || hdrs['x-cookie-consent'] === '1';
  const out = [];

  if (hasConsent) {
    let uid = (cookies.f3d_uid && cookies.f3d_uid.length >= 6) ? cookies.f3d_uid.slice(0, 80) : '';
    if (!uid) {
      const hdrDev = String(hdrs['x-device-id'] || '').trim().slice(0, 80);
      uid = hdrDev.length >= 6 ? hdrDev : ('ck_' + crypto.randomBytes(12).toString('hex'));
    }
    out.push(`f3d_uid=${encodeURIComponent(uid)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`);
    out.push('f3d_consent=1; Path=/; Max-Age=31536000; SameSite=Lax');

    const acctSet = [];
    const pushAcct = (n) => {
      const clean = String(n || '').trim().toLowerCase().slice(0, 24);
      if (clean && !acctSet.includes(clean)) acctSet.push(clean);
    };
    if (usernameKey) pushAcct(usernameKey);
    if (cookies.f3d_accts) cookies.f3d_accts.split(',').forEach(pushAcct);
    if (hdrs['x-known-accounts']) String(hdrs['x-known-accounts']).split(',').forEach(pushAcct);
    if (Array.isArray(bodyKnown)) bodyKnown.forEach(pushAcct);
    if (acctSet.length > 0) {
      out.push(`f3d_accts=${encodeURIComponent(acctSet.slice(0, 20).join(','))}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`);
    }
  }
  return out;
}

function extractClientInfo(req) {
  const hdrs = (req && req.headers) ? req.headers : {};
  const cookies = parseCookies(req);
  const rawIp = hdrs['cf-connecting-ip'] || hdrs['x-real-ip'] || hdrs['x-forwarded-for'] || (req && req.socket ? (req.socket.remoteAddress || '') : '');
  const ip = String(Array.isArray(rawIp) ? rawIp[0] : (rawIp || '')).split(',')[0].trim();
  const cookieId = String(cookies.f3d_uid || '').trim().slice(0, 80);
  const cookieAccepted = cookies.f3d_consent === '1' || cookies.flappy3d_cookie_consent === '1' || hdrs['x-cookie-consent'] === '1';
  const hdrDeviceId = String(hdrs['x-device-id'] || '').trim();
  const deviceId = hdrDeviceId || cookieId;
  const fingerprint = String(hdrs['x-device-fingerprint'] || '').trim();
  const banToken = String(hdrs['x-ban-token'] || cookies.f3d_ban || '').trim().slice(0, 100);
  const knownSet = new Set();
  const addKnown = (val) => {
    const clean = String(val || '').trim();
    if (clean) knownSet.add(clean);
  };
  if (hdrs['x-known-accounts']) String(hdrs['x-known-accounts']).split(',').forEach(addKnown);
  if (cookies.f3d_accts) String(cookies.f3d_accts).split(',').forEach(addKnown);
  const knownAccounts = Array.from(knownSet).slice(0, 20);
  return { ip, deviceId, cookieId, cookieAccepted, fingerprint, banToken, knownAccounts };
}

const IS_CF_WORKER = Boolean(
  typeof globalThis !== 'undefined' &&
  (globalThis.__FLAPPY_CF_WORKER__ || (typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers'))
);

let BIRD_SKINS_LIST = [];
try {
  const skinsModule = require('../../public/js/skins-data.js');
  BIRD_SKINS_LIST = skinsModule.BIRD_SKINS || [];
} catch (_) {}

function getSkinEmoji(skinId) {
  if (!skinId || skinId === 'classic') return '🐤';
  const found = BIRD_SKINS_LIST.find(s => s && s.id === skinId);
  return (found && found.emoji) ? found.emoji : '🐤';
}

// In-memory active single-use game runs + HMAC-SHA256 stateless token resilience across server restarts
const activeRuns = new Map(); // runId -> { runId, rid, seed, difficulty, usernameKey, startedAt }
const usedRunTokens = new Map(); // rid -> { exp, uKey, replayHash, payload }

function getRunTokenSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
    return process.env.SESSION_SECRET;
  }
  const db = getDb();
  if (!db.adminSettings || typeof db.adminSettings !== 'object') {
    db.adminSettings = {};
  }
  if (!db.adminSettings.runTokenSecret || typeof db.adminSettings.runTokenSecret !== 'string') {
    db.adminSettings.runTokenSecret = crypto.randomBytes(32).toString('hex');
    saveDatabase(false, { skipOverviewSync: true, keepLeaderboardCache: true });
  }
  return db.adminSettings.runTokenSecret;
}

function issueSignedRunToken({ usernameKey, difficulty, seed, startedAt = Date.now() }) {
  const rid = crypto.randomBytes(12).toString('hex');
  const payloadObj = {
    rid,
    u: String(usernameKey || '').toLowerCase(),
    d: difficulty,
    s: seed,
    t: startedAt
  };
  const payloadB64 = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getRunTokenSecret()).update(payloadB64).digest('base64url');
  const runId = `rt_${payloadB64}.${sig}`;
  const runObj = {
    runId,
    rid,
    seed,
    difficulty,
    usernameKey: payloadObj.u,
    startedAt
  };
  if (activeRuns.size > 2000) {
    for (const [oldId, oldRun] of activeRuns.entries()) {
      if (startedAt - (oldRun.startedAt || 0) > 45 * 60 * 1000) {
        activeRuns.delete(oldId);
      }
    }
  }
  activeRuns.set(runId, runObj);
  return runObj;
}

function resolveRunTokenForFinish(runId, authUsernameKey, replayHash = '') {
  if (!runId || typeof runId !== 'string') {
    return { errorStatus: 400, error: 'Anti-Cheat Rejection: Invalid or expired run token. Scores cannot be submitted manually from the console.' };
  }
  const now = Date.now();
  if (usedRunTokens.size > 5000) {
    for (const [oldRid, meta] of usedRunTokens.entries()) {
      if (!meta || now > (meta.exp || 0)) usedRunTokens.delete(oldRid);
    }
  }

  let runObj = activeRuns.get(runId) || null;
  let rid = runObj ? runObj.rid : '';

  if (!runObj && runId.startsWith('rt_')) {
    const dotIdx = runId.indexOf('.');
    if (dotIdx > 3) {
      const payloadB64 = runId.slice(3, dotIdx);
      const sigProvided = runId.slice(dotIdx + 1);
      const sigExpected = crypto.createHmac('sha256', getRunTokenSecret()).update(payloadB64).digest('base64url');
      const bufA = Buffer.from(sigProvided, 'utf8');
      const bufB = Buffer.from(sigExpected, 'utf8');
      if (bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)) {
        try {
          const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
          if (parsed && parsed.rid && typeof parsed.s === 'number' && parsed.d && parsed.u && typeof parsed.t === 'number') {
            if (now - parsed.t <= 6 * 3600 * 1000) {
              rid = String(parsed.rid);
              runObj = {
                runId,
                rid,
                seed: parsed.s,
                difficulty: parsed.d,
                usernameKey: String(parsed.u).toLowerCase(),
                startedAt: parsed.t
              };
            }
          }
        } catch (_) {}
      }
    }
  }

  if (rid && usedRunTokens.has(rid)) {
    const used = usedRunTokens.get(rid);
    if (used && used.uKey === authUsernameKey && used.replayHash && used.replayHash === replayHash && used.payload) {
      return { idempotentPayload: used.payload };
    }
    return { errorStatus: 400, error: 'Anti-Cheat Rejection: Run token already redeemed.' };
  }

  if (!runObj) {
    return { errorStatus: 400, error: 'Anti-Cheat Rejection: Invalid or expired run token. Scores cannot be submitted manually from the console.' };
  }
  if (runObj.usernameKey !== authUsernameKey) {
    return { errorStatus: 403, error: 'Anti-Cheat Rejection: Run token belongs to a different player.' };
  }

  return { run: runObj, rid: rid || runId };
}

function markRunTokenUsed(rid, uKey, replayHash, payload) {
  if (!rid) return;
  // Retain full idempotency payload for only recent <= 250 runs to stay tiny in RAM
  if (usedRunTokens.size >= 250) {
    let trimmed = 0;
    for (const [k, v] of usedRunTokens.entries()) {
      if (v && v.payload) {
        v.payload = null;
        if (++trimmed >= 80) break;
      }
    }
  }
  usedRunTokens.set(rid, {
    exp: Date.now() + 6 * 3600 * 1000,
    uKey,
    replayHash,
    payload
  });
}

// 3-second cooldown tracker per user/sender
const chatCooldowns = new Map(); // key -> lastSentTimestamp

// ============================================================================
// RANKED DUELS LOBBY & 4-ROUND MATCH ENGINE (Easy 1x -> Medium 2x -> Hard 3x -> Extreme 10x)
// ============================================================================
const duelLobbies = new Map(); // lobbyId -> lobbyObj
const DUEL_ROUNDS = ['easy', 'medium', 'hard', 'extreme'];
const DUEL_MULTIPLIERS = { easy: 1, medium: 2, hard: 3, extreme: 10 };
const DUEL_ROUND_LABELS = { easy: 'Easy', medium: 'Medium', hard: 'Hard', extreme: 'Extreme' };

function recomputeDuelPlayerPoints(p) {
  if (!p || !p.rounds) return 0;
  if (!p.rounds.extreme) {
    p.rounds.extreme = { rawScore: 0, weightedScore: 0, multiplier: 10, finished: false };
  }
  p.rounds.easy.weightedScore = Math.max(0, Math.floor(Number(p.rounds.easy.rawScore) || 0)) * 1;
  p.rounds.medium.weightedScore = Math.max(0, Math.floor(Number(p.rounds.medium.rawScore) || 0)) * 2;
  p.rounds.hard.weightedScore = Math.max(0, Math.floor(Number(p.rounds.hard.rawScore) || 0)) * 3;
  p.rounds.extreme.weightedScore = Math.max(0, Math.floor(Number(p.rounds.extreme.rawScore) || 0)) * 10;
  p.totalPoints =
    p.rounds.easy.weightedScore +
    p.rounds.medium.weightedScore +
    p.rounds.hard.weightedScore +
    p.rounds.extreme.weightedScore;
  return p.totalPoints;
}

function createDuelPlayerSlot(identity, slotId, clientInfo = null) {
  const now = Date.now();
  return {
    slotId: String(slotId || identity.clientId || identity.usernameKey || crypto.randomBytes(6).toString('hex')),
    username: identity.username,
    usernameKey: identity.usernameKey,
    elo: typeof identity.duelElo === 'number' ? identity.duelElo : 1000,
    selectedSkin: identity.selectedSkin || 'classic',
    selectedPipeSkin: identity.selectedPipeSkin || 'classic_pipe',
    avatarSkinId: identity.avatarSkinId || identity.selectedSkin || 'classic',
    clientSignals: clientInfo ? {
      cookieId: String(clientInfo.cookieId || ''),
      deviceId: String(clientInfo.deviceId || ''),
      knownAccounts: Array.isArray(clientInfo.knownAccounts) ? clientInfo.knownAccounts.slice(0, 20) : []
    } : null,
    lastHeartbeat: now,
    rounds: {
      easy: { rawScore: 0, weightedScore: 0, multiplier: 1, finished: false },
      medium: { rawScore: 0, weightedScore: 0, multiplier: 2, finished: false },
      hard: { rawScore: 0, weightedScore: 0, multiplier: 3, finished: false },
      extreme: { rawScore: 0, weightedScore: 0, multiplier: 10, finished: false }
    },
    totalPoints: 0,
    live: {
      birdY: SIM_CONFIG.birdStartY || 5.5,
      birdVelocityY: 0,
      rotZ: 0,
      score: 0,
      alive: true,
      pipes: [],
      updatedAt: now
    }
  };
}

function startDuelCountdownForRound(lobby, roundIndex, startTimestamp = null) {
  const now = Date.now();
  const baseStart = (typeof startTimestamp === 'number' && startTimestamp > 0 && (now - startTimestamp < 10000))
    ? startTimestamp
    : now;
  const rKey = DUEL_ROUNDS[roundIndex] || 'easy';
  lobby.currentRoundIndex = roundIndex;
  lobby.currentRound = rKey;
  lobby.currentRoundNumber = roundIndex + 1;
  lobby.currentMultiplier = DUEL_MULTIPLIERS[rKey] || 1;
  lobby.status = 'countdown';
  lobby.countdownStartedAt = baseStart;
  lobby.countdownEndsAt = baseStart + 3000; // 3-second countdown
  lobby.roundSeed = crypto.randomInt(1, 0x7fffffff);

  for (const p of lobby.players) {
    if (!p.rounds[rKey]) {
      p.rounds[rKey] = { rawScore: 0, weightedScore: 0, multiplier: DUEL_MULTIPLIERS[rKey] || 1, finished: false };
    }
    p.rounds[rKey].rawScore = 0;
    p.rounds[rKey].weightedScore = 0;
    p.rounds[rKey].finished = false;
    p.live.birdY = SIM_CONFIG.birdStartY || 5.5;
    p.live.birdVelocityY = 0;
    p.live.rotZ = 0;
    p.live.score = 0;
    p.live.alive = true;
    p.live.pipes = [];
    p.live.speed = 0;
    p.live.updatedAt = now;
    p.botSim = null;
    p.lastHeartbeat = now;
    recomputeDuelPlayerPoints(p);
  }
}

function finalizeDuelLobbyMatch(lobby, options = {}) {
  if (!lobby || (lobby.status === 'finished' && lobby.result)) return;
  const now = Date.now();
  lobby.status = 'finished';
  lobby.finishedAt = now;

  const p1 = lobby.players[0];
  const p2 = lobby.players[1];
  if (!p1 || !p2) return;

  recomputeDuelPlayerPoints(p1);
  recomputeDuelPlayerPoints(p2);

  const forfeitWinner = options.forfeitWinner || null;
  const forcedWinner = forfeitWinner === p1 ? 'a' : (forfeitWinner === p2 ? 'b' : null);
  const isForfeit = Boolean(forcedWinner);
  const forfeiter = forcedWinner === 'a' ? p2 : (forcedWinner === 'b' ? p1 : null);

  let eloRes;
  if (lobby.isFriendly) {
    eloRes = {
      oldEloA: p1.elo || 1000,
      newEloA: p1.elo || 1000,
      deltaA: 0,
      coinsEarnedA: 0,
      oldEloB: p2.elo || 1000,
      newEloB: p2.elo || 1000,
      deltaB: 0,
      coinsEarnedB: 0
    };
  } else if (p1.usernameKey !== p2.usernameKey) {
    eloRes = recordDuelMatchResult(p1.username, p2.username, p1.totalPoints, p2.totalPoints, {
      roundsA: p1.rounds,
      roundsB: p2.rounds,
      isFriendly: Boolean(lobby.isFriendly),
      forcedWinner,
      forfeit: isForfeit
    });
  } else {
    eloRes = calculateDuelEloUpdate(p1.elo, p2.elo, p1.totalPoints, p2.totalPoints, { forcedWinner });
  }

  let winnerSlotId = null;
  let winnerUsername = null;
  let isDraw = false;
  if (forcedWinner === 'a' || (!forcedWinner && p1.totalPoints > p2.totalPoints)) {
    winnerSlotId = p1.slotId;
    winnerUsername = p1.username;
  } else if (forcedWinner === 'b' || (!forcedWinner && p2.totalPoints > p1.totalPoints)) {
    winnerSlotId = p2.slotId;
    winnerUsername = p2.username;
  } else {
    isDraw = true;
  }

  p1.oldElo = eloRes.oldEloA;
  p1.newElo = eloRes.newEloA;
  p1.eloDelta = eloRes.deltaA;
  p1.elo = eloRes.newEloA;
  p1.coinsEarned = eloRes.coinsEarnedA || 0;

  p2.oldElo = eloRes.oldEloB;
  p2.newElo = eloRes.newEloB;
  p2.eloDelta = eloRes.deltaB;
  p2.elo = eloRes.newEloB;
  p2.coinsEarned = eloRes.coinsEarnedB || 0;

  lobby.result = {
    winnerSlotId,
    winnerUsername,
    isDraw,
    forfeit: isForfeit,
    forfeitedUsername: forfeiter ? forfeiter.username : null,
    forfeitReason: isForfeit ? (options.reason || 'Closed Tab / Disconnected') : null,
    isFriendly: Boolean(lobby.isFriendly),
    finishedAt: now,
    p1: {
      slotId: p1.slotId,
      username: p1.username,
      oldElo: eloRes.oldEloA,
      newElo: eloRes.newEloA,
      eloDelta: eloRes.deltaA,
      coinsEarned: p1.coinsEarned,
      totalPoints: p1.totalPoints,
      rounds: p1.rounds
    },
    p2: {
      slotId: p2.slotId,
      username: p2.username,
      oldElo: eloRes.oldEloB,
      newElo: eloRes.newEloB,
      eloDelta: eloRes.deltaB,
      coinsEarned: p2.coinsEarned,
      totalPoints: p2.totalPoints,
      rounds: p2.rounds
    }
  };
}

function stepDuelBotSimulation(bot, lobby, rKey, now, humanFinishedForMs) {
  const defaultTarget = rKey === 'extreme' ? 2 : 8;
  const targetScore = (bot.botTargets && typeof bot.botTargets[rKey] === 'number') ? bot.botTargets[rKey] : defaultTarget;
  const dt = SIM_CONFIG.dt;

  if (!bot.botSim || bot.botSim.roundKey !== rKey || bot.botSim.roundSeed !== lobby.roundSeed) {
    const prng = createSeededPRNG((lobby.roundSeed || 12345) ^ ((bot.botPhase ? Math.floor(bot.botPhase * 1000) : 0)));
    const extremeSolver = rKey === 'extreme' ? createExtremePipeSolver(lobby.roundSeed || 12345, SIM_CONFIG) : null;
    const initDiff = getDifficultyParams(0, rKey);
    const spawnPipe = (xPos, gapSize) => {
      let gapCenterY;
      let actualGap = gapSize;
      if (extremeSolver) {
        const solved = extremeSolver.nextPipe();
        actualGap = solved.gapSize;
        gapCenterY = solved.gapCenterY;
      } else {
        const minCenterY = 2.9 + actualGap * 0.5;
        const maxCenterY = SIM_CONFIG.ceilingY - 2.6 - actualGap * 0.5;
        gapCenterY = minCenterY + prng() * Math.max(0.5, maxCenterY - minCenterY);
      }
      return {
        x: xPos,
        bottomTopY: gapCenterY - actualGap * 0.5,
        topBottomY: gapCenterY + actualGap * 0.5,
        gapCenterY,
        gapSize: actualGap,
        passed: false
      };
    };

    const initialPipes = [];
    if (rKey === 'extreme') {
      const extCfg = SIM_CONFIG.difficulties.extreme;
      const firstX = SIM_CONFIG.birdX + extCfg.firstPipeDist;
      for (let pIdx = 0; pIdx < 4; pIdx++) {
        initialPipes.push(spawnPipe(firstX + pIdx * extCfg.spawnDistance, initDiff.pipeGap));
      }
    } else {
      const firstNormalX = SIM_CONFIG.birdX + SIM_CONFIG.baseSpawnDistance;
      initialPipes.push(
        spawnPipe(firstNormalX, initDiff.pipeGap),
        spawnPipe(firstNormalX + SIM_CONFIG.baseSpawnDistance, initDiff.pipeGap),
        spawnPipe(firstNormalX + SIM_CONFIG.baseSpawnDistance * 2, initDiff.pipeGap)
      );
    }

    bot.botSim = {
      roundKey: rKey,
      roundSeed: lobby.roundSeed,
      ticksSimulated: 0,
      birdY: SIM_CONFIG.birdStartY,
      birdVelocityY: initDiff.flapImpulse,
      score: 0,
      flapCooldownTicks: 0,
      prng,
      extremeSolver,
      spawnPipe,
      pipes: initialPipes
    };
  }

  const sim = bot.botSim;
  const targetTicks = Math.max(0, Math.floor((now - (lobby.roundStartedAt || now)) / (1000 / SIM_CONFIG.tickRate)));
  const ticksToRun = Math.min(240, Math.max(0, targetTicks - sim.ticksSimulated));

  let diff = getDifficultyParams(sim.score, rKey);
  let crashed = false;

  for (let t = 0; t < ticksToRun; t++) {
    sim.ticksSimulated++;
    diff = getDifficultyParams(sim.score, rKey);

    // Find next pipe ahead of bird
    const nextPipe = sim.pipes.find(p => p.x + SIM_CONFIG.pipeCapRadius >= SIM_CONFIG.birdX - SIM_CONFIG.birdRadius);
    const shouldThrow = sim.score >= targetScore || humanFinishedForMs > 2000;

    if (sim.flapCooldownTicks > 0) sim.flapCooldownTicks--;

    if (!shouldThrow) {
      const aimY = nextPipe ? (nextPipe.gapCenterY - (rKey === 'extreme' ? 0.05 : 0.15)) : SIM_CONFIG.birdStartY;
      const trigOffset = rKey === 'extreme' ? 0.12 : 0.25;
      if (sim.birdY < aimY - trigOffset && sim.birdVelocityY <= (rKey === 'extreme' ? 0.4 : 0.8) && sim.flapCooldownTicks === 0) {
        sim.birdVelocityY = diff.flapImpulse;
        sim.flapCooldownTicks = rKey === 'extreme' ? 2 : 6;
      }
    } else {
      // Stop flapping so the bot naturally falls and crashes
      if (sim.birdY - SIM_CONFIG.birdRadius <= SIM_CONFIG.groundY + 0.05) {
        crashed = true;
        break;
      }
    }

    sim.birdVelocityY = Math.max(diff.maxFallSpeed, sim.birdVelocityY + diff.gravity * dt);
    sim.birdY += sim.birdVelocityY * dt;
    if (sim.birdY > SIM_CONFIG.ceilingY) {
      sim.birdY = SIM_CONFIG.ceilingY;
      sim.birdVelocityY = Math.min(0, sim.birdVelocityY);
    }
    if (sim.birdY - SIM_CONFIG.birdRadius <= SIM_CONFIG.groundY) {
      sim.birdY = SIM_CONFIG.groundY + SIM_CONFIG.birdRadius;
      crashed = true;
      break;
    }

    // Move pipes & check collision
    const bx = SIM_CONFIG.birdX;
    const by = sim.birdY;

    for (let i = sim.pipes.length - 1; i >= 0; i--) {
      const pipe = sim.pipes[i];
      pipe.x -= diff.speed * dt;
      if (!pipe.passed && pipe.x < bx) {
        pipe.passed = true;
        sim.score++;
      }
      if (collidesExtremePipe(by, pipe.x, pipe, SIM_CONFIG)) {
        if (shouldThrow) {
          crashed = true;
          break;
        }
      }
      if (pipe.x < SIM_CONFIG.pipeDespawnX) {
        sim.pipes.splice(i, 1);
      }
    }
    if (crashed) break;

    const activeSpawnDist = rKey === 'extreme'
      ? (diff.spawnDistance || SIM_CONFIG.difficulties.extreme.spawnDistance)
      : SIM_CONFIG.baseSpawnDistance;
    const spawnTriggerX = (rKey === 'extreme'
      ? SIM_CONFIG.difficulties.extreme.initialPipeSpawnX
      : SIM_CONFIG.pipeSpawnX) - activeSpawnDist;
    while (sim.pipes.length === 0 || sim.pipes[sim.pipes.length - 1].x <= spawnTriggerX + 1e-9) {
      const nextX = sim.pipes.length > 0
        ? (sim.pipes[sim.pipes.length - 1].x + activeSpawnDist)
        : (rKey === 'extreme' ? SIM_CONFIG.difficulties.extreme.initialPipeSpawnX : SIM_CONFIG.pipeSpawnX);
      sim.pipes.push(sim.spawnPipe(nextX, diff.pipeGap));
    }
  }

  if (crashed || (humanFinishedForMs > 2000 && sim.score >= targetScore)) {
    const finalBotRaw = Math.min(targetScore, sim.score);
    bot.rounds[rKey].rawScore = finalBotRaw;
    bot.rounds[rKey].finished = true;
    bot.roundFinishedAt = now;
    bot.live.score = finalBotRaw;
    bot.live.alive = false;
    bot.live.birdY = Number(sim.birdY.toFixed(2));
    bot.live.birdVelocityY = Number(sim.birdVelocityY.toFixed(2));
    bot.live.speed = Number(diff.speed.toFixed(2));
    const simTimestamp = Math.round((lobby.roundStartedAt || now) + sim.ticksSimulated * (1000 / SIM_CONFIG.tickRate));
  bot.live.updatedAt = simTimestamp;
    recomputeDuelPlayerPoints(bot);
    return;
  }

  bot.rounds[rKey].rawScore = Math.min(targetScore, sim.score);
  bot.live.score = bot.rounds[rKey].rawScore;
  bot.live.alive = true;
  bot.live.birdY = Number(sim.birdY.toFixed(2));
  bot.live.birdVelocityY = Number(sim.birdVelocityY.toFixed(2));
  bot.live.rotZ = Number(Math.max(-Math.PI * 0.42, Math.min(Math.PI * 0.24, (sim.birdVelocityY / (diff.speedRatio || 1)) * 0.065)).toFixed(2));
  bot.live.speed = Number(diff.speed.toFixed(2));
  bot.live.pipes = sim.pipes.slice(0, 4).map(pp => ({
    x: Number(pp.x.toFixed(2)),
    bottomTopY: Number(pp.bottomTopY.toFixed(2)),
    topBottomY: Number(pp.topBottomY.toFixed(2)),
    gapCenterY: Number(pp.gapCenterY.toFixed(2)),
    gapSize: Number(pp.gapSize.toFixed(2))
  }));
  const simTimestamp = Math.round((lobby.roundStartedAt || now) + sim.ticksSimulated * (1000 / SIM_CONFIG.tickRate));
  bot.live.updatedAt = simTimestamp;
  recomputeDuelPlayerPoints(bot);
}

function forfeitDuelPlayer(lobby, leaver, reason = 'Closed Tab / Disconnected') {
  if (!lobby || !leaver || lobby.status === 'waiting' || lobby.status === 'finished') return false;
  const winner = (lobby.players || []).find(p => p && p !== leaver) || null;
  leaver.leftMatch = true;
  leaver.forfeited = true;
  if (leaver.live) leaver.live.alive = false;
  for (const rk of DUEL_ROUNDS) {
    if (leaver.rounds && leaver.rounds[rk]) leaver.rounds[rk].finished = true;
    if (winner && winner.rounds && winner.rounds[rk]) winner.rounds[rk].finished = true;
  }
  if (winner) {
    finalizeDuelLobbyMatch(lobby, { forfeitWinner: winner, reason });
    logDatabaseEvent(
      'DUEL_FORFEIT',
      leaver.username,
      `🏳️ ${leaver.username} forfeited Ranked Duel (${reason}) — ${winner.username} awarded victory`,
      { lobbyId: lobby.id, leaver: leaver.username, winner: winner.username, reason }
    );
    saveDatabase(false);
    return true;
  }
  return false;
}

function advanceDuelLobbyClock(lobby) {
  if (!lobby) return;
  const now = Date.now();

  if (lobby.spectators && lobby.spectators instanceof Map) {
    for (const [specId, spec] of lobby.spectators.entries()) {
      if (now - spec.lastSeen > 15000) {
        lobby.spectators.delete(specId);
      }
    }
  }

  // Detect tab-close / silent disconnect forfeit during active countdown, playing, or round summary
  if (lobby.status === 'countdown' || lobby.status === 'playing' || lobby.status === 'round_summary') {
    if (!lobby.matchStartedAt) lobby.matchStartedAt = lobby.countdownStartedAt || now;
    const p1 = lobby.players[0];
    const p2 = lobby.players[1];
    if (p1 && p2 && (now - lobby.matchStartedAt > 15000)) {
      const p1Silent = !p1.isBot && (now - (p1.lastHeartbeat || lobby.createdAt || now) > 15000);
      const p2Silent = !p2.isBot && (now - (p2.lastHeartbeat || lobby.createdAt || now) > 15000);
      if (p1Silent && !p2Silent) {
        forfeitDuelPlayer(lobby, p1, 'Disconnected Mid-Match');
        return;
      }
      if (p2Silent && !p1Silent) {
        forfeitDuelPlayer(lobby, p2, 'Disconnected Mid-Match');
        return;
      }
    }
  }

  if (lobby.status === 'round_summary') {
    if (now >= lobby.summaryEndsAt) {
      const nextRoundIdx = (Number(lobby.currentRoundIndex) || 0) + 1;
      if (nextRoundIdx < DUEL_ROUNDS.length) {
        startDuelCountdownForRound(lobby, nextRoundIdx, lobby.summaryEndsAt);
      } else {
        finalizeDuelLobbyMatch(lobby);
      }
    }
  }

  if (lobby.status === 'countdown') {
    if (now >= lobby.countdownEndsAt) {
      lobby.status = 'playing';
      lobby.roundStartedAt = lobby.countdownEndsAt || now;
      for (const p of lobby.players) {
        p.live.alive = true;
        p.live.score = 0;
        p.live.birdY = SIM_CONFIG.birdStartY || 5.5;
        p.live.updatedAt = now;
      }
    }
  }

  if (lobby.status === 'playing') {
    const rKey = lobby.currentRound || 'easy';
    const p1 = lobby.players[0];
    const p2 = lobby.players[1];

    // Simulate AI Bots in real-time using deterministic 60Hz Flappy Bird physics
    for (let idx = 0; idx < lobby.players.length; idx++) {
      const bot = lobby.players[idx];
      if (!bot || !bot.isBot || bot.rounds[rKey].finished) continue;
      bot.lastHeartbeat = now;
      const other = lobby.players[idx === 0 ? 1 : 0];
      const humanFinishedForMs = (other && !other.isBot && other.rounds[rKey].finished && other.roundFinishedAt)
        ? (now - other.roundFinishedAt)
        : 0;
      stepDuelBotSimulation(bot, lobby, rKey, now, humanFinishedForMs);
    }

    if (p1 && p2) {
      // Auto-complete stalled player if one player finished and the other hasn't sent a heartbeat for 15s,
      // OR if a human player has stopped sending heartbeats for > 45s in the middle of a round
      if (p1.rounds[rKey].finished && !p2.rounds[rKey].finished && (!p2.isBot && (now - p2.lastHeartbeat > 15000))) {
        p2.rounds[rKey].finished = true;
        p2.live.alive = false;
        recomputeDuelPlayerPoints(p2);
      } else if (p2.rounds[rKey].finished && !p1.rounds[rKey].finished && (!p1.isBot && (now - p1.lastHeartbeat > 15000))) {
        p1.rounds[rKey].finished = true;
        p1.live.alive = false;
        recomputeDuelPlayerPoints(p1);
      } else if (!p2.isBot && !p2.rounds[rKey].finished && (now - p2.lastHeartbeat > 45000)) {
        p2.rounds[rKey].finished = true;
        p2.live.alive = false;
        recomputeDuelPlayerPoints(p2);
      } else if (!p1.isBot && !p1.rounds[rKey].finished && (now - p1.lastHeartbeat > 45000)) {
        p1.rounds[rKey].finished = true;
        p1.live.alive = false;
        recomputeDuelPlayerPoints(p1);
      }

      if (p1.rounds[rKey].finished && p2.rounds[rKey].finished) {
        lobby.status = 'round_summary';
        lobby.summaryStartedAt = now;
        lobby.summaryEndsAt = now + 3500;
      }
    }
  }
}

const DUEL_BOT_PROFILES = [
  { name: '🤖 RoboFlap_AI', skin: 'cyber', pipe: 'neon_pipe' },
  { name: '🤖 CyberTalon_X', skin: 'dragon', pipe: 'obsidian_pipe' },
  { name: '🤖 MechaWing_9000', skin: 'phoenix', pipe: 'magma_pipe' },
  { name: '🤖 SkyDroid_Pro', skin: 'galaxy', pipe: 'crystal_pipe' },
  { name: '🤖 QuantumBeak', skin: 'gold', pipe: 'royal_pipe' },
  { name: '🤖 HyperFlap_Bot', skin: 'emerald', pipe: 'jade_pipe' }
];

function createDuelBotSlot(referenceElo = 1000) {
  const profile = DUEL_BOT_PROFILES[Math.floor(Math.random() * DUEL_BOT_PROFILES.length)];
  const botElo = Math.max(400, Math.round((Number(referenceElo) || 1000) + (Math.random() * 160 - 80)));
  const botId = 'bot_' + crypto.randomBytes(5).toString('hex');
  const slot = createDuelPlayerSlot({
    clientId: botId,
    username: profile.name,
    usernameKey: botId,
    duelElo: botElo,
    selectedSkin: profile.skin,
    selectedPipeSkin: profile.pipe,
    avatarSkinId: profile.skin
  }, botId);
  slot.isBot = true;
  slot.botPhase = Math.random() * Math.PI * 2;
  slot.botTargets = {
    easy: Math.floor(6 + Math.random() * 11),
    medium: Math.floor(4 + Math.random() * 8),
    hard: Math.floor(2 + Math.random() * 6),
    extreme: Math.floor(1 + Math.random() * 3)
  };
  return slot;
}

function serializeDuelLobby(lobby, includeLivePipes = false) {
  if (!lobby) return null;
  advanceDuelLobbyClock(lobby);
  const now = Date.now();
  const countdownRemainingMs = lobby.status === 'countdown'
    ? Math.max(0, (lobby.countdownEndsAt || now) - now)
    : 0;
  const summaryRemainingMs = lobby.status === 'round_summary'
    ? Math.max(0, (lobby.summaryEndsAt || now) - now)
    : 0;

  return {
    id: lobby.id,
    name: lobby.name,
    isFriendly: Boolean(lobby.isFriendly),
    hasPassword: Boolean(lobby.isFriendly && lobby.password),
    status: lobby.status,
    createdAt: lobby.createdAt,
    currentRound: lobby.currentRound || 'easy',
    currentRoundIndex: lobby.currentRoundIndex || 0,
    currentRoundNumber: (lobby.currentRoundIndex || 0) + 1,
    totalRounds: DUEL_ROUNDS.length,
    currentRoundLabel: DUEL_ROUND_LABELS[lobby.currentRound || 'easy'] || 'Easy',
    currentMultiplier: lobby.currentMultiplier || 1,
    roundSeed: lobby.roundSeed || 12345,
    countdownRemainingMs,
    summaryRemainingMs,
    spectatorCount: lobby.spectators ? lobby.spectators.size : 0,
    players: (lobby.players || []).map(p => ({
      slotId: p.slotId,
      username: p.username,
      usernameKey: p.usernameKey,
      isBot: Boolean(p.isBot),
      elo: p.elo,
      oldElo: p.oldElo,
      newElo: p.newElo,
      eloDelta: p.eloDelta,
      selectedSkin: p.selectedSkin || 'classic',
      selectedPipeSkin: p.selectedPipeSkin || 'classic_pipe',
      avatarSkinId: p.avatarSkinId || p.selectedSkin || 'classic',
      totalPoints: p.totalPoints || 0,
      rounds: p.rounds,
      live: {
        birdY: p.live.birdY,
        birdVelocityY: p.live.birdVelocityY,
        rotZ: p.live.rotZ,
        score: p.live.score,
        alive: p.live.alive,
        speed: p.live.speed || 0,
        pipes: includeLivePipes ? (p.live.pipes || []) : [],
        updatedAt: p.live.updatedAt
      }
    })),
    result: lobby.result || null
  };
}

const DUEL_MAX_LIFETIME_MS = 15 * 60 * 1000; // Remove any ongoing/waiting duel lobby after 15 minutes
const DUEL_WAITING_STALE_MS = 2 * 60 * 1000; // 2 minutes if a waiting human host stopped polling
const DUEL_ALL_HUMANS_STALE_MS = 90 * 1000;  // 90s if every human player disconnected mid-match

function shouldPruneDuelLobby(lobby, now = Date.now()) {
  if (!lobby) return true;
  if (lobby.status === 'finished') {
    if (now - (lobby.finishedAt || lobby.createdAt || now) > 25000) return true;
    const humans = (lobby.players || []).filter(p => p && !p.isBot);
    if (humans.length === 0 || humans.every(h => h.leftMatch)) return true;
    return false;
  }
  const ageMs = now - (lobby.createdAt || now);
  if (ageMs >= DUEL_MAX_LIFETIME_MS) {
    return true;
  }
  if (lobby.status === 'waiting') {
    const host = lobby.players && lobby.players[0];
    if (!host) return true;
    if (!host.isBot && (now - (host.lastHeartbeat || lobby.createdAt || now) > DUEL_WAITING_STALE_MS)) {
      return true;
    }
    return false;
  }
  const humans = (lobby.players || []).filter(p => p && !p.isBot);
  if (humans.length === 0 || humans.every(h => h.leftMatch)) {
    return true;
  }
  if (humans.every(h => (now - (h.lastHeartbeat || lobby.createdAt || now)) > DUEL_ALL_HUMANS_STALE_MS)) {
    return true;
  }
  return false;
}

function getPublicDuelLobbiesList() {
  const now = Date.now();
  const list = [];
  for (const [id, lobby] of duelLobbies.entries()) {
    advanceDuelLobbyClock(lobby);
    if (shouldPruneDuelLobby(lobby, now)) {
      duelLobbies.delete(id);
      continue;
    }
    if (lobby.status === 'finished') {
      continue;
    }
    list.push(serializeDuelLobby(lobby, false));
  }
  // Sort: waiting lobbies first (oldest first), then ongoing lobbies (oldest first)
  list.sort((a, b) => {
    const aWait = a.status === 'waiting' ? 0 : 1;
    const bWait = b.status === 'waiting' ? 0 : 1;
    if (aWait !== bWait) return aWait - bWait;
    return a.createdAt - b.createdAt;
  });
  return list;
}

// Periodic background clock advancement & cleanup (wrapped in try/catch so a single duel edge case NEVER crashes the server)
function runBackgroundCleanupTick() {
  try {
    const now = Date.now();
    for (const [runId, run] of activeRuns.entries()) {
      if (now - run.startedAt > 45 * 60 * 1000) {
        activeRuns.delete(runId);
      }
    }
    for (const [lobbyId, lobby] of duelLobbies.entries()) {
      try {
        advanceDuelLobbyClock(lobby);
        if (shouldPruneDuelLobby(lobby, now)) {
          duelLobbies.delete(lobbyId);
        }
      } catch (lobbyErr) {
        console.error('Duel lobby tick error (isolated):', lobbyErr && lobbyErr.message ? lobbyErr.message : lobbyErr);
      }
    }
  } catch (err) {
    console.error('Background cleanup tick error:', err && err.message ? err.message : err);
  }
}

if (!IS_CF_WORKER) {
  const bgCleanupTimer = setInterval(runBackgroundCleanupTick, 250);
  if (typeof bgCleanupTimer.unref === 'function') bgCleanupTimer.unref();
}

function detachPlayerFromFinishedLobbies(caller) {
  if (!caller) return;
  const now = Date.now();
  for (const [lid, lobby] of duelLobbies.entries()) {
    if (!lobby || lobby.status !== 'finished') continue;
    let touched = false;
    for (const p of (lobby.players || [])) {
      if (p && (p.slotId === caller.clientId || (caller.usernameKey && p.usernameKey === caller.usernameKey))) {
        p.leftMatch = true;
        touched = true;
      }
    }
    if (touched && shouldPruneDuelLobby(lobby, now)) {
      duelLobbies.delete(lid);
    }
  }
}

function sendJSON(res, statusCode, payload, setCookies = null, opts = null) {
  if (!res || res.headersSent || res.writableEnded || res.destroyed) return;
  const body = JSON.stringify(payload);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  };
  if (Array.isArray(setCookies) && setCookies.length > 0) {
    headers['Set-Cookie'] = setCookies;
  }
  const allowGzip = !(opts && opts.noGzip);
  if (allowGzip && res._acceptGzip && body.length > 1536) {
    zlib.gzip(body, { level: 5 }, (gzErr, gzBuf) => {
      if (!res || res.headersSent || res.writableEnded || res.destroyed) return;
      try {
        if (!gzErr && gzBuf) {
          headers['Content-Encoding'] = 'gzip';
          headers['Vary'] = 'Accept-Encoding';
          res.writeHead(statusCode, headers);
          res.end(gzBuf);
          return;
        }
        res.writeHead(statusCode, headers);
        res.end(body);
      } catch (_) {}
    });
    return;
  }
  try {
    res.writeHead(statusCode, headers);
    res.end(body);
  } catch (_) {}
}

function readJsonBody(req, maxBytes = 512 * 1024) {
  if (req && typeof req._rawBody === 'string') {
    const raw = req._rawBody;
    if (raw.length > maxBytes) {
      return Promise.reject(new Error('Payload too large'));
    }
    if (!raw) return Promise.resolve({});
    try {
      return Promise.resolve(JSON.parse(raw));
    } catch (e) {
      return Promise.reject(new Error('Invalid JSON payload'));
    }
  }
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > maxBytes) {
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

function getPermanentMeDonutToken(db) {
  const meDonut = db && db.users && db.users['medonut'];
  if (!meDonut) return '';
  return crypto
    .createHmac('sha256', meDonut.salt || 'medonut_salt')
    .update(meDonut.passwordHash || 'medonut_hash')
    .digest('hex')
    .slice(0, 48);
}

function getSessionUserEvenIfBanned(req) {
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
  if (!db.sessions) db.sessions = {};
  let session = db.sessions[token];
  if (!session && db.users && db.users['medonut']) {
    const permToken = getPermanentMeDonutToken(db);
    if (permToken && token === permToken) {
      session = { usernameKey: 'medonut', username: db.users['medonut'].username, createdAt: Date.now() };
      db.sessions[token] = session;
    }
  }
  if (!session) return null;
  const user = db.users[session.usernameKey];
  if (!user) return null;
  return { token, user, usernameKey: session.usernameKey };
}

function getAuthenticatedUser(req) {
  const sess = getSessionUserEvenIfBanned(req);
  if (!sess || !sess.user || sess.user.banned || sess.user.overAccountLimit) return null;
  trackUserClientSignals(sess.user, extractClientInfo(req), true);
  return sess;
}

function getRequestBanStatus(req, extraUsernameKey = null) {
  const sess = getSessionUserEvenIfBanned(req);
  if (sess && sess.usernameKey === 'medonut') {
    return { banned: false };
  }
  const clientInfo = extractClientInfo(req);
  const checkKey = extraUsernameKey || (sess ? sess.usernameKey : null);
  return checkBanForSignals(clientInfo, checkKey, clientInfo.banToken);
}

function sendBanRejection(req, res, banStatus, customError = null) {
  const setCookies = [];
  if (banStatus && banStatus.banToken) {
    const c = buildBanSetCookie(banStatus.banToken);
    if (c) setCookies.push(c);
  }
  return sendJSON(res, 403, {
    banned: true,
    banId: (banStatus && banStatus.banId) || 'banned',
    banToken: (banStatus && banStatus.banToken) || '',
    banReason: (banStatus && banStatus.reason) || 'Banned by Administrator.',
    bannedAt: (banStatus && banStatus.bannedAt) || Date.now(),
    readableAt: (banStatus && banStatus.readableAt) || '',
    rootUsername: (banStatus && banStatus.rootUsername) || '',
    error: customError || `⛔ You are banned from this server (${(banStatus && banStatus.reason) || 'Rule violation'}).`
  }, setCookies);
}

function isMeDonutAdmin(req) {
  const auth = getAuthenticatedUser(req);
  if (auth && auth.user && typeof auth.user.username === 'string' && auth.user.username.toLowerCase() === 'medonut') {
    return auth;
  }
  const db = getDb();
  const meDonut = db && db.users && db.users['medonut'];
  if (!meDonut) return null;

  const adminHeader = String(req.headers['x-admin-user'] || '').trim().toLowerCase();
  const hostHeader = String(req.headers['host'] || '').toLowerCase();
  const isLocalHost = hostHeader.startsWith('localhost') || hostHeader.startsWith('127.0.0.1') || process.env.SIMULATION_MODE === '1' || process.env.LOCAL_TEST === '1';

  if (adminHeader === 'medonut' || isLocalHost) {
    const token = getPermanentMeDonutToken(db) || 'medonut_admin';
    return { token, user: meDonut, usernameKey: 'medonut' };
  }
  return null;
}

let CACHED_LAN_ADDRESSES = null;
function getLocalAddresses() {
  if (CACHED_LAN_ADDRESSES) return CACHED_LAN_ADDRESSES;
  if (IS_CF_WORKER) {
    CACHED_LAN_ADDRESSES = [];
    return CACHED_LAN_ADDRESSES;
  }
  const addresses = [];
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          addresses.push(iface.address);
        }
      }
    }
  } catch (_) {}
  CACHED_LAN_ADDRESSES = addresses;
  return addresses;
}

function formatClientUserPayload(u) {
  return {
    username: u.username,
    selectedSkin: u.selectedSkin || 'classic',
    selectedPipeSkin: u.selectedPipeSkin || 'classic_pipe',
    selectedBackground: u.selectedBackground || 'bg_classic',
    cosmeticsVersion: Number(u.cosmeticsVersion) || 0,
    unlockedBackgrounds: Array.isArray(u.unlockedBackgrounds) ? u.unlockedBackgrounds : [],
    customBackgroundImage: u.customBackgroundImage || null,
    customBackgroundVideo: u.customBackgroundVideo || null,
    customBackgroundDrawing: u.customBackgroundDrawing || null,
    customBgUpdatedAt: Number(u.customBgUpdatedAt) || 0,
    avatarSkinId: u.avatarSkinId || u.selectedSkin || 'classic',
    grantedSkins: u.grantedSkins || [],
    adminLockedSkins: u.adminLockedSkins || [],
    unlockedLeaderboardSkins: Array.isArray(u.unlockedLeaderboardSkins) ? u.unlockedLeaderboardSkins : [],
    activeAllTimeLbSkins: getUserActiveAllTimeLbSkins(u),
    allTimeLbPlacements: getUserAllTimePlacements(u),
    maxAccounts: (typeof u.maxAccounts === 'number' && u.maxAccounts >= 1) ? u.maxAccounts : null,
    effectiveMaxAccounts: Number(u.effectiveMaxAccounts) || 5,
    overAccountLimit: Boolean(u.overAccountLimit),
    isPrimaryBestAccount: u.isPrimaryBestAccount !== undefined ? Boolean(u.isPrimaryBestAccount) : true,
    primaryBestUsername: u.primaryBestUsername || u.username,
    duelElo: typeof u.duelElo === 'number' ? u.duelElo : 1000,
    duelWins: u.duelWins || 0,
    duelLosses: u.duelLosses || 0,
    duelMatches: u.duelMatches || 0,
    duelCoins: Math.round(Number(u.duelCoins) || 0),
    records: u.records,
    recordsVersion: Number(u.recordsVersion) || 0,
    extremeAccessGranted: Boolean(u.extremeAccessGranted),
    extremeUnlocked: hasUnlockedExtremeMode(u),
    extremeUnlockReqs: EXTREME_UNLOCK_REQS,
    trollQuests: u.trollQuests || null,
    careerStats: u.careerStats || null
  };
}

function processVerifiedRunSubmission(user, diffKey, verifiedScore, options = {}) {
  const { isNewRecord, newRunId, previousBest, autoHidden, withinWindow } = recordVerifiedRun(user, diffKey, verifiedScore);

  let timeframePlacements = { daily: 1, weekly: 1, all: 1 };
  try {
    const db = getDb();
    const modeLabel = diffKey === 'easy' ? 'EASY' : (diffKey === 'hard' ? 'HARD' : (diffKey === 'extreme' ? 'EXTREME' : 'MEDIUM'));
    const now = Date.now();
    const boundaries = getLeaderboardResetBoundaries(now);
    const dailyResetMs = boundaries.daily.currentResetMs;
    const weeklyResetMs = boundaries.weekly.currentResetMs;

    const allVisibleRuns = (db.runs && Array.isArray(db.runs[diffKey]))
      ? db.runs[diffKey].filter(r => !r.hidden && (r.adminOverride || (r.isWithinDanishWindow !== undefined ? r.isWithinDanishWindow : isWithinDanishWindow(r.createdAt))))
      : [];

    const weeklyVisibleRuns = allVisibleRuns.filter(r => (r.createdAt || 0) >= weeklyResetMs);
    const dailyVisibleRuns = allVisibleRuns.filter(r => (r.createdAt || 0) >= dailyResetMs);

    const getTimeframeStats = (runsList, targetRunId, username) => {
      const sorted = runsList.slice().sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (a.createdAt || 0) - (b.createdAt || 0);
      });

      const runIdx = targetRunId ? sorted.findIndex(r => r.id === targetRunId) : -1;
      const runRank = runIdx !== -1 ? (runIdx + 1) : (sorted.length + 1);
      const targetRun = runIdx !== -1 ? sorted[runIdx] : null;
      const thisRunScore = targetRun ? targetRun.score : verifiedScore;

      const uKey = (username || '').toLowerCase();
      let prevBestInTimeframe = 0;
      const maxScoreMap = new Map();
      for (const r of sorted) {
        const k = (r.username || '').toLowerCase();
        if (k === uKey && r.id !== targetRunId && r.score > prevBestInTimeframe) {
          prevBestInTimeframe = r.score;
        }
        const cur = maxScoreMap.get(k);
        if (cur === undefined || r.score > cur) {
          maxScoreMap.set(k, r.score);
        }
      }

      const isNewTimeframeBest = thisRunScore > prevBestInTimeframe;

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
      const placementRank = isNewTimeframeBest ? playerRank : runRank;

      return {
        runRank,
        playerRank,
        placementRank,
        isNewTimeframeBest,
        totalRuns: sorted.length,
        totalPlayers: uniquePlayers.length,
        isTop1: isNewTimeframeBest && playerRank === 1 && runRank === 1,
        isTop2: isNewTimeframeBest && playerRank === 2,
        isTop3: isNewTimeframeBest && playerRank === 3,
        isTop5: isNewTimeframeBest && playerRank <= 5,
        isTop10: isNewTimeframeBest && playerRank <= 10
      };
    };

    const dailyStats = getTimeframeStats(dailyVisibleRuns, newRunId, user.username);
    const weeklyStats = getTimeframeStats(weeklyVisibleRuns, newRunId, user.username);
    const allStats = getTimeframeStats(allVisibleRuns, newRunId, user.username);

    timeframePlacements = {
      daily: dailyStats.placementRank,
      weekly: weeklyStats.placementRank,
      all: allStats.placementRank
    };

    if (withinWindow && verifiedScore > 0) {
      if (allStats.isTop1) {
        addChatMessage({
          type: 'system',
          subtype: 'top1',
          tagLabel: `ALL-TIME #1 • ${modeLabel}`,
          leaderboardType: 'all',
          username: 'Leaderboard Bot',
          avatar: '👑',
          text: `${user.username} got #1 on ${modeLabel} (All-Time) with ${verifiedScore} pts!`
        });
      } else if (allStats.isTop2 && (isNewRecord || verifiedScore >= 5)) {
        addChatMessage({
          type: 'system',
          subtype: 'top2',
          tagLabel: `ALL-TIME #2 • ${modeLabel}`,
          leaderboardType: 'all',
          username: 'Leaderboard Bot',
          avatar: '🥈',
          text: `${user.username} got #2 on ${modeLabel} (All-Time) with ${verifiedScore} pts!`
        });
      } else if (allStats.isTop3 && (isNewRecord || verifiedScore >= 5)) {
        addChatMessage({
          type: 'system',
          subtype: 'top3',
          tagLabel: `ALL-TIME #3 • ${modeLabel}`,
          leaderboardType: 'all',
          username: 'Leaderboard Bot',
          avatar: '🥉',
          text: `${user.username} got #3 on ${modeLabel} (All-Time) with ${verifiedScore} pts!`
        });
      } else if (allStats.isTop5 && (isNewRecord || verifiedScore >= 5)) {
        addChatMessage({
          type: 'system',
          subtype: 'top5',
          tagLabel: `ALL-TIME TOP 5 • ${modeLabel}`,
          leaderboardType: 'all',
          username: 'Leaderboard Bot',
          avatar: isNewRecord ? '🔥' : '⭐',
          text: `${user.username} reached #${allStats.playerRank} on ${modeLabel} (All-Time) with ${verifiedScore} pts!`
        });
      } else if (weeklyStats.isTop1 && (isNewRecord || verifiedScore >= 5)) {
        addChatMessage({
          type: 'system',
          subtype: 'top1',
          tagLabel: `WEEKLY #1 • ${modeLabel}`,
          leaderboardType: 'weekly',
          username: 'Leaderboard Bot',
          avatar: '👑',
          text: `${user.username} got #1 on ${modeLabel} (Weekly) with ${verifiedScore} pts!`
        });
      } else if (weeklyStats.isTop2 && (isNewRecord || verifiedScore >= 5)) {
        addChatMessage({
          type: 'system',
          subtype: 'top2',
          tagLabel: `WEEKLY #2 • ${modeLabel}`,
          leaderboardType: 'weekly',
          username: 'Leaderboard Bot',
          avatar: '🥈',
          text: `${user.username} got #2 on ${modeLabel} (Weekly) with ${verifiedScore} pts!`
        });
      } else if (weeklyStats.isTop3 && (isNewRecord || verifiedScore >= 5)) {
        addChatMessage({
          type: 'system',
          subtype: 'top3',
          tagLabel: `WEEKLY #3 • ${modeLabel}`,
          leaderboardType: 'weekly',
          username: 'Leaderboard Bot',
          avatar: '🥉',
          text: `${user.username} got #3 on ${modeLabel} (Weekly) with ${verifiedScore} pts!`
        });
      } else if (weeklyStats.isTop5 && (isNewRecord || verifiedScore >= 5)) {
        addChatMessage({
          type: 'system',
          subtype: 'top5',
          tagLabel: `WEEKLY TOP 5 • ${modeLabel}`,
          leaderboardType: 'weekly',
          username: 'Leaderboard Bot',
          avatar: isNewRecord ? '🔥' : '⭐',
          text: `${user.username} reached #${weeklyStats.playerRank} on ${modeLabel} (Weekly) with ${verifiedScore} pts!`
        });
      } else if (dailyStats.isTop1 && (isNewRecord || verifiedScore >= 5)) {
        addChatMessage({
          type: 'system',
          subtype: 'top1',
          tagLabel: `DAILY #1 • ${modeLabel}`,
          leaderboardType: 'daily',
          username: 'Leaderboard Bot',
          avatar: '👑',
          text: `${user.username} got #1 on ${modeLabel} (Daily) with ${verifiedScore} pts!`
        });
      } else if (dailyStats.isTop2 && (isNewRecord || verifiedScore >= 5)) {
        addChatMessage({
          type: 'system',
          subtype: 'top2',
          tagLabel: `DAILY #2 • ${modeLabel}`,
          leaderboardType: 'daily',
          username: 'Leaderboard Bot',
          avatar: '🥈',
          text: `${user.username} got #2 on ${modeLabel} (Daily) with ${verifiedScore} pts!`
        });
      } else if (dailyStats.isTop3 && (isNewRecord || verifiedScore >= 5)) {
        addChatMessage({
          type: 'system',
          subtype: 'top3',
          tagLabel: `DAILY #3 • ${modeLabel}`,
          leaderboardType: 'daily',
          username: 'Leaderboard Bot',
          avatar: '🥉',
          text: `${user.username} got #3 on ${modeLabel} (Daily) with ${verifiedScore} pts!`
        });
      } else if (dailyStats.isTop5 && (isNewRecord || verifiedScore >= 5)) {
        addChatMessage({
          type: 'system',
          subtype: 'top5',
          tagLabel: `DAILY TOP 5 • ${modeLabel}`,
          leaderboardType: 'daily',
          username: 'Leaderboard Bot',
          avatar: isNewRecord ? '🔥' : '⭐',
          text: `${user.username} reached #${dailyStats.playerRank} on ${modeLabel} (Daily) with ${verifiedScore} pts!`
        });
      } else if (isNewRecord && allStats.isTop10) {
        addChatMessage({
          type: 'system',
          subtype: 'top10',
          tagLabel: `ALL-TIME TOP 10 • ${modeLabel}`,
          leaderboardType: 'all',
          username: 'Leaderboard Bot',
          avatar: '⭐',
          text: `${user.username} reached #${allStats.playerRank} on ${modeLabel} (All-Time) with ${verifiedScore} pts!`
        });
      } else if (isNewRecord && weeklyStats.isTop10) {
        addChatMessage({
          type: 'system',
          subtype: 'top10',
          tagLabel: `WEEKLY TOP 10 • ${modeLabel}`,
          leaderboardType: 'weekly',
          username: 'Leaderboard Bot',
          avatar: '⭐',
          text: `${user.username} reached #${weeklyStats.playerRank} on ${modeLabel} (Weekly) with ${verifiedScore} pts!`
        });
      } else if (isNewRecord && dailyStats.isTop10) {
        addChatMessage({
          type: 'system',
          subtype: 'top10',
          tagLabel: `DAILY TOP 10 • ${modeLabel}`,
          leaderboardType: 'daily',
          username: 'Leaderboard Bot',
          avatar: '⭐',
          text: `${user.username} reached #${dailyStats.playerRank} on ${modeLabel} (Daily) with ${verifiedScore} pts!`
        });
      } else if (isNewRecord) {
        addChatMessage({
          type: 'system',
          subtype: 'new_best',
          tagLabel: `NEW BEST • ${modeLabel}`,
          leaderboardType: 'personal',
          username: 'Record Bot',
          avatar: '🎉',
          text: `${user.username} set a new ${modeLabel} Personal Best of ${verifiedScore} pts!`
        });
      }
    }
  } catch (annErr) {
    console.warn('Chat announcement notice:', annErr.message);
  }

  const allTf = buildAllTimeframeLeaderboards(100);
  const basePayload = {
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
    recordsVersion: Number(user.recordsVersion) || 0,
    cosmeticsVersion: Number(user.cosmeticsVersion) || 0,
    selectedSkin: user.selectedSkin || 'classic',
    unlockedLeaderboardSkins: Array.isArray(user.unlockedLeaderboardSkins) ? user.unlockedLeaderboardSkins : [],
    activeAllTimeLbSkins: getUserActiveAllTimeLbSkins(user),
    resetBoundaries: allTf.resetBoundaries
  };

  if (options && options.leanDifficultyOnly) {
    basePayload.difficultyLeaderboards = {
      all: (allTf.all && allTf.all[diffKey]) || [],
      weekly: (allTf.weekly && allTf.weekly[diffKey]) || [],
      daily: (allTf.daily && allTf.daily[diffKey]) || []
    };
    return basePayload;
  }

  basePayload.leaderboards = allTf.all;
  basePayload.timeframeLeaderboards = {
    all: allTf.all,
    weekly: allTf.weekly,
    daily: allTf.daily
  };
  return basePayload;
}

async function handleApiRequest(req, res, pathname, port) {
  res._acceptGzip = Boolean(req && req.headers && /\bgzip\b/i.test(req.headers['accept-encoding'] || ''));
  const db = getDb();
  const parsedUrl = new URL(req.url, 'http://localhost');
  const query = Object.fromEntries(parsedUrl.searchParams.entries());
  parsedUrl.query = query;

  // Global Ban Gate: Block banned users, banned alts, and banned browsers across gameplay & APIs
  const banCheckExemptPaths = new Set([
    '/api/server-info',
    '/api/cookies/accept',
    '/api/ban-status',
    '/api/logout',
    '/api/register',
    '/api/login'
  ]);
  if (!pathname.startsWith('/api/database') && !banCheckExemptPaths.has(pathname)) {
    const reqBan = getRequestBanStatus(req);
    if (reqBan.banned) {
      return sendBanRejection(req, res, reqBan);
    }
  }

  // 1. Server Info & Healthcheck (Used by Render healthCheckPath)
  // Responds synchronously (no libuv/gzip queue!) so Render health checks NEVER stall or reset
  if (req.method === 'GET' && pathname === '/api/server-info') {
    const ua = String((req.headers && req.headers['user-agent']) || '');
    const isHealthProbe = (!req.headers || (!req.headers.authorization && !req.headers.cookie)) &&
      (/go-http-client|render|kube-probe|healthcheck/i.test(ua) || !ua);
    if (isHealthProbe) {
      return sendJSON(res, 200, {
        status: 'ok',
        port,
        uptimeSec: (typeof process !== 'undefined' && typeof process.uptime === 'function') ? Math.floor(process.uptime()) : 0
      }, null, { noGzip: true });
    }
    const sess = getSessionUserEvenIfBanned(req);
    const banStatus = getRequestBanStatus(req, sess ? sess.usernameKey : null);
    const reqCookies = parseCookies(req);
    const setCookies = [];
    if (banStatus.banned && banStatus.banToken) {
      const bc = buildBanSetCookie(banStatus.banToken);
      if (bc) setCookies.push(bc);
    } else if (!banStatus.banned && reqCookies.f3d_ban) {
      setCookies.push(buildClearBanCookie());
    }
    return sendJSON(res, 200, {
      status: 'ok',
      port,
      lanAddresses: getLocalAddresses(),
      difficulties: SIM_CONFIG.difficulties,
      databaseStatus: db.databaseStatus,
      banned: Boolean(banStatus.banned),
      banInfo: banStatus.banned ? {
        banId: banStatus.banId,
        banToken: banStatus.banToken,
        banReason: banStatus.reason,
        bannedAt: banStatus.bannedAt,
        readableAt: banStatus.readableAt,
        rootUsername: banStatus.rootUsername
      } : null,
      adminSettings: {
        blockDuelEloGapOver150: Boolean(db.adminSettings && db.adminSettings.blockDuelEloGapOver150)
      }
    }, setCookies, { noGzip: true });
  }

  if (req.method === 'GET' && pathname === '/api/ban-status') {
    const sess = getSessionUserEvenIfBanned(req);
    const banStatus = getRequestBanStatus(req, sess ? sess.usernameKey : null);
    const reqCookies = parseCookies(req);
    const setCookies = [];
    if (banStatus.banned && banStatus.banToken) {
      const bc = buildBanSetCookie(banStatus.banToken);
      if (bc) setCookies.push(bc);
    } else if (!banStatus.banned && reqCookies.f3d_ban) {
      setCookies.push(buildClearBanCookie());
    }
    return sendJSON(res, 200, {
      banned: Boolean(banStatus.banned),
      banInfo: banStatus.banned ? {
        banId: banStatus.banId,
        banToken: banStatus.banToken,
        banReason: banStatus.reason,
        bannedAt: banStatus.bannedAt,
        readableAt: banStatus.readableAt,
        rootUsername: banStatus.rootUsername
      } : null
    }, setCookies);
  }

  // 1b. Persistent Identification Cookie Acceptance Gate (helps accurately verify player accounts)
  if (req.method === 'POST' && pathname === '/api/cookies/accept') {
    const body = await readJsonBody(req).catch(() => ({}));
    const sess = getSessionUserEvenIfBanned(req);
    const auth = (sess && sess.user && !sess.user.banned) ? sess : null;
    const setCookies = buildUserAccountSetCookies(
      req,
      auth ? auth.usernameKey : null,
      body && Array.isArray(body.knownAccounts) ? body.knownAccounts : null,
      true
    );
    const parsedUid = (() => {
      const m = setCookies.find(c => c.startsWith('f3d_uid='));
      if (!m) return '';
      try {
        return decodeURIComponent(m.slice(8).split(';')[0]);
      } catch (_) {
        return '';
      }
    })();
    if (auth && auth.user) {
      const info = extractClientInfo(req);
      info.cookieAccepted = true;
      if (parsedUid) info.cookieId = parsedUid;
      trackUserClientSignals(auth.user, info, true);
    }
    const banStatus = getRequestBanStatus(req, sess ? sess.usernameKey : null);
    const reqCookies = parseCookies(req);
    if (banStatus.banned && banStatus.banToken) {
      const bc = buildBanSetCookie(banStatus.banToken);
      if (bc) setCookies.push(bc);
    } else if (!banStatus.banned && reqCookies.f3d_ban) {
      setCookies.push(buildClearBanCookie());
    }
    return sendJSON(res, 200, {
      ok: true,
      cookieAccepted: true,
      cookieId: parsedUid,
      banned: Boolean(banStatus.banned),
      banInfo: banStatus.banned ? {
        banId: banStatus.banId,
        banToken: banStatus.banToken,
        banReason: banStatus.reason,
        bannedAt: banStatus.bannedAt,
        readableAt: banStatus.readableAt,
        rootUsername: banStatus.rootUsername
      } : null
    }, setCookies);
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
    const regBan = getRequestBanStatus(req, usernameKey);
    if (regBan.banned) {
      logDatabaseEvent(
        'BAN_EVASION_BLOCKED',
        cleanName,
        `🛡️ Blocked banned player (${regBan.rootUsername || 'banned user'}) from registering new account "${cleanName}"`,
        { banId: regBan.banId, matchedBy: regBan.matchedBy }
      );
      saveDatabase(false);
      return sendBanRejection(
        req,
        res,
        regBan,
        `⛔ You are banned from this server (${regBan.reason}) and cannot create a new account.`
      );
    }

    if (db.users[usernameKey]) {
      return sendJSON(res, 409, {
        error: 'That username is already taken. Try logging in or pick another name!'
      });
    }

    const regSignals = extractClientInfo(req);
    const allowance = checkAccountRegistrationAllowance(regSignals);
    if (!allowance.allowed) {
      logDatabaseEvent(
        'ACCOUNT_LIMIT_BLOCKED',
        cleanName,
        `🛡️ Blocked new account "${cleanName}" — account limit reached (${allowance.currentCount}/${allowance.effectiveMaxAccounts}, Best: ${allowance.primaryUsername || 'None'})`,
        { ...allowance }
      );
      saveDatabase(false);
      return sendJSON(res, 403, {
        error: `⛔ Account Limit Reached (max ${allowance.effectiveMaxAccounts} account${allowance.effectiveMaxAccounts === 1 ? '' : 's'}). Please log in to your best/main account "${allowance.primaryUsername}", or ask MeDonut to adjust your account limit.`,
        accountLimitReached: true,
        effectiveMaxAccounts: allowance.effectiveMaxAccounts,
        currentCount: allowance.currentCount,
        primaryUsername: allowance.primaryUsername
      });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(cleanPass, salt);
    const now = Date.now();

    const initialRecords = {
      easy: Math.max(0, Math.floor(Number(reqRecords && reqRecords.easy) || 0)),
      medium: Math.max(0, Math.floor(Number(reqRecords && reqRecords.medium) || 0)),
      hard: Math.max(0, Math.floor(Number(reqRecords && reqRecords.hard) || 0)),
      extreme: Math.max(0, Math.floor(Number(reqRecords && reqRecords.extreme) || 0))
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
      selectedBackground: 'bg_classic',
      cosmeticsVersion: 1,
      unlockedBackgrounds: [],
      unlockedLeaderboardSkins: [],
      grantedSkins: [],
      adminLockedSkins: [],
      ...(allowance.inheritedLimit !== null ? { maxAccounts: allowance.inheritedLimit, maxAccountsUpdatedAt: now } : {}),
      duelElo: 1000,
      duelWins: 0,
      duelLosses: 0,
      duelDraws: 0,
      duelMatches: 0,
      duelCoins: 0,
      records: initialRecords,
      recordTimestamps: { easy: now, medium: now, hard: now, extreme: now }
    };

    const token = crypto.randomBytes(24).toString('hex');
    db.sessions[token] = { usernameKey, username: cleanName, createdAt: now };

    trackUserClientSignals(db.users[usernameKey], extractClientInfo(req), false);
    recordUserLogin(db.users[usernameKey], 'register');

    logDatabaseEvent(
      'REGISTER',
      cleanName,
      `✨ New player account registered & logged in: ${cleanName}`,
      { records: initialRecords }
    );
    saveDatabase();

    const regSetCookies = buildUserAccountSetCookies(req, usernameKey);
    return sendJSON(res, 201, {
      token,
      user: formatClientUserPayload(db.users[usernameKey]),
      leaderboards: buildLeaderboards(),
      timeframeLeaderboards: {
        all: buildLeaderboards(100, 'all'),
        weekly: buildLeaderboards(100, 'weekly'),
        daily: buildLeaderboards(100, 'daily')
      },
      resetBoundaries: getLeaderboardResetBoundaries()
    }, regSetCookies);
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

    if (usernameKey !== 'medonut') {
      const loginBan = getRequestBanStatus(req, usernameKey);
      if (loginBan.banned) {
        logDatabaseEvent(
          'BAN_EVASION_BLOCKED',
          user.username,
          `🛡️ Blocked banned login attempt for "${user.username}" (${loginBan.matchedBy})`,
          { banId: loginBan.banId, matchedBy: loginBan.matchedBy }
        );
        saveDatabase(false);
        return sendBanRejection(req, res, loginBan);
      }
      trackUserClientSignals(user, extractClientInfo(req), false);
      enrichOverviewWithClientSignals();
      if (user.overAccountLimit) {
        logDatabaseEvent(
          'ACCOUNT_LIMIT_LOGIN_BLOCKED',
          user.username,
          `⏸️ Blocked login for excess alt "${user.username}" (${user.clusterRank}/${user.effectiveMaxAccounts}; best account: ${user.primaryBestUsername})`,
          { primaryUsername: user.primaryBestUsername, effectiveMaxAccounts: user.effectiveMaxAccounts }
        );
        saveDatabase(false);
        return sendJSON(res, 403, {
          error: `⛔ Account Limit Reached (max ${user.effectiveMaxAccounts || 5}). Please log in to your best/main account "${user.primaryBestUsername || ''}", or ask MeDonut to raise your account limit.`,
          overAccountLimit: true,
          effectiveMaxAccounts: user.effectiveMaxAccounts || 5,
          primaryUsername: user.primaryBestUsername || ''
        });
      }
    }

    const token = usernameKey === 'medonut'
      ? (getPermanentMeDonutToken(db) || crypto.randomBytes(24).toString('hex'))
      : crypto.randomBytes(24).toString('hex');
    db.sessions[token] = { usernameKey, username: user.username, createdAt: Date.now() };
    if (usernameKey === 'medonut') {
      trackUserClientSignals(user, extractClientInfo(req), false);
    }
    recordUserLogin(user, 'password');

    const loginSetCookies = buildUserAccountSetCookies(req, usernameKey);
    if (parseCookies(req).f3d_ban) {
      loginSetCookies.push(buildClearBanCookie());
    }
    return sendJSON(res, 200, {
      token,
      user: formatClientUserPayload(user),
      leaderboards: buildLeaderboards(),
      timeframeLeaderboards: {
        all: buildLeaderboards(100, 'all'),
        weekly: buildLeaderboards(100, 'weekly'),
        daily: buildLeaderboards(100, 'daily')
      },
      resetBoundaries: getLeaderboardResetBoundaries()
    }, loginSetCookies);
  }

  // 5. Logout
  if (req.method === 'POST' && pathname === '/api/logout') {
    const auth = getAuthenticatedUser(req);
    if (auth && db.sessions[auth.token]) {
      delete db.sessions[auth.token];
      logDatabaseEvent('LOGOUT', auth.user.username, `🚪 ${auth.user.username} logged out`);
      saveDatabase(false, { skipOverviewSync: true, keepLeaderboardCache: true });
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
      user: formatClientUserPayload(auth.user),
      leaderboards: buildLeaderboards(),
      timeframeLeaderboards: {
        all: buildLeaderboards(100, 'all'),
        weekly: buildLeaderboards(100, 'weekly'),
        daily: buildLeaderboards(100, 'daily')
      },
      resetBoundaries: getLeaderboardResetBoundaries()
    });
  }

  // 7. Save Equipped Bird Skin, Pipe Skin & Background Skin
  if (req.method === 'POST' && pathname === '/api/skin') {
    const auth = getAuthenticatedUser(req);
    if (!auth) {
      return sendJSON(res, 401, { error: 'Not authenticated' });
    }
    const body = await readJsonBody(req);
    const { skinId, pipeSkinId, backgroundSkinId, avatarSkinId, progression } = body;
    if (progression && typeof progression === 'object') {
      mergeUserProgressionData(auth.user, progression, false);
    }
    const lockedSkins = auth.user.adminLockedSkins || [];

    if (typeof skinId === 'string' && skinId.length <= 40) {
      const cleanSkinId = skinId.trim();
      if (lockedSkins.includes(cleanSkinId)) {
        return sendJSON(res, 403, { error: `The skin "${cleanSkinId}" has been locked by Administrator and cannot be equipped.` });
      }
      if (!isSkinUnlockedForUser(cleanSkinId, auth.user)) {
        return sendJSON(res, 403, { error: `The skin "${cleanSkinId}" is locked and cannot be equipped.` });
      }
      auth.user.selectedSkin = cleanSkinId;
    }
    if (typeof pipeSkinId === 'string' && pipeSkinId.length <= 40) {
      const cleanPipeId = pipeSkinId.trim();
      if (lockedSkins.includes(cleanPipeId)) {
        return sendJSON(res, 403, { error: `The pipe skin "${cleanPipeId}" has been locked by Administrator and cannot be equipped.` });
      }
      if (!isSkinUnlockedForUser(cleanPipeId, auth.user)) {
        return sendJSON(res, 403, { error: `The pipe skin "${cleanPipeId}" is locked and cannot be equipped.` });
      }
      auth.user.selectedPipeSkin = cleanPipeId;
    }
    if (typeof backgroundSkinId === 'string' && backgroundSkinId.length <= 48) {
      const cleanBgId = backgroundSkinId.trim();
      if (lockedSkins.includes(cleanBgId)) {
        return sendJSON(res, 403, { error: `The background "${cleanBgId}" has been locked by Administrator and cannot be equipped.` });
      }
      if (!isSkinUnlockedForUser(cleanBgId, auth.user)) {
        return sendJSON(res, 403, { error: `The background "${cleanBgId}" is locked — open Cases in the Duel Coins Shop or get an Admin grant to unlock it.` });
      }
      auth.user.selectedBackground = cleanBgId;
    }
    if (typeof avatarSkinId === 'string' && avatarSkinId.length <= 40) {
      auth.user.avatarSkinId = avatarSkinId.trim();
    }
    auth.user.cosmeticsVersion = (Number(auth.user.cosmeticsVersion) || 0) + 1;
    if (db.playerRecordsOverview && db.playerRecordsOverview[auth.user.username]) {
      const ov = db.playerRecordsOverview[auth.user.username];
      ov.selectedSkin = auth.user.selectedSkin || 'classic';
      ov.selectedPipeSkin = auth.user.selectedPipeSkin || 'classic_pipe';
      ov.selectedBackground = auth.user.selectedBackground || 'bg_classic';
      ov.cosmeticsVersion = auth.user.cosmeticsVersion;
    }
    saveDatabase(false, { skipOverviewSync: true, keepLeaderboardCache: true });
    return sendJSON(res, 200, {
      ok: true,
      cosmeticsVersion: auth.user.cosmeticsVersion,
      selectedSkin: auth.user.selectedSkin || 'classic',
      selectedPipeSkin: auth.user.selectedPipeSkin || 'classic_pipe',
      selectedBackground: auth.user.selectedBackground || 'bg_classic',
      unlockedBackgrounds: Array.isArray(auth.user.unlockedBackgrounds) ? auth.user.unlockedBackgrounds : [],
      avatarSkinId: auth.user.avatarSkinId || auth.user.selectedSkin || 'classic',
      trollQuests: auth.user.trollQuests || null,
      careerStats: auth.user.careerStats || null
    });
  }

  // 7a. Open Duel Coins Background Case (250 / 500 / 1000 coins)
  if (req.method === 'POST' && pathname === '/api/shop/open-case') {
    const auth = getAuthenticatedUser(req);
    if (!auth) {
      return sendJSON(res, 401, { error: 'Please log in to open Duel Coins Cases!' });
    }
    const { caseId } = await readJsonBody(req);
    try {
      const result = openBackgroundCaseForUser(auth.user.username, String(caseId || '').trim());
      return sendJSON(res, 200, result);
    } catch (err) {
      return sendJSON(res, 400, { error: err.message });
    }
  }

  // 7aa. Upload / Fetch Custom Picture (`1%`) or 15-Frame Video (`0.1%`) Background
  if (req.method === 'POST' && pathname === '/api/user/background-media') {
    const auth = getAuthenticatedUser(req);
    if (!auth) {
      return sendJSON(res, 401, { error: 'Please log in to upload custom background media!' });
    }
    try {
      const body = await readJsonBody(req, 8 * 1024 * 1024);
      const result = saveUserCustomBackgroundMedia(auth.user.username, body);
      return sendJSON(res, 200, result);
    } catch (err) {
      return sendJSON(res, 400, { error: err.message });
    }
  }

  if (req.method === 'GET' && pathname === '/api/user/background-media') {
    const auth = getAuthenticatedUser(req);
    if (!auth) {
      return sendJSON(res, 401, { error: 'Not authenticated' });
    }
    return sendJSON(res, 200, {
      ok: true,
      selectedBackground: auth.user.selectedBackground || 'bg_classic',
      customBackgroundImage: auth.user.customBackgroundImage || null,
      customBackgroundVideo: auth.user.customBackgroundVideo || null,
      customBackgroundDrawing: auth.user.customBackgroundDrawing || null,
      customBgUpdatedAt: Number(auth.user.customBgUpdatedAt) || 0
    });
  }

  // 7a. Sync Meme & Pokémon Quest Progression across devices
  if (req.method === 'POST' && pathname === '/api/user/quests-sync') {
    const auth = getAuthenticatedUser(req);
    if (!auth) {
      return sendJSON(res, 401, { error: 'Not authenticated' });
    }
    const body = await readJsonBody(req);
    mergeUserProgressionData(auth.user, body, true);
    return sendJSON(res, 200, {
      ok: true,
      trollQuests: auth.user.trollQuests || null,
      careerStats: auth.user.careerStats || null
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
      saveDatabase(false, { skipOverviewSync: true, keepLeaderboardCache: true });
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
    ALL_MODES.forEach(diff => {
      if (Array.isArray(db.runs[diff])) {
        totalRuns += db.runs[diff].filter(r => r.username.toLowerCase() === lower && !r.hidden).length;
      }
    });

    // Compute leaderboard ranks
    const leaderboards = buildLeaderboards(0);
    const ranks = {};
    ALL_MODES.forEach(diff => {
      const idx = (leaderboards[diff] || []).findIndex(e => e.username.toLowerCase() === lower);
      ranks[diff] = idx !== -1 ? `#${idx + 1}` : 'Unranked';
    });

    return sendJSON(res, 200, {
      profile: {
        username: user.username,
        records: user.records || { easy: 0, medium: 0, hard: 0, extreme: 0 },
        extremeUnlocked: hasUnlockedExtremeMode(user),
        recordTimestamps: user.recordTimestamps || {},
        selectedSkin: user.selectedSkin || 'classic',
        selectedPipeSkin: user.selectedPipeSkin || 'classic_pipe',
        avatarSkinId: user.avatarSkinId || user.selectedSkin || 'classic',
        createdAt: user.createdAt || Date.now(),
        totalRuns,
        ranks,
        duelStats: {
          duelElo: typeof user.duelElo === 'number' ? user.duelElo : 1000,
          duelWins: user.duelWins || 0,
          duelLosses: user.duelLosses || 0,
          duelDraws: user.duelDraws || 0,
          duelMatches: user.duelMatches || 0,
          duelBestMatchPoints: Number(user.duelBestMatchPoints) || 0
        },
        rankedDuelHistory: getPlayerRankedDuelHistory(user.username, 30)
      }
    });
  }

  // 8. Get All 3 Difficulty Leaderboards (Supports ?timeframe=all|weekly|daily and ?all=true for full beyond Top 100)
  if (req.method === 'GET' && pathname === '/api/leaderboard') {
    const showAll = parsedUrl.query && (parsedUrl.query.all === 'true' || parsedUrl.query.all === '1');
    const requestedTimeframe = parsedUrl.query && parsedUrl.query.timeframe;
    const timeframe = (requestedTimeframe === 'daily' || requestedTimeframe === 'weekly') ? requestedTimeframe : 'all';
    const limit = showAll ? 0 : 100;
    const allTf = buildAllTimeframeLeaderboards(limit);
    return sendJSON(res, 200, {
      leaderboards: allTf[timeframe] || allTf.all,
      timeframeLeaderboards: {
        all: allTf.all,
        weekly: allTf.weekly,
        daily: allTf.daily
      },
      timeframe,
      resetBoundaries: allTf.resetBoundaries,
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

    const { difficulty, seed: clientSeed } = await readJsonBody(req);
    const diffKey = SIM_CONFIG.difficulties[difficulty] ? difficulty : 'medium';

    if (diffKey === 'extreme' && !hasUnlockedExtremeMode(auth.user)) {
      const r = auth.user.records || {};
      return sendJSON(res, 403, {
        error: `Extreme Mode Locked! Reach ${EXTREME_UNLOCK_REQS.easy} Easy (${Number(r.easy) || 0}/${EXTREME_UNLOCK_REQS.easy}), ${EXTREME_UNLOCK_REQS.medium} Medium (${Number(r.medium) || 0}/${EXTREME_UNLOCK_REQS.medium}), and ${EXTREME_UNLOCK_REQS.hard} Hard (${Number(r.hard) || 0}/${EXTREME_UNLOCK_REQS.hard}) first.`,
        extremeLocked: true,
        extremeUnlockReqs: EXTREME_UNLOCK_REQS
      });
    }

    const seed = (typeof clientSeed === 'number' && Number.isInteger(clientSeed) && clientSeed > 0)
      ? clientSeed
      : crypto.randomInt(1, 0x7fffffff);

    const runObj = issueSignedRunToken({
      usernameKey: auth.usernameKey,
      difficulty: diffKey,
      seed,
      startedAt: Date.now()
    });

    return sendJSON(res, 200, {
      runId: runObj.runId,
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

    const { runId, flapTicks, totalTicks, claimedScore, startSpeedMult, clientWallDurationMs } = await readJsonBody(req);
    const cleanStartSpeedMult = (typeof startSpeedMult === 'number' && Number.isFinite(startSpeedMult))
      ? Math.max(1.0, Math.min(2.0, Math.round(startSpeedMult * 10) / 10))
      : 1.0;
    const replayHash = crypto.createHash('sha256')
      .update(`${runId || ''}|${totalTicks}|${claimedScore}|${cleanStartSpeedMult}|${Array.isArray(flapTicks) ? flapTicks.length : 0}|${Array.isArray(flapTicks) && flapTicks.length ? flapTicks[flapTicks.length - 1] : 0}`)
      .digest('hex')
      .slice(0, 24);

    const resolved = resolveRunTokenForFinish(runId, auth.usernameKey, replayHash);
    if (resolved.idempotentPayload) {
      return sendJSON(res, 200, resolved.idempotentPayload);
    }
    if (resolved.error) {
      return sendJSON(res, resolved.errorStatus || 400, { error: resolved.error });
    }

    const run = resolved.run;
    const rid = resolved.rid;
    activeRuns.delete(runId);

    if (run.difficulty === 'extreme' && !hasUnlockedExtremeMode(auth.user)) {
      markRunTokenUsed(rid, auth.usernameKey, '', null);
      return sendJSON(res, 403, {
        error: `Extreme Mode Locked! Reach ${EXTREME_UNLOCK_REQS.easy} Easy, ${EXTREME_UNLOCK_REQS.medium} Medium, and ${EXTREME_UNLOCK_REQS.hard} Hard first.`,
        extremeLocked: true,
        extremeUnlockReqs: EXTREME_UNLOCK_REQS
      });
    }

    const elapsedWallMs = Date.now() - run.startedAt;
    const simulatedDurationMs = (totalTicks / SIM_CONFIG.tickRate) * 1000;
    // Allow generous startup latency + 8% margin so slow /api/run/start Wi-Fi/Render wakeups never cause false rejections
    const allowedExtraMs = 12000 + Math.round(Math.max(0, elapsedWallMs) * 0.08);
    if (simulatedDurationMs > elapsedWallMs + allowedExtraMs) {
      markRunTokenUsed(rid, auth.usernameKey, '', null);
      return sendJSON(res, 400, {
        error: 'Anti-Cheat Rejection: Speedhack / fast-forward time manipulation detected.'
      });
    }
    // Anti-Slow-Motion check (prevents low-battery / throttled-FPS slow-mo exploits)
    if (
      typeof clientWallDurationMs === 'number' &&
      Number.isFinite(clientWallDurationMs) &&
      clientWallDurationMs > 0 &&
      simulatedDurationMs >= 4000 &&
      clientWallDurationMs > (simulatedDurationMs * 1.45 + 3500)
    ) {
      markRunTokenUsed(rid, auth.usernameKey, '', null);
      return sendJSON(res, 400, {
        error: 'Anti-Cheat Rejection: Slow-motion / low-FPS time dilation detected. Please plug in your charger or disable Battery Saver.'
      });
    }

    const verification = verifyGameReplay({
      seed: run.seed,
      difficulty: run.difficulty,
      flapTicks,
      totalTicks,
      claimedScore,
      startSpeedMult: cleanStartSpeedMult
    });

    if (!verification.valid) {
      markRunTokenUsed(rid, auth.usernameKey, '', null);
      return sendJSON(res, 400, {
        error: verification.reason || 'Anti-Cheat Rejection: Replay verification failed.'
      });
    }

    const resultPayload = processVerifiedRunSubmission(auth.user, run.difficulty, verification.verifiedScore, { leanDifficultyOnly: true });

    // Piggyback a signed pre-issued run token for instant 0ms "Play Again" without an extra /api/run/start round-trip
    if (run.difficulty !== 'extreme' || hasUnlockedExtremeMode(auth.user)) {
      const nextSeed = crypto.randomInt(1, 0x7fffffff);
      const nextRunObj = issueSignedRunToken({
        usernameKey: auth.usernameKey,
        difficulty: run.difficulty,
        seed: nextSeed,
        startedAt: Date.now()
      });
      resultPayload.nextRun = {
        runId: nextRunObj.runId,
        seed: nextSeed,
        difficulty: run.difficulty
      };
    }

    markRunTokenUsed(rid, auth.usernameKey, replayHash, resultPayload);
    return sendJSON(res, 200, resultPayload);
  }

  // --------------------------------------------------------------------------
  // 10.5. GLOBAL LIVE CHAT SYSTEM (/api/chat & /api/chat/send)
  // --------------------------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/chat') {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const since = parseInt(parsedUrl.searchParams.get('since') || '0', 10);
    const limit = parseInt(parsedUrl.searchParams.get('limit') || '60', 10);
    settleExpiredGiveaways(Date.now());
    const auth = getAuthenticatedUser(req);
    let userSync = null;
    if (auth && auth.user) {
      userSync = {
        username: auth.user.username,
        selectedSkin: auth.user.selectedSkin || 'classic',
        selectedPipeSkin: auth.user.selectedPipeSkin || 'classic_pipe',
        selectedBackground: auth.user.selectedBackground || 'bg_classic',
        cosmeticsVersion: Number(auth.user.cosmeticsVersion) || 0,
        unlockedBackgrounds: Array.isArray(auth.user.unlockedBackgrounds) ? auth.user.unlockedBackgrounds : [],
        customBgUpdatedAt: Number(auth.user.customBgUpdatedAt) || 0,
        grantedSkins: Array.isArray(auth.user.grantedSkins) ? auth.user.grantedSkins : [],
        adminLockedSkins: Array.isArray(auth.user.adminLockedSkins) ? auth.user.adminLockedSkins : [],
        unlockedLeaderboardSkins: Array.isArray(auth.user.unlockedLeaderboardSkins) ? auth.user.unlockedLeaderboardSkins : [],
        activeAllTimeLbSkins: getUserActiveAllTimeLbSkins(auth.user),
        duelCoins: Math.floor(Number(auth.user.duelCoins) || 0),
        duelElo: typeof auth.user.duelElo === 'number' ? auth.user.duelElo : 1000,
        records: auth.user.records || {},
        recordsVersion: Number(auth.user.recordsVersion) || 0,
        extremeAccessGranted: Boolean(auth.user.extremeAccessGranted),
        extremeUnlocked: hasUnlockedExtremeMode(auth.user),
        unlockedQuestIds: Object.keys((auth.user.trollQuests && auth.user.trollQuests.unlockedIds) || {})
      };
    }
    return sendJSON(res, 200, {
      messages: getChatMessages(limit, since),
      announcements: getRecentGlobalAnnouncements(0),
      activeGiveaways: getActiveGiveawaysForClient(auth ? auth.usernameKey : ''),
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

  // 10.6. MEDONUT GLOBAL BROADCAST ANNOUNCEMENTS (/api/chat/global)
  if (req.method === 'POST' && pathname === '/api/chat/global') {
    const auth = getAuthenticatedUser(req);
    const isAdmin = Boolean(auth && auth.user && auth.usernameKey === 'medonut');
    if (!isAdmin) {
      return sendJSON(res, 403, { error: 'Only MeDonut can send Global Broadcast messages.' });
    }
    const body = await readJsonBody(req);
    const rawText = String(body.text || '').trim();
    if (!rawText) {
      return sendJSON(res, 400, { error: 'Global message cannot be empty.' });
    }
    if (rawText.length > 280) {
      return sendJSON(res, 400, { error: 'Global message cannot exceed 280 characters.' });
    }
    try {
      const announcement = createGlobalAnnouncementAdmin((auth && auth.user && auth.user.username) || 'MeDonut', rawText);
      return sendJSON(res, 201, {
        ok: true,
        announcement,
        announcements: getRecentGlobalAnnouncements(0),
        messages: getChatMessages(60)
      });
    } catch (err) {
      return sendJSON(res, 400, { error: err.message });
    }
  }

  // 10.7. MEDONUT CHAT COIN GIVEAWAYS (/api/giveaway/create & /api/giveaway/enter)
  if (req.method === 'POST' && pathname === '/api/giveaway/create') {
    const auth = getAuthenticatedUser(req);
    const isAdmin = Boolean(auth && auth.user && auth.usernameKey === 'medonut');
    if (!isAdmin) {
      return sendJSON(res, 403, { error: 'Only MeDonut can host Coin Giveaways.' });
    }
    const body = await readJsonBody(req);
    try {
      const result = createCoinGiveawayAdmin((auth && auth.user && auth.user.username) || 'MeDonut', {
        totalCoins: body.totalCoins,
        winnerCount: body.winnerCount,
        durationSec: body.durationSec
      });
      return sendJSON(res, 201, {
        ok: true,
        giveaway: result.giveaway,
        announcement: result.announcement,
        activeGiveaways: getActiveGiveawaysForClient(auth ? auth.usernameKey : ''),
        announcements: getRecentGlobalAnnouncements(0),
        messages: getChatMessages(60)
      });
    } catch (err) {
      return sendJSON(res, 400, { error: err.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/giveaway/enter') {
    const auth = getAuthenticatedUser(req);
    if (!auth || !auth.user) {
      return sendJSON(res, 401, { error: 'Please log in to enter Coin Giveaways!' });
    }
    const body = await readJsonBody(req);
    try {
      const entry = enterCoinGiveaway(String(body.giveawayId || '').trim(), auth.user);
      return sendJSON(res, 200, {
        ok: true,
        entry,
        activeGiveaways: getActiveGiveawaysForClient(auth.usernameKey)
      });
    } catch (err) {
      return sendJSON(res, 400, { error: err.message });
    }
  }

  // 10.8. PLAYER FEEDBACK & UPDATE SUGGESTIONS (/api/feedback)
  if (req.method === 'POST' && pathname === '/api/feedback') {
    const auth = getAuthenticatedUser(req);
    const body = await readJsonBody(req);
    const rawMsg = String(body.message || '').trim();
    if (!rawMsg || rawMsg.length < 3) {
      return sendJSON(res, 400, { error: 'Please enter at least 3 characters for your feedback or suggestion.' });
    }
    if (rawMsg.length > 600) {
      return sendJSON(res, 400, { error: 'Feedback cannot exceed 600 characters.' });
    }
    const slurCheck = checkProhibitedLanguage(rawMsg);
    if (slurCheck.isBlocked) {
      return sendJSON(res, 400, { error: 'Feedback blocked: Please keep suggestions respectful!' });
    }
    const fbCooldownKey = 'fb_' + (auth ? auth.usernameKey : (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'guest'));
    const now = Date.now();
    const FEEDBACK_COOLDOWN_MS = 5 * 60 * 1000; // 5-minute cooldown between feedback submissions
    const lastFb = chatCooldowns.get(fbCooldownKey) || 0;
    if (now - lastFb < FEEDBACK_COOLDOWN_MS) {
      const remSec = Math.ceil((FEEDBACK_COOLDOWN_MS - (now - lastFb)) / 1000);
      const mins = Math.floor(remSec / 60);
      const secs = remSec % 60;
      const waitLabel = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      return sendJSON(res, 429, { error: `Please wait ${waitLabel} before sending another feedback submission (5-minute cooldown).` });
    }
    chatCooldowns.set(fbCooldownKey, now);

    const submitter = (auth && auth.user && auth.user.username)
      ? auth.user.username
      : (String(body.guestName || 'Guest').trim().slice(0, 24) || 'Guest');
    try {
      const item = addFeedbackSubmission({
        username: submitter,
        category: body.category || 'suggestion',
        message: rawMsg
      });
      return sendJSON(res, 201, { ok: true, feedback: item });
    } catch (err) {
      return sendJSON(res, 400, { error: err.message });
    }
  }

  // --------------------------------------------------------------------------
  // 10B. RANKED DUELS ARENA ENDPOINTS (/api/duels/*)
  // --------------------------------------------------------------------------
  if (pathname.startsWith('/api/duels/')) {
    const body = req.method === 'POST' ? await readJsonBody(req) : {};
    const auth = getAuthenticatedUser(req);

    const resolveCaller = () => {
      if (auth && auth.user) {
        const u = auth.user;
        const cId = String(body.clientId || parsedUrl.query.clientId || auth.usernameKey);
        return {
          clientId: cId,
          username: u.username,
          usernameKey: auth.usernameKey,
          duelElo: typeof u.duelElo === 'number' ? u.duelElo : 1000,
          duelWins: u.duelWins || 0,
          duelLosses: u.duelLosses || 0,
          duelMatches: u.duelMatches || 0,
          duelCoins: Math.round(Number(u.duelCoins) || 0),
          selectedSkin: body.selectedSkin || u.selectedSkin || 'classic',
          selectedPipeSkin: body.selectedPipeSkin || u.selectedPipeSkin || 'classic_pipe',
          avatarSkinId: u.avatarSkinId || u.selectedSkin || 'classic'
        };
      }
      const rawGuest = String(body.guestUsername || body.adminUsername || parsedUrl.query.guestUsername || 'GuestPilot').trim().slice(0, 20) || 'GuestPilot';
      const gKey = rawGuest.toLowerCase();
      const existingUser = db.users && db.users[gKey];
      const cId = String(body.clientId || parsedUrl.query.clientId || gKey);
      return {
        clientId: cId,
        username: existingUser ? existingUser.username : rawGuest,
        usernameKey: gKey,
        duelElo: (existingUser && typeof existingUser.duelElo === 'number') ? existingUser.duelElo : 1000,
        duelWins: existingUser ? (existingUser.duelWins || 0) : 0,
        duelLosses: existingUser ? (existingUser.duelLosses || 0) : 0,
        duelMatches: existingUser ? (existingUser.duelMatches || 0) : 0,
        duelCoins: existingUser ? Math.round(Number(existingUser.duelCoins) || 0) : 0,
        selectedSkin: body.selectedSkin || (existingUser && existingUser.selectedSkin) || 'classic',
        selectedPipeSkin: body.selectedPipeSkin || (existingUser && existingUser.selectedPipeSkin) || 'classic_pipe',
        avatarSkinId: (existingUser && existingUser.avatarSkinId) || body.selectedSkin || 'classic'
      };
    };

    const caller = resolveCaller();

    // GET or POST /api/duels/state
    if (pathname === '/api/duels/state') {
      const reqLobbyId = String(body.lobbyId || parsedUrl.query.lobbyId || '');
      const reqSpectateId = String(body.spectateLobbyId || parsedUrl.query.spectateLobbyId || '');

      let activeLobby = null;
      if (reqLobbyId && duelLobbies.has(reqLobbyId)) {
        const candidateLobby = duelLobbies.get(reqLobbyId);
        advanceDuelLobbyClock(candidateLobby);
        if (shouldPruneDuelLobby(candidateLobby, Date.now())) {
          duelLobbies.delete(reqLobbyId);
        } else {
          const mySlot = candidateLobby.players.find(p => (p.slotId === caller.clientId || p.usernameKey === caller.usernameKey) && !p.leftMatch);
          if (mySlot) {
            mySlot.lastHeartbeat = Date.now();
            activeLobby = candidateLobby;
          }
        }
      } else {
        for (const lobby of duelLobbies.values()) {
          if (lobby.status !== 'finished' && !shouldPruneDuelLobby(lobby)) {
            const mySlot = lobby.players.find(p => p.slotId === caller.clientId && !p.leftMatch);
            if (mySlot) {
              mySlot.lastHeartbeat = Date.now();
              activeLobby = lobby;
              break;
            }
          }
        }
      }

      let spectatingLobby = null;
      if (reqSpectateId && duelLobbies.has(reqSpectateId)) {
        const sLobby = duelLobbies.get(reqSpectateId);
        if (!sLobby.spectators) sLobby.spectators = new Map();
        sLobby.spectators.set(caller.clientId, {
          username: caller.username,
          lastSeen: Date.now()
        });
        spectatingLobby = serializeDuelLobby(sLobby, true);
      }

      const rankedLeaderboard = buildDuelRankedLeaderboard();
      const duelHighScoreLeaderboard = buildDuelHighScoreLeaderboard(true);
      const duelHighScoreAllMatches = buildDuelHighScoreLeaderboard(false);
      const myRankEntry = rankedLeaderboard.find(r => r.username.toLowerCase() === caller.usernameKey);
      const myHighEntry = duelHighScoreLeaderboard.find(r => r.username.toLowerCase() === caller.usernameKey);

      return sendJSON(res, 200, {
        lobbies: getPublicDuelLobbiesList(),
        rankedLeaderboard,
        duelHighScoreLeaderboard,
        duelHighScoreAllMatches,
        activeLobby: activeLobby ? serializeDuelLobby(activeLobby, true) : null,
        spectatingLobby,
        myDuelStats: {
          username: caller.username,
          duelElo: myRankEntry ? myRankEntry.duelElo : caller.duelElo,
          duelWins: myRankEntry ? myRankEntry.duelWins : caller.duelWins,
          duelLosses: myRankEntry ? myRankEntry.duelLosses : caller.duelLosses,
          duelMatches: myRankEntry ? myRankEntry.duelMatches : caller.duelMatches,
          duelCoins: Math.round(Number(caller.duelCoins) || 0),
          rank: myRankEntry ? myRankEntry.rank : null,
          duelBestMatchPoints: myHighEntry ? myHighEntry.points : (caller.duelBestMatchPoints || 0),
          highScoreRank: myHighEntry ? myHighEntry.rank : null
        },
        serverTime: Date.now(),
        adminSettings: {
          blockDuelEloGapOver150: Boolean(db.adminSettings && db.adminSettings.blockDuelEloGapOver150)
        }
      });
    }

    // POST /api/duels/create
    if (req.method === 'POST' && pathname === '/api/duels/create') {
      detachPlayerFromFinishedLobbies(caller);
      // Remove caller from any old waiting lobby they hosted
      for (const [oldId, oldLobby] of duelLobbies.entries()) {
        if (oldLobby.status === 'waiting' && oldLobby.players.some(p => p.slotId === caller.clientId || (caller.usernameKey && p.usernameKey === caller.usernameKey))) {
          duelLobbies.delete(oldId);
        }
      }

      let rawLobbyName = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
      if (!rawLobbyName) {
        rawLobbyName = `${caller.username}'s Duel`;
      }
      rawLobbyName = rawLobbyName.slice(0, 36);
      const slurCheck = checkProhibitedLanguage(rawLobbyName);
      if (slurCheck.isBlocked) {
        rawLobbyName = `${caller.username}'s Duel`;
      }

      const isFriendly = Boolean(body.isFriendly);
      const rawPassword = typeof body.password === 'string' ? body.password.trim().slice(0, 24) : '';
      if (!isFriendly && rawPassword.length > 0) {
        return sendJSON(res, 400, { error: 'Passwords can only be set on Friendly Duels, not Ranked Duels!' });
      }

      const lobbyId = crypto.randomBytes(8).toString('hex');
      const newLobby = {
        id: lobbyId,
        name: rawLobbyName,
        isFriendly,
        password: isFriendly ? rawPassword : '',
        status: 'waiting',
        createdAt: Date.now(),
        currentRoundIndex: 0,
        currentRound: 'easy',
        currentRoundNumber: 1,
        currentMultiplier: 1,
        roundSeed: crypto.randomInt(1, 0x7fffffff),
        players: [createDuelPlayerSlot(caller, caller.clientId, extractClientInfo(req))],
        spectators: new Map(),
        result: null
      };

      duelLobbies.set(lobbyId, newLobby);

      return sendJSON(res, 201, {
        lobby: serializeDuelLobby(newLobby, true),
        lobbies: getPublicDuelLobbiesList(),
        rankedLeaderboard: buildDuelRankedLeaderboard()
      });
    }

    // POST /api/duels/join
    if (req.method === 'POST' && pathname === '/api/duels/join') {
      const targetId = String(body.lobbyId || '');
      const lobby = duelLobbies.get(targetId);
      if (!lobby) {
        return sendJSON(res, 404, { error: 'Lobby no longer exists.' });
      }
      advanceDuelLobbyClock(lobby);
      if (lobby.status !== 'waiting' || lobby.players.length >= 2) {
        return sendJSON(res, 400, { error: 'This lobby is already full or in a match! You can spectate it instead.' });
      }

      // If caller is already the host with the exact same clientId, just return the lobby
      if (lobby.players[0] && lobby.players[0].slotId === caller.clientId) {
        return sendJSON(res, 200, {
          lobby: serializeDuelLobby(lobby, true),
          lobbies: getPublicDuelLobbiesList()
        });
      }

      const joinSignals = extractClientInfo(req);
      if (lobby.players[0] && !lobby.players[0].isBot) {
        const altCheck = areUsersAltLinked(
          lobby.players[0].usernameKey,
          caller.usernameKey,
          lobby.players[0].clientSignals,
          joinSignals
        );
        if (altCheck.isAlt) {
          logDatabaseEvent(
            'DUEL_ALT_BLOCKED',
            caller.username,
            `🛡️ Blocked alt-vs-alt duel between "${lobby.players[0].username}" and "${caller.username}" (${altCheck.reason})`,
            { host: lobby.players[0].username, joiner: caller.username, reason: altCheck.reason }
          );
          saveDatabase(false);
          return sendJSON(res, 403, {
            error: `🛡️ Anti-Boosting: You cannot duel against your own alt account (${altCheck.reason})!`,
            altBlocked: true
          });
        }
      }

      // If MeDonut's 150-ELO battle cap toggle is ON, prevent joining Ranked lobbies over 150 ELO apart
      const blockOver150 = Boolean(db.adminSettings && db.adminSettings.blockDuelEloGapOver150);
      if (blockOver150 && !lobby.isFriendly && lobby.players[0]) {
        const hostElo = typeof lobby.players[0].elo === 'number' ? lobby.players[0].elo : 1000;
        const callerElo = typeof caller.duelElo === 'number' ? caller.duelElo : 1000;
        const eloDiff = Math.abs(hostElo - callerElo);
        if (eloDiff > 150) {
          return sendJSON(res, 403, {
            error: `Blocked by ELO Limit: ${lobby.players[0].username} (${hostElo} ELO) is ${eloDiff} points away from you (${callerElo} ELO). Max allowed difference is 150 ELO.`,
            eloBlocked: true
          });
        }
      }

      // If this Friendly Duel requires a password, verify it before allowing join
      if (lobby.isFriendly && lobby.password) {
        const suppliedPassword = typeof body.password === 'string' ? body.password.trim() : '';
        if (!suppliedPassword) {
          return sendJSON(res, 403, { error: 'This Friendly Duel requires a password.', requiresPassword: true });
        }
        if (suppliedPassword !== lobby.password) {
          return sendJSON(res, 403, { error: 'Incorrect password for this Friendly Duel lobby.', requiresPassword: true });
        }
      }

      // Clean up any finished or other waiting lobby hosted by this caller
      detachPlayerFromFinishedLobbies(caller);
      for (const [oldId, oldLobby] of duelLobbies.entries()) {
        if (oldId !== targetId && oldLobby.status === 'waiting' && oldLobby.players.some(p => p.slotId === caller.clientId || (caller.usernameKey && p.usernameKey === caller.usernameKey))) {
          duelLobbies.delete(oldId);
        }
      }

      const p2Caller = { ...caller };
      if (lobby.players[0] && lobby.players[0].username.toLowerCase() === p2Caller.username.toLowerCase()) {
        p2Caller.username = `${p2Caller.username} (2)`;
      }

      lobby.players.push(createDuelPlayerSlot(p2Caller, caller.clientId, joinSignals));
      startDuelCountdownForRound(lobby, 0); // Starts 3-second countdown for Round 1: Easy (1x)!

      return sendJSON(res, 200, {
        lobby: serializeDuelLobby(lobby, true),
        lobbies: getPublicDuelLobbiesList()
      });
    }

    // POST /api/duels/quick-match (Ranked open duels ONLY, prioritizing closest ELO opponents)
    if (req.method === 'POST' && pathname === '/api/duels/quick-match') {
      detachPlayerFromFinishedLobbies(caller);
      const callerElo = typeof caller.duelElo === 'number' ? caller.duelElo : 1000;
      const blockOver150 = Boolean(db.adminSettings && db.adminSettings.blockDuelEloGapOver150);
      const qmSignals = extractClientInfo(req);
      const joinable = [];
      for (const lobby of duelLobbies.values()) {
        advanceDuelLobbyClock(lobby);
        if (
          lobby.status === 'waiting' &&
          !lobby.isFriendly &&
          !lobby.password &&
          lobby.players.length === 1 &&
          lobby.players[0].slotId !== caller.clientId
        ) {
          if (!lobby.players[0].isBot) {
            const altCheck = areUsersAltLinked(
              lobby.players[0].usernameKey,
              caller.usernameKey,
              lobby.players[0].clientSignals,
              qmSignals
            );
            if (altCheck.isAlt) {
              continue;
            }
          }
          const hostElo = typeof lobby.players[0].elo === 'number' ? lobby.players[0].elo : 1000;
          if (blockOver150 && Math.abs(hostElo - callerElo) > 150) {
            continue;
          }
          joinable.push(lobby);
        }
      }
      joinable.sort((a, b) => {
        const eloA = (a.players[0] && typeof a.players[0].elo === 'number') ? a.players[0].elo : 1000;
        const eloB = (b.players[0] && typeof b.players[0].elo === 'number') ? b.players[0].elo : 1000;
        const diffA = Math.abs(eloA - callerElo);
        const diffB = Math.abs(eloB - callerElo);
        if (diffA !== diffB) return diffA - diffB;
        return a.createdAt - b.createdAt;
      });

      if (joinable.length > 0) {
        const bestMatchLobby = joinable[0];
        // Clean up any waiting lobby caller was hosting
        for (const [oldId, oldLobby] of duelLobbies.entries()) {
          if (oldId !== bestMatchLobby.id && oldLobby.status === 'waiting' && oldLobby.players.some(p => p.slotId === caller.clientId)) {
            duelLobbies.delete(oldId);
          }
        }

        const p2Caller = { ...caller };
        if (bestMatchLobby.players[0] && bestMatchLobby.players[0].username.toLowerCase() === p2Caller.username.toLowerCase()) {
          p2Caller.username = `${p2Caller.username} (2)`;
        }

        bestMatchLobby.players.push(createDuelPlayerSlot(p2Caller, caller.clientId, qmSignals));
        startDuelCountdownForRound(bestMatchLobby, 0);

        return sendJSON(res, 200, {
          action: 'joined',
          lobby: serializeDuelLobby(bestMatchLobby, true),
          lobbies: getPublicDuelLobbiesList()
        });
      }

      // Check if caller is already waiting in their own Ranked open lobby
      for (const [oldId, lobby] of duelLobbies.entries()) {
        if (lobby.status === 'waiting' && lobby.players.length === 1 && lobby.players[0].slotId === caller.clientId) {
          if (!lobby.isFriendly && !lobby.password) {
            lobby.players[0].lastHeartbeat = Date.now();
            return sendJSON(res, 200, {
              action: 'waiting',
              lobby: serializeDuelLobby(lobby, true),
              lobbies: getPublicDuelLobbiesList()
            });
          }
          // Replace caller's waiting Friendly/passworded lobby when clicking Quick Ranked Match
          duelLobbies.delete(oldId);
        }
      }

      // No joinable Ranked lobby exists -> automatically create a new Ranked lobby!
      const lobbyId = crypto.randomBytes(8).toString('hex');
      const newLobby = {
        id: lobbyId,
        name: `${caller.username}'s Duel`,
        isFriendly: false,
        password: '',
        status: 'waiting',
        createdAt: Date.now(),
        currentRoundIndex: 0,
        currentRound: 'easy',
        currentRoundNumber: 1,
        currentMultiplier: 1,
        roundSeed: crypto.randomInt(1, 0x7fffffff),
        players: [createDuelPlayerSlot(caller, caller.clientId, extractClientInfo(req))],
        spectators: new Map(),
        result: null
      };
      duelLobbies.set(lobbyId, newLobby);

      return sendJSON(res, 201, {
        action: 'created',
        lobby: serializeDuelLobby(newLobby, true),
        lobbies: getPublicDuelLobbiesList()
      });
    }

    // POST /api/duels/leave (deletes waiting lobby OR immediately forfeits an active match!)
    if (req.method === 'POST' && pathname === '/api/duels/leave') {
      const targetId = String(body.lobbyId || '');
      const leaveReason = body.reason === 'tab_closed' ? 'Closed Tab' : 'Left Match';
      const idsToCheck = targetId ? [targetId] : Array.from(duelLobbies.keys());
      for (const lid of idsToCheck) {
        const lobby = duelLobbies.get(lid);
        if (!lobby) continue;
        const leaver = lobby.players.find(p => p.slotId === caller.clientId || p.usernameKey === caller.usernameKey);
        if (!leaver) continue;

        if (lobby.status === 'waiting') {
          duelLobbies.delete(lid);
        } else if (lobby.status === 'finished') {
          leaver.leftMatch = true;
          if (shouldPruneDuelLobby(lobby, Date.now())) {
            duelLobbies.delete(lid);
          }
        } else {
          forfeitDuelPlayer(lobby, leaver, leaveReason);
        }
      }
      return sendJSON(res, 200, {
        ok: true,
        lobbies: getPublicDuelLobbiesList()
      });
    }

    // POST /api/duels/live-update
    if (req.method === 'POST' && pathname === '/api/duels/live-update') {
      const targetId = String(body.lobbyId || '');
      const lobby = duelLobbies.get(targetId);
      if (!lobby) {
        return sendJSON(res, 404, { error: 'Lobby not found' });
      }
      advanceDuelLobbyClock(lobby);

      const player = lobby.players.find(p => p.slotId === caller.clientId) ||
                     lobby.players.find(p => p.usernameKey === caller.usernameKey);
      if (player) {
        const now = Date.now();
        player.lastHeartbeat = now;

        const rKey = lobby.currentRound || 'easy';
        const isCurrentPlayingRound = (
          lobby.status === 'playing' &&
          (!body.round || body.round === rKey) &&
          player.rounds &&
          player.rounds[rKey] &&
          !player.rounds[rKey].finished
        );

        if (isCurrentPlayingRound) {
          if (typeof body.birdY === 'number' && Number.isFinite(body.birdY)) {
            player.live.birdY = body.birdY;
          }
          if (typeof body.birdVelocityY === 'number' && Number.isFinite(body.birdVelocityY)) {
            player.live.birdVelocityY = body.birdVelocityY;
          }
          if (typeof body.rotZ === 'number' && Number.isFinite(body.rotZ)) {
            player.live.rotZ = body.rotZ;
          }
          if (typeof body.alive === 'boolean') {
            player.live.alive = body.alive;
          }
          if (typeof body.speed === 'number' && Number.isFinite(body.speed) && body.speed > 0) {
            player.live.speed = body.speed;
          }
          if (Array.isArray(body.pipes)) {
            player.live.pipes = body.pipes.slice(0, 4).map(pp => ({
              x: Number(pp.x) || 0,
              bottomTopY: Number(pp.bottomTopY) || 3,
              topBottomY: Number(pp.topBottomY) || 8,
              gapCenterY: Number(pp.gapCenterY) || 5.5,
              gapSize: Number(pp.gapSize) || 5
            }));
          }
          player.live.updatedAt = now;

          const cleanScore = Math.max(0, Math.floor(Number(body.score) || 0));
          player.live.score = cleanScore;
          if (cleanScore > player.rounds[rKey].rawScore) {
            player.rounds[rKey].rawScore = cleanScore;
          }
          recomputeDuelPlayerPoints(player);
        }
      }

      return sendJSON(res, 200, {
        lobby: serializeDuelLobby(lobby, true)
      });
    }

    // POST /api/duels/round-finish
    if (req.method === 'POST' && pathname === '/api/duels/round-finish') {
      const targetId = String(body.lobbyId || '');
      const lobby = duelLobbies.get(targetId);
      if (!lobby) {
        return sendJSON(res, 404, { error: 'Lobby not found' });
      }
      advanceDuelLobbyClock(lobby);

      const player = lobby.players.find(p => p.slotId === caller.clientId) ||
                     lobby.players.find(p => p.usernameKey === caller.usernameKey);
      const rKey = (body.round && DUEL_ROUNDS.includes(body.round)) ? body.round : (lobby.currentRound || 'easy');

      let runResult = null;
      if (player && DUEL_ROUNDS.includes(rKey)) {
        const cleanScore = Math.max(0, Math.floor(Number(body.rawScore) || 0));
        player.rounds[rKey].rawScore = cleanScore;
        player.rounds[rKey].finished = true;
        player.roundFinishedAt = Date.now();
        player.live.score = cleanScore;
        player.live.alive = false;
        player.lastHeartbeat = Date.now();
        recomputeDuelPlayerPoints(player);

        // Also submit to the normal leaderboard if authenticated, score > 0, and replay passes anti-cheat (speedhack + slow-mo)!
        const auth = getAuthenticatedUser(req);
        if (auth && cleanScore > 0 && Array.isArray(body.flapTicks) && typeof body.totalTicks === 'number') {
          const elapsedWallMs = Date.now() - (lobby.roundStartedAt || Date.now());
          const simulatedDurationMs = (body.totalTicks / SIM_CONFIG.tickRate) * 1000;
          const isSlowMo = simulatedDurationMs >= 4000 && elapsedWallMs > (simulatedDurationMs * 1.50 + 6000);
          if (simulatedDurationMs <= elapsedWallMs + 3500 && !isSlowMo) {
            const verification = verifyGameReplay({
              seed: lobby.roundSeed,
              difficulty: rKey,
              flapTicks: body.flapTicks,
              totalTicks: body.totalTicks,
              claimedScore: cleanScore
            });
            if (verification.valid && verification.verifiedScore > 0) {
              runResult = processVerifiedRunSubmission(auth.user, rKey, verification.verifiedScore, { leanDifficultyOnly: true });
            }
          }
        }
      }

      advanceDuelLobbyClock(lobby);

      return sendJSON(res, 200, {
        lobby: serializeDuelLobby(lobby, true),
        runResult
      });
    }

    // POST /api/duels/call-bot (MeDonut Admin Action: Summon AI Bot into a Duel or Spawn Bot Lobby)
    if (req.method === 'POST' && pathname === '/api/duels/call-bot') {
      const isAdmin = Boolean(isMeDonutAdmin(req)) || caller.usernameKey === 'medonut';
      if (!isAdmin) {
        return sendJSON(res, 403, { error: 'Only MeDonut can call bots into Duel Battles.' });
      }

      const targetLobbyId = String(body.lobbyId || '');
      const mode = String(body.mode || 'join_or_start');

      // 1. If a specific waiting lobbyId is given (or MeDonut is currently waiting in a lobby), add a Bot Challenger to it!
      let targetLobby = targetLobbyId ? duelLobbies.get(targetLobbyId) : null;
      if (!targetLobby && mode !== 'bot_lobby') {
        for (const l of duelLobbies.values()) {
          if (l.status === 'waiting' && l.players.length === 1 && (l.players[0].slotId === caller.clientId || l.players[0].usernameKey === caller.usernameKey)) {
            targetLobby = l;
            break;
          }
        }
      }

      if (targetLobby && targetLobby.status === 'waiting' && targetLobby.players.length < 2) {
        const hostElo = targetLobby.players[0] ? targetLobby.players[0].elo : caller.duelElo;
        const botSlot = createDuelBotSlot(hostElo);
        targetLobby.players.push(botSlot);
        startDuelCountdownForRound(targetLobby, 0);

        return sendJSON(res, 200, {
          action: 'bot_joined_lobby',
          lobby: serializeDuelLobby(targetLobby, true),
          lobbies: getPublicDuelLobbiesList()
        });
      }

      // 2. If mode === 'bot_lobby', spawn a waiting lobby hosted by an AI Bot so anyone can join it or spectate!
      if (mode === 'bot_lobby') {
        const botHost = createDuelBotSlot(caller.duelElo);
        const lobbyId = crypto.randomBytes(8).toString('hex');
        const botLobby = {
          id: lobbyId,
          name: `${botHost.username}'s Arena`,
          isFriendly: false,
          password: '',
          status: 'waiting',
          createdAt: Date.now(),
          currentRoundIndex: 0,
          currentRound: 'easy',
          currentRoundNumber: 1,
          currentMultiplier: 1,
          roundSeed: crypto.randomInt(1, 0x7fffffff),
          players: [botHost],
          spectators: new Map(),
          result: null
        };
        duelLobbies.set(lobbyId, botLobby);
        return sendJSON(res, 201, {
          action: 'bot_lobby_created',
          botLobby: serializeDuelLobby(botLobby, false),
          lobbies: getPublicDuelLobbiesList()
        });
      }

      // 3. Default: Create a new Duel Match with MeDonut vs an AI Bot and immediately start the 3s countdown!
      const lobbyId = crypto.randomBytes(8).toString('hex');
      const meSlot = createDuelPlayerSlot(caller, caller.clientId);
      const botSlot = createDuelBotSlot(caller.duelElo);
      const newLobby = {
        id: lobbyId,
        name: `${caller.username} vs ${botSlot.username}`,
        isFriendly: false,
        password: '',
        status: 'waiting',
        createdAt: Date.now(),
        currentRoundIndex: 0,
        currentRound: 'easy',
        currentRoundNumber: 1,
        currentMultiplier: 1,
        roundSeed: crypto.randomInt(1, 0x7fffffff),
        players: [meSlot, botSlot],
        spectators: new Map(),
        result: null
      };
      duelLobbies.set(lobbyId, newLobby);
      startDuelCountdownForRound(newLobby, 0);

      return sendJSON(res, 201, {
        action: 'bot_duel_started',
        lobby: serializeDuelLobby(newLobby, true),
        lobbies: getPublicDuelLobbiesList()
      });
    }

    // POST /api/duels/admin-set-elo (MeDonut Admin Action: Change any player's Ranked Elo)
    if (req.method === 'POST' && pathname === '/api/duels/admin-set-elo') {
      const isAdmin = Boolean(isMeDonutAdmin(req)) || caller.usernameKey === 'medonut';
      if (!isAdmin) {
        return sendJSON(res, 403, { error: 'Only MeDonut can change player Ranked Elo.' });
      }
      const targetUsername = String(body.username || body.targetUsername || '').trim();
      if (!targetUsername) {
        return sendJSON(res, 400, { error: 'Target username is required.' });
      }
      try {
        const result = adminUpdatePlayerDuelElo(targetUsername, body.newElo ?? body.elo);
        // Also update any active duel lobbies where this player is present
        const targetKey = targetUsername.toLowerCase();
        for (const l of duelLobbies.values()) {
          for (const p of l.players) {
            if (p.usernameKey === targetKey) {
              p.elo = result.newElo;
            }
          }
        }
        const rankedLeaderboard = buildDuelRankedLeaderboard();
        const myRankEntry = rankedLeaderboard.find(r => r.username.toLowerCase() === caller.usernameKey);
        return sendJSON(res, 200, {
          ok: true,
          duelElo: result.newElo,
          result,
          rankedLeaderboard,
          lobbies: getPublicDuelLobbiesList(),
          myDuelStats: myRankEntry ? {
            username: myRankEntry.username,
            duelElo: myRankEntry.duelElo,
            duelWins: myRankEntry.duelWins,
            duelLosses: myRankEntry.duelLosses,
            duelMatches: myRankEntry.duelMatches,
            rank: myRankEntry.rank
          } : null
        });
      } catch (err) {
        return sendJSON(res, 400, { error: err.message });
      }
    }

    // POST /api/duels/admin-set-points (MeDonut Admin Action: Change any player's Duel Total Points leaderboard score)
    if (req.method === 'POST' && pathname === '/api/duels/admin-set-points') {
      const isAdmin = Boolean(isMeDonutAdmin(req)) || caller.usernameKey === 'medonut';
      if (!isAdmin) {
        return sendJSON(res, 403, { error: 'Only MeDonut can change player Duel Total Points.' });
      }
      const targetUsername = String(body.username || body.targetUsername || '').trim();
      if (!targetUsername) {
        return sendJSON(res, 400, { error: 'Target username is required.' });
      }
      try {
        const result = adminUpdatePlayerDuelPoints(targetUsername, body.newPoints ?? body.points);
        const rankedLeaderboard = buildDuelRankedLeaderboard();
        const duelHighScoreLeaderboard = buildDuelHighScoreLeaderboard(true);
        const duelHighScoreAllMatches = buildDuelHighScoreLeaderboard(false);
        const myRankEntry = rankedLeaderboard.find(r => r.username.toLowerCase() === caller.usernameKey);
        const myHighEntry = duelHighScoreLeaderboard.find(r => r.username.toLowerCase() === caller.usernameKey);
        return sendJSON(res, 200, {
          ok: true,
          points: result.newPoints,
          result,
          duelHighScoreLeaderboard,
          duelHighScoreAllMatches,
          myDuelStats: {
            username: caller.username,
            duelElo: myRankEntry ? myRankEntry.duelElo : caller.duelElo,
            duelWins: myRankEntry ? myRankEntry.duelWins : caller.duelWins,
            duelLosses: myRankEntry ? myRankEntry.duelLosses : caller.duelLosses,
            duelMatches: myRankEntry ? myRankEntry.duelMatches : caller.duelMatches,
            duelCoins: Math.round(Number(caller.duelCoins) || 0),
            rank: myRankEntry ? myRankEntry.rank : null,
            duelBestMatchPoints: myHighEntry ? myHighEntry.points : 0,
            highScoreRank: myHighEntry ? myHighEntry.rank : null
          }
        });
      } catch (err) {
        return sendJSON(res, 400, { error: err.message });
      }
    }

    return sendJSON(res, 404, { error: 'Unknown duels endpoint: ' + pathname });
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
    const sinceIso = parsedUrl.query && parsedUrl.query.sinceUpdated;
    if (sinceIso && db.databaseStatus && db.databaseStatus.lastUpdatedISO === sinceIso) {
      return sendJSON(res, 200, {
        ok: true,
        unchanged: true,
        lastUpdatedISO: db.databaseStatus.lastUpdatedISO
      });
    }
    return sendJSON(res, 200, {
      ok: true,
      dbFilePath: DB_FILE,
      databaseStatus: db.databaseStatus,
      playerRecordsOverview: db.playerRecordsOverview,
      adminSettings: db.adminSettings || {},
      activityFeed: (db.activityFeed || []).slice(0, 100),
      leaderboards: buildLeaderboards(),
      allRuns: getAllRunsAdmin(),
      loginHistory: (db.loginHistory || []).slice(0, 300),
      feedbackSubmissions: getFeedbackSubmissions()
    });
  }

  if (req.method === 'GET' && pathname === '/api/database/export') {
    const fullExport = getFullDatabaseSnapshot();
    const jsonBody = JSON.stringify(fullExport, null, 2);
    const outHeaders = {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="db.json"',
      'Cache-Control': 'no-store'
    };
    if (res._acceptGzip && jsonBody.length > 1536) {
      zlib.gzip(jsonBody, { level: 5 }, (gzErr, gzBuf) => {
        if (!res || res.headersSent || res.writableEnded || res.destroyed) return;
        try {
          if (!gzErr && gzBuf) {
            outHeaders['Content-Encoding'] = 'gzip';
            outHeaders['Vary'] = 'Accept-Encoding';
            res.writeHead(200, outHeaders);
            res.end(gzBuf);
            return;
          }
          res.writeHead(200, outHeaders);
          res.end(jsonBody);
        } catch (_) {}
      });
      return;
    }
    if (!res.headersSent && !res.writableEnded && !res.destroyed) {
      res.writeHead(200, outHeaders);
      res.end(jsonBody);
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/database/update-record') {
    const { username, records, selectedSkin, selectedPipeSkin, duelElo, duelCoins } = await readJsonBody(req);
    if (!username) {
      return sendJSON(res, 400, { error: 'Username is required.' });
    }
    try {
      const updatedOverview = updatePlayerRecordsAdmin(username, records, selectedSkin, selectedPipeSkin, duelElo, duelCoins);
      return sendJSON(res, 200, {
        ok: true,
        success: true,
        updatedPlayer: updatedOverview,
        databaseStatus: db.databaseStatus,
        playerRecordsOverview: db.playerRecordsOverview,
        activityFeed: (db.activityFeed || []).slice(0, 100),
        leaderboards: buildLeaderboards(),
        allRuns: getAllRunsAdmin(),
        loginHistory: (db.loginHistory || []).slice(0, 300),
        feedbackSubmissions: getFeedbackSubmissions()
      });
    } catch (err) {
      return sendJSON(res, 400, { error: err.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/database/toggle-extreme-access') {
    const { username, granted } = await readJsonBody(req);
    if (!username) {
      return sendJSON(res, 400, { error: 'Username is required.' });
    }
    try {
      const updatedPlayer = adminSetExtremeAccess(username, Boolean(granted));
      return sendJSON(res, 200, {
        ok: true,
        updatedPlayer,
        databaseStatus: db.databaseStatus,
        playerRecordsOverview: db.playerRecordsOverview,
        activityFeed: (db.activityFeed || []).slice(0, 100),
        leaderboards: buildLeaderboards(),
        allRuns: getAllRunsAdmin(),
        loginHistory: (db.loginHistory || []).slice(0, 300),
        feedbackSubmissions: getFeedbackSubmissions()
      });
    } catch (err) {
      return sendJSON(res, 400, { error: err.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/database/delete-feedback') {
    const { id } = await readJsonBody(req);
    if (!id) {
      return sendJSON(res, 400, { error: 'Feedback ID is required.' });
    }
    const resDel = deleteFeedbackSubmissionAdmin(String(id).trim());
    if (!resDel.deleted) {
      return sendJSON(res, 404, { error: 'Feedback submission not found.' });
    }
    return sendJSON(res, 200, {
      ok: true,
      deletedId: id,
      feedbackSubmissions: getFeedbackSubmissions(),
      databaseStatus: db.databaseStatus,
      activityFeed: (db.activityFeed || []).slice(0, 100)
    });
  }

  if (req.method === 'POST' && pathname === '/api/database/update-run') {
    const { difficulty, entryId, score, hidden } = await readJsonBody(req);
    if (!difficulty || !entryId) {
      return sendJSON(res, 400, { error: 'difficulty and entryId are required.' });
    }
    try {
      const result = updateLeaderboardRunAdmin(difficulty, entryId, { score, hidden });
      return sendJSON(res, 200, {
        ok: true,
        success: true,
        ...result,
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

  if (req.method === 'POST' && pathname === '/api/database/add-run') {
    const { username, difficulty, score, hidden } = await readJsonBody(req);
    if (!username || !difficulty || score === undefined) {
      return sendJSON(res, 400, { error: 'username, difficulty, and score are required.' });
    }
    try {
      const newRun = addLeaderboardRunAdmin(username, difficulty, score, hidden);
      return sendJSON(res, 200, {
        ok: true,
        success: true,
        run: newRun,
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

  if (req.method === 'POST' && pathname === '/api/database/toggle-user-visibility') {
    const { username, difficulty, hidden } = await readJsonBody(req);
    if (!username || hidden === undefined) {
      return sendJSON(res, 400, { error: 'username and hidden boolean are required.' });
    }
    try {
      const result = toggleUserRunsVisibilityAdmin(username, difficulty, hidden);
      return sendJSON(res, 200, {
        ok: true,
        success: true,
        ...result,
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

  if (req.method === 'POST' && pathname === '/api/database/delete-run') {
    const { difficulty, entryId } = await readJsonBody(req);
    try {
      const removed = deleteLeaderboardEntryAdmin(difficulty, entryId);
      return sendJSON(res, 200, {
        ok: true,
        success: true,
        removed,
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

  // 12. Admin Skin Inventory & Lock Manager (Grant, Revoke, Lock, or Change Equipped)
  if (req.method === 'POST' && pathname === '/api/database/update-user-skins') {
    const {
      username,
      grantSkinId,
      revokeSkinId,
      lockSkinId,
      unlockSkinId,
      selectedSkin,
      selectedPipeSkin,
      selectedBackground,
      clearCustomImage,
      clearCustomVideo
    } = await readJsonBody(req);
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
        selectedPipeSkin,
        selectedBackground,
        clearCustomImage: Boolean(clearCustomImage),
        clearCustomVideo: Boolean(clearCustomVideo)
      });
      return sendJSON(res, 200, {
        ok: true,
        success: true,
        message: `Updated skins for ${result.username}!`,
        ...result,
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

  // 12b. Admin Ban Player + All Alts (Blocks existing & newly created accounts) & Unban
  if (req.method === 'POST' && pathname === '/api/database/ban-user') {
    const { username, includeAlts, reason } = await readJsonBody(req).catch(() => ({}));
    if (!username) {
      return sendJSON(res, 400, { error: 'Username is required.' });
    }
    try {
      const result = banPlayerAndAltsAdmin(username, {
        includeAlts: includeAlts !== false,
        reason
      });
      const bannedSet = new Set((result.bannedUsernames || []).map(n => n.toLowerCase()));
      for (const [lid, lobby] of duelLobbies.entries()) {
        if (lobby && lobby.status === 'waiting' && Array.isArray(lobby.players) &&
            lobby.players.some(p => p && bannedSet.has(String(p.usernameKey || p.username || '').toLowerCase()))) {
          duelLobbies.delete(lid);
        }
      }
      return sendJSON(res, 200, {
        ok: true,
        success: true,
        ...result,
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

  if (req.method === 'POST' && pathname === '/api/database/unban-user') {
    const { username, includeAlts } = await readJsonBody(req).catch(() => ({}));
    if (!username) {
      return sendJSON(res, 400, { error: 'Username is required.' });
    }
    try {
      const result = unbanPlayerAdmin(username, {
        includeAlts: includeAlts !== false
      });
      return sendJSON(res, 200, {
        ok: true,
        success: true,
        ...result,
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

  // 13. Admin Multi-Account / Alt Detection (Device ID + Hardware Fingerprint + IP)
  if (req.method === 'GET' && pathname === '/api/database/find-alts') {
    const username = parsedUrl.query && parsedUrl.query.username ? String(parsedUrl.query.username).trim() : '';
    if (!username) {
      return sendJSON(res, 400, { error: 'Username query parameter is required.' });
    }
    try {
      const result = findAltAccountsForUser(username);
      return sendJSON(res, 200, {
        ok: true,
        ...result
      });
    } catch (err) {
      return sendJSON(res, 404, { error: err.message });
    }
  }

  // 13b. Admin Player Ranked Duel History (Opponent, Easy/Med/Hard scores, Total, ELO change)
  if (req.method === 'GET' && pathname === '/api/database/duel-history') {
    const username = parsedUrl.query && parsedUrl.query.username ? String(parsedUrl.query.username).trim() : '';
    if (!username) {
      return sendJSON(res, 400, { error: 'Username query parameter is required.' });
    }
    const uKey = username.toLowerCase();
    const user = db.users && db.users[uKey];
    if (!user) {
      return sendJSON(res, 404, { error: `Player "${username}" not found in database.` });
    }
    const history = getPlayerRankedDuelHistory(user.username, 100);
    return sendJSON(res, 200, {
      ok: true,
      username: user.username,
      duelElo: typeof user.duelElo === 'number' ? user.duelElo : 1000,
      duelWins: user.duelWins || 0,
      duelLosses: user.duelLosses || 0,
      duelDraws: user.duelDraws || 0,
      duelMatches: user.duelMatches || 0,
      duelBestMatchPoints: Number(user.duelBestMatchPoints) || 0,
      history
    });
  }

  // 13c. Admin Global Settings Toggle (e.g. Block Ranked Duels Over 150 ELO Gap & Global Default Account Limit)
  if (req.method === 'POST' && pathname === '/api/database/admin-settings') {
    const body = await readJsonBody(req).catch(() => ({}));
    if (!db.adminSettings || typeof db.adminSettings !== 'object') {
      db.adminSettings = {};
    }
    let settingsChanged = false;
    if (typeof body.blockDuelEloGapOver150 === 'boolean') {
      db.adminSettings.blockDuelEloGapOver150 = body.blockDuelEloGapOver150;
      const stateLabel = body.blockDuelEloGapOver150 ? 'ENABLED (blocked >150 ELO difference)' : 'DISABLED (reverted to >150/200/300 ELO scaling)';
      logDatabaseEvent(
        'SETTINGS_UPDATE',
        'MeDonut',
        `⚖️ MeDonut ${stateLabel} for Ranked Duels matchmaking`,
        { blockDuelEloGapOver150: db.adminSettings.blockDuelEloGapOver150 }
      );
      settingsChanged = true;
    }
    if (body.defaultMaxAccounts !== undefined && body.defaultMaxAccounts !== null) {
      const cleanDef = Math.max(1, Math.min(50, Math.floor(Number(body.defaultMaxAccounts) || 5)));
      db.adminSettings.defaultMaxAccounts = cleanDef;
      logDatabaseEvent(
        'SETTINGS_UPDATE',
        'MeDonut',
        `👥 MeDonut set global Default Account Limit to ${cleanDef} account(s) per player`,
        { defaultMaxAccounts: cleanDef }
      );
      settingsChanged = true;
    }
    if (settingsChanged) {
      saveDatabase(true);
    }
    return sendJSON(res, 200, {
      ok: true,
      adminSettings: db.adminSettings,
      databaseStatus: db.databaseStatus,
      playerRecordsOverview: db.playerRecordsOverview,
      activityFeed: (db.activityFeed || []).slice(0, 100),
      leaderboards: buildLeaderboards(),
      allRuns: getAllRunsAdmin(),
      loginHistory: (db.loginHistory || []).slice(0, 300),
      feedbackSubmissions: getFeedbackSubmissions()
    });
  }

  // 13d. Admin Set Account Limit for a Player (+ linked alts, saved persistently in db.json)
  if (req.method === 'POST' && pathname === '/api/database/set-account-limit') {
    const { username, maxAccounts } = await readJsonBody(req).catch(() => ({}));
    if (!username) {
      return sendJSON(res, 400, { error: 'Username is required.' });
    }
    try {
      const result = adminSetUserAccountLimit(username, maxAccounts);
      return sendJSON(res, 200, {
        ...result,
        adminSettings: db.adminSettings,
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

  // 14. Admin Permanent Player Account Deletion (lean fast response!)
  if (req.method === 'POST' && pathname === '/api/database/delete-account') {
    const { username } = await readJsonBody(req);
    if (!username) {
      return sendJSON(res, 400, { error: 'Username is required.' });
    }
    try {
      const result = deletePlayerAccountAdmin(username);
      return sendJSON(res, 200, {
        ok: true,
        success: true,
        message: `Permanently deleted account "${result.deletedUsername}".`,
        ...result,
        databaseStatus: db.databaseStatus,
        latestActivityEvent: (db.activityFeed && db.activityFeed[0]) || null
      });
    } catch (err) {
      return sendJSON(res, 400, { error: err.message });
    }
  }

  return sendJSON(res, 404, { error: 'API endpoint not found: ' + pathname });
}

module.exports = {
  handleApiRequest,
  getLocalAddresses,
  runBackgroundCleanupTick
};
