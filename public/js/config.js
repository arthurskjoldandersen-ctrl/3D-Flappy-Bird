/**
 * ============================================================================
 * CLIENT PHYSICS CONFIGURATION & DETERMINISTIC SEEDED PRNG (config.js)
 * ============================================================================
 */
'use strict';

try {
  Object.freeze(Math);
} catch (_) {}

      // --------------------------------------------------------------------------
      // 1. DETERMINISTIC SEEDED PRNG (Mulberry32 - Matches server.js)
      // --------------------------------------------------------------------------
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

      // --------------------------------------------------------------------------
      // 2. SHARED 60HZ PHYSICS & 3-DIFFICULTY CONFIGURATION
      // --------------------------------------------------------------------------
      const CONFIG = Object.freeze({
        tickRate: 60,
        dt: 1 / 60,
        birdX: -3.5,
        birdStartY: 5.5,
        birdRadius: 0.60,
        gravity: -27.5,
        flapImpulse: 10.8,
        maxFallSpeed: -18.0,
        groundY: 0.0,
        ceilingY: 13.8,
        baseSpeed: 6.8,
        maxSpeed: 13.6, // 2.0x of baseSpeed (6.8 * 2.0)
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

window.createSeededPRNG = createSeededPRNG;
window.CONFIG = CONFIG;
