/**
 * ============================================================================
 * API ROUTES HANDLER (AUTH, LEADERBOARDS, ANTI-CHEAT RUNS & LIVE DB MANAGER)
 * ============================================================================
 */

const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { SIM_CONFIG, createSeededPRNG, getDifficultyParams } = require('../config/physicsConfig');
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
  adminUpdatePlayerDuelElo,
  resetAllRecordsAdmin,
  formatReadableTimestamp,
  isSkinUnlockedForUser,
  isWithinDanishWindow,
  getChatMessages,
  addChatMessage,
  calculateDuelEloUpdate,
  recordDuelMatchResult,
  buildDuelRankedLeaderboard,
  buildDuelHighScoreLeaderboard,
  trackUserClientSignals,
  findAltAccountsForUser,
  deletePlayerAccountAdmin
} = require('../services/database');

function extractClientInfo(req) {
  const rawFwd = req && req.headers ? (req.headers['x-forwarded-for'] || '') : '';
  const sockIp = req && req.socket ? (req.socket.remoteAddress || '') : '';
  const ip = String(rawFwd || sockIp || '').split(',')[0].trim();
  const deviceId = req && req.headers ? String(req.headers['x-device-id'] || '').trim() : '';
  const fingerprint = req && req.headers ? String(req.headers['x-device-fingerprint'] || '').trim() : '';
  return { ip, deviceId, fingerprint };
}

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

// ============================================================================
// RANKED DUELS LOBBY & 3-ROUND MATCH ENGINE (Easy 1x -> Medium 2x -> Hard 3x)
// ============================================================================
const duelLobbies = new Map(); // lobbyId -> lobbyObj
const DUEL_ROUNDS = ['easy', 'medium', 'hard'];
const DUEL_MULTIPLIERS = { easy: 1, medium: 2, hard: 3 };
const DUEL_ROUND_LABELS = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

function recomputeDuelPlayerPoints(p) {
  if (!p || !p.rounds) return 0;
  p.rounds.easy.weightedScore = Math.max(0, Math.floor(Number(p.rounds.easy.rawScore) || 0)) * 1;
  p.rounds.medium.weightedScore = Math.max(0, Math.floor(Number(p.rounds.medium.rawScore) || 0)) * 2;
  p.rounds.hard.weightedScore = Math.max(0, Math.floor(Number(p.rounds.hard.rawScore) || 0)) * 3;
  p.totalPoints = p.rounds.easy.weightedScore + p.rounds.medium.weightedScore + p.rounds.hard.weightedScore;
  return p.totalPoints;
}

