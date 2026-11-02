/**
 * ============================================================================
 * AUTHORITATIVE SERVER-SIDE PHYSICS REPLAY SIMULATOR (ANTI-CHEAT)
 * ============================================================================
 * Replays a player's recorded flap ticks against the deterministic pipe seed
 * to verify the exact score achieved without trusting the client's score variable.
 */

const { SIM_CONFIG, createSeededPRNG, getDifficultyParams } = require('../config/physicsConfig');

function verifyGameReplay({ seed, difficulty, flapTicks, totalTicks, claimedScore }) {
  if (!SIM_CONFIG.difficulties[difficulty]) {
    return { valid: false, reason: 'Invalid difficulty mode.' };
  }
  if (!Array.isArray(flapTicks) || typeof totalTicks !== 'number') {
    return { valid: false, reason: 'Malformed replay telemetry.' };
  }
  if (totalTicks < 1 || totalTicks > 60 * 60 * 30) {
    return { valid: false, reason: 'Invalid run tick duration.' };
  }
  if (flapTicks.length > totalTicks + 1) {
    return { valid: false, reason: 'Impossible flap count.' };
  }

  const flapSet = new Set();
  let prevTick = -10;
  for (let i = 0; i < flapTicks.length; i++) {
    const t = flapTicks[i];
    if (!Number.isInteger(t) || t < 0 || t > totalTicks) {
      return { valid: false, reason: 'Out-of-bounds flap tick detected.' };
    }
    if (t <= prevTick && i > 0) {
      return { valid: false, reason: 'Non-monotonic flap tick sequence.' };
    }
    if (i > 0 && (t - prevTick) < 2) {
      return { valid: false, reason: 'Inhuman flap frequency detected (Anti-Cheat).' };
    }
    flapSet.add(t);
    prevTick = t;
  }

  const rand = createSeededPRNG(seed);
  const dt = SIM_CONFIG.dt;

  let score = 0;
  let birdY = SIM_CONFIG.birdStartY;
  let birdVelocityY = SIM_CONFIG.flapImpulse;
  let distanceSinceLastPipe = 0;
  const pipes = [];

  function spawnPipePair(spawnX) {
    const { pipeGap } = getDifficultyParams(score, difficulty);
    const minCenterY = 2.9 + pipeGap * 0.5;
    const maxCenterY = SIM_CONFIG.ceilingY - 2.6 - pipeGap * 0.5;
    const gapCenterY = minCenterY + rand() * (maxCenterY - minCenterY);

    pipes.push({
      x: spawnX,
      gapCenterY,
      gapSize: pipeGap,
      bottomTopY: gapCenterY - pipeGap * 0.5,
      topBottomY: gapCenterY + pipeGap * 0.5,
      passed: false
    });
  }

  function checkCollisions() {
    const bx = SIM_CONFIG.birdX;
    const by = birdY;
    const r = SIM_CONFIG.birdRadius;

    if (by - r <= SIM_CONFIG.groundY) {
      return true;
    }

    const capReachX = SIM_CONFIG.pipeCapRadius + r - 0.08;
    const shaftReachX = SIM_CONFIG.pipeRadius + r - 0.08;

    for (let i = 0; i < pipes.length; i++) {
      const pipe = pipes[i];
      const dx = Math.abs(bx - pipe.x);
      if (dx > capReachX) continue;

      const hitBottom = (by - r * 0.85) < pipe.bottomTopY;
      const hitTop = (by + r * 0.85) > pipe.topBottomY;

      if (hitBottom || hitTop) {
        const nearBottomCap = by >= (pipe.bottomTopY - SIM_CONFIG.pipeCapHeight - r);
        const nearTopCap = by <= (pipe.topBottomY + SIM_CONFIG.pipeCapHeight + r);

        if ((nearBottomCap || nearTopCap) && dx <= capReachX) {
          return true;
        }
        if (dx <= shaftReachX) {
          return true;
        }
      }
    }
    return false;
  }

  spawnPipePair(SIM_CONFIG.pipeSpawnX - SIM_CONFIG.baseSpawnDistance * 2);
  spawnPipePair(SIM_CONFIG.pipeSpawnX - SIM_CONFIG.baseSpawnDistance);
  spawnPipePair(SIM_CONFIG.pipeSpawnX);

  let crashedAtTick = -1;

  for (let tick = 1; tick <= totalTicks; tick++) {
    const { speed: scrollSpeed, gravity, flapImpulse, maxFallSpeed } = getDifficultyParams(score, difficulty);

    if (flapSet.has(tick)) {
      birdVelocityY = flapImpulse;
    }

    birdVelocityY += gravity * dt;
    if (birdVelocityY < maxFallSpeed) {
      birdVelocityY = maxFallSpeed;
    }
    birdY += birdVelocityY * dt;

    if (birdY > SIM_CONFIG.ceilingY) {
      birdY = SIM_CONFIG.ceilingY;
      if (birdVelocityY > 0) birdVelocityY = 0;
    }

    distanceSinceLastPipe += scrollSpeed * dt;
    if (distanceSinceLastPipe >= SIM_CONFIG.baseSpawnDistance) {
      distanceSinceLastPipe = 0;
      spawnPipePair(SIM_CONFIG.pipeSpawnX);
    }

    for (let i = pipes.length - 1; i >= 0; i--) {
      const pipe = pipes[i];
      pipe.x -= scrollSpeed * dt;

      if (!pipe.passed && pipe.x < SIM_CONFIG.birdX) {
        pipe.passed = true;
        score += 1;
      }

      if (pipe.x < SIM_CONFIG.pipeDespawnX) {
        pipes.splice(i, 1);
      }
    }

    if (checkCollisions()) {
      crashedAtTick = tick;
      break;
    }
  }

  if (typeof claimedScore === 'number' && claimedScore !== score) {
    return {
      valid: false,
      reason: `Anti-Cheat Mismatch: Client claimed ${claimedScore}, server physics verified ${score}.`,
      verifiedScore: score
    };
  }

  return {
    valid: true,
    verifiedScore: score,
    crashedAtTick
  };
}

module.exports = {
  verifyGameReplay
};
