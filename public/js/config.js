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
      // 2. SHARED 60HZ PHYSICS & 4-DIFFICULTY CONFIGURATION
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
          hard:   Object.freeze({ label: 'Hard',   baseGap: 3.85, minGap: 3.10, speedRampScore: 45, maxSpeed: 13.6 }),
          extreme: Object.freeze({
            label: 'Extreme',
            baseGap: 2.87,
            minGap: 2.87,
            speedRampScore: 45,
            baseSpeed: 6.8,
            maxSpeed: 13.6,
            gravity: -75.0,
            flapImpulse: 16.5,
            maxFallSpeed: -9.5,
            refSpeed: 12.0,
            spawnDistance: 5.4,
            firstPipeDist: 6.2,
            initialPipeSpawnX: 18.9,
            lockFps60: true,
            unlockReqs: Object.freeze({ easy: 100, medium: 40, hard: 25 })
          })
        })
      });

      function getDifficultyParamsFor(score, difficultyKey, simCfg = CONFIG) {
        const diff = simCfg.difficulties[difficultyKey] || simCfg.difficulties.medium;
        if (difficultyKey === 'extreme' || (typeof diff.gravity === 'number' && typeof diff.flapImpulse === 'number')) {
          const speedProgress = Math.min(Math.max(0, Number(score) || 0) / (diff.speedRampScore || 45), 1.0);
          const minSpd = diff.baseSpeed || simCfg.baseSpeed;
          const maxSpd = Math.min(diff.maxSpeed || simCfg.maxSpeed, simCfg.baseSpeed * 2.0);
          const speed = Math.min(maxSpd, minSpd + speedProgress * (maxSpd - minSpd));
          const speedRatio = Math.min(2.0, speed / simCfg.baseSpeed);
          const refRatio = speed / (diff.refSpeed || 12.0);
          return {
            speed,
            pipeGap: diff.baseGap,
            speedRatio,
            gravity: diff.gravity * (refRatio * refRatio),
            flapImpulse: diff.flapImpulse * refRatio,
            maxFallSpeed: diff.maxFallSpeed * refRatio,
            spawnDistance: diff.spawnDistance || simCfg.baseSpawnDistance,
            speedMult: speedRatio.toFixed(1),
            label: diff.label
          };
        }
        const speedProgress = Math.min(score / (diff.speedRampScore || 45), 1.0);
        const gapProgress = Math.min(score / 40, 1.0);
        const targetMaxSpeed = Math.min(diff.maxSpeed || simCfg.maxSpeed, simCfg.baseSpeed * 2.0);
        const speed = Math.min(
          simCfg.baseSpeed * 2.0,
          simCfg.baseSpeed + speedProgress * (targetMaxSpeed - simCfg.baseSpeed)
        );
        const pipeGap = diff.baseGap - gapProgress * (diff.baseGap - diff.minGap);
        const speedRatio = Math.min(2.0, speed / simCfg.baseSpeed);
        const highSpeedFactor = Math.max(0, Math.min(1, (speedRatio - 1.15) / 0.70));
        const fallSlowdown = 1.0 - 0.20 * highSpeedFactor;
        return {
          speed,
          pipeGap,
          speedRatio,
          gravity: simCfg.gravity * (speedRatio * speedRatio) * fallSlowdown,
          flapImpulse: simCfg.flapImpulse * speedRatio,
          maxFallSpeed: simCfg.maxFallSpeed * speedRatio * fallSlowdown,
          spawnDistance: simCfg.baseSpawnDistance,
          speedMult: speedRatio.toFixed(1),
          label: diff.label
        };
      }

      function collidesExtremePipe(by, px, pipe, simCfg = CONFIG) {
        const r = simCfg.birdRadius;
        if (by - r <= simCfg.groundY) return true;
        const capReachX = simCfg.pipeCapRadius + r - 0.08;
        const shaftReachX = simCfg.pipeRadius + r - 0.08;
        const dx = Math.abs(simCfg.birdX - px);
        if (dx > capReachX) return false;
        const hitBottom = (by - r * 0.85) < pipe.bottomTopY;
        const hitTop = (by + r * 0.85) > pipe.topBottomY;
        if (hitBottom || hitTop) {
          const nearBottomCap = by >= (pipe.bottomTopY - simCfg.pipeCapHeight - r);
          const nearTopCap = by <= (pipe.topBottomY + simCfg.pipeCapHeight + r);
          if ((nearBottomCap || nearTopCap) && dx <= capReachX) return true;
          if (dx <= shaftReachX) return true;
        }
        return false;
      }

      /**
       * Deterministic 60Hz 30-FPS Frame-Perfect Pipe Solver for Extreme Mode.
       * Must remain 100% identical to src/config/physicsConfig.js.
       */
      function createExtremePipeSolver(seed, simCfg = CONFIG) {
        const extDiff = simCfg.difficulties.extreme;
        const dt = simCfg.dt;
        const capReachX = simCfg.pipeCapRadius + simCfg.birdRadius - 0.08;
        const shaftReachX = simCfg.pipeRadius + simCfg.birdRadius - 0.08;
        const rCapH = simCfg.pipeCapHeight + simCfg.birdRadius;
        const rand = createSeededPRNG(seed);
        const spawnDist = extDiff.spawnDistance;
        const firstDist = extDiff.firstPipeDist;
        const initParams = getDifficultyParamsFor(0, 'extreme', simCfg);

        let branches = [{
          y: simCfg.birdStartY,
          vy: initParams.flapImpulse,
          px: simCfg.birdX + firstDist
        }];
        let pipeIndex = 0;

        const fastHit = (by, px, pipe) => {
          if (by - simCfg.birdRadius <= simCfg.groundY) return true;
          const dx = Math.abs(simCfg.birdX - px);
          if (dx > capReachX) return false;
          const hitBottom = (by - simCfg.birdRadius * 0.85) < pipe.bottomTopY;
          const hitTop = (by + simCfg.birdRadius * 0.85) > pipe.topBottomY;
          if (hitBottom || hitTop) {
            if (by >= (pipe.bottomTopY - rCapH) || by <= (pipe.topBottomY + rCapH)) return true;
            if (dx <= shaftReachX) return true;
          }
          return false;
        };

        const measure1 = (st0, fRel, pk, pk1) => {
          let y = st0.y;
          let vy = st0.vy;
          let px = st0.px;
          let minY = Infinity;
          let maxY = -Infinity;
          for (let t = 1; t <= 125; t++) {
            const p = (px < simCfg.birdX) ? pk1 : pk;
            vy = (t === fRel) ? p.flapImpulse : vy;
            vy += p.gravity * dt;
            if (vy < p.maxFallSpeed) vy = p.maxFallSpeed;
            y += vy * dt;
            if (y > simCfg.ceilingY) {
              y = simCfg.ceilingY;
              if (vy > 0) vy = 0;
            }
            px -= p.speed * dt;
            if (y - simCfg.birdRadius <= simCfg.groundY) return null;
            if (Math.abs(simCfg.birdX - px) <= capReachX) {
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
            if (px < simCfg.birdX - capReachX && minY < Infinity) {
              return { fRel, minY, maxY, exitState: { y, vy, px } };
            }
          }
          return null;
        };

        const evalBranch1 = (st0, pipe, pk, pk1) => {
          const maxRel = Math.ceil((st0.px - (simCfg.birdX - capReachX)) / (pk.speed * dt)) + 4;
          let y0 = st0.y, vy0 = st0.vy, px0 = st0.px;
          let zeroPass = true;
          for (let t = 1; t <= maxRel + 25; t++) {
            const p = (px0 < simCfg.birdX) ? pk1 : pk;
            vy0 += p.gravity * dt;
            if (vy0 < p.maxFallSpeed) vy0 = p.maxFallSpeed;
            y0 += vy0 * dt;
            if (y0 > simCfg.ceilingY) { y0 = simCfg.ceilingY; if (vy0 > 0) vy0 = 0; }
            px0 -= p.speed * dt;
            if (fastHit(y0, px0, pipe)) { zeroPass = false; break; }
            if (px0 < simCfg.birdX - capReachX) break;
          }
          if (zeroPass) return { valid1: [], zeroPass: true };

          const valid1 = [];
          for (let f = 1; f <= maxRel; f++) {
            let y = st0.y, vy = st0.vy, px = st0.px;
            let alive = true, exitState = null;
            for (let t = 1; t <= maxRel + 25; t++) {
              const p = (px < simCfg.birdX) ? pk1 : pk;
              vy = (t === f) ? p.flapImpulse : vy;
              vy += p.gravity * dt;
              if (vy < p.maxFallSpeed) vy = p.maxFallSpeed;
              y += vy * dt;
              if (y > simCfg.ceilingY) { y = simCfg.ceilingY; if (vy > 0) vy = 0; }
              px -= p.speed * dt;
              if (fastHit(y, px, pipe)) { alive = false; break; }
              if (px < simCfg.birdX - capReachX) { exitState = { y, vy, px }; break; }
            }
            if (alive && exitState) {
              valid1.push({ f, exitState });
              if (valid1.length > 2) return { valid1, zeroPass: false };
            }
          }
          return { valid1, zeroPass: false };
        };

        const evalCheese2 = (st0, pipe, pk, pk1) => {
          const maxRel = Math.ceil((st0.px - (simCfg.birdX - capReachX)) / (pk.speed * dt)) + 3;
          let max2Consec = 0;
          let baseY = st0.y, baseVy = st0.vy, basePx = st0.px;
          for (let f1 = 1; f1 <= maxRel - 3; f1++) {
            if (f1 > 1) {
              const pb = (basePx < simCfg.birdX) ? pk1 : pk;
              baseVy += pb.gravity * dt; if (baseVy < pb.maxFallSpeed) baseVy = pb.maxFallSpeed;
              baseY += baseVy * dt; if (baseY > simCfg.ceilingY) { baseY = simCfg.ceilingY; if (baseVy > 0) baseVy = 0; }
              basePx -= pb.speed * dt;
              if (fastHit(baseY, basePx, pipe) || basePx < simCfg.birdX - capReachX) break;
            }
            const pf1 = (basePx < simCfg.birdX) ? pk1 : pk;
            let f1Vy = pf1.flapImpulse + pf1.gravity * dt; if (f1Vy < pf1.maxFallSpeed) f1Vy = pf1.maxFallSpeed;
            let f1Y = baseY + f1Vy * dt; if (f1Y > simCfg.ceilingY) { f1Y = simCfg.ceilingY; if (f1Vy > 0) f1Vy = 0; }
            let f1Px = basePx - pf1.speed * dt;
            if (fastHit(f1Y, f1Px, pipe) || f1Px < simCfg.birdX - capReachX) continue;

            const pf1b = (f1Px < simCfg.birdX) ? pk1 : pk;
            let bVy = f1Vy + pf1b.gravity * dt; if (bVy < pf1b.maxFallSpeed) bVy = pf1b.maxFallSpeed;
            let bY = f1Y + bVy * dt; if (bY > simCfg.ceilingY) { bY = simCfg.ceilingY; if (bVy > 0) bVy = 0; }
            let bPx = f1Px - pf1b.speed * dt;
            if (fastHit(bY, bPx, pipe) || bPx < simCfg.birdX - capReachX) continue;

            let cur = 0, lastF = -10;
            for (let f2 = f1 + 2; f2 <= maxRel; f2++) {
              const pf2 = (bPx < simCfg.birdX) ? pk1 : pk;
              let sVy = pf2.flapImpulse + pf2.gravity * dt; if (sVy < pf2.maxFallSpeed) sVy = pf2.maxFallSpeed;
              let sY = bY + sVy * dt; if (sY > simCfg.ceilingY) { sY = simCfg.ceilingY; if (sVy > 0) sVy = 0; }
              let sPx = bPx - pf2.speed * dt;
              let ok2 = !fastHit(sY, sPx, pipe);
              let done2 = ok2 && (sPx < simCfg.birdX - capReachX);
              if (ok2 && !done2) {
                for (let t = f2 + 1; t <= maxRel + 25; t++) {
                  const pt = (sPx < simCfg.birdX) ? pk1 : pk;
                  sVy += pt.gravity * dt; if (sVy < pt.maxFallSpeed) sVy = pt.maxFallSpeed;
                  sY += sVy * dt; if (sY > simCfg.ceilingY) { sY = simCfg.ceilingY; if (sVy > 0) sVy = 0; }
                  sPx -= pt.speed * dt;
                  if (fastHit(sY, sPx, pipe)) { ok2 = false; break; }
                  if (sPx < simCfg.birdX - capReachX) { done2 = true; break; }
                }
              }
              if (ok2 && done2) {
                cur = (f2 === lastF + 1) ? cur + 1 : 1;
                lastF = f2;
                if (cur > max2Consec) max2Consec = cur;
                if (max2Consec > 2) return max2Consec;
              }
              bVy += pf2.gravity * dt; if (bVy < pf2.maxFallSpeed) bVy = pf2.maxFallSpeed;
              bY += bVy * dt; if (bY > simCfg.ceilingY) { bY = simCfg.ceilingY; if (bVy > 0) bVy = 0; }
              bPx -= pf2.speed * dt;
              if (fastHit(bY, bPx, pipe) || bPx < simCfg.birdX - capReachX) break;
            }
          }
          return max2Consec;
        };

        function nextPipe() {
          const k = pipeIndex++;
          const pk = getDifficultyParamsFor(k, 'extreme', simCfg);
          const pk1 = getDifficultyParamsFor(k + 1, 'extreme', simCfg);
          const maxRel = Math.ceil((branches[0].px - simCfg.birdX) / (pk.speed * dt)) + 2;
          const branchMaps = branches.map(br => {
            const m = new Map();
            for (let f = 2; f <= maxRel; f++) {
              const res = measure1(br, f, pk, pk1);
              if (res) m.set(f, res);
            }
            return m;
          });

          const b0Map = branchMaps[0];
          const cands = [];
          for (const [fBase] of b0Map.entries()) {
            if (!b0Map.has(fBase + 1)) continue;
            let reqBot = Infinity, reqTop = -Infinity, buildOk = true;
            let minY = Infinity, maxY = -Infinity, minVy = Infinity, maxVy = -Infinity;
            for (const bm of branchMaps) {
              const m1 = bm.get(fBase);
              const m2 = bm.get(fBase + 1);
              if (!m1 || !m2) { buildOk = false; break; }
              reqBot = Math.min(reqBot, Math.min(m1.minY, m2.minY) - simCfg.birdRadius * 0.85);
              reqTop = Math.max(reqTop, Math.max(m1.maxY, m2.maxY) + simCfg.birdRadius * 0.85);
              minY = Math.min(minY, m1.exitState.y, m2.exitState.y);
              maxY = Math.max(maxY, m1.exitState.y, m2.exitState.y);
              minVy = Math.min(minVy, m1.exitState.vy, m2.exitState.vy);
              maxVy = Math.max(maxVy, m1.exitState.vy, m2.exitState.vy);
            }
            if (!buildOk) continue;

            let minBot = 1.0, maxTop = simCfg.ceilingY - 1.0;
            for (const bm of branchMaps) {
              const prev = bm.get(fBase - 1);
              const next = bm.get(fBase + 2);
              if (prev) {
                if (prev.maxY + 0.51 > reqTop) maxTop = Math.min(maxTop, prev.maxY + 0.51 - 0.002);
                else if (prev.minY - 0.51 < reqBot) minBot = Math.max(minBot, prev.minY - 0.51 + 0.002);
              }
              if (next) {
                if (next.minY - 0.51 < reqBot) minBot = Math.max(minBot, next.minY - 0.51 + 0.002);
                else if (next.maxY + 0.51 > reqTop) maxTop = Math.min(maxTop, next.maxY + 0.51 - 0.002);
              }
            }
            if (minBot > reqBot || maxTop < reqTop) continue;

            const frac = 0.05;
            const b = reqBot - (reqBot - minBot) * frac;
            const t = reqTop + (maxTop - reqTop) * frac;
            const pipe = { bottomTopY: b, topBottomY: t, gapCenterY: (b + t) * 0.5, gapSize: t - b };
            if (pipe.bottomTopY < 1.3 || pipe.topBottomY > simCfg.ceilingY - 1.3 || pipe.gapSize < 1.15 || pipe.gapSize > 3.5) {
              continue;
            }

            const termAtClick = branches.every(br => {
              let vy = br.vy;
              for (let t0 = 1; t0 < fBase; t0++) vy = Math.max(pk.maxFallSpeed, vy + pk.gravity * dt);
              return vy <= pk.maxFallSpeed + 1e-6;
            });
            cands.push({ f: fBase, pipe, termAtClick, metric: (maxY - minY) + 0.04 * (maxVy - minVy) });
          }

          const targetC = 4.2 + rand() * 5.0;
          const orderByPriority = (list) => {
            const copy = list.slice();
            copy.sort((a, b) => a.metric - b.metric);
            const minM = copy.length > 0 ? copy[0].metric : 0;
            const tier1 = copy.filter(c => c.metric <= Math.max(minM * 1.35, 0.06));
            const tier2 = copy.filter(c => c.metric > Math.max(minM * 1.35, 0.06));
            tier1.sort((a, b) => Math.abs(a.pipe.gapCenterY - targetC) - Math.abs(b.pipe.gapCenterY - targetC));
            return tier1.concat(tier2);
          };

          const termList = orderByPriority(cands.filter(c => c.termAtClick));
          const nonTermList = orderByPriority(cands.filter(c => !c.termAtClick));
          const orderedCands = termList.concat(nonTermList);

          let chosen = null;
          let bestFallback = null;
          let bestFallbackM2 = Infinity;
          for (const c of orderedCands) {
            let allOk = true;
            const nxtB = [];
            for (const br of branches) {
              const ev = evalBranch1(br, c.pipe, pk, pk1);
              if (ev.zeroPass || ev.valid1.length !== 2 || ev.valid1[1].f !== ev.valid1[0].f + 1) {
                allOk = false;
                break;
              }
              nxtB.push(ev.valid1[0].exitState, ev.valid1[1].exitState);
            }
            if (!allOk) continue;

            let m2 = 0;
            for (const br of branches) {
              m2 = Math.max(m2, evalCheese2(br, c.pipe, pk, pk1));
              if (m2 > 2 && m2 >= bestFallbackM2) break;
            }
            if (m2 <= 2) {
              chosen = { pipe: c.pipe, nxtB };
              break;
            }
            if (m2 < bestFallbackM2) {
              bestFallbackM2 = m2;
              bestFallback = { pipe: c.pipe, nxtB };
            }
          }
          if (!chosen) chosen = bestFallback;

          if (chosen) {
            const uniq = [];
            for (const st of chosen.nxtB) {
              const n = { y: st.y, vy: st.vy, px: st.px + spawnDist };
              if (!uniq.some(u => Math.abs(u.y - n.y) < 1e-4 && Math.abs(u.vy - n.vy) < 1e-3)) {
                uniq.push(n);
              }
            }
            uniq.sort((a, b) => a.y - b.y);
            if (uniq.length > 4) {
              branches = [
                uniq[0],
                uniq[Math.floor(uniq.length / 3)],
                uniq[Math.floor((2 * uniq.length) / 3)],
                uniq[uniq.length - 1]
              ];
            } else if (uniq.length > 0) {
              branches = uniq;
            }
            return {
              index: k,
              gapCenterY: chosen.pipe.gapCenterY,
              gapSize: chosen.pipe.gapSize,
              bottomTopY: chosen.pipe.bottomTopY,
              topBottomY: chosen.pipe.topBottomY,
              validWindowFrames: 2
            };
          }

          const fallbackCenter = 5.5;
          const fallbackGap = 2.87;
          return {
            index: k,
            gapCenterY: fallbackCenter,
            gapSize: fallbackGap,
            bottomTopY: fallbackCenter - fallbackGap * 0.5,
            topBottomY: fallbackCenter + fallbackGap * 0.5,
            validWindowFrames: 2
          };
        }

        return { nextPipe };
      }

window.createSeededPRNG = createSeededPRNG;
window.CONFIG = CONFIG;
window.getDifficultyParamsFor = getDifficultyParamsFor;
window.collidesExtremePipe = collidesExtremePipe;
window.createExtremePipeSolver = createExtremePipeSolver;