function createDuelPlayerSlot(identity, slotId) {
  const now = Date.now();
  return {
    slotId: String(slotId || identity.clientId || identity.usernameKey || crypto.randomBytes(6).toString('hex')),
    username: identity.username,
    usernameKey: identity.usernameKey,
    elo: typeof identity.duelElo === 'number' ? identity.duelElo : 1000,
    selectedSkin: identity.selectedSkin || 'classic',
    selectedPipeSkin: identity.selectedPipeSkin || 'classic_pipe',
    avatarSkinId: identity.avatarSkinId || identity.selectedSkin || 'classic',
    lastHeartbeat: now,
    rounds: {
      easy: { rawScore: 0, weightedScore: 0, multiplier: 1, finished: false },
      medium: { rawScore: 0, weightedScore: 0, multiplier: 2, finished: false },
      hard: { rawScore: 0, weightedScore: 0, multiplier: 3, finished: false }
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

function finalizeDuelLobbyMatch(lobby) {
  if (!lobby || (lobby.status === 'finished' && lobby.result)) return;
  const now = Date.now();
  lobby.status = 'finished';
  lobby.finishedAt = now;

  const p1 = lobby.players[0];
  const p2 = lobby.players[1];
  if (!p1 || !p2) return;

  recomputeDuelPlayerPoints(p1);
  recomputeDuelPlayerPoints(p2);

  let eloRes;
  if (p1.usernameKey !== p2.usernameKey) {
    eloRes = recordDuelMatchResult(p1.username, p2.username, p1.totalPoints, p2.totalPoints, {
      roundsA: p1.rounds,
      roundsB: p2.rounds
    });
  } else {
    eloRes = calculateDuelEloUpdate(p1.elo, p2.elo, p1.totalPoints, p2.totalPoints);
  }

  let winnerSlotId = null;
  let winnerUsername = null;
  let isDraw = false;
  if (p1.totalPoints > p2.totalPoints) {
    winnerSlotId = p1.slotId;
    winnerUsername = p1.username;
  } else if (p2.totalPoints > p1.totalPoints) {
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
  const targetScore = (bot.botTargets && typeof bot.botTargets[rKey] === 'number') ? bot.botTargets[rKey] : 8;
  const dt = SIM_CONFIG.dt;

  if (!bot.botSim || bot.botSim.roundKey !== rKey || bot.botSim.roundSeed !== lobby.roundSeed) {
    const prng = createSeededPRNG((lobby.roundSeed || 12345) ^ ((bot.botPhase ? Math.floor(bot.botPhase * 1000) : 0)));
    const initDiff = getDifficultyParams(0, rKey);
    const spawnPipe = (xPos, gapSize) => {
      const minCenterY = SIM_CONFIG.groundY + 2.4 + gapSize * 0.5;
      const maxCenterY = SIM_CONFIG.ceilingY - 2.6 - gapSize * 0.5;
      const gapCenterY = minCenterY + prng() * Math.max(0.5, maxCenterY - minCenterY);
      return {
        x: xPos,
        bottomTopY: gapCenterY - gapSize * 0.5,
        topBottomY: gapCenterY + gapSize * 0.5,
        gapCenterY,
        gapSize,
        passed: false
      };
    };

    bot.botSim = {
      roundKey: rKey,
      roundSeed: lobby.roundSeed,
      ticksSimulated: 0,
      birdY: SIM_CONFIG.birdStartY,
      birdVelocityY: SIM_CONFIG.flapImpulse * 0.65,
      score: 0,
      distanceSinceLastPipe: 0,
      flapCooldownTicks: 0,
      prng,
      pipes: [
        spawnPipe(SIM_CONFIG.pipeSpawnX - SIM_CONFIG.baseSpawnDistance * 2, initDiff.pipeGap),
        spawnPipe(SIM_CONFIG.pipeSpawnX - SIM_CONFIG.baseSpawnDistance, initDiff.pipeGap),
        spawnPipe(SIM_CONFIG.pipeSpawnX, initDiff.pipeGap)
      ]
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
      const aimY = nextPipe ? (nextPipe.gapCenterY - 0.15) : SIM_CONFIG.birdStartY;
      if (sim.birdY < aimY - 0.25 && sim.birdVelocityY <= 0.8 && sim.flapCooldownTicks === 0) {
        sim.birdVelocityY = diff.flapImpulse;
        sim.flapCooldownTicks = 6;
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
    const r = SIM_CONFIG.birdRadius;
    const capReachX = SIM_CONFIG.pipeCapRadius + r - 0.08;
    const shaftReachX = SIM_CONFIG.pipeRadius + r - 0.08;

    sim.distanceSinceLastPipe += diff.speed * dt;
    for (let i = sim.pipes.length - 1; i >= 0; i--) {
      const pipe = sim.pipes[i];
      pipe.x -= diff.speed * dt;
      if (!pipe.passed && pipe.x < bx) {
        pipe.passed = true;
        sim.score++;
      }
      const dx = Math.abs(bx - pipe.x);
      if (dx < capReachX) {
        const nearBottomCap = by >= (pipe.bottomTopY - SIM_CONFIG.pipeCapHeight - r);
        const nearTopCap = by <= (pipe.topBottomY + SIM_CONFIG.pipeCapHeight + r);
        const effX = (nearBottomCap || nearTopCap) ? capReachX : shaftReachX;
        if (dx < effX && (by - r < pipe.bottomTopY || by + r > pipe.topBottomY)) {
          if (shouldThrow) {
            crashed = true;
            break;
          }
        }
      }
      if (pipe.x < SIM_CONFIG.pipeDespawnX) {
        sim.pipes.splice(i, 1);
      }
    }
    if (crashed) break;

    if (sim.distanceSinceLastPipe >= SIM_CONFIG.baseSpawnDistance) {
      sim.distanceSinceLastPipe -= SIM_CONFIG.baseSpawnDistance;
      const gSize = diff.pipeGap;
      const minCenterY = SIM_CONFIG.groundY + 2.4 + gSize * 0.5;
      const maxCenterY = SIM_CONFIG.ceilingY - 2.6 - gSize * 0.5;
      const gapCenterY = minCenterY + sim.prng() * Math.max(0.5, maxCenterY - minCenterY);
      sim.pipes.push({
        x: SIM_CONFIG.pipeSpawnX,
        bottomTopY: gapCenterY - gSize * 0.5,
        topBottomY: gapCenterY + gSize * 0.5,
        gapCenterY,
        gapSize: gSize,
        passed: false
      });
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

  if (lobby.status === 'round_summary') {
    if (now >= lobby.summaryEndsAt) {
      if (lobby.currentRoundIndex === 0) {
        startDuelCountdownForRound(lobby, 1, lobby.summaryEndsAt);
      } else if (lobby.currentRoundIndex === 1) {
        startDuelCountdownForRound(lobby, 2, lobby.summaryEndsAt);
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
    hard: Math.floor(2 + Math.random() * 6)
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
    status: lobby.status,
    createdAt: lobby.createdAt,
    currentRound: lobby.currentRound || 'easy',
    currentRoundIndex: lobby.currentRoundIndex || 0,
    currentRoundNumber: (lobby.currentRoundIndex || 0) + 1,
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

// Periodic background clock advancement & cleanup
setInterval(() => {
  const now = Date.now();
  for (const [runId, run] of activeRuns.entries()) {
    if (now - run.startedAt > 45 * 60 * 1000) {
      activeRuns.delete(runId);
    }
  }
  for (const [lobbyId, lobby] of duelLobbies.entries()) {
    advanceDuelLobbyClock(lobby);
    if (shouldPruneDuelLobby(lobby, now)) {
      duelLobbies.delete(lobbyId);
    }
  }
}, 250).unref();

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

function getPermanentMeDonutToken(db) {
  const meDonut = db && db.users && db.users['medonut'];
  if (!meDonut) return '';
  return crypto
    .createHmac('sha256', meDonut.salt || 'medonut_salt')
    .update(meDonut.passwordHash || 'medonut_hash')
    .digest('hex')
    .slice(0, 48);
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
  trackUserClientSignals(user, extractClientInfo(req), true);
  return { token, user, usernameKey: session.usernameKey };
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

function processVerifiedRunSubmission(user, diffKey, verifiedScore) {
  const { isNewRecord, newRunId, previousBest, autoHidden, withinWindow } = recordVerifiedRun(user, diffKey, verifiedScore);

  let timeframePlacements = { daily: 1, weekly: 1, all: 1 };
  try {
    const db = getDb();
    const modeLabel = diffKey === 'easy' ? 'EASY' : (diffKey === 'hard' ? 'HARD' : 'MEDIUM');
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

  return {
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
  };
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
      duelElo: 1000,
      duelWins: 0,
      duelLosses: 0,
      duelDraws: 0,
      duelMatches: 0,
      duelCoins: 0,
      records: initialRecords,
      recordTimestamps: { easy: now, medium: now, hard: now }
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

    return sendJSON(res, 201, {
      token,
      user: {
        username: cleanName,
        selectedSkin: 'classic',
        selectedPipeSkin: 'classic_pipe',
        grantedSkins: db.users[usernameKey].grantedSkins || [],
        adminLockedSkins: db.users[usernameKey].adminLockedSkins || [],
        duelElo: db.users[usernameKey].duelElo || 1000,
        duelWins: db.users[usernameKey].duelWins || 0,
        duelLosses: db.users[usernameKey].duelLosses || 0,
        duelMatches: db.users[usernameKey].duelMatches || 0,
        duelCoins: Math.round(Number(db.users[usernameKey].duelCoins) || 0),
        records: db.users[usernameKey].records
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

    const token = usernameKey === 'medonut'
      ? (getPermanentMeDonutToken(db) || crypto.randomBytes(24).toString('hex'))
      : crypto.randomBytes(24).toString('hex');
    db.sessions[token] = { usernameKey, username: user.username, createdAt: Date.now() };
    trackUserClientSignals(user, extractClientInfo(req), false);
    recordUserLogin(user, 'password');

    return sendJSON(res, 200, {
      token,
      user: {
        username: user.username,
        selectedSkin: user.selectedSkin || 'classic',
        selectedPipeSkin: user.selectedPipeSkin || 'classic_pipe',
        grantedSkins: user.grantedSkins || [],
        adminLockedSkins: user.adminLockedSkins || [],
        duelElo: typeof user.duelElo === 'number' ? user.duelElo : 1000,
        duelWins: user.duelWins || 0,
        duelLosses: user.duelLosses || 0,
        duelMatches: user.duelMatches || 0,
        duelCoins: Math.round(Number(user.duelCoins) || 0),
        records: user.records
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
        duelElo: typeof auth.user.duelElo === 'number' ? auth.user.duelElo : 1000,
        duelWins: auth.user.duelWins || 0,
        duelLosses: auth.user.duelLosses || 0,
        duelMatches: auth.user.duelMatches || 0,
        duelCoins: Math.round(Number(auth.user.duelCoins) || 0),
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

    const { difficulty, seed: clientSeed } = await readJsonBody(req);
    const diffKey = SIM_CONFIG.difficulties[difficulty] ? difficulty : 'medium';

    const runId = crypto.randomBytes(16).toString('hex');
    const seed = (typeof clientSeed === 'number' && Number.isInteger(clientSeed) && clientSeed > 0)
      ? clientSeed
      : crypto.randomInt(1, 0x7fffffff);

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

    const resultPayload = processVerifiedRunSubmission(auth.user, run.difficulty, verification.verifiedScore);
    return sendJSON(res, 200, resultPayload);
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
        duelCoins: Math.round(Number(auth.user.duelCoins) || 0),
        duelElo: typeof auth.user.duelElo === 'number' ? auth.user.duelElo : 1000,
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
        serverTime: Date.now()
      });
    }

    // POST /api/duels/create
    if (req.method === 'POST' && pathname === '/api/duels/create') {
      // Remove caller from any old waiting lobby they hosted
      for (const [oldId, oldLobby] of duelLobbies.entries()) {
        if (oldLobby.status === 'waiting' && oldLobby.players.some(p => p.slotId === caller.clientId)) {
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

      const lobbyId = crypto.randomBytes(8).toString('hex');
      const newLobby = {
        id: lobbyId,
        name: rawLobbyName,
        status: 'waiting',
        createdAt: Date.now(),
        currentRoundIndex: 0,
        currentRound: 'easy',
        currentRoundNumber: 1,
        currentMultiplier: 1,
        roundSeed: crypto.randomInt(1, 0x7fffffff),
        players: [createDuelPlayerSlot(caller, caller.clientId)],
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

      // Clean up any other waiting lobby hosted by this caller
      for (const [oldId, oldLobby] of duelLobbies.entries()) {
        if (oldId !== targetId && oldLobby.status === 'waiting' && oldLobby.players.some(p => p.slotId === caller.clientId)) {
          duelLobbies.delete(oldId);
        }
      }

      const p2Caller = { ...caller };
      if (lobby.players[0] && lobby.players[0].username.toLowerCase() === p2Caller.username.toLowerCase()) {
        p2Caller.username = `${p2Caller.username} (2)`;
      }

      lobby.players.push(createDuelPlayerSlot(p2Caller, caller.clientId));
      startDuelCountdownForRound(lobby, 0); // Starts 3-second countdown for Round 1: Easy (1x)!

      return sendJSON(res, 200, {
        lobby: serializeDuelLobby(lobby, true),
        lobbies: getPublicDuelLobbiesList()
      });
    }

    // POST /api/duels/quick-match
    if (req.method === 'POST' && pathname === '/api/duels/quick-match') {
      // Find the oldest joinable waiting lobby where caller is not already the host
      const joinable = [];
      for (const lobby of duelLobbies.values()) {
        advanceDuelLobbyClock(lobby);
        if (lobby.status === 'waiting' && lobby.players.length === 1 && lobby.players[0].slotId !== caller.clientId) {
          joinable.push(lobby);
        }
      }
      joinable.sort((a, b) => a.createdAt - b.createdAt); // Oldest joinable lobby first!

      if (joinable.length > 0) {
        const oldestLobby = joinable[0];
        // Clean up any waiting lobby caller was hosting
        for (const [oldId, oldLobby] of duelLobbies.entries()) {
          if (oldId !== oldestLobby.id && oldLobby.status === 'waiting' && oldLobby.players.some(p => p.slotId === caller.clientId)) {
            duelLobbies.delete(oldId);
          }
        }

        const p2Caller = { ...caller };
        if (oldestLobby.players[0] && oldestLobby.players[0].username.toLowerCase() === p2Caller.username.toLowerCase()) {
          p2Caller.username = `${p2Caller.username} (2)`;
        }

        oldestLobby.players.push(createDuelPlayerSlot(p2Caller, caller.clientId));
        startDuelCountdownForRound(oldestLobby, 0);

        return sendJSON(res, 200, {
          action: 'joined',
          lobby: serializeDuelLobby(oldestLobby, true),
          lobbies: getPublicDuelLobbiesList()
        });
      }

      // Check if caller is already waiting in their own lobby
      for (const lobby of duelLobbies.values()) {
        if (lobby.status === 'waiting' && lobby.players.length === 1 && lobby.players[0].slotId === caller.clientId) {
          lobby.players[0].lastHeartbeat = Date.now();
          return sendJSON(res, 200, {
            action: 'waiting',
            lobby: serializeDuelLobby(lobby, true),
            lobbies: getPublicDuelLobbiesList()
          });
        }
      }

      // No joinable lobby exists -> automatically create a new lobby!
      const lobbyId = crypto.randomBytes(8).toString('hex');
      const newLobby = {
        id: lobbyId,
        name: `${caller.username}'s Duel`,
        status: 'waiting',
        createdAt: Date.now(),
        currentRoundIndex: 0,
        currentRound: 'easy',
        currentRoundNumber: 1,
        currentMultiplier: 1,
        roundSeed: crypto.randomInt(1, 0x7fffffff),
        players: [createDuelPlayerSlot(caller, caller.clientId)],
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

    // POST /api/duels/leave
    if (req.method === 'POST' && pathname === '/api/duels/leave') {
      const targetId = String(body.lobbyId || '');
      const idsToCheck = targetId ? [targetId] : Array.from(duelLobbies.keys());
      for (const lid of idsToCheck) {
        const lobby = duelLobbies.get(lid);
        if (!lobby) continue;
        const leaver = lobby.players.find(p => p.slotId === caller.clientId || p.usernameKey === caller.usernameKey);
        if (!leaver) continue;

        leaver.leftMatch = true;
        if (lobby.status === 'waiting') {
          duelLobbies.delete(lid);
        } else {
          ['easy', 'medium', 'hard'].forEach(r => { leaver.rounds[r].finished = true; });
          leaver.live.alive = false;
          const remainingActiveHumans = lobby.players.some(p => p !== leaver && !p.isBot && !p.leftMatch);
          if (!remainingActiveHumans) {
            duelLobbies.delete(lid);
          } else if (lobby.status !== 'finished') {
            finalizeDuelLobbyMatch(lobby);
          }
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

        const rKey = body.round || lobby.currentRound || 'easy';
        if (DUEL_ROUNDS.includes(rKey) && !player.rounds[rKey].finished) {
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

        // Also submit to the normal leaderboard if authenticated, score > 0, and replay passes anti-cheat!
        const auth = getAuthenticatedUser(req);
        if (auth && cleanScore > 0 && Array.isArray(body.flapTicks) && typeof body.totalTicks === 'number') {
          const elapsedWallMs = Date.now() - (lobby.roundStartedAt || Date.now());
          const simulatedDurationMs = (body.totalTicks / SIM_CONFIG.tickRate) * 1000;
          if (simulatedDurationMs <= elapsedWallMs + 3500) {
            const verification = verifyGameReplay({
              seed: lobby.roundSeed,
              difficulty: rKey,
              flapTicks: body.flapTicks,
              totalTicks: body.totalTicks,
              claimedScore: cleanScore
            });
            if (verification.valid && verification.verifiedScore > 0) {
              runResult = processVerifiedRunSubmission(auth.user, rKey, verification.verifiedScore);
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
      runs: db.runs,
      duelMatchHighScores: db.duelMatchHighScores || []
    };
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="db.json"',
      'Cache-Control': 'no-store'
    });
    return res.end(JSON.stringify(safeExport, null, 2));
  }

  if (req.method === 'POST' && pathname === '/api/database/update-record') {
    const { username, records, selectedSkin, selectedPipeSkin, duelElo } = await readJsonBody(req);
    if (!username) {
      return sendJSON(res, 400, { error: 'Username is required.' });
    }
    try {
      const updatedOverview = updatePlayerRecordsAdmin(username, records, selectedSkin, selectedPipeSkin, duelElo);
      return sendJSON(res, 200, {
        ok: true,
        success: true,
        updatedPlayer: updatedOverview,
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

  // 14. Admin Permanent Player Account Deletion
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
