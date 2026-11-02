/**
 * ============================================================================
 * SHARED DETERMINISTIC PHYSICS & DIFFICULTY CONSTANTS (60Hz Fixed Step)
 * ============================================================================
 * Must remain 100% identical between client (public/js/config.js) and server
 * so that server-side replay verification produces the exact same trajectory.
 */

const SIM_CONFIG = Object.freeze({
  tickRate: 60,
  dt: 1 / 60,
  birdX: -3.5,
  birdStartY: 5.5,
  birdRadius: 0.60,       // Forgiving collision radius
  gravity: -27.5,         // Base gravity at 1.0x speed
  flapImpulse: 10.8,      // Base flap impulse at 1.0x speed
  maxFallSpeed: -18.0,    // Base terminal velocity at 1.0x speed
  groundY: 0.0,
  ceilingY: 13.8,
  baseSpeed: 6.8,
  maxSpeed: 13.6,         // Strictly capped at 2.0x of baseSpeed (6.8 * 2.0 = 13.6)
  pipeRadius: 1.05,
  pipeCapRadius: 1.24,
  pipeCapHeight: 0.65,
  pipeSpawnX: 22.0,
  pipeDespawnX: -16.0,
  baseSpawnDistance: 9.6,
  difficulties: Object.freeze({
    easy:   Object.freeze({ label: 'Easy',   baseGap: 5.70, minGap: 4.65, speedRampScore: 35, maxSpeed: 13.6 }),
    medium: Object.freeze({ label: 'Medium', baseGap: 4.65, minGap: 3.75, speedRampScore: 45, maxSpeed: 13.6 }),
    hard:   Object.freeze({ label: 'Hard',   baseGap: 3.85, minGap: 3.10, speedRampScore: 45, maxSpeed: 13.6 })
  })
});

/**
 * Deterministic PRNG (Mulberry32) - Identical on Client and Server
 */
function createSeededPRNG(seed) {
  let a = seed >>> 0;
  return function nextFloat() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Compute speed, gap, and speed-scaled vertical physics for a given score and difficulty
 */
function getDifficultyParams(score, difficultyKey) {
  const diff = SIM_CONFIG.difficulties[difficultyKey] || SIM_CONFIG.difficulties.medium;
  const speedProgress = Math.min(score / (diff.speedRampScore || 45), 1.0);
  const gapProgress = Math.min(score / 40, 1.0);
  const targetMaxSpeed = Math.min(diff.maxSpeed || SIM_CONFIG.maxSpeed, SIM_CONFIG.baseSpeed * 2.0);

  const speed = Math.min(
    SIM_CONFIG.baseSpeed * 2.0,
    SIM_CONFIG.baseSpeed + speedProgress * (targetMaxSpeed - SIM_CONFIG.baseSpeed)
  );
  const pipeGap = diff.baseGap - gapProgress * (diff.baseGap - diff.minGap);

  const speedRatio = Math.min(2.0, speed / SIM_CONFIG.baseSpeed);
  const highSpeedFactor = Math.max(0, Math.min(1, (speedRatio - 1.55) / 0.25));
  const fallSlowdown = 1.0 - 0.20 * highSpeedFactor;

  const gravity = SIM_CONFIG.gravity * (speedRatio * speedRatio) * fallSlowdown;
  const flapImpulse = SIM_CONFIG.flapImpulse * speedRatio;
  const maxFallSpeed = SIM_CONFIG.maxFallSpeed * speedRatio * fallSlowdown;

  return { speed, pipeGap, speedRatio, gravity, flapImpulse, maxFallSpeed };
}

module.exports = {
  SIM_CONFIG,
  createSeededPRNG,
  getDifficultyParams
};
