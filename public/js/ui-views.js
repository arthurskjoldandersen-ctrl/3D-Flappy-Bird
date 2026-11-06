/**
 * ============================================================================
 * UI VIEWS, LOCKER GRIDS, STATS, LEADERBOARD, AUTH & THEMES (ui-views.js)
 * ============================================================================
 */
'use strict';

class FlappyBirdUIAndProgression {
        loadLocalRecords() {
          try {
            const raw = localStorage.getItem('flappy3d_records_v2');
            if (raw) {
              const parsed = JSON.parse(raw);
              const r = {
                easy: Number(parsed.easy) || 0,
                medium: Number(parsed.medium) || 0,
                hard: Number(parsed.hard) || 0
              };
              // Sanitize: purge corrupted 109/40/27 baseline so guests & players start with their true records
              if (r.easy === 109 && r.medium === 40 && r.hard === 27) {
                const clean = { easy: 0, medium: 0, hard: 0 };
                try { localStorage.setItem('flappy3d_records_v2', JSON.stringify(clean)); } catch (_) {}
                return clean;
              }
              return r;
            }
          } catch (_) {}
          const baseline = { easy: 0, medium: 0, hard: 0 };
          try {
            localStorage.setItem('flappy3d_records_v2', JSON.stringify(baseline));
          } catch (_) {}
          return baseline;
        }

        saveLocalRecords() {
          try {
            localStorage.setItem('flappy3d_records_v2', JSON.stringify(this.localRecords));
          } catch (_) {}
        }

        loadCareerStats() {
          const defaultModeStat = () => ({ runs: 0, totalScore: 0, totalFlaps: 0, lastScore: 0 });
          try {
            const raw = localStorage.getItem('flappy3d_career_v1');
            if (raw) {
              const parsed = JSON.parse(raw);
              const pm = (parsed.modes && typeof parsed.modes === 'object') ? parsed.modes : {};
              const normMode = (m) => ({
                runs: Number(m && m.runs) || 0,
                totalScore: Number(m && m.totalScore) || 0,
                totalFlaps: Number(m && m.totalFlaps) || 0,
                lastScore: Number(m && m.lastScore) || 0
              });
              return {
                totalRuns: Number(parsed.totalRuns) || 0,
                totalScore: Number(parsed.totalScore) || 0,
                totalFlaps: Number(parsed.totalFlaps) || 0,
                lastScore: Number(parsed.lastScore) || 0,
                lastMode: parsed.lastMode || 'medium',
                modes: {
                  easy: normMode(pm.easy),
                  medium: normMode(pm.medium),
                  hard: normMode(pm.hard)
                }
              };
            }
          } catch (_) {}
          return {
            totalRuns: 0,
            totalScore: 0,
            totalFlaps: 0,
            lastScore: 0,
            lastMode: 'medium',
            modes: {
              easy: defaultModeStat(),
              medium: defaultModeStat(),
              hard: defaultModeStat()
            }
          };
        }

        saveCareerStats() {
          try {
            localStorage.setItem('flappy3d_career_v1', JSON.stringify(this.careerStats));
          } catch (_) {}
        }

        loadTrollQuests() {
          try {
            const raw = localStorage.getItem('flappy3d_troll_quests_v1');
            if (raw) {
              const p = JSON.parse(raw);
              return {
                unlockedIds: (p.unlockedIds && typeof p.unlockedIds === 'object') ? p.unlockedIds : {},
                scoreDeaths: (p.scoreDeaths && typeof p.scoreDeaths === 'object') ? p.scoreDeaths : {},
                recentScores: Array.isArray(p.recentScores) ? p.recentScores.slice(-10) : [],
                recentModes: Array.isArray(p.recentModes) ? p.recentModes.slice(-10) : [],
                zeroFlapDeaths: Number(p.zeroFlapDeaths) || 0,
                chokeMilestones: Number(p.chokeMilestones) || 0,
                bestFlapsUnder5: Number(p.bestFlapsUnder5) || 0,
                bestFlapsUnder8: Number(p.bestFlapsUnder8) || 0,
                bestFlapsSingleRun: Number(p.bestFlapsSingleRun) || 0,
                totalBonks: Number(p.totalBonks) || 0
              };
            }
          } catch (_) {}
          return {
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
        }

        saveTrollQuests() {
          try {
            localStorage.setItem('flappy3d_troll_quests_v1', JSON.stringify(this.trollQuests));
          } catch (_) {}
        }

        reconcileTrollQuests() {
          const tq = this.trollQuests || this.loadTrollQuests();
          if (!tq.unlockedIds) tq.unlockedIds = {};
          const allPokeItems = (typeof BIRD_SKINS !== 'undefined' && typeof PIPE_SKINS !== 'undefined')
            ? [...BIRD_SKINS, ...PIPE_SKINS].filter(i => i.reqMode === 'pokemon' && i.pokeQuestId)
            : [];
          allPokeItems.forEach(item => {
            const prog = this.getPokemonQuestProgress(item.pokeQuestId);
            if (!prog.unlocked) {
              delete tq.unlockedIds[item.pokeQuestId];
            } else {
              tq.unlockedIds[item.pokeQuestId] = true;
            }
          });
          this.saveTrollQuests();
        }

        validateAndReconcileEquippedSkins() {
          if (typeof BIRD_SKINS === 'undefined' || typeof PIPE_SKINS === 'undefined') return;
          let skinChanged = false;
          let pipeChanged = false;

          const birdObj = BIRD_SKINS.find(s => s.id === this.selectedSkinId);
          if (!birdObj || !this.isCosmeticUnlocked(birdObj)) {
            this.selectedSkinId = 'classic';
            skinChanged = true;
            try { localStorage.setItem('flappy3d_skin', 'classic'); } catch (_) {}
          }

          const pipeObj = PIPE_SKINS.find(p => p.id === this.selectedPipeSkinId);
          if (!pipeObj || !this.isCosmeticUnlocked(pipeObj)) {
            this.selectedPipeSkinId = 'classic_pipe';
            pipeChanged = true;
            try { localStorage.setItem('flappy3d_pipe_skin', 'classic_pipe'); } catch (_) {}
          }

          if (skinChanged) {
            this.applySkin('classic', Boolean(this.authToken && this.currentUser));
          }
          if (pipeChanged) {
            this.applyPipeSkin('classic_pipe', Boolean(this.authToken && this.currentUser));
          }
        }

        getSequenceMatchProgress(historyArr, targetSeq) {
          for (let len = targetSeq.length; len >= 1; len--) {
            if (historyArr.length < len) continue;
            let match = true;
            for (let i = 0; i < len; i++) {
              if (historyArr[historyArr.length - len + i] !== targetSeq[i]) {
                match = false;
                break;
              }
            }
            if (match) return len;
          }
          return 0;
        }

        getTrollQuestProgress(questId, target = 1) {
          const tq = this.trollQuests || this.loadTrollQuests();
          if (tq.unlockedIds && tq.unlockedIds[questId]) {
            return { current: target, target, percent: 100, unlocked: true };
          }

          let current = 0;
          const sd = tq.scoreDeaths || {};
          const rs = tq.recentScores || [];
          const rm = tq.recentModes || [];

          switch (questId) {
            case 'die_67_x5':
            case 'die_67_pipe_x3':
              current = Number(sd[67]) || 0;
              break;
            case 'seq_10_9_21': {
              const p1 = this.getSequenceMatchProgress(rs, [10, 9, 21]);
              const p2 = this.getSequenceMatchProgress(rs, [9, 10, 21]);
              current = Math.max(p1, p2);
              break;
            }
            case 'die_0_x10':
              current = Number(sd[0]) || 0;
              break;
            case 'seq_7_7_7':
              current = this.getSequenceMatchProgress(rs, [7, 7, 7]);
              break;
            case 'die_69_x3':
              current = Number(sd[69]) || 0;
              break;
            case 'zero_flap_x5':
              current = Number(tq.zeroFlapDeaths) || 0;
              break;
            case 'flap_50_under_5':
              current = Math.min(target, Number(tq.bestFlapsUnder5) || 0);
              break;
            case 'seq_1_2_3_5':
              current = this.getSequenceMatchProgress(rs, [1, 2, 3, 5]);
              break;
            case 'choke_milestone_x3':
              current = Number(tq.chokeMilestones) || 0;
              break;
            case 'seq_easy_med_hard':
              current = this.getSequenceMatchProgress(rm, ['easy', 'medium', 'hard']);
              break;
            case 'die_21_x3':
              current = Number(sd[21]) || 0;
              break;
            case 'seq_0_x5':
              current = this.getSequenceMatchProgress(rs, [0, 0, 0, 0, 0]);
              break;
            case 'seq_4_0_4':
              current = this.getSequenceMatchProgress(rs, [4, 0, 4]);
              break;
            case 'seq_1_1_1':
              current = this.getSequenceMatchProgress(rs, [1, 1, 1]);
              break;
            case 'total_bonks_25':
              current = Math.min(target, Math.max(Number(tq.totalBonks) || 0, (this.careerStats && this.careerStats.totalRuns) || 0));
              break;
            case 'seq_12_12':
              current = this.getSequenceMatchProgress(rs, [12, 12]);
              break;
            case 'die_2_x5':
              current = Number(sd[2]) || 0;
              break;
            case 'stonks_25_to_0':
              if (rs.length >= 2 && rs[rs.length - 2] >= 25 && rs[rs.length - 1] === 0) {
                current = 1;
              } else {
                current = 0;
              }
              break;
            case 'single_run_80_flaps':
              current = Math.min(target, Number(tq.bestFlapsSingleRun) || 0);
              break;
            default:
              current = 0;
          }

          const clamped = Math.min(target, Math.max(0, current));
          const percent = Math.max(0, Math.min(100, Math.round((clamped / target) * 100)));
          return { current: clamped, target, percent, unlocked: clamped >= target };
        }

        getPokemonQuestProgress(questId) {
          const tq = this.trollQuests || this.loadTrollQuests();
          const sd = tq.scoreDeaths || {};
          const eBest = this.getBestForDifficulty('easy');
          const mBest = this.getBestForDifficulty('medium');
          const hBest = this.getBestForDifficulty('hard');
          const careerPipes = (this.careerStats && this.careerStats.totalScore) || 0;

          const multiModeEval = (medReq, easyReq, hardReq) => {
            const pMed = mBest / medReq;
            const pEasy = eBest / easyReq;
            const pHard = hBest / hardReq;
            if (pMed >= 1 || pEasy >= 1 || pHard >= 1) {
              return { current: medReq, target: medReq, percent: 100, unlocked: true };
            }
            if (pEasy > pMed && pEasy >= pHard) {
              return { current: eBest, target: easyReq, percent: Math.min(100, Math.round(pEasy * 100)), unlocked: false };
            }
            if (pHard > pMed && pHard > pEasy) {
              return { current: hBest, target: hardReq, percent: Math.min(100, Math.round(pHard * 100)), unlocked: false };
            }
            return { current: mBest, target: medReq, percent: Math.min(100, Math.round(pMed * 100)), unlocked: false };
          };

          switch (questId) {
            case 'poke_pikachu':
              return multiModeEval(50, 95, 32);
            case 'poke_charmander':
            case 'poke_eevee':
              return multiModeEval(48, 90, 30);
            case 'poke_squirtle':
              return multiModeEval(45, 85, 28);
            case 'poke_bulbasaur':
              return multiModeEval(42, 80, 26);
            case 'poke_pipe_pokeball':
              return multiModeEval(40, 75, 25);
            case 'poke_mew':
              return multiModeEval(65, 125, 42);
            case 'poke_masterball':
              return multiModeEval(70, 135, 46);
            case 'poke_charizard':
              return multiModeEval(60, 115, 38);
            case 'poke_gengar':
              return multiModeEval(55, 105, 35);
            case 'poke_lucario':
              return multiModeEval(58, 110, 36);
            case 'poke_greninja':
              return multiModeEval(56, 108, 35);
            case 'poke_mewtwo':
              return multiModeEval(72, 140, 48);
            case 'poke_rayquaza':
              return multiModeEval(80, 155, 55);
            case 'poke_snorlax': {
              const fallback = multiModeEval(52, 100, 34);
              if (careerPipes >= 500 || fallback.unlocked) {
                return { current: 500, target: 500, percent: 100, unlocked: true };
              }
              const cPct = Math.round((careerPipes / 500) * 100);
              if (cPct >= fallback.percent) {
                return { current: careerPipes, target: 500, percent: cPct, unlocked: false };
              }
              return fallback;
            }
            case 'poke_bidoof': {
              const d15 = Number(sd[15]) || 0;
              const fallback = multiModeEval(45, 85, 28);
              if (d15 >= 4 || fallback.unlocked) {
                return { current: 4, target: 4, percent: 100, unlocked: true };
              }
              const dPct = Math.round((d15 / 4) * 100);
              if (dPct >= fallback.percent) {
                return { current: d15, target: 4, percent: dPct, unlocked: false };
              }
              return fallback;
            }
            case 'poke_jigglypuff': {
              const d39 = Number(sd[39]) || 0;
              const fallback = multiModeEval(44, 85, 28);
              if (d39 >= 2 || fallback.unlocked) {
                return { current: 2, target: 2, percent: 100, unlocked: true };
              }
              const dPct = Math.round((d39 / 2) * 100);
              if (dPct >= fallback.percent) {
                return { current: d39, target: 2, percent: dPct, unlocked: false };
              }
              return fallback;
            }
            case 'poke_magikarp': {
              const splashFlaps = Math.min(50, Number(tq.bestFlapsUnder8) || 0);
              const fallback = multiModeEval(46, 88, 29);
              if (splashFlaps >= 50 || fallback.unlocked) {
                return { current: 50, target: 50, percent: 100, unlocked: true };
              }
              const fPct = Math.round((splashFlaps / 50) * 100);
              if (fPct >= fallback.percent) {
                return { current: splashFlaps, target: 50, percent: fPct, unlocked: false };
              }
              return fallback;
            }
            case 'poke_meowth': {
              const fallback = multiModeEval(50, 95, 32);
              if (careerPipes >= 350 || fallback.unlocked) {
                return { current: 350, target: 350, percent: 100, unlocked: true };
              }
              const cPct = Math.round((careerPipes / 350) * 100);
              if (cPct >= fallback.percent) {
                return { current: careerPipes, target: 350, percent: cPct, unlocked: false };
              }
              return fallback;
            }
            default:
              return multiModeEval(50, 95, 32);
          }
        }

        recordTrollQuestRun(achievedScore, diffKey, extraFlapCount) {
          const tq = this.trollQuests;
          const s = Number(achievedScore) || 0;
          const totalFlapsInRun = (Number(extraFlapCount) || 0) + 1;

          tq.totalBonks = (Number(tq.totalBonks) || 0) + 1;
          tq.scoreDeaths[s] = (Number(tq.scoreDeaths[s]) || 0) + 1;

          tq.recentScores.push(s);
          if (tq.recentScores.length > 10) tq.recentScores.shift();

          tq.recentModes.push(diffKey);
          if (tq.recentModes.length > 10) tq.recentModes.shift();

          if (extraFlapCount === 0) {
            tq.zeroFlapDeaths = (Number(tq.zeroFlapDeaths) || 0) + 1;
          }

          if (s === 9 || s === 24 || s === 49 || s === 99) {
            tq.chokeMilestones = (Number(tq.chokeMilestones) || 0) + 1;
          }

          if (s < 5 && totalFlapsInRun > (tq.bestFlapsUnder5 || 0)) {
            tq.bestFlapsUnder5 = totalFlapsInRun;
          }

          if (s < 8 && totalFlapsInRun > (tq.bestFlapsUnder8 || 0)) {
            tq.bestFlapsUnder8 = totalFlapsInRun;
          }

          if (totalFlapsInRun > (tq.bestFlapsSingleRun || 0)) {
            tq.bestFlapsSingleRun = totalFlapsInRun;
          }

          // Permanently lock in any completed Meme or Pokémon Quests so sequence/special quests stay unlocked forever!
          const allMemeItems = [...BIRD_SKINS, ...PIPE_SKINS].filter(i => i.reqMode === 'meme' && i.trollQuestId);
          allMemeItems.forEach(item => {
            const prog = this.getTrollQuestProgress(item.trollQuestId, item.reqScore);
            if (prog.unlocked) {
              tq.unlockedIds[item.trollQuestId] = true;
            }
          });

          const allPokeItems = [...BIRD_SKINS, ...PIPE_SKINS].filter(i => i.reqMode === 'pokemon' && i.pokeQuestId);
          allPokeItems.forEach(item => {
            const prog = this.getPokemonQuestProgress(item.pokeQuestId);
            if (prog.unlocked) {
              tq.unlockedIds[item.pokeQuestId] = true;
            } else {
              delete tq.unlockedIds[item.pokeQuestId];
            }
          });

          this.saveTrollQuests();
        }

        getBestForDifficulty(diffKey) {
          if (this.currentUser && this.currentUser.records) {
            return Number(this.currentUser.records[diffKey]) || 0;
          }
          return Number(this.localRecords && this.localRecords[diffKey]) || 0;
        }

        getHighestScoreAnyMode() {
          return Math.max(
            this.getBestForDifficulty('easy'),
            this.getBestForDifficulty('medium'),
            this.getBestForDifficulty('hard')
          );
        }

        isCosmeticUnlocked(item) {
          if (!item) return false;
          // Priority 1: Admin-locked skins stay locked and cannot be unlocked until MeDonut unlocks them
          if (this.currentUser && Array.isArray(this.currentUser.adminLockedSkins) && this.currentUser.adminLockedSkins.includes(item.id)) {
            return false;
          }
          // Priority 2: Admin-granted skins are unlocked immediately
          if (this.currentUser && Array.isArray(this.currentUser.grantedSkins) && this.currentUser.grantedSkins.includes(item.id)) {
            return true;
          }
          // Priority 2.5: Skin equipped by database/admin is unlocked immediately
          if (this.currentUser && (this.currentUser.selectedSkin === item.id || this.currentUser.selectedPipeSkin === item.id)) {
            return true;
          }
          if (item.reqMode === 'meme' && item.trollQuestId) {
            return this.getTrollQuestProgress(item.trollQuestId, item.reqScore).unlocked;
          }
          if (item.reqMode === 'pokemon' && item.pokeQuestId) {
            return this.getPokemonQuestProgress(item.pokeQuestId).unlocked;
          }
          if (item.reqScore <= 0) return true;
          const anyBest = this.getHighestScoreAnyMode();
          if (item.altScore && anyBest >= item.altScore) return true;
          if (item.reqMode === 'any') {
            return anyBest >= item.reqScore;
          }
          return this.getBestForDifficulty(item.reqMode) >= item.reqScore;
        }

        getUnlockedBirdSkinCount() {
          return BIRD_SKINS.filter(s => this.isCosmeticUnlocked(s)).length;
        }

        getUnlockedPipeSkinCount() {
          return PIPE_SKINS.filter(s => this.isCosmeticUnlocked(s)).length;
        }

        // ------------------------------------------------------------------------
        // ONLINE API & AUTHENTICATION (WITH COLD-START 502/503 RESILIENT RETRIES)
        // ------------------------------------------------------------------------
        async apiRequest(path, method = 'GET', body = null, maxRetries = 2) {
          const headers = { 'Content-Type': 'application/json' };
          if (this.authToken) {
            headers['Authorization'] = `Bearer ${this.authToken}`;
          }

          let attempt = 0;
          while (attempt <= maxRetries) {
            try {
              const res = await fetch(path, {
                method,
                headers,
                body: body ? JSON.stringify(body) : null
              });

              if (res.ok) {
                return await res.json();
              }

              const status = res.status;
              // Handle server wake-up/proxy delays (502 Bad Gateway, 503 Unavailable, 504 Gateway Timeout)
              if ((status === 502 || status === 503 || status === 504) && attempt < maxRetries) {
                attempt++;
                await new Promise(r => setTimeout(r, attempt * 800));
                continue;
              }

              const data = await res.json().catch(() => ({}));
              throw new Error(data.error || `Request failed (${status})`);
            } catch (err) {
              const errMsg = String(err && err.message || '');
              const isProxyOrWakeup = errMsg.includes('502') || errMsg.includes('503') || errMsg.includes('504');
              const isNetworkErr = (err && err.name === 'TypeError') || errMsg.toLowerCase().includes('failed to fetch');

              if ((isProxyOrWakeup || isNetworkErr) && attempt < maxRetries) {
                attempt++;
                await new Promise(r => setTimeout(r, attempt * 800));
                continue;
              }

              const isLocalHost = typeof window !== 'undefined' && window.location && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
              if (isLocalHost && window.location.port !== '3000' && !errMsg.includes('40')) {
                try {
                  const fallbackUrl = `http://localhost:3000${path.startsWith('/') ? '' : '/'}${path}`;
                  const fallbackRes = await fetch(fallbackUrl, {
                    method,
                    headers,
                    body: body ? JSON.stringify(body) : null
                  });
                  if (fallbackRes.ok) return await fallbackRes.json();
                } catch (_) {}
              }
              throw err;
            }
          }
        }

        async initOnlineSession() {
          try {
            const info = await this.apiRequest('/api/server-info');
            const dot = document.getElementById('server-dot');
            if (dot) dot.classList.remove('offline');
            const lanEl = document.getElementById('lan-url-text');
            if (lanEl) {
              if (info.lanAddresses && info.lanAddresses.length > 0) {
                lanEl.textContent = `http://${info.lanAddresses[0]}:${info.port}`;
              } else {
                lanEl.textContent = window.location.origin;
              }
            }
          } catch (_) {
            const dot = document.getElementById('server-dot');
            if (dot) dot.classList.add('offline');
          }

          if (this.authToken) {
            try {
              const data = await this.apiRequest('/api/me');
              this.setLoggedInUser(data.user, this.authToken);
              if (data.leaderboards) {
                this.leaderboards = data.leaderboards;
                if (data.timeframeLeaderboards) {
                  this.timeframeLeaderboards = data.timeframeLeaderboards;
                  try {
                    localStorage.setItem('flappy3d_cached_timeframe_lb', JSON.stringify(data.timeframeLeaderboards));
                  } catch (_) {}
                }
                if (data.resetBoundaries) {
                  this.resetBoundaries = data.resetBoundaries;
                  if (typeof data.resetBoundaries.serverTime === 'number') {
                    this.clientServerTimeOffset = data.resetBoundaries.serverTime - Date.now();
                  }
                }
                try {
                  localStorage.setItem('flappy3d_cached_leaderboards', JSON.stringify(data.leaderboards));
                } catch (_) {}
                if (typeof this.updateResetTimerUI === 'function') {
                  this.updateResetTimerUI();
                }
                this.renderLeaderboard();
              }
              return;
            } catch (_) {
              this.clearLoggedInUser(false);
            }
          }

          // When on a Guest account, automatically bring up the Login Prompt Screen asking the player to log in!
          if (!this.currentUser) {
            this.toggleGuestLoginModal(true);
          }

          await this.fetchLeaderboards();
        }

        getDefaultLeaderboardSnapshot() {
          return {
            easy: [
              { id: 'seed_e1', username: 'MeDonut', score: 109, verified: true, date: Date.now() - 3600000, skin: 'sakura' },
              { id: 'seed_e2', username: 'joslor11', score: 85, verified: true, date: Date.now() - 7200000, skin: 'emerald' },
              { id: 'seed_e3', username: 'SkyAce', score: 72, verified: true, date: Date.now() - 10800000, skin: 'crimson' },
              { id: 'seed_e4', username: 'ejstrup', score: 54, verified: true, date: Date.now() - 14400000, skin: 'cyber' },
              { id: 'seed_e5', username: 'thomsen', score: 41, verified: true, date: Date.now() - 18000000, skin: 'golden' }
            ],
            medium: [
              { id: 'seed_m1', username: 'joslor11', score: 42, verified: true, date: Date.now() - 3600000, skin: 'emerald' },
              { id: 'seed_m2', username: 'MeDonut', score: 40, verified: true, date: Date.now() - 7200000, skin: 'sakura' },
              { id: 'seed_m3', username: 'SkyAce', score: 38, verified: true, date: Date.now() - 10800000, skin: 'crimson' },
              { id: 'seed_m4', username: 'ejstrup', score: 29, verified: true, date: Date.now() - 14400000, skin: 'cyber' },
              { id: 'seed_m5', username: 'thomsen', score: 25, verified: true, date: Date.now() - 18000000, skin: 'golden' }
            ],
            hard: [
              { id: 'seed_h1', username: 'MeDonut', score: 27, verified: true, date: Date.now() - 3600000, skin: 'sakura' },
              { id: 'seed_h2', username: 'SkyAce', score: 24, verified: true, date: Date.now() - 7200000, skin: 'crimson' },
              { id: 'seed_h3', username: 'joslor11', score: 21, verified: true, date: Date.now() - 10800000, skin: 'emerald' },
              { id: 'seed_h4', username: 'ejstrup', score: 18, verified: true, date: Date.now() - 14400000, skin: 'cyber' },
              { id: 'seed_h5', username: 'thomsen', score: 15, verified: true, date: Date.now() - 18000000, skin: 'golden' }
            ]
          };
        }

        async fetchLeaderboards(showAll = null) {
          if (showAll !== null) {
            this.lbShowAllPlayers = Boolean(showAll);
          }
          if (typeof this.updateLeaderboardToggleBtn === 'function') {
            this.updateLeaderboardToggleBtn();
          }
          try {
            const url = this.lbShowAllPlayers ? '/api/leaderboard?all=true' : '/api/leaderboard';
            const data = await this.apiRequest(url);
            if (data && data.leaderboards) {
              this.leaderboards = data.leaderboards;
              if (data.timeframeLeaderboards) {
                this.timeframeLeaderboards = data.timeframeLeaderboards;
                try {
                  localStorage.setItem('flappy3d_cached_timeframe_lb', JSON.stringify(data.timeframeLeaderboards));
                } catch (_) {}
              }
              if (data.resetBoundaries) {
                this.resetBoundaries = data.resetBoundaries;
                if (typeof data.resetBoundaries.serverTime === 'number') {
                  this.clientServerTimeOffset = data.resetBoundaries.serverTime - Date.now();
                }
              }
              try {
                localStorage.setItem('flappy3d_cached_leaderboards', JSON.stringify(data.leaderboards));
              } catch (_) {}
              if (typeof this.updateResetTimerUI === 'function') {
                this.updateResetTimerUI();
              }
              this.renderLeaderboard();
              return;
            }
          } catch (err) {
            // Live fetch failed, fall back to offline cache or snapshot
          }

          let cachedData = null;
          try {
            const raw = localStorage.getItem('flappy3d_cached_leaderboards');
            if (raw) cachedData = JSON.parse(raw);
            const rawTf = localStorage.getItem('flappy3d_cached_timeframe_lb');
            if (rawTf) this.timeframeLeaderboards = JSON.parse(rawTf);
          } catch (_) {}

          if (!this.resetBoundaries && typeof this.computeLocalResetBoundaries === 'function') {
            this.resetBoundaries = this.computeLocalResetBoundaries();
          }
          if (typeof this.updateResetTimerUI === 'function') {
            this.updateResetTimerUI();
          }

          if (cachedData && typeof cachedData === 'object' && cachedData.easy) {
            this.leaderboards = cachedData;
            this.renderLeaderboard();
            const listEl = document.getElementById('lb-list');
            if (listEl && !listEl.querySelector('.lb-offline-notice')) {
              const notice = document.createElement('div');
              notice.className = 'lb-offline-notice';
              notice.innerHTML = `⚡ <span>Viewing Cached Standings</span> <small>(Run <code>node server.js</code> for live multiplayer)</small>`;
              listEl.prepend(notice);
            }
            return;
          }

          this.leaderboards = this.getDefaultLeaderboardSnapshot();
          if (!this.timeframeLeaderboards) {
            this.timeframeLeaderboards = {
              all: this.leaderboards,
              weekly: this.leaderboards,
              daily: this.leaderboards
            };
          }
          this.renderLeaderboard();
          const listEl = document.getElementById('lb-list');
          if (listEl && !listEl.querySelector('.lb-offline-notice')) {
            const notice = document.createElement('div');
            notice.className = 'lb-offline-notice';
            notice.innerHTML = `⚡ <span>Standings Snapshot</span> <small>(Start <code>node server.js</code> on port 3000 for live cloud sync)</small>`;
            listEl.prepend(notice);
          }
        }

        updateLeaderboardToggleBtn() {
          const btn = document.getElementById('lb-toggle-top100-btn');
          const icon = document.getElementById('lb-toggle-icon');
          const text = document.getElementById('lb-toggle-text');
          if (!btn) return;
          if (this.lbShowAllPlayers) {
            btn.classList.add('active');
            if (icon) icon.textContent = '👥';
            if (text) text.textContent = 'All Players: ON';
            btn.title = 'Showing All Players! Click to view Top 100 Only.';
          } else {
            btn.classList.remove('active');
            if (icon) icon.textContent = '🌐';
            if (text) text.textContent = 'All Players: OFF';
            btn.title = 'Showing Top 100 Only. Click to view All Players.';
          }
        }

        computeLocalResetBoundaries(nowMs = Date.now() + (this.clientServerTimeOffset || 0)) {
          try {
            const dtf = new Intl.DateTimeFormat('en-US', {
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

            const getOffset = (utcMs) => {
              const parts = dtf.formatToParts(new Date(utcMs));
              const res = {};
              for (let i = 0; i < parts.length; i++) {
                const p = parts[i];
                if (p.type !== 'literal') res[p.type] = p.value;
              }
              const cphUtc = Date.UTC(
                parseInt(res.year, 10),
                parseInt(res.month, 10) - 1,
                parseInt(res.day, 10),
                parseInt(res.hour, 10) % 24,
                parseInt(res.minute, 10),
                parseInt(res.second, 10)
              );
              return cphUtc - utcMs;
            };

            const toUtc = (year, month, day, hour = 7, min = 0, sec = 0) => {
              const guess = Date.UTC(year, month - 1, day, hour, min, sec);
              const o1 = getOffset(guess);
              const cand = guess - o1;
              const o2 = getOffset(cand);
              return guess - o2;
            };

            const getParts = (ts) => {
              const parts = dtf.formatToParts(new Date(ts));
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
            };

            const parts = getParts(nowMs);
            const today7amMs = toUtc(parts.year, parts.month, parts.day, 7, 0, 0);

            let curDailyMs, nextDailyMs;
            if (nowMs >= today7amMs) {
              curDailyMs = today7amMs;
              const tomorrowParts = getParts(today7amMs + 28 * 3600 * 1000);
              nextDailyMs = toUtc(tomorrowParts.year, tomorrowParts.month, tomorrowParts.day, 7, 0, 0);
            } else {
              const yesterdayParts = getParts(today7amMs - 12 * 3600 * 1000);
              curDailyMs = toUtc(yesterdayParts.year, yesterdayParts.month, yesterdayParts.day, 7, 0, 0);
              nextDailyMs = today7amMs;
            }

            const WEEKDAY_INDEX = { 'Mon': 0, 'Tue': 1, 'Wed': 2, 'Thu': 3, 'Fri': 4, 'Sat': 5, 'Sun': 6 };
            const dayOfWeek = WEEKDAY_INDEX[parts.weekday] ?? 0;
            let curWeeklyMs, nextWeeklyMs;

            if (dayOfWeek === 0 && nowMs < today7amMs) {
              nextWeeklyMs = today7amMs;
              const prevMonParts = getParts(today7amMs - 7 * 24 * 3600 * 1000 + 4 * 3600 * 1000);
              curWeeklyMs = toUtc(prevMonParts.year, prevMonParts.month, prevMonParts.day, 7, 0, 0);
            } else {
              const daysSinceMon = dayOfWeek;
              const thisMonApprox = today7amMs - daysSinceMon * 24 * 3600 * 1000;
              const thisMonParts = getParts(thisMonApprox + 4 * 3600 * 1000);
              curWeeklyMs = toUtc(thisMonParts.year, thisMonParts.month, thisMonParts.day, 7, 0, 0);

              const daysUntilNextMon = 7 - daysSinceMon;
              const nextMonApprox = today7amMs + daysUntilNextMon * 24 * 3600 * 1000;
              const nextMonParts = getParts(nextMonApprox + 4 * 3600 * 1000);
              nextWeeklyMs = toUtc(nextMonParts.year, nextMonParts.month, nextMonParts.day, 7, 0, 0);
            }

            return {
              serverTime: nowMs,
              daily: {
                currentResetMs: curDailyMs,
                nextResetMs: nextDailyMs,
                remainingMs: Math.max(0, nextDailyMs - nowMs)
              },
              weekly: {
                currentResetMs: curWeeklyMs,
                nextResetMs: nextWeeklyMs,
                remainingMs: Math.max(0, nextWeeklyMs - nowMs)
              }
            };
          } catch (_) {
            return null;
          }
        }

        formatRemainingResetCountdown(remainingMs) {
          if (remainingMs <= 0) return '00:00:00';
          const totalSec = Math.floor(remainingMs / 1000);
          const days = Math.floor(totalSec / 86400);
          const hours = Math.floor((totalSec % 86400) / 3600);
          const minutes = Math.floor((totalSec % 3600) / 60);
          const seconds = totalSec % 60;
          const pad = (n) => String(n).padStart(2, '0');

          if (days > 0) {
            return `${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
          }
          return `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
        }

        updateResetTimerUI() {
          const nowMs = Date.now() + (this.clientServerTimeOffset || 0);
          let b = this.resetBoundaries;

          // Recompute boundaries if expired or not yet initialized
          if (!b || !b.daily || !b.weekly || nowMs >= b.daily.nextResetMs || nowMs >= b.weekly.nextResetMs) {
            b = this.computeLocalResetBoundaries(nowMs);
            if (b) this.resetBoundaries = b;
            // If a reset rollover occurred while page is open, refresh leaderboard data
            if (!this._isLeaderboardRollingOver) {
              this._isLeaderboardRollingOver = true;
              setTimeout(() => {
                this._isLeaderboardRollingOver = false;
                this.fetchLeaderboards();
              }, 1200);
            }
          }

          const tf = this.activeTimeframeTab || 'all';
          const badgeEl = document.getElementById('lb-reset-timer-badge');
          const iconEl = document.getElementById('lb-timer-icon');
          const labelEl = document.getElementById('lb-timer-label');
          const clockEl = document.getElementById('lb-timer-clock');
          const goPillEl = document.getElementById('gameover-lb-timer-pill');

          if (!b) return;

          const remainingDaily = Math.max(0, (b.daily?.nextResetMs || nowMs) - nowMs);
          const remainingWeekly = Math.max(0, (b.weekly?.nextResetMs || nowMs) - nowMs);

          const strDaily = this.formatRemainingResetCountdown(remainingDaily);
          const strWeekly = this.formatRemainingResetCountdown(remainingWeekly);

          if (tf === 'daily') {
            if (badgeEl) {
              badgeEl.className = 'lb-reset-timer-badge is-daily';
              badgeEl.title = `Daily Leaderboard resets every day at 07:00 Danish Time (Europe/Copenhagen). Next reset in ${strDaily}.`;
            }
            if (iconEl) iconEl.textContent = '🌅';
            if (labelEl) labelEl.textContent = 'Daily Reset in:';
            if (clockEl) clockEl.textContent = strDaily;
            if (goPillEl) goPillEl.textContent = `⏳ Daily Reset in: ${strDaily}`;
          } else if (tf === 'weekly') {
            if (badgeEl) {
              badgeEl.className = 'lb-reset-timer-badge is-weekly';
              badgeEl.title = `Weekly Leaderboard resets every Monday at 07:00 Danish Time (Europe/Copenhagen). Next reset in ${strWeekly}.`;
            }
            if (iconEl) iconEl.textContent = '📅';
            if (labelEl) labelEl.textContent = 'Weekly Reset in:';
            if (clockEl) clockEl.textContent = strWeekly;
            if (goPillEl) goPillEl.textContent = `⏳ Weekly Reset in: ${strWeekly}`;
          } else {
            // All-Time
            if (badgeEl) {
              badgeEl.className = 'lb-reset-timer-badge is-all';
              badgeEl.title = 'All-Time Hall of Fame: Permanent high scores that never expire.';
            }
            if (iconEl) iconEl.textContent = '👑';
            if (labelEl) labelEl.textContent = 'All Time:';
            if (clockEl) clockEl.textContent = 'Permanent 🏆';
            if (goPillEl) goPillEl.textContent = '👑 All Time: Permanent 🏆';
          }
        }

        setLoggedInUser(user, token) {
          this.currentUser = user;
          this.authToken = token;
          localStorage.setItem('flappy3d_token', token);

          const authBox = document.getElementById('auth-form-box');
          if (authBox) authBox.style.display = 'none';
          const accLayout = document.getElementById('account-body-layout');
          if (accLayout) {
            accLayout.classList.remove('is-guest-split');
            accLayout.classList.add('is-logged-in');
          }

          document.getElementById('profile-summary-box').style.display = 'flex';
          document.getElementById('profile-name-text').textContent = user.username;
          const statusPill = document.querySelector('#profile-summary-box .profile-status-pill');
          if (statusPill) {
            statusPill.textContent = '🟢 Online & Authenticated';
            statusPill.style.color = '#10b981';
          }
          document.querySelectorAll('.btn-logout, #hud-logout-btn').forEach(b => { b.style.display = 'inline-block'; });
          const capsuleNameEl = document.getElementById('capsule-username');
          if (capsuleNameEl) capsuleNameEl.textContent = user.username;
          document.getElementById('hud-username').textContent = `👤 ${user.username}`;

          const dockAccLabel = document.getElementById('dock-account-label');
          if (dockAccLabel) dockAccLabel.textContent = user.username;
          const lobbyAuthText = document.getElementById('lobby-auth-text');
          if (lobbyAuthText) lobbyAuthText.innerHTML = `👋 Logged in as <strong>${user.username}</strong> • 🟢 Synced`;
          const lobbyAuthBtn = document.getElementById('btn-lobby-auth-action');
          if (lobbyAuthBtn) lobbyAuthBtn.textContent = '👤 My Account';

          // Only the user MeDonut has access to the Database button & manager!
          const dbBtn = document.getElementById('btn-open-database');
          if (dbBtn) {
            const isMeDonut = Boolean(user && user.username && user.username.toLowerCase() === 'medonut');
            dbBtn.style.display = isMeDonut ? 'inline-flex' : 'none';
          }

          this.toggleGuestLoginModal(false);

          if (user.records) {
            this.localRecords = {
              easy: Number(user.records.easy) || 0,
              medium: Number(user.records.medium) || 0,
              hard: Number(user.records.hard) || 0
            };
            this.saveLocalRecords();
          }

          this.reconcileTrollQuests();

          const skinObj = BIRD_SKINS.find(s => s.id === (user.selectedSkin || this.selectedSkinId));
          if (skinObj && this.isCosmeticUnlocked(skinObj)) {
            this.applySkin(skinObj.id, false);
          } else {
            this.applySkin('classic', false);
            if (this.authToken) {
              this.apiRequest('/api/skin', 'POST', { skinId: 'classic' }).catch(() => {});
            }
          }

          const pipeObj = PIPE_SKINS.find(p => p.id === (user.selectedPipeSkin || this.selectedPipeSkinId));
          if (pipeObj && this.isCosmeticUnlocked(pipeObj)) {
            this.applyPipeSkin(pipeObj.id, false);
          } else {
            this.applyPipeSkin('classic_pipe', false);
            if (this.authToken) {
              this.apiRequest('/api/skin', 'POST', { pipeSkinId: 'classic_pipe' }).catch(() => {});
            }
          }

          this.validateAndReconcileEquippedSkins();
          if (user.avatarSkinId) {
            this.avatarSkinId = user.avatarSkinId;
            try { localStorage.setItem('flappy3d_avatar_skin', user.avatarSkinId); } catch (_) {}
          }
          this.updateAllProfilePictures();
          this.updateProfileRecordPills();
          this.renderAllCosmeticGrids();
          this.renderLeaderboard();
          if (typeof this.prefetchRunSession === 'function') {
            this.prefetchRunSession(this.selectedDifficulty);
          }
        }

        clearLoggedInUser(showGuestPrompt = true) {
          this.currentUser = null;
          this.authToken = null;
          this.prefetchedRun = null;
          this.prefetchPromise = null;
          this.prefetchingDifficulty = null;
          this.localRecords = { easy: 0, medium: 0, hard: 0 };
          this.saveLocalRecords();
          localStorage.removeItem('flappy3d_token');

          const dbBtn = document.getElementById('btn-open-database');
          if (dbBtn) {
            dbBtn.style.display = 'none';
          }

          const authBox = document.getElementById('auth-form-box');
          if (authBox) authBox.style.display = 'flex';
          const accLayout = document.getElementById('account-body-layout');
          if (accLayout) {
            accLayout.classList.add('is-guest-split');
            accLayout.classList.remove('is-logged-in');
          }

          document.getElementById('profile-summary-box').style.display = 'flex';
          document.getElementById('profile-name-text').textContent = 'Guest Player';
          const statusPill2 = document.querySelector('#profile-summary-box .profile-status-pill');
          if (statusPill2) {
            statusPill2.textContent = '⚪ Guest Session (Local Records)';
            statusPill2.style.color = '';
          }
          document.querySelectorAll('.btn-logout, #hud-logout-btn').forEach(b => { b.style.display = 'none'; });
          const capsuleNameEl2 = document.getElementById('capsule-username');
          if (capsuleNameEl2) capsuleNameEl2.textContent = 'Guest Player';
          document.getElementById('hud-username').textContent = 'Guest';

          const dockAccLabel2 = document.getElementById('dock-account-label');
          if (dockAccLabel2) dockAccLabel2.textContent = 'Login';
          const lobbyAuthText2 = document.getElementById('lobby-auth-text');
          if (lobbyAuthText2) lobbyAuthText2.innerHTML = '👤 Playing as <strong>Guest</strong>';
          const lobbyAuthBtn2 = document.getElementById('btn-lobby-auth-action');
          if (lobbyAuthBtn2) lobbyAuthBtn2.textContent = '🔑 Log In / Register';
          this.updateAllProfilePictures();
          this.updateProfileRecordPills();
          this.renderAllCosmeticGrids();
          this.renderLeaderboard();

          if (showGuestPrompt) {
            this.toggleGuestLoginModal(true);
          }
        }

        setProfileAvatar(birdSkinId) {
          const skin = BIRD_SKINS.find(s => s.id === birdSkinId);
          if (!skin) return;
          this.avatarSkinId = birdSkinId;
          try {
            localStorage.setItem('flappy3d_avatar_skin', birdSkinId);
          } catch (_) {}

          if (this.currentUser) {
            this.currentUser.avatarSkinId = birdSkinId;
          }

          if (this.authToken) {
            this.apiRequest('/api/user/set-avatar', 'POST', { avatarSkinId: birdSkinId }).catch(() => {});
          }

          this.updateAllProfilePictures();
          if (this.activeBirdSpotlightSkin) {
            this.renderSpotlightBox('bird-skin-spotlight', this.activeBirdSpotlightSkin, false);
          }
          const toast = document.getElementById('unlock-toast');
          if (toast) {
            toast.textContent = `🖼️ Profile picture set to ${skin.name}!`;
            toast.classList.add('visible');
            setTimeout(() => { toast.classList.remove('visible'); }, 3000);
          }
        }

        updateAllProfilePictures() {
          const currentId = this.avatarSkinId || (this.currentUser && this.currentUser.avatarSkinId) || this.selectedSkinId || 'classic';
          const skin = BIRD_SKINS.find(s => s.id === currentId) || BIRD_SKINS[0];
          if (!skin) return;

          const hexBody = '#' + skin.body.toString(16).padStart(6, '0');
          const hexWing = '#' + skin.wing.toString(16).padStart(6, '0');
          const gradientStyle = `linear-gradient(135deg, ${hexBody} 45%, ${hexWing} 100%)`;

          const capsuleAvatars = document.querySelectorAll('.capsule-avatar, #capsule-avatar');
          capsuleAvatars.forEach(el => {
            el.textContent = skin.emoji;
            el.style.background = gradientStyle;
            el.style.borderRadius = '50%';
            el.style.display = 'inline-flex';
            el.style.alignItems = 'center';
            el.style.justifyContent = 'center';
            el.style.width = '26px';
            el.style.height = '26px';
            el.style.fontSize = '14px';
            el.style.boxShadow = `0 2px 8px ${hexBody}66`;
            el.title = `Profile Picture: ${skin.name}`;
          });

          const heroAvatar = document.getElementById('profile-avatar-emoji');
          if (heroAvatar) {
            heroAvatar.textContent = skin.emoji;
            heroAvatar.style.background = gradientStyle;
            heroAvatar.style.display = 'flex';
            heroAvatar.style.alignItems = 'center';
            heroAvatar.style.justifyContent = 'center';
            heroAvatar.style.boxShadow = `0 6px 20px ${hexBody}88`;
            heroAvatar.title = `Profile Picture: ${skin.name}`;
          }

          const pubAvatar = document.getElementById('public-profile-avatar');
          if (pubAvatar && pubAvatar.dataset && pubAvatar.dataset.isSelf === 'true') {
            pubAvatar.textContent = skin.emoji;
            pubAvatar.style.background = gradientStyle;
          }
        }

        async openPublicProfileModal(username) {
          const modal = document.getElementById('player-public-profile-modal');
          if (!modal) return;

          const cleanName = String(username || '').trim();
          modal.style.display = 'flex';
          modal.classList.add('active');

          const unameEl = document.getElementById('public-profile-username');
          if (unameEl) unameEl.textContent = cleanName;
          const badgeEl = document.getElementById('public-profile-badge');
          if (badgeEl) badgeEl.textContent = cleanName.toLowerCase() === 'medonut' ? '👑 SERVER ADMIN & DEV' : '⭐ VERIFIED PILOT';
          const joinedEl = document.getElementById('public-profile-joined');
          if (joinedEl) joinedEl.textContent = 'Fetching player records...';

          let profileData = null;
          try {
            const res = await this.apiRequest(`/api/user/profile?username=${encodeURIComponent(cleanName)}`);
            if (res && res.profile) profileData = res.profile;
          } catch (_) {}

          if (!profileData) {
            const easyEntry = (this.leaderboards.easy || []).find(e => e.username.toLowerCase() === cleanName.toLowerCase());
            const medEntry = (this.leaderboards.medium || []).find(e => e.username.toLowerCase() === cleanName.toLowerCase());
            const hardEntry = (this.leaderboards.hard || []).find(e => e.username.toLowerCase() === cleanName.toLowerCase());

            const easyRank = easyEntry ? `#${(this.leaderboards.easy || []).indexOf(easyEntry) + 1}` : 'Unranked';
            const medRank = medEntry ? `#${(this.leaderboards.medium || []).indexOf(medEntry) + 1}` : 'Unranked';
            const hardRank = hardEntry ? `#${(this.leaderboards.hard || []).indexOf(hardEntry) + 1}` : 'Unranked';

            profileData = {
              username: cleanName,
              records: {
                easy: easyEntry ? easyEntry.score : 0,
                medium: medEntry ? medEntry.score : 0,
                hard: hardEntry ? hardEntry.score : 0
              },
              selectedSkin: (easyEntry && easyEntry.skin) || (cleanName.toLowerCase() === 'medonut' ? 'sakura' : 'classic'),
              selectedPipeSkin: (cleanName.toLowerCase() === 'medonut' ? 'glacier_pipe' : 'classic_pipe'),
              avatarSkinId: (cleanName.toLowerCase() === 'medonut' ? 'sakura' : 'classic'),
              createdAt: Date.now() - 86400000 * 14,
              totalRuns: (easyEntry ? 1 : 0) + (medEntry ? 1 : 0) + (hardEntry ? 1 : 0),
              ranks: { easy: easyRank, medium: medRank, hard: hardRank }
            };
          }

          const avatarSkin = BIRD_SKINS.find(s => s.id === (profileData.avatarSkinId || profileData.selectedSkin)) || BIRD_SKINS[0];
          const avatarEl = document.getElementById('public-profile-avatar');
          if (avatarEl && avatarSkin) {
            const hexBody = '#' + avatarSkin.body.toString(16).padStart(6, '0');
            const hexWing = '#' + avatarSkin.wing.toString(16).padStart(6, '0');
            avatarEl.textContent = avatarSkin.emoji;
            avatarEl.style.background = `linear-gradient(135deg, ${hexBody} 45%, ${hexWing} 100%)`;
            avatarEl.style.boxShadow = `0 6px 20px ${hexBody}88`;
            avatarEl.dataset.isSelf = (this.currentUser && this.currentUser.username.toLowerCase() === cleanName.toLowerCase()) ? 'true' : 'false';
          }

          if (joinedEl) {
            const dateStr = profileData.createdAt ? new Date(profileData.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Verified Flier';
            joinedEl.textContent = `Member since ${dateStr}`;
          }

          const birdSkin = BIRD_SKINS.find(s => s.id === profileData.selectedSkin) || BIRD_SKINS[0];
          const pipeSkin = PIPE_SKINS.find(p => p.id === profileData.selectedPipeSkin) || PIPE_SKINS[0];

          const birdSwatch = document.getElementById('public-bird-swatch');
          const birdName = document.getElementById('public-bird-name');
          if (birdSwatch && birdSkin) {
            const hexBody = '#' + birdSkin.body.toString(16).padStart(6, '0');
            const hexWing = '#' + birdSkin.wing.toString(16).padStart(6, '0');
            birdSwatch.textContent = birdSkin.emoji;
            birdSwatch.style.background = `linear-gradient(135deg, ${hexBody} 45%, ${hexWing} 100%)`;
          }
          if (birdName && birdSkin) {
            birdName.textContent = birdSkin.name;
          }

          const pipeSwatch = document.getElementById('public-pipe-swatch');
          const pipeName = document.getElementById('public-pipe-name');
          if (pipeSwatch && pipeSkin) {
            pipeSwatch.textContent = pipeSkin.emoji;
            pipeSwatch.style.background = `linear-gradient(90deg, ${pipeSkin.colors[0]} 0%, ${pipeSkin.colors[2]} 50%, ${pipeSkin.colors[1]} 100%)`;
          }
          if (pipeName && pipeSkin) {
            pipeName.textContent = pipeSkin.name;
          }

          const recEasy = document.getElementById('public-rec-easy');
          const recMed = document.getElementById('public-rec-med');
          const recHard = document.getElementById('public-rec-hard');
          const rankEasy = document.getElementById('public-rank-easy');
          const rankMed = document.getElementById('public-rank-med');
          const rankHard = document.getElementById('public-rank-hard');

          if (recEasy) recEasy.textContent = `${profileData.records?.easy || 0} pts`;
          if (recMed) recMed.textContent = `${profileData.records?.medium || 0} pts`;
          if (recHard) recHard.textContent = `${profileData.records?.hard || 0} pts`;

          if (rankEasy) rankEasy.textContent = `Rank ${profileData.ranks?.easy || '--'}`;
          if (rankMed) rankMed.textContent = `Rank ${profileData.ranks?.medium || '--'}`;
          if (rankHard) rankHard.textContent = `Rank ${profileData.ranks?.hard || '--'}`;

          const runsStat = document.getElementById('public-stat-runs');
          const skinsStat = document.getElementById('public-stat-skins');
          const top100Stat = document.getElementById('public-stat-top100');
          if (runsStat) runsStat.textContent = String(profileData.totalRuns || 1);
          if (skinsStat) skinsStat.textContent = cleanName.toLowerCase() === 'medonut' ? '96/96 (Master)' : 'Active Collector';
          if (top100Stat) {
            let top100Count = 0;
            if (profileData.ranks?.easy && profileData.ranks.easy.startsWith('#')) top100Count++;
            if (profileData.ranks?.medium && profileData.ranks.medium.startsWith('#')) top100Count++;
            if (profileData.ranks?.hard && profileData.ranks.hard.startsWith('#')) top100Count++;
            top100Stat.textContent = `${top100Count} Modes`;
          }
        }

        closePublicProfileModal() {
          const modal = document.getElementById('player-public-profile-modal');
          if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('active');
          }
        }

        toggleGuestLoginModal(forceOpen) {
          const modal = document.getElementById('guest-login-modal');
          if (!modal) return;
          const isOpen = modal.classList.contains('active') || modal.classList.contains('visible') || modal.style.display === 'flex';
          const next = typeof forceOpen === 'boolean' ? forceOpen : !isOpen;
          modal.classList.toggle('active', next);
          modal.classList.toggle('visible', next);
          modal.style.display = next ? 'flex' : 'none';
        }

        async handleGuestModalAuth(mode) {
          const usernameInput = document.getElementById('guest-modal-username');
          const passwordInput = document.getElementById('guest-modal-password');
          const msgEl = document.getElementById('guest-modal-message');
          if (!usernameInput || !passwordInput || !msgEl) return;

          const username = usernameInput.value.trim();
          const password = passwordInput.value;

          if (!username) {
            msgEl.className = 'auth-msg error';
            msgEl.textContent = 'Please enter a username (2-20 characters).';
            return;
          }
          if (!password) {
            msgEl.className = 'auth-msg error';
            msgEl.textContent = 'Please enter a password.';
            return;
          }

          msgEl.className = 'auth-msg';
          msgEl.textContent = mode === 'register' ? 'Creating account...' : 'Logging in (connecting to server)...';

          try {
            let data;
            if (mode === 'smart') {
              // Try login first; if 401 (Account not found), automatically register!
              try {
                data = await this.apiRequest('/api/login', 'POST', { username, password });
              } catch (loginErr) {
                if (loginErr.message && (loginErr.message.toLowerCase().includes('not found') || loginErr.message.includes('401'))) {
                  msgEl.textContent = 'Account not found — creating new account...';
                  data = await this.apiRequest('/api/register', 'POST', {
                    username,
                    password,
                    records: this.localRecords
                  });
                } else {
                  throw loginErr;
                }
              }
            } else {
              const endpoint = mode === 'register' ? '/api/register' : '/api/login';
              data = await this.apiRequest(endpoint, 'POST', {
                username,
                password,
                records: this.localRecords
              });
            }
            passwordInput.value = '';
            msgEl.className = 'auth-msg success';
            msgEl.textContent = `Welcome, ${data.user.username}!`;
            this.setLoggedInUser(data.user, data.token);
            if (data.leaderboards) {
              this.leaderboards = data.leaderboards;
              this.renderLeaderboard();
            }
            this.toggleGuestLoginModal(false);
          } catch (err) {
            msgEl.className = 'auth-msg error';
            msgEl.textContent = err.message;
          }
        }

        updateProfileRecordPills() {
          const easyBest = this.getBestForDifficulty('easy');
          const medBest = this.getBestForDifficulty('medium');
          const hardBest = this.getBestForDifficulty('hard');
          const anyBest = this.getHighestScoreAnyMode();

          const recEasyEl = document.getElementById('rec-easy');
          if (recEasyEl) recEasyEl.textContent = String(easyBest);
          const recMedEl = document.getElementById('rec-medium');
          if (recMedEl) recMedEl.textContent = String(medBest);
          const recHardEl = document.getElementById('rec-hard');
          if (recHardEl) recHardEl.textContent = String(hardBest);
          const recAnyEl = document.getElementById('rec-any');
          if (recAnyEl) recAnyEl.textContent = String(anyBest);

          const unlockedBirds = this.getUnlockedBirdSkinCount();
          const unlockedPipes = this.getUnlockedPipeSkinCount();
          const totalUnlocked = unlockedBirds + unlockedPipes;
          const totalCosmetics = BIRD_SKINS.length + PIPE_SKINS.length;
          const totalPct = Math.round((totalUnlocked / totalCosmetics) * 100);

          const badgeEl = document.getElementById('unlocked-count-badge');
          if (badgeEl) badgeEl.textContent = `🎨 ${totalUnlocked}/${totalCosmetics} Owned (${totalPct}%)`;

          // Dynamically update top-right profile capsule badge, nav dock badge, and locker tab counts!
          const capsuleCountEl = document.getElementById('capsule-owned-count');
          if (capsuleCountEl) capsuleCountEl.textContent = `🎨 ${totalUnlocked}/${totalCosmetics}`;
          const dockSkinsBadgeEl = document.getElementById('dock-skins-badge');
          if (dockSkinsBadgeEl) dockSkinsBadgeEl.textContent = `${totalUnlocked}/${totalCosmetics}`;
          const tabBirdBtnEl = document.getElementById('tab-btn-bird-skins');
          if (tabBirdBtnEl) tabBirdBtnEl.innerHTML = `<span>🐦</span> Bird Skins (${unlockedBirds}/${BIRD_SKINS.length})`;
          const tabPipeBtnEl = document.getElementById('tab-btn-pipe-skins');
          if (tabPipeBtnEl) tabPipeBtnEl.innerHTML = `<span>🏗️</span> Pipe Skins (${unlockedPipes}/${PIPE_SKINS.length})`;
          const gotoLockerBtnEl = document.getElementById('btn-account-goto-locker');
          if (gotoLockerBtnEl) gotoLockerBtnEl.textContent = `🎨 Open Skins Locker (${totalUnlocked}/${totalCosmetics})`;

          // Determine Pilot Rank Title for Profile & Stats
          let rankTitle = '🌱 Rookie Flyer';
          if (hardBest >= 55 || anyBest >= 95 || totalUnlocked >= 55) {
            rankTitle = '👑 Godlike Grandmaster';
          } else if (hardBest >= 35 || anyBest >= 65 || totalUnlocked >= 38) {
            rankTitle = '💎 Mythic Sky Ace';
          } else if (anyBest >= 30 || totalUnlocked >= 22) {
            rankTitle = '🥇 Gold Aviator';
          } else if (anyBest >= 15 || totalUnlocked >= 10) {
            rankTitle = '🥈 Silver Glider';
          } else if (anyBest >= 5 || totalUnlocked >= 4) {
            rankTitle = '🥉 Bronze Wing';
          }
          const rankPillEl = document.getElementById('profile-rank-pill');
          if (rankPillEl) rankPillEl.textContent = rankTitle;

          const profMasteryFill = document.getElementById('profile-mastery-bar-fill');
          if (profMasteryFill) profMasteryFill.style.width = `${totalPct}%`;
          const profMasteryPct = document.getElementById('profile-mastery-pct');
          if (profMasteryPct) profMasteryPct.textContent = `${totalUnlocked} / ${totalCosmetics} Skins (${totalPct}%)`;

          const easyBirdsCount = BIRD_SKINS.filter(s => s.reqMode === 'easy').length;
          const medBirdsCount = BIRD_SKINS.filter(s => s.reqMode === 'medium').length;
          const hardBirdsCount = BIRD_SKINS.filter(s => s.reqMode === 'hard').length;
          const pokeBirdsCount = BIRD_SKINS.filter(s => s.reqMode === 'pokemon').length;
          const memeBirdsCount = BIRD_SKINS.filter(s => s.reqMode === 'meme').length;

          const easyPipesCount = PIPE_SKINS.filter(p => p.reqMode === 'easy').length;
          const medPipesCount = PIPE_SKINS.filter(p => p.reqMode === 'medium').length;
          const hardPipesCount = PIPE_SKINS.filter(p => p.reqMode === 'hard').length;
          const pokePipesCount = PIPE_SKINS.filter(p => p.reqMode === 'pokemon').length;
          const memePipesCount = PIPE_SKINS.filter(p => p.reqMode === 'meme').length;

          // Update difficulty button meta pills (Personal Best + Average Score)
          const modesStats = (this.careerStats && this.careerStats.modes) || {};
          const getAvgStr = (mKey) => {
            const m = modesStats[mKey];
            return (m && m.runs > 0) ? (m.totalScore / m.runs).toFixed(1) : '0.0';
          };
          const getRunsCount = (mKey) => {
            const m = modesStats[mKey];
            return (m && m.runs) ? m.runs : 0;
          };
          const overallRuns = (this.careerStats && this.careerStats.totalRuns) || 0;
          const overallScore = (this.careerStats && this.careerStats.totalScore) || 0;
          const overallFlaps = (this.careerStats && this.careerStats.totalFlaps) || 0;
          const overallAvg = overallRuns > 0 ? (overallScore / overallRuns).toFixed(1) : '0.0';
          const overallFlapsPerPipe = overallScore > 0 ? (overallFlaps / overallScore).toFixed(1) : '—';

          // Update Profile Mode Record Meta Pills
          const recEasyMeta = document.getElementById('rec-easy-meta');
          if (recEasyMeta) recEasyMeta.textContent = `Avg: ${getAvgStr('easy')} pts • ${getRunsCount('easy')} Flights`;
          const recMedMeta = document.getElementById('rec-med-meta');
          if (recMedMeta) recMedMeta.textContent = `Avg: ${getAvgStr('medium')} pts • ${getRunsCount('medium')} Flights`;
          const recHardMeta = document.getElementById('rec-hard-meta');
          if (recHardMeta) recHardMeta.textContent = `Avg: ${getAvgStr('hard')} pts • ${getRunsCount('hard')} Flights`;
          const recAnyMeta = document.getElementById('rec-any-meta');
          if (recAnyMeta) recAnyMeta.textContent = `Avg: ${overallAvg} pts • ${overallRuns} Total Runs`;

          // Update Profile Active 3D Loadout Showcase & Avatar
          const activeBird = BIRD_SKINS.find(s => s.id === this.selectedSkinId) || BIRD_SKINS[0];
          const activePipe = PIPE_SKINS.find(p => p.id === this.selectedPipeSkinId) || PIPE_SKINS[0];
          const profAvatarEl = document.getElementById('profile-avatar-emoji');
          if (profAvatarEl && activeBird) {
            profAvatarEl.textContent = activeBird.emoji || '🐤';
            profAvatarEl.style.display = 'flex';
            profAvatarEl.style.alignItems = 'center';
            profAvatarEl.style.justifyContent = 'center';
            const hexBody = '#' + activeBird.body.toString(16).padStart(6, '0');
            const hexWing = '#' + activeBird.wing.toString(16).padStart(6, '0');
            profAvatarEl.style.background = `linear-gradient(135deg, ${hexBody} 50%, ${hexWing} 100%)`;
          }
          const eqBirdIcon = document.getElementById('profile-eq-bird-icon');
          if (eqBirdIcon && activeBird) {
            eqBirdIcon.textContent = activeBird.emoji;
            const hexBody = '#' + activeBird.body.toString(16).padStart(6, '0');
            const hexWing = '#' + activeBird.wing.toString(16).padStart(6, '0');
            eqBirdIcon.style.background = `linear-gradient(135deg, ${hexBody} 55%, ${hexWing} 100%)`;
          }
          const eqBirdName = document.getElementById('profile-eq-bird-name');
          if (eqBirdName && activeBird) eqBirdName.textContent = activeBird.name;
          const eqBirdTier = document.getElementById('profile-eq-bird-tier');
          if (eqBirdTier && activeBird) {
            eqBirdTier.textContent = activeBird.rarity;
            eqBirdTier.className = `rarity-tag rarity-${activeBird.rarity}`;
          }

          const eqPipeIcon = document.getElementById('profile-eq-pipe-icon');
          if (eqPipeIcon && activePipe) {
            eqPipeIcon.textContent = activePipe.emoji;
            eqPipeIcon.style.background = `linear-gradient(135deg, ${activePipe.colors[0]} 0%, ${activePipe.colors[2]} 50%, ${activePipe.colors[1]} 100%)`;
          }
          const eqPipeName = document.getElementById('profile-eq-pipe-name');
          if (eqPipeName && activePipe) eqPipeName.textContent = activePipe.name;
          const eqPipeTier = document.getElementById('profile-eq-pipe-tier');
          if (eqPipeTier && activePipe) {
            eqPipeTier.textContent = activePipe.rarity;
            eqPipeTier.className = `rarity-tag rarity-${activePipe.rarity}`;
          }

          // Update Profile Career & Quest Telemetry Counters
          const allCosmetics = [...BIRD_SKINS, ...PIPE_SKINS];
          const pokeOwned = allCosmetics.filter(i => i.reqMode === 'pokemon' && this.isCosmeticUnlocked(i)).length;
          const pokeTotal = pokeBirdsCount + pokePipesCount;
          const memeOwned = allCosmetics.filter(i => i.reqMode === 'meme' && this.isCosmeticUnlocked(i)).length;
          const memeTotal = memeBirdsCount + memePipesCount;

          const setElText = (id, txt) => {
            const el = document.getElementById(id);
            if (el) el.textContent = txt;
          };
          setElText('prof-stat-runs', String(overallRuns));
          setElText('prof-stat-pipes', String(overallScore));
          setElText('prof-stat-flaps', String(overallFlaps));
          setElText('prof-stat-efficiency', `${overallFlapsPerPipe}`);
          setElText('prof-stat-pokemon', `${pokeOwned} / ${pokeTotal}`);
          setElText('prof-stat-meme', `${memeOwned} / ${memeTotal}`);

          const metaEasy = document.getElementById('diff-meta-easy');
          const metaMed = document.getElementById('diff-meta-medium');
          const metaHard = document.getElementById('diff-meta-hard');
          const easyRec = (this.leaderboards && this.leaderboards.easy && this.leaderboards.easy[0] && this.leaderboards.easy[0].score) || 109;
          const easyRecUser = (this.leaderboards && this.leaderboards.easy && this.leaderboards.easy[0] && this.leaderboards.easy[0].username) || 'MeDonut';
          const medRec = (this.leaderboards && this.leaderboards.medium && this.leaderboards.medium[0] && this.leaderboards.medium[0].score) || 42;
          const medRecUser = (this.leaderboards && this.leaderboards.medium && this.leaderboards.medium[0] && this.leaderboards.medium[0].username) || 'joslor11';
          const hardRec = (this.leaderboards && this.leaderboards.hard && this.leaderboards.hard[0] && this.leaderboards.hard[0].score) || 27;
          const hardRecUser = (this.leaderboards && this.leaderboards.hard && this.leaderboards.hard[0] && this.leaderboards.hard[0].username) || 'MeDonut';

          if (metaEasy) metaEasy.innerHTML = `🏆 Record: ${easyRec} (${easyRecUser}) • 👤 Best: ${easyBest} • ${easyBirdsCount + easyPipesCount} Skins`;
          if (metaMed) metaMed.innerHTML = `🏆 Record: ${medRec} (${medRecUser}) • 👤 Best: ${medBest} • ${medBirdsCount + medPipesCount} Skins`;
          if (metaHard) metaHard.innerHTML = `🏆 Record: ${hardRec} (${hardRecUser}) • 👤 Best: ${hardBest} • ${hardBirdsCount + hardPipesCount} Skins`;

          // Update filter button counts for Bird Skins (Spacious 4x2 grid)
          const bAll = document.getElementById('bird-filter-all');
          const bOwned = document.getElementById('bird-filter-owned');
          const bLocked = document.getElementById('bird-filter-locked');
          const bPokemon = document.getElementById('bird-filter-pokemon');
          const bEasy = document.getElementById('bird-filter-easy');
          const bMed = document.getElementById('bird-filter-medium');
          const bHard = document.getElementById('bird-filter-hard');
          const bMeme = document.getElementById('bird-filter-meme');
          if (bAll) bAll.textContent = `✨ All (${BIRD_SKINS.length})`;
          if (bOwned) bOwned.textContent = `✅ Owned (${unlockedBirds})`;
          if (bLocked) bLocked.textContent = `🔒 Locked (${BIRD_SKINS.length - unlockedBirds})`;
          if (bPokemon) bPokemon.textContent = `🔴 Pokémon (${pokeBirdsCount})`;
          if (bEasy) bEasy.textContent = `🟢 Easy (${easyBirdsCount})`;
          if (bMed) bMed.textContent = `🟡 Medium (${medBirdsCount})`;
          if (bHard) bHard.textContent = `🔴 Hard (${hardBirdsCount})`;
          if (bMeme) bMeme.textContent = `😂 Meme (${memeBirdsCount})`;

          // Update filter button counts for Pipe Skins (Spacious 4x2 grid)
          const pAll = document.getElementById('pipe-filter-all');
          const pOwned = document.getElementById('pipe-filter-owned');
          const pLocked = document.getElementById('pipe-filter-locked');
          const pPokemon = document.getElementById('pipe-filter-pokemon');
          const pEasy = document.getElementById('pipe-filter-easy');
          const pMed = document.getElementById('pipe-filter-medium');
          const pHard = document.getElementById('pipe-filter-hard');
          const pMeme = document.getElementById('pipe-filter-meme');
          if (pAll) pAll.textContent = `✨ All (${PIPE_SKINS.length})`;
          if (pOwned) pOwned.textContent = `✅ Owned (${unlockedPipes})`;
          if (pLocked) pLocked.textContent = `🔒 Locked (${PIPE_SKINS.length - unlockedPipes})`;
          if (pPokemon) pPokemon.textContent = `🔴 Pokémon (${pokePipesCount})`;
          if (pEasy) pEasy.textContent = `🟢 Easy (${easyPipesCount})`;
          if (pMed) pMed.textContent = `🟡 Medium (${medPipesCount})`;
          if (pHard) pHard.textContent = `🔴 Hard (${hardPipesCount})`;
          if (pMeme) pMeme.textContent = `😂 Meme (${memePipesCount})`;

          this.updateNextUnlockTracker();
        }

        updateNextUnlockTracker() {
          const mode = this.selectedDifficulty || 'medium';
          const modeLabel = (typeof CONFIG !== 'undefined' && CONFIG.difficulties && CONFIG.difficulties[mode])
            ? CONFIG.difficulties[mode].label
            : (mode.charAt(0).toUpperCase() + mode.slice(1));
          const titleEl = document.getElementById('next-unlock-title');
          if (titleEl) {
            titleEl.textContent = `🎯 Next Unlock Goals (${modeLabel} Mode)`;
          }

          // Find closest locked Bird Skin achievable in current difficulty (or any/pokemon mode)
          const lockedBirdsForMode = BIRD_SKINS.filter(s => !this.isCosmeticUnlocked(s) && (s.reqMode === mode || s.reqMode === 'any' || s.reqMode === 'pokemon'));
          const fallbackLockedBirds = BIRD_SKINS.filter(s => !this.isCosmeticUnlocked(s));
          const birdCandidates = lockedBirdsForMode.length > 0 ? lockedBirdsForMode : fallbackLockedBirds;
          birdCandidates.sort((a, b) => {
            const pA = this.getCosmeticProgress(a);
            const pB = this.getCosmeticProgress(b);
            return (pA.target - pA.current) - (pB.target - pB.current);
          });
          const nextBird = birdCandidates[0] || null;
          this.nextGoalBirdSkin = nextBird;

          const bNameEl = document.getElementById('next-bird-name');
          const bReqEl = document.getElementById('next-bird-req');
          const bFillEl = document.getElementById('next-bird-fill');
          if (nextBird && bNameEl && bReqEl && bFillEl) {
            const prog = this.getCosmeticProgress(nextBird);
            bNameEl.textContent = `${nextBird.emoji} ${nextBird.name}`;
            bReqEl.innerHTML = `<span>${nextBird.reqText}</span><span>${prog.current}/${prog.target}</span>`;
            bFillEl.style.width = `${prog.percent}%`;
          } else if (bNameEl && bReqEl && bFillEl) {
            bNameEl.textContent = `🎉 All ${BIRD_SKINS.length} Birds Unlocked!`;
            bReqEl.innerHTML = `<span>100% Complete</span><span>${BIRD_SKINS.length}/${BIRD_SKINS.length}</span>`;
            bFillEl.style.width = `100%`;
          }

          // Find closest locked Pipe Skin achievable in current difficulty (or any/pokemon mode)
          const lockedPipesForMode = PIPE_SKINS.filter(p => !this.isCosmeticUnlocked(p) && (p.reqMode === mode || p.reqMode === 'any' || p.reqMode === 'pokemon'));
          const fallbackLockedPipes = PIPE_SKINS.filter(p => !this.isCosmeticUnlocked(p));
          const pipeCandidates = lockedPipesForMode.length > 0 ? lockedPipesForMode : fallbackLockedPipes;
          pipeCandidates.sort((a, b) => {
            const pA = this.getCosmeticProgress(a);
            const pB = this.getCosmeticProgress(b);
            return (pA.target - pA.current) - (pB.target - pB.current);
          });
          const nextPipe = pipeCandidates[0] || null;
          this.nextGoalPipeSkin = nextPipe;

          const pNameEl = document.getElementById('next-pipe-name');
          const pReqEl = document.getElementById('next-pipe-req');
          const pFillEl = document.getElementById('next-pipe-fill');
          if (nextPipe && pNameEl && pReqEl && pFillEl) {
            const prog = this.getCosmeticProgress(nextPipe);
            pNameEl.textContent = `${nextPipe.emoji} ${nextPipe.name}`;
            pReqEl.innerHTML = `<span>${nextPipe.reqText}</span><span>${prog.current}/${prog.target}</span>`;
            pFillEl.style.width = `${prog.percent}%`;
          } else if (pNameEl && pReqEl && pFillEl) {
            pNameEl.textContent = `🎉 All ${PIPE_SKINS.length} Pipes Unlocked!`;
            pReqEl.innerHTML = `<span>100% Complete</span><span>${PIPE_SKINS.length}/${PIPE_SKINS.length}</span>`;
            pFillEl.style.width = `100%`;
          }
        }

        getCosmeticProgress(item) {
          if (item.reqMode === 'meme' && item.trollQuestId) {
            const tProg = this.getTrollQuestProgress(item.trollQuestId, item.reqScore);
            return { current: tProg.current, target: tProg.target, percent: tProg.percent };
          }
          if (item.reqMode === 'pokemon' && item.pokeQuestId) {
            const pProg = this.getPokemonQuestProgress(item.pokeQuestId);
            return { current: pProg.current, target: pProg.target, percent: pProg.percent };
          }
          if (item.reqScore <= 0) {
            return { current: 1, target: 1, percent: 100 };
          }
          const anyBest = this.getHighestScoreAnyMode();
          const modeBest = item.reqMode === 'any' ? anyBest : this.getBestForDifficulty(item.reqMode);
          const current = modeBest;
          const target = item.reqScore;
          const percent = Math.max(0, Math.min(100, Math.round((current / target) * 100)));
          return { current, target, percent };
        }

        async handleAuth(mode) {
          const usernameInput = document.getElementById('auth-username');
          const passwordInput = document.getElementById('auth-password');
          const msgEl = document.getElementById('auth-message');

          const username = usernameInput.value.trim();
          const password = passwordInput.value;

          if (!username) {
            msgEl.className = 'auth-msg error';
            msgEl.textContent = 'Please enter a username (2-20 characters).';
            return;
          }
          if (!password) {
            msgEl.className = 'auth-msg error';
            msgEl.textContent = 'Please enter a password.';
            return;
          }

          msgEl.className = 'auth-msg';
          msgEl.textContent = mode === 'register' ? 'Creating account...' : 'Logging in (connecting to server)...';

          try {
            let data;
            if (mode === 'smart') {
              // Try login first; if 401 (Account not found), automatically register!
              try {
                data = await this.apiRequest('/api/login', 'POST', { username, password });
              } catch (loginErr) {
                if (loginErr.message && (loginErr.message.toLowerCase().includes('not found') || loginErr.message.includes('401'))) {
                  msgEl.textContent = 'Account not found — creating new account...';
                  data = await this.apiRequest('/api/register', 'POST', {
                    username,
                    password,
                    records: this.localRecords
                  });
                } else {
                  throw loginErr;
                }
              }
            } else {
              const endpoint = mode === 'register' ? '/api/register' : '/api/login';
              data = await this.apiRequest(endpoint, 'POST', {
                username,
                password,
                records: this.localRecords
              });
            }
            passwordInput.value = '';
            msgEl.className = 'auth-msg success';
            msgEl.textContent = `Welcome, ${data.user.username}!`;
            this.setLoggedInUser(data.user, data.token);
            if (data.leaderboards) {
              this.leaderboards = data.leaderboards;
              this.renderLeaderboard();
            }
          } catch (err) {
            msgEl.className = 'auth-msg error';
            msgEl.textContent = err.message;
          }
        }

        async handleLogout() {
          try {
            await this.apiRequest('/api/logout', 'POST');
          } catch (_) {}
          this.clearLoggedInUser();
        }

        renderLeaderboard(highlightEntryId = null) {
          if (typeof this.updateLeaderboardUniqueToggleUI === 'function') {
            this.updateLeaderboardUniqueToggleUI();
          }
          this.renderLeaderboardInto(
            document.getElementById('lb-list'),
            this.activeLbTab,
            highlightEntryId
          );

          const tfKey = this.activeTimeframeTab || 'all';
          const tfLabel = tfKey === 'daily' ? 'Daily' : (tfKey === 'weekly' ? 'Weekly' : 'All-Time');

          const goTitle = document.getElementById('gameover-lb-title');
          if (goTitle) {
            const label = CONFIG.difficulties[this.selectedDifficulty].label;
            goTitle.textContent = `🏆 Live Leaderboard (${tfLabel} · ${label})`;
          }
          this.renderLeaderboardInto(
            document.getElementById('gameover-lb-list'),
            this.selectedDifficulty,
            highlightEntryId
          );
        }

        renderLeaderboardInto(listEl, diffKey, highlightEntryId = null) {
          if (!listEl) return;
          const currentTf = this.activeTimeframeTab || 'all';
          const tfLeaderboard = this.timeframeLeaderboards && this.timeframeLeaderboards[currentTf];
          const rawEntries = (tfLeaderboard && tfLeaderboard[diffKey]) || (this.leaderboards && this.leaderboards[diffKey]) || [];
          const label = CONFIG.difficulties[diffKey].label;
          const tfLabel = currentTf === 'daily' ? 'Daily' : (currentTf === 'weekly' ? 'Weekly' : 'All-Time');

          // Preserve scroll position so periodic leaderboard refreshes NEVER jump back to the top!
          const prevScrollTop = listEl.scrollTop || 0;

          listEl.innerHTML = '';

          // Filter to 1 record per player if unique toggle is turned on
          let entries = rawEntries;
          if (this.lbUniqueRecordsOnly) {
            const maxScoreMap = new Map();
            for (const item of rawEntries) {
              const uKey = (item.username || '').toLowerCase();
              const curMax = maxScoreMap.get(uKey);
              if (curMax === undefined || item.score > curMax) {
                maxScoreMap.set(uKey, item.score);
              }
            }

            const maxCountMap = new Map();
            for (const item of rawEntries) {
              const uKey = (item.username || '').toLowerCase();
              if (item.score === maxScoreMap.get(uKey)) {
                maxCountMap.set(uKey, (maxCountMap.get(uKey) || 0) + 1);
              }
            }

            const seenPlayers = new Set();
            const uniqueEntries = [];
            for (const item of rawEntries) {
              const uKey = (item.username || '').toLowerCase();
              if (!seenPlayers.has(uKey) && item.score === maxScoreMap.get(uKey)) {
                seenPlayers.add(uKey);
                uniqueEntries.push({
                  ...item,
                  repeatCount: maxCountMap.get(uKey) || 1
                });
              }
            }
            uniqueEntries.sort((a, b) => b.score - a.score);
            entries = uniqueEntries;
          }

          // 1. Dedicated "Your Standing" Header Card
          const standingCard = document.createElement('div');
          standingCard.className = 'lb-my-standing-card';
          
          let myIndex = -1;
          if (this.currentUser) {
            myIndex = entries.findIndex(e => e.username.toLowerCase() === this.currentUser.username.toLowerCase());
          }

          if (this.currentUser && myIndex !== -1) {
            const myEntry = entries[myIndex];
            standingCard.classList.add('is-ranked');
            const repeatSuffix = this.lbUniqueRecordsOnly && myEntry.repeatCount > 1 ? ` (${myEntry.repeatCount}x)` : '';
            standingCard.innerHTML = `
              <div class="standing-pill-left">
                <span class="standing-crown">⭐</span>
                <div>
                  <div class="standing-title">Your Verified ${tfLabel} ${label} Standing</div>
                  <strong class="standing-rank">Rank #${myIndex + 1} of ${entries.length} ${this.lbUniqueRecordsOnly ? '(Unique Players)' : (this.lbShowAllPlayers ? '(All Players)' : '(Top 100)')}</strong>
                </div>
              </div>
              <div class="standing-pill-right">
                <span class="standing-tag">YOUR ${currentTf === 'all' ? 'BEST' : (currentTf === 'daily' ? 'DAILY BEST' : 'WEEKLY BEST')}</span>
                <span class="standing-score">${myEntry.score}${repeatSuffix} pts</span>
              </div>
            `;
          } else if (this.currentUser) {
            const userBest = this.getBestForDifficulty(diffKey);
            standingCard.classList.add('not-ranked');
            const unrankedSub = currentTf === 'daily'
              ? (entries.length > 0 ? `No run submitted today yet. Play a run on ${label} to claim your daily rank (resets 07:00)!` : 'Be the first to submit a run today to claim #1!')
              : (currentTf === 'weekly'
                ? (entries.length > 0 ? `No run submitted this week yet. Play a run on ${label} to claim your weekly rank (resets Mon 07:00)!` : 'Be the first to submit a run this week to claim #1!')
                : (entries.length > 0 ? (this.lbShowAllPlayers ? `Play a run on ${label} to appear on the global leaderboard!` : `Score ${entries[entries.length - 1].score + 1}+ pts to enter the Top 100!`) : 'Submit a run to claim #1!'));

            standingCard.innerHTML = `
              <div class="standing-pill-left">
                <span class="standing-crown">🎯</span>
                <div>
                  <div class="standing-title">Your ${label} Best: <strong>${userBest} pts</strong></div>
                  <div class="standing-sub">${unrankedSub}</div>
                </div>
              </div>
              <div class="standing-pill-right">
                <span class="standing-tag unranked">${currentTf === 'all' ? (this.lbShowAllPlayers ? 'Unranked' : 'Unranked in Top 100') : `Unranked ${tfLabel}`}</span>
              </div>
            `;
          } else {
            standingCard.classList.add('guest');
            standingCard.innerHTML = `
              <div class="standing-pill-left">
                <span class="standing-crown">👤</span>
                <div>
                  <div class="standing-title">Playing as Guest</div>
                  <div class="standing-sub">Log in with your account to lock in your global rank!</div>
                </div>
              </div>
              <button type="button" class="standing-login-btn" id="lb-standing-login-btn">Log In</button>
            `;
          }
          listEl.appendChild(standingCard);

          const standingLoginBtn = standingCard.querySelector('#lb-standing-login-btn');
          if (standingLoginBtn) {
            standingLoginBtn.addEventListener('click', () => this.switchView('account'));
          }

          if (entries.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'lb-empty';
            const tfDesc = currentTf === 'daily' ? 'today (since 07:00 Danish time)' : (currentTf === 'weekly' ? 'this week (since Monday 07:00 Danish time)' : 'all time');
            emptyEl.innerHTML = `No scores recorded on <strong>${label}</strong> for <strong>${tfDesc}</strong> yet.<br/>Be the first to set a record!`;
            listEl.appendChild(emptyEl);
            return;
          }

          const rawQuery = listEl.id === 'lb-list'
            ? ((this.lbSearchQuery !== undefined ? this.lbSearchQuery : (document.getElementById('lb-search-input')?.value || '')) || '').trim().toLowerCase()
            : '';

          let meRowElement = null;
          let matchedCount = 0;

          entries.forEach((item, idx) => {
            const rankStr = `#${idx + 1}`;
            if (rawQuery) {
              const uname = (item.username || '').toLowerCase();
              const scoreStr = String(item.score);
              if (!uname.includes(rawQuery) && !rankStr.includes(rawQuery) && !scoreStr.includes(rawQuery)) {
                return;
              }
            }
            matchedCount++;

            const row = document.createElement('div');
            const isMe = this.currentUser && this.currentUser.username.toLowerCase() === item.username.toLowerCase();
            const isLatestRun = highlightEntryId && item.id === highlightEntryId;
            row.className = 'lb-row' + (isMe ? ' me my-entry' : '') + (isLatestRun ? ' latest-run' : '');

            const rankEl = document.createElement('span');
            rankEl.className = 'lb-rank' + (idx < 3 ? ` rank-top rank-${idx + 1}` : '');
            rankEl.textContent = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : rankStr;

            const nameEl = document.createElement('span');
            nameEl.className = 'lb-player';
            
            const nameText = document.createElement('span');
            nameText.className = 'lb-player-name';
            nameText.textContent = item.username;
            nameText.title = `Click to view ${item.username}'s profile & stats`;
            nameText.addEventListener('click', (e) => {
              e.stopPropagation();
              this.openPublicProfileModal(item.username);
            });
            nameEl.appendChild(nameText);

            if (isMe) {
              const youBadge = document.createElement('span');
              youBadge.className = 'lb-you-badge';
              youBadge.textContent = '⭐ YOU';
              nameEl.appendChild(youBadge);
            }

            if (isLatestRun) {
              const justNowBadge = document.createElement('span');
              justNowBadge.className = 'lb-just-now-badge';
              justNowBadge.textContent = '⚡ Just Now!';
              nameEl.appendChild(justNowBadge);
            }

            const scoreEl = document.createElement('span');
            scoreEl.className = 'lb-score' + (isMe ? ' my-score' : '');
            if (this.lbUniqueRecordsOnly && item.repeatCount > 1) {
              scoreEl.innerHTML = `${item.score} <span class="lb-repeat-tag">(${item.repeatCount}x)</span>`;
            } else {
              scoreEl.textContent = String(item.score);
            }

            row.append(rankEl, nameEl, scoreEl);
            listEl.appendChild(row);

            if (isMe && !meRowElement) {
              meRowElement = row;
            }
          });

          if (matchedCount === 0 && rawQuery) {
            const emptySearchEl = document.createElement('div');
            emptySearchEl.className = 'lb-empty';
            emptySearchEl.innerHTML = `🔍 No leaderboard players or scores match "<strong>${rawQuery}</strong>" on ${label}.`;
            listEl.appendChild(emptySearchEl);
          }

          // Restore previous scroll position so scrolling down never jumps back to top after ~2s
          if (!highlightEntryId && prevScrollTop > 0) {
            listEl.scrollTop = prevScrollTop;
          } else if (highlightEntryId && meRowElement && listEl.id === 'lb-list') {
            setTimeout(() => {
              meRowElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 100);
          }
        }

        // ------------------------------------------------------------------------
        // BIRD SKINS, PIPE SKINS & DEDICATED PLAYER STATS MENU
        // ------------------------------------------------------------------------
        renderAllCosmeticGrids() {
          this.reconcileTrollQuests();
          this.validateAndReconcileEquippedSkins();
          if (!this.birdLockerFilter) this.birdLockerFilter = 'all';
          if (!this.pipeLockerFilter) this.pipeLockerFilter = 'all';
          this.updateProfileRecordPills();
          this.renderStatsMenu();
          this.renderBirdSkinsGrid();
          this.renderPipeSkinsGrid();
        }

        renderStatsMenu() {
          const container = document.getElementById('stats-scroll-area');
          if (!container) return;
          container.innerHTML = '';

          const easyBest = this.getBestForDifficulty('easy');
          const medBest = this.getBestForDifficulty('medium');
          const hardBest = this.getBestForDifficulty('hard');
          const anyBest = this.getHighestScoreAnyMode();

          const unlockedBirds = this.getUnlockedBirdSkinCount();
          const unlockedPipes = this.getUnlockedPipeSkinCount();
          const totalUnlocked = unlockedBirds + unlockedPipes;
          const totalCosmetics = BIRD_SKINS.length + PIPE_SKINS.length;
          const totalPct = Math.round((totalUnlocked / totalCosmetics) * 100);

          const mStats = (this.careerStats && this.careerStats.modes) || {};
          const getModeStat = (k) => mStats[k] || { runs: 0, totalScore: 0, totalFlaps: 0, lastScore: 0 };
          const calcAvg = (m) => m.runs > 0 ? (m.totalScore / m.runs).toFixed(1) : '0.0';
          const calcFlapsPerPipe = (m) => m.totalScore > 0 ? (m.totalFlaps / m.totalScore).toFixed(1) : '—';

          const easyM = getModeStat('easy');
          const medM  = getModeStat('medium');
          const hardM = getModeStat('hard');
          const overallRuns = (this.careerStats && this.careerStats.totalRuns) || 0;
          const overallScore = (this.careerStats && this.careerStats.totalScore) || 0;
          const overallFlaps = (this.careerStats && this.careerStats.totalFlaps) || 0;
          const overallAvg = overallRuns > 0 ? (overallScore / overallRuns).toFixed(1) : '0.0';
          const overallFlapsPerPipe = overallScore > 0 ? (overallFlaps / overallScore).toFixed(1) : '—';

          const allItems = [...BIRD_SKINS, ...PIPE_SKINS];
          const pokeItems = allItems.filter(i => i.reqMode === 'pokemon');
          const pokeOwnedCount = pokeItems.filter(i => this.isCosmeticUnlocked(i)).length;
          const memeItems = allItems.filter(i => i.reqMode === 'meme');
          const memeOwnedCount = memeItems.filter(i => this.isCosmeticUnlocked(i)).length;

          // Determine Pilot Rank Title
          let rankTitle = '🌱 Rookie Flyer';
          let rankSub = `Reach Score 10+ to advance • All ${BIRD_SKINS.length} Bird Skins share an identical 0.60m competitive hitbox`;
          if (hardBest >= 55 || anyBest >= 95 || totalUnlocked >= 55) {
            rankTitle = '👑 Godlike Grandmaster';
            rankSub = `Pinnacle 3D Flappy Bird Legend • All ${BIRD_SKINS.length} Bird Skins share an identical 0.60m competitive hitbox`;
          } else if (hardBest >= 35 || anyBest >= 65 || totalUnlocked >= 38) {
            rankTitle = '💎 Mythic Sky Ace';
            rankSub = `Master of High-Speed Flight • All ${BIRD_SKINS.length} Bird Skins share an identical 0.60m competitive hitbox`;
          } else if (anyBest >= 30 || totalUnlocked >= 22) {
            rankTitle = '🥇 Gold Aviator';
            rankSub = `Pokémon Trainer & Obstacle Navigator • All ${BIRD_SKINS.length} Bird Skins share an identical 0.60m competitive hitbox`;
          } else if (anyBest >= 15 || totalUnlocked >= 10) {
            rankTitle = '🥈 Silver Glider';
            rankSub = `Building Your 3D Locker • All ${BIRD_SKINS.length} Bird Skins share an identical 0.60m competitive hitbox`;
          } else if (anyBest >= 5 || totalUnlocked >= 4) {
            rankTitle = '🥉 Bronze Wing';
            rankSub = `First Skins Unlocked • All ${BIRD_SKINS.length} Bird Skins share an identical 0.60m competitive hitbox`;
          }

          const sfilter = this.statsSubfilter || 'all';
          const isModeFilter = (sfilter === 'easy' || sfilter === 'medium' || sfilter === 'hard');

          // Always show Pilot Rank & Overall Mastery Hero Banner with 6-KPI Strip
          const hero = document.createElement('div');
          hero.className = 'stats-rank-hero';
          hero.innerHTML = `
            <div class="stats-rank-top">
              <div>
                <div class="stats-rank-title">${rankTitle}</div>
                <div class="stats-rank-sub" style="font-size: 0.74rem; font-weight: 800; margin-top: 2px;">${rankSub}</div>
              </div>
              <div class="stats-rank-badges-wrap">
                <span class="stats-fairness-pill">🎯 0.60m Uniform Hitbox Verified</span>
                <span class="stats-rank-badge">${this.currentUser ? '👤 ' + this.currentUser.username : '👤 Guest Profile'}</span>
              </div>
            </div>
            <div class="stats-master-bar-wrap">
              <div class="stats-master-bar-labels">
                <span>🎨 Total 3D Cosmetic Mastery (${BIRD_SKINS.length} Birds + ${PIPE_SKINS.length} Pipes)</span>
                <span class="stats-header-link">${totalUnlocked} / ${totalCosmetics} Unlocked (${totalPct}%)</span>
              </div>
              <div class="stats-master-bar-track">
                <div class="stats-master-bar-fill" style="width: ${totalPct}%;"></div>
              </div>
            </div>
            <div class="stats-hero-kpi-strip">
              <div class="stats-hero-kpi">
                <small>👑 Peak Score</small>
                <strong>${anyBest} <span class="kpi-unit">PTS</span></strong>
              </div>
              <div class="stats-hero-kpi">
                <small>📈 Career Avg</small>
                <strong>${overallAvg} <span class="kpi-unit">PTS</span></strong>
              </div>
              <div class="stats-hero-kpi">
                <small>🎮 Total Flights</small>
                <strong>${overallRuns}</strong>
              </div>
              <div class="stats-hero-kpi">
                <small>🧱 Pipes Cleared</small>
                <strong>${overallScore}</strong>
              </div>
              <div class="stats-hero-kpi">
                <small>🐦 Birds Owned</small>
                <strong>${unlockedBirds} / ${BIRD_SKINS.length}</strong>
              </div>
              <div class="stats-hero-kpi">
                <small>🏗️ Pipes Owned</small>
                <strong>${unlockedPipes} / ${PIPE_SKINS.length}</strong>
              </div>
            </div>
          `;
          container.appendChild(hero);

          // SECTION 1: PERSONAL BEST RECORDS, PER-GAMEMODE TELEMETRY & CAREER STATS
          if (sfilter === 'all' || sfilter === 'records' || isModeFilter) {
            const recHeader = document.createElement('div');
            recHeader.className = 'stats-block-header';
            recHeader.innerHTML = `<span>🏆 Personal Best Records ${isModeFilter ? '(' + sfilter.toUpperCase() + ')' : 'by Gamemode'}</span><span class="stats-header-link">Click Mode Card to Open Live Leaderboard →</span>`;
            container.appendChild(recHeader);

            const recGrid = document.createElement('div');
            recGrid.className = 'stats-records-grid';

            const countModeMastery = (mKey) => {
              const items = allItems.filter(i => i.reqMode === mKey);
              const owned = items.filter(i => this.isCosmeticUnlocked(i)).length;
              const pct = items.length > 0 ? Math.round((owned / items.length) * 100) : 100;
              return { owned, total: items.length, pct };
            };
            const easyMas = countModeMastery('easy');
            const medMas  = countModeMastery('medium');
            const hardMas = countModeMastery('hard');

            const allModesData = [
              { key: 'easy', cls: 'easy-card', label: '🟢 Easy Mode', score: easyBest, subLeft: `Avg: ${calcAvg(easyM)} pts`, subRight: `${easyM.runs} Flights`, mastery: `${easyMas.owned}/${easyMas.total} Mode Skins (${easyMas.pct}%)`, pct: easyMas.pct },
              { key: 'medium', cls: 'med-card', label: '🟡 Medium Mode', score: medBest, subLeft: `Avg: ${calcAvg(medM)} pts`, subRight: `${medM.runs} Flights`, mastery: `${medMas.owned}/${medMas.total} Mode Skins (${medMas.pct}%)`, pct: medMas.pct },
              { key: 'hard', cls: 'hard-card', label: '🔴 Hard Mode', score: hardBest, subLeft: `Avg: ${calcAvg(hardM)} pts`, subRight: `${hardM.runs} Flights`, mastery: `${hardMas.owned}/${hardMas.total} Mode Skins (${hardMas.pct}%)`, pct: hardMas.pct },
              { key: 'any', cls: 'peak-card', label: '👑 Overall Peak', score: anyBest, subLeft: `Avg: ${overallAvg} pts`, subRight: `${overallRuns} Total Runs`, mastery: `${totalUnlocked}/${totalCosmetics} Total Skins (${totalPct}%)`, pct: totalPct }
            ];
            const modesData = isModeFilter
              ? allModesData.filter(m => m.key === sfilter || m.key === 'any')
              : allModesData;

            modesData.forEach(m => {
              const card = document.createElement('div');
              card.className = `stat-mode-card ${m.cls}`;
              card.innerHTML = `
                <div class="stat-mode-top">
                  <span>${m.label}</span>
                  <span>Best Record</span>
                </div>
                <div class="stat-mode-val">${m.score} <small class="stat-pts-unit" style="font-size:0.68rem;">PTS</small></div>
                <div class="stat-mode-sub">
                  <span>${m.subLeft}</span>
                  <strong>${m.subRight}</strong>
                </div>
                <div class="stat-mode-mastery">
                  <div class="stat-mode-mastery-row">
                    <span>🎨 ${m.mastery}</span>
                    <span>Leaderboard →</span>
                  </div>
                  <div class="skin-progress-track" style="height: 5px;">
                    <div class="skin-progress-fill" style="width: ${m.pct}%;"></div>
                  </div>
                </div>
              `;
              card.addEventListener('click', () => {
                const targetDiff = m.key === 'any' ? this.selectedDifficulty : m.key;
                this.setLeaderboardTab(targetDiff);
                if (this.switchRightPanelFn) this.switchRightPanelFn('lb');
              });
              recGrid.appendChild(card);
            });
            container.appendChild(recGrid);

            // PER-GAMEMODE DETAILED TELEMETRY BREAKDOWN (3-Column Grid across full width)
            const modeTeleHeader = document.createElement('div');
            modeTeleHeader.className = 'stats-block-header';
            modeTeleHeader.innerHTML = `<span>📊 Per-Gamemode Telemetry & Flight Physics Breakdown</span><span>${isModeFilter ? sfilter.toUpperCase() : 'Easy • Medium • Hard Side-by-Side'}</span>`;
            container.appendChild(modeTeleHeader);

            const modeTeleList = document.createElement('div');
            modeTeleList.className = 'mode-telemetry-list' + (isModeFilter ? ' single-mode-grid' : '');

            const allDetailedModes = [
              { key: 'easy', cls: 'easy-tele', title: '🟢 Easy Mode Telemetry', best: easyBest, data: easyM, spec: 'Gap: 4.9m • Base Speed: 8.6m/s • Ramp: +1.2%/pipe' },
              { key: 'medium', cls: 'med-tele', title: '🟡 Medium Mode Telemetry', best: medBest, data: medM, spec: 'Gap: 3.9m • Base Speed: 10.6m/s • Standard Competitive' },
              { key: 'hard', cls: 'hard-tele', title: '🔴 Hard Mode Telemetry', best: hardBest, data: hardM, spec: 'Gap: 3.35m • Base Speed: 12.8m/s • Moving Pipes' }
            ];
            const detailedModes = isModeFilter
              ? allDetailedModes.filter(dm => dm.key === sfilter)
              : allDetailedModes;

            detailedModes.forEach(dm => {
              const tCard = document.createElement('div');
              tCard.className = `mode-telemetry-card ${dm.cls}`;
              tCard.innerHTML = `
                <div class="mode-tele-header">
                  <div>
                    <span class="mode-tele-title">${dm.title}</span>
                    <div class="mode-tele-spec">${dm.spec}</div>
                  </div>
                  <span class="mode-tele-badge">Last: ${dm.data.lastScore} PTS</span>
                </div>
                <div class="mode-tele-metrics">
                  <div class="mode-tele-pill">
                    <small>🏆 Best Score</small>
                    <strong>${dm.best}</strong>
                  </div>
                  <div class="mode-tele-pill">
                    <small>📈 Avg Score</small>
                    <strong>${calcAvg(dm.data)}</strong>
                  </div>
                  <div class="mode-tele-pill">
                    <small>🎮 Flights</small>
                    <strong>${dm.data.runs}</strong>
                  </div>
                  <div class="mode-tele-pill">
                    <small>🧱 Pipes Passed</small>
                    <strong>${dm.data.totalScore}</strong>
                  </div>
                  <div class="mode-tele-pill">
                    <small>🪶 Total Flaps</small>
                    <strong>${dm.data.totalFlaps}</strong>
                  </div>
                  <div class="mode-tele-pill">
                    <small>⚡ Flaps / Pipe</small>
                    <strong>${calcFlapsPerPipe(dm.data)}</strong>
                  </div>
                </div>
              `;
              modeTeleList.appendChild(tCard);
            });
            container.appendChild(modeTeleList);

            // Lifetime Career Flight Telemetry (6-Column Strip)
            const careerHeader = document.createElement('div');
            careerHeader.className = 'stats-block-header';
            careerHeader.innerHTML = `<span>✈️ All-Mode Lifetime Career & Quest Totals</span><span>Last Flight: ${this.careerStats.lastScore} pts (${this.careerStats.lastMode.toUpperCase()})</span>`;
            container.appendChild(careerHeader);

            const careerGrid = document.createElement('div');
            careerGrid.className = 'stats-career-grid';
            careerGrid.innerHTML = `
              <div class="career-mini-card">
                <small>🎮 Total Flights</small>
                <strong>${overallRuns}</strong>
              </div>
              <div class="career-mini-card">
                <small>🧱 Total Pipes</small>
                <strong>${overallScore}</strong>
              </div>
              <div class="career-mini-card">
                <small>🪶 Total Flaps</small>
                <strong>${overallFlaps}</strong>
              </div>
              <div class="career-mini-card">
                <small>📈 Career Avg</small>
                <strong>${overallAvg}</strong>
              </div>
              <div class="career-mini-card">
                <small>⚡ Flaps / Pipe</small>
                <strong>${overallFlapsPerPipe}</strong>
              </div>
              <div class="career-mini-card">
                <small>🔴/😂 Quests Done</small>
                <strong>${pokeOwnedCount + memeOwnedCount} / ${pokeItems.length + memeItems.length}</strong>
              </div>
            `;
            container.appendChild(careerGrid);
          }

          // SECTION 2: INTERACTIVE COLLECTION & MODE MASTERY BREAKDOWN (4x2 Grid)
          if (sfilter === 'all' || sfilter === 'collection' || isModeFilter) {
            const colHeader = document.createElement('div');
            colHeader.className = 'stats-block-header';
            colHeader.innerHTML = `<span>🎨 3D Cosmetic Collection Breakdown</span><span class="stats-header-link">Click Any Category Card to Open Locker →</span>`;
            container.appendChild(colHeader);

            const countHelper = (arr, pred) => {
              const filtered = arr.filter(pred);
              const owned = filtered.filter(i => this.isCosmeticUnlocked(i)).length;
              return { owned, total: filtered.length, pct: filtered.length ? Math.round((owned / filtered.length) * 100) : 100 };
            };

            const totalStat = countHelper(allItems, () => true);
            const birdStat = countHelper(BIRD_SKINS, () => true);
            const pipeStat = countHelper(PIPE_SKINS, () => true);
            const pokeStat = countHelper(allItems, i => i.reqMode === 'pokemon');
            const memeStat = countHelper(allItems, i => i.reqMode === 'meme');
            const easyStat = countHelper(allItems, i => i.reqMode === 'easy');
            const medStat  = countHelper(allItems, i => i.reqMode === 'medium');
            const hardStat = countHelper(allItems, i => i.reqMode === 'hard');

            const categories = [
              { title: '✨ All 3D Cosmetics', stat: totalStat, sub: 'Complete Collection', action: () => this.openLockerWithFilter('birds', 'all') },
              { title: '🐦 3D Bird Skins', stat: birdStat, sub: '0.60m Uniform Hitbox', action: () => this.openLockerWithFilter('birds', 'all') },
              { title: '🏗️ 3D Pipe Skins', stat: pipeStat, sub: '1.05m Uniform Shaft', action: () => this.openLockerWithFilter('pipes', 'all') },
              { title: '🔴 Pokémon Quests', stat: pokeStat, sub: '17 Birds + 8 Pipes', action: () => this.openLockerWithFilter('birds', 'pokemon') },
              { title: '😂 Meme Quests', stat: memeStat, sub: '16 Viral Challenges', action: () => this.openLockerWithFilter('birds', 'meme') },
              { title: '🟢 Easy Exclusives', stat: easyStat, sub: 'Score Milestones', action: () => this.openLockerWithFilter('birds', 'easy') },
              { title: '🟡 Medium Exclusives', stat: medStat, sub: 'Competitive Tiers', action: () => this.openLockerWithFilter('birds', 'medium') },
              { title: '🔴 Hard Exclusives', stat: hardStat, sub: 'Grandmaster Tiers', action: () => this.openLockerWithFilter('birds', 'hard') }
            ];

            const colGrid = document.createElement('div');
            colGrid.className = 'stats-collection-grid';

            categories.forEach(cat => {
              const cCard = document.createElement('div');
              cCard.className = 'collection-cat-card';
              cCard.innerHTML = `
                <div class="collection-cat-top">
                  <span>${cat.title}</span>
                  <span class="collection-cat-count">${cat.stat.owned}/${cat.stat.total}</span>
                </div>
                <div class="skin-progress-track">
                  <div class="skin-progress-fill" style="width: ${cat.stat.pct}%;"></div>
                </div>
                <div class="collection-cat-sub" style="font-size: 0.66rem; font-weight: 800; display: flex; justify-content: space-between;">
                  <span>${cat.stat.pct}% • ${cat.sub}</span>
                  <span class="stats-header-link">Open →</span>
                </div>
              `;
              cCard.addEventListener('click', cat.action);
              colGrid.appendChild(cCard);
            });
            container.appendChild(colGrid);
          }

          // SECTION 3: NEXT CLOSEST UNLOCKS ROADMAP (2-Column Grid with 1-Click 3D Preview)
          if (sfilter === 'all' || sfilter === 'roadmap' || isModeFilter) {
            const roadHeader = document.createElement('div');
            roadHeader.className = 'stats-block-header';
            roadHeader.innerHTML = `<span>🎯 Closest Next Unlocks Roadmap</span><span class="stats-header-link">Click Any Item to Inspect in 3D Locker →</span>`;
            container.appendChild(roadHeader);

            const lockedAll = [
              ...BIRD_SKINS.filter(s => !this.isCosmeticUnlocked(s) && (!isModeFilter || s.reqMode === sfilter || s.reqMode === 'any' || s.reqMode === 'pokemon')).map(s => ({ item: s, isPipe: false })),
              ...PIPE_SKINS.filter(p => !this.isCosmeticUnlocked(p) && (!isModeFilter || p.reqMode === sfilter || p.reqMode === 'any' || p.reqMode === 'pokemon')).map(p => ({ item: p, isPipe: true }))
            ];

            lockedAll.sort((a, b) => {
              const pA = this.getCosmeticProgress(a.item);
              const pB = this.getCosmeticProgress(b.item);
              return (pB.percent - pA.percent) || ((pA.target - pA.current) - (pB.target - pB.current));
            });

            const roadList = document.createElement('div');
            roadList.className = 'stats-roadmap-list';

            if (lockedAll.length === 0) {
              roadList.innerHTML = `<div class="lb-empty" style="grid-column: 1 / -1;">🎉 Incredible! You have unlocked all ${BIRD_SKINS.length + PIPE_SKINS.length} Bird & Pipe Cosmetics!</div>`;
            } else {
              lockedAll.slice(0, 8).forEach(({ item, isPipe }) => {
                const prog = this.getCosmeticProgress(item);
                const ptsLeft = Math.max(1, prog.target - prog.current);
                const isQuest = item.reqMode === 'meme' || item.reqMode === 'pokemon';
                const row = document.createElement('div');
                row.className = 'roadmap-row';
                row.innerHTML = `
                  <div class="skin-swatch ${isPipe ? 'pipe-swatch' : ''}" style="width:42px; height:42px; font-size:1.15rem; background:${isPipe ? item.colors[0] : '#' + item.body.toString(16).padStart(6, '0')};">
                    ${item.emoji}
                  </div>
                  <div class="skin-info">
                    <div class="skin-header-row">
                      <span class="skin-name" style="font-size:0.86rem;">${item.name}</span>
                      <span class="rarity-tag rarity-${item.rarity}">${item.rarity}</span>
                      <span class="req-badge-inline">${isPipe ? '🏗️ Pipe' : '🐦 Bird'}</span>
                    </div>
                    <div class="skin-progress-row">
                      <div class="skin-progress-track">
                        <div class="skin-progress-fill" style="width:${prog.percent}%;"></div>
                      </div>
                      <span class="skin-req">${item.reqText} • ${isQuest ? `Progress: ${prog.current}/${prog.target} (${prog.percent}%)` : `Need ${ptsLeft} more pts (${prog.current}/${prog.target})`}</span>
                    </div>
                  </div>
                  <button type="button" class="skin-cta-btn preview-btn">👁️ 3D View</button>
                `;
                row.addEventListener('click', () => {
                  if (isPipe) {
                    this.previewPipeSkinId = item.id;
                    this.applyPipeSkinVisualsOnly(item);
                    this.updatePreviewBanner();
                    if (this.switchRightPanelFn) this.switchRightPanelFn('pipes');
                  } else {
                    this.previewSkinId = item.id;
                    this.applySkinVisualsOnly(item);
                    this.updatePreviewBanner();
                    if (this.switchRightPanelFn) this.switchRightPanelFn('birds');
                  }
                });
                roadList.appendChild(row);
              });
            }
            container.appendChild(roadList);
          }
        }

        openLockerWithFilter(panelMode, filterKey) {
          if (panelMode === 'birds') {
            this.birdLockerFilter = filterKey;
            document.querySelectorAll('#bird-filter-bar .locker-filter-btn').forEach(b => {
              b.classList.toggle('active', b.getAttribute('data-filter') === filterKey);
            });
            if (this.switchRightPanelFn) this.switchRightPanelFn('birds');
          } else {
            this.pipeLockerFilter = filterKey;
            document.querySelectorAll('#pipe-filter-bar .locker-filter-btn').forEach(b => {
              b.classList.toggle('active', b.getAttribute('data-filter') === filterKey);
            });
            if (this.switchRightPanelFn) this.switchRightPanelFn('pipes');
          }
        }

        updatePreviewBanner() {
          const banner = document.getElementById('preview-banner');
          const bannerText = document.getElementById('preview-banner-text');
          if (!banner || !bannerText) return;

          const previewBird = this.previewSkinId && BIRD_SKINS.find(s => s.id === this.previewSkinId);
          const previewPipe = this.previewPipeSkinId && PIPE_SKINS.find(p => p.id === this.previewPipeSkinId);

          if (previewBird) {
            banner.classList.add('visible');
            bannerText.textContent = `👁️ 3D Preview: ${previewBird.emoji} ${previewBird.name} (${previewBird.reqText})`;
          } else if (previewPipe) {
            banner.classList.add('visible');
            bannerText.textContent = `👁️ 3D Preview: ${previewPipe.emoji} ${previewPipe.name} (${previewPipe.reqText})`;
          } else {
            banner.classList.remove('visible');
          }
        }

        renderSpotlightBox(elId, item, isPipe = false) {
          const spotEl = document.getElementById(elId);
          if (!spotEl || !item) return;

          const unlocked = this.isCosmeticUnlocked(item);
          const equipped = isPipe ? (this.selectedPipeSkinId === item.id) : (this.selectedSkinId === item.id);
          const prog = this.getCosmeticProgress(item);

          spotEl.className = 'skin-spotlight ' + (unlocked ? 'owned-spot' : 'locked-spot');

          const modeBadgeHtml = item.reqMode === 'easy'
            ? `<span class="mode-tag mode-easy">🟢 EASY ONLY</span>`
            : (item.reqMode === 'medium'
              ? `<span class="mode-tag mode-medium">🟡 MEDIUM ONLY</span>`
              : (item.reqMode === 'hard'
                ? `<span class="mode-tag mode-hard">🔴 HARD ONLY</span>`
                : (item.reqMode === 'pokemon'
                  ? `<span class="mode-tag mode-pokemon">🔴 POKÉMON QUEST</span>`
                  : (item.reqMode === 'meme'
                    ? `<span class="mode-tag mode-meme">😂 MEME QUEST</span>`
                    : ''))));

          const unitLabel = (item.reqMode === 'meme' || item.reqMode === 'pokemon') ? 'PROGRESS' : 'PTS';
          const statusHtml = equipped
            ? `<span class="ownership-pill equipped">⚡ EQUIPPED & OWNED</span>`
            : (unlocked
              ? `<span class="ownership-pill owned">✅ OWNED IN LOCKER</span>`
              : `<span class="ownership-pill locked">🔒 NOT OWNED (${prog.current}/${prog.target} ${unitLabel})</span>`);

          const canvasId = isPipe ? 'pipe-spotlight-canvas' : 'bird-spotlight-canvas';
          const hitboxBadgeHtml = isPipe
            ? `<span class="hitbox-fairness-tag" title="Every pipe skin uses the exact same 1.05m shaft / 1.24m cap collision bounds">🎯 1.05m Uniform Hitbox</span>`
            : `<span class="hitbox-fairness-tag" title="Every bird & Pokémon skin uses the exact same 0.60m spherical hitbox">🎯 0.60m Uniform Hitbox</span>`;

          const isAvatar = !isPipe && ((this.avatarSkinId || (this.currentUser && this.currentUser.avatarSkinId) || this.selectedSkinId || 'classic') === item.id);
          const avatarBtnHtml = !isPipe
            ? `<button type="button" class="btn-spotlight-avatar ${isAvatar ? 'is-active' : ''}" id="btn-spotlight-set-avatar" title="Set ${item.name} preview as your profile picture">🖼️ ${isAvatar ? 'Current Profile Picture ✓' : 'Set as Profile Picture'}</button>`
            : '';

          spotEl.innerHTML = `
            <div class="spotlight-3d-wrap">
              <canvas class="spotlight-3d-canvas" id="${canvasId}" width="160" height="160"></canvas>
              <span class="spotlight-3d-tag">LIVE 3D</span>
            </div>
            <div class="spotlight-body">
              <div class="spotlight-top">
                <span class="spotlight-title">${item.emoji} ${item.name}</span>
                <div class="spotlight-badges">
                  <span class="rarity-tag rarity-${item.rarity}">${item.rarity}</span>
                  ${hitboxBadgeHtml}
                  ${modeBadgeHtml}
                  ${statusHtml}
                </div>
              </div>
              <div class="spotlight-desc">${item.desc} • <strong class="spotlight-req-strong">${unlocked ? 'Unlocked (' + item.reqText + ')' : 'Requirement: ' + item.reqText}</strong></div>
              ${avatarBtnHtml ? `<div class="spotlight-avatar-row" style="margin-top: 10px; display: flex; align-items: center; gap: 8px;">${avatarBtnHtml}</div>` : ''}
            </div>
          `;

          if (!isPipe) {
            this.activeBirdSpotlightSkin = item;
            const setAvatarBtn = spotEl.querySelector('#btn-spotlight-set-avatar');
            if (setAvatarBtn) {
              setAvatarBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setProfileAvatar(item.id);
              });
            }
          }
        }

        buildCosmeticCard(item, isPipe = false) {
          const unlocked = this.isCosmeticUnlocked(item);
          const equipped = isPipe ? (this.selectedPipeSkinId === item.id) : (this.selectedSkinId === item.id);
          const previewing = isPipe ? (this.previewPipeSkinId === item.id) : (this.previewSkinId === item.id);
          const prog = this.getCosmeticProgress(item);
          const isAdminLocked = Boolean(this.currentUser && Array.isArray(this.currentUser.adminLockedSkins) && this.currentUser.adminLockedSkins.includes(item.id));
          const isGranted = Boolean(this.currentUser && Array.isArray(this.currentUser.grantedSkins) && this.currentUser.grantedSkins.includes(item.id));

          const tierClass = item.rarity === 'POKEMON'
            ? ' tier-pokemon'
            : (item.rarity === 'MEME'
              ? ' tier-meme'
              : (item.rarity === 'GODLIKE'
                ? ' tier-godlike'
                : (item.rarity === 'MYTHIC' ? ' tier-mythic' : (item.rarity === 'EPIC' ? ' tier-epic' : ''))));

          const card = document.createElement('div');
          card.className = 'skin-card' +
            tierClass +
            (unlocked ? ' owned-card' : ' locked') +
            (equipped ? ' equipped' : '') +
            (previewing ? ' previewing' : '');

          const swatch = document.createElement('div');
          swatch.className = 'skin-swatch' + (isPipe ? ' pipe-swatch' : '');
          if (isPipe) {
            swatch.style.background = `linear-gradient(90deg, ${item.colors[0]} 0%, ${item.colors[2]} 45%, ${item.colors[1]} 100%)`;
          } else {
            const hexBody = '#' + item.body.toString(16).padStart(6, '0');
            const hexWing = '#' + item.wing.toString(16).padStart(6, '0');
            swatch.style.background = `linear-gradient(135deg, ${hexBody} 55%, ${hexWing} 100%)`;
          }
          swatch.textContent = item.emoji;

          const badge = document.createElement('span');
          badge.className = 'swatch-badge' + (unlocked ? ' owned-check' : '');
          badge.textContent = unlocked ? '✓' : '🔒';
          swatch.appendChild(badge);

          const info = document.createElement('div');
          info.className = 'skin-info';

          // 1. Skin Title Row (Clean, dedicated row for name and rarity without clutter)
          const titleRow = document.createElement('div');
          titleRow.className = 'skin-title-row';

          const nameEl = document.createElement('span');
          nameEl.className = 'skin-name';
          nameEl.textContent = item.name;
          nameEl.title = item.name;

          // Responsive font scaling for long Pokemon and Meme names to prevent clipping
          if (item.name.length > 24) {
            nameEl.style.fontSize = '0.68rem';
            nameEl.style.letterSpacing = '-0.3px';
            nameEl.style.lineHeight = '1.12';
          } else if (item.name.length > 20) {
            nameEl.style.fontSize = '0.72rem';
            nameEl.style.letterSpacing = '-0.2px';
            nameEl.style.lineHeight = '1.15';
          } else if (item.name.length > 14) {
            nameEl.style.fontSize = '0.78rem';
            nameEl.style.lineHeight = '1.18';
          } else {
            nameEl.style.fontSize = '0.84rem';
            nameEl.style.lineHeight = '1.2';
          }

          const rarityEl = document.createElement('span');
          rarityEl.className = `rarity-tag rarity-${item.rarity}`;
          rarityEl.textContent = item.rarity;

          titleRow.append(nameEl, rarityEl);

          // 2. Meta Badges Row (Ownership status & Mode/Quest badge)
          const metaRow = document.createElement('div');
          metaRow.className = 'skin-meta-badges';

          const ownerTag = document.createElement('span');
          if (isAdminLocked) {
            ownerTag.className = 'ownership-pill locked-admin';
            ownerTag.textContent = '🔒 ADMIN LOCKED';
          } else if (equipped) {
            ownerTag.className = 'ownership-pill equipped';
            ownerTag.textContent = '⚡ EQUIPPED';
          } else if (isGranted) {
            ownerTag.className = 'ownership-pill granted';
            ownerTag.textContent = '🎁 GRANTED';
          } else if (unlocked) {
            ownerTag.className = 'ownership-pill owned';
            ownerTag.textContent = '✅ OWNED';
          } else {
            ownerTag.className = 'ownership-pill locked';
            ownerTag.textContent = '🔒 LOCKED';
          }
          metaRow.appendChild(ownerTag);

          if (item.reqMode === 'easy' || item.reqMode === 'medium' || item.reqMode === 'hard' || item.reqMode === 'pokemon' || item.reqMode === 'meme') {
            const modeTag = document.createElement('span');
            modeTag.className = `mode-tag mode-${item.reqMode}`;
            modeTag.textContent = item.reqMode === 'easy'
              ? '🟢 EASY'
              : (item.reqMode === 'medium'
                ? '🟡 MEDIUM'
                : (item.reqMode === 'hard'
                  ? '🔴 HARD'
                  : (item.reqMode === 'pokemon' ? '🔴 POKÉMON' : '😂 MEME')));
            metaRow.appendChild(modeTag);
          }

          // 3. Compact Description
          const descEl = document.createElement('div');
          descEl.className = 'skin-desc';
          descEl.textContent = item.desc;
          descEl.title = item.desc;

          info.append(titleRow, metaRow, descEl);

          // 4. Progress row (only if not unlocked)
          if (!unlocked) {
            const progRow = document.createElement('div');
            progRow.className = 'skin-progress-row';

            const track = document.createElement('div');
            track.className = 'skin-progress-track';
            const fill = document.createElement('div');
            fill.className = 'skin-progress-fill';
            fill.style.width = isAdminLocked ? '0%' : `${prog.percent}%`;
            track.appendChild(fill);

            const reqEl = document.createElement('span');
            reqEl.className = 'skin-req';
            reqEl.textContent = isAdminLocked
              ? '🔒 Locked by Admin MeDonut (Stays locked)'
              : `${item.reqText} • ${prog.current}/${prog.target} (${prog.percent}%)`;
            reqEl.title = reqEl.textContent;

            progRow.append(track, reqEl);
            info.appendChild(progRow);
          }

          const actionCol = document.createElement('div');
          actionCol.className = 'skin-action-col';

          const ctaBtn = document.createElement('button');
          ctaBtn.type = 'button';
          if (equipped) {
            ctaBtn.className = 'skin-cta-btn equipped-btn';
            ctaBtn.textContent = 'Equipped ✓';
          } else if (unlocked) {
            ctaBtn.className = 'skin-cta-btn equip-btn';
            ctaBtn.textContent = 'Equip';
          } else if (previewing) {
            ctaBtn.className = 'skin-cta-btn previewing-btn';
            ctaBtn.textContent = '👁️ Viewing';
          } else {
            ctaBtn.className = 'skin-cta-btn preview-btn';
            ctaBtn.textContent = '👁️ Preview';
          }
          actionCol.appendChild(ctaBtn);

          card.append(swatch, info, actionCol);

          card.addEventListener('click', () => {
            if (isPipe) {
              if (unlocked) {
                this.previewPipeSkinId = null;
                this.applyPipeSkin(item.id, true);
              } else {
                this.previewPipeSkinId = item.id;
                this.applyPipeSkinVisualsOnly(item);
              }
              this.updatePreviewBanner();
              this.renderPipeSkinsGrid();
            } else {
              if (unlocked) {
                this.previewSkinId = null;
                this.applySkin(item.id, true);
              } else {
                this.previewSkinId = item.id;
                this.applySkinVisualsOnly(item);
              }
              this.updatePreviewBanner();
              this.renderBirdSkinsGrid();
            }
          });

          return card;
        }

        sortCosmetics(list, sortOrder = 'default') {
          const items = [...list];
          if (!sortOrder || sortOrder === 'default') {
            return items;
          }

          const rarityWeights = {
            GODLIKE: 8,
            MYTHIC: 7,
            LEGENDARY: 6,
            POKEMON: 5,
            MEME: 4.5,
            TROLL: 4.5,
            EPIC: 4,
            RARE: 3,
            UNCOMMON: 2,
            COMMON: 1
          };

          if (sortOrder === 'score_asc') {
            return items.sort((a, b) => (a.reqScore || 0) - (b.reqScore || 0) || a.name.localeCompare(b.name));
          }
          if (sortOrder === 'score_desc') {
            return items.sort((a, b) => (b.reqScore || 0) - (a.reqScore || 0) || a.name.localeCompare(b.name));
          }
          if (sortOrder === 'rarity') {
            return items.sort((a, b) => {
              const wa = rarityWeights[a.rarity] || 0;
              const wb = rarityWeights[b.rarity] || 0;
              if (wb !== wa) return wb - wa;
              return (b.reqScore || 0) - (a.reqScore || 0) || a.name.localeCompare(b.name);
            });
          }
          if (sortOrder === 'name') {
            return items.sort((a, b) => a.name.localeCompare(b.name));
          }
          if (sortOrder === 'status') {
            return items.sort((a, b) => {
              const aUnlocked = this.isCosmeticUnlocked(a) ? 1 : 0;
              const bUnlocked = this.isCosmeticUnlocked(b) ? 1 : 0;
              if (bUnlocked !== aUnlocked) return bUnlocked - aUnlocked;
              return (a.reqScore || 0) - (b.reqScore || 0) || a.name.localeCompare(b.name);
            });
          }
          return items;
        }

        renderBirdSkinsGrid() {
          const gridEl = document.getElementById('bird-skins-grid');
          if (!gridEl) return;
          // Cache current scroll positions so equipping never resets to the top
          const prevScrollTop = gridEl.scrollTop;
          const viewSkinsEl = document.getElementById('view-skins');
          const prevViewScroll = viewSkinsEl ? viewSkinsEl.scrollTop : 0;
          gridEl.innerHTML = '';

          const activeBirdId = this.previewSkinId || this.selectedSkinId;
          const activeBirdSkin = BIRD_SKINS.find(s => s.id === activeBirdId) || BIRD_SKINS[0];
          this.renderSpotlightBox('bird-skin-spotlight', activeBirdSkin, false);

          const filter = this.birdLockerFilter || 'all';
          const sortOrder = this.lockerSortOrder || 'default';
          const query = (this.skinSearchQuery || '').trim().toLowerCase();

          // Step 1: Base Category Filtering
          let filteredSkins = BIRD_SKINS;
          if (filter === 'owned') {
            filteredSkins = filteredSkins.filter(s => this.isCosmeticUnlocked(s));
          } else if (filter === 'locked') {
            filteredSkins = filteredSkins.filter(s => !this.isCosmeticUnlocked(s));
          } else if (filter === 'pokemon') {
            filteredSkins = filteredSkins.filter(s => s.reqMode === 'pokemon' || s.rarity === 'POKEMON');
          } else if (filter === 'meme') {
            filteredSkins = filteredSkins.filter(s => s.reqMode === 'meme' || s.rarity === 'MEME' || s.rarity === 'TROLL');
          } else if (filter === 'easy' || filter === 'medium' || filter === 'hard') {
            filteredSkins = filteredSkins.filter(s => s.reqMode === filter);
          }

          // Step 2: Search Query Filtering
          if (query) {
            filteredSkins = filteredSkins.filter(s =>
              (s.name && s.name.toLowerCase().includes(query)) ||
              (s.desc && s.desc.toLowerCase().includes(query)) ||
              (s.rarity && s.rarity.toLowerCase().includes(query)) ||
              (s.reqText && s.reqText.toLowerCase().includes(query)) ||
              (s.emoji && s.emoji.includes(query))
            );
          }

          // Step 3: Sorting
          const sortedSkins = this.sortCosmetics(filteredSkins, sortOrder);

          // Step 4: Empty state handling
          if (sortedSkins.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'lb-empty';
            emptyEl.style.gridColumn = '1 / -1';
            emptyEl.style.padding = '36px 16px';
            emptyEl.style.textAlign = 'center';
            emptyEl.textContent = query
              ? `🔍 No bird skins match "${query}". Try another search term.`
              : '🔒 No bird skins found in this category.';
            gridEl.appendChild(emptyEl);
            return;
          }

          // Step 5: Rendering
          // If a custom sort or search query is active, render unified sorted cards with banner
          if (sortOrder !== 'default' || query) {
            const sortLabels = {
              score_asc: 'Score: Low → High',
              score_desc: 'Score: High → Low',
              rarity: 'Rarest First',
              name: 'Alphabetical A → Z',
              status: 'Owned First'
            };
            const divSortHeader = document.createElement('div');
            divSortHeader.className = 'skins-section-divider owned-header';
            divSortHeader.innerHTML = query
              ? `<span>🔍 SEARCH & SORT RESULTS (${sortedSkins.length} SKINS)</span><span>${sortLabels[sortOrder] || 'Filtered'}</span>`
              : `<span>🔃 SORTED BIRD SKINS (${sortedSkins.length} SKINS)</span><span>${sortLabels[sortOrder] || 'Custom Sort'}</span>`;
            gridEl.appendChild(divSortHeader);

            sortedSkins.forEach(skin => {
              gridEl.appendChild(this.buildCosmeticCard(skin, false));
            });
            return;
          }

          // Category-specific divider when viewing specific mode/theme
          if (filter === 'easy' || filter === 'medium' || filter === 'hard' || filter === 'pokemon' || filter === 'meme') {
            const divMode = document.createElement('div');
            divMode.className = 'skins-section-divider ' + (filter === 'pokemon' ? 'pokemon-header' : (filter === 'meme' ? 'meme-header' : (filter === 'easy' ? 'owned-header' : 'locked-header')));
            divMode.innerHTML = filter === 'easy'
              ? `<span>🟢 EASY MODE EXCLUSIVE BIRD SKINS (${sortedSkins.length} • UP TO SCORE 150)</span><span>Easy Mode Only</span>`
              : (filter === 'medium'
                ? `<span>🟡 MEDIUM MODE EXCLUSIVE BIRD SKINS (${sortedSkins.length})</span><span>Medium Mode Only</span>`
                : (filter === 'hard'
                  ? `<span>🔴 HARD MODE EXCLUSIVE BIRD SKINS (${sortedSkins.length})</span><span>Hard Mode Only</span>`
                  : (filter === 'pokemon'
                    ? `<span>🔴 POKÉMON BASE-FORM BIRD SKINS (${sortedSkins.length})</span><span>Complete Pokémon Quests!</span>`
                    : `<span>😂 MEME QUEST BIRD SKINS (${sortedSkins.length})</span><span>Complete Meme Quests!</span>`)));
            gridEl.appendChild(divMode);
            sortedSkins.forEach(skin => {
              gridEl.appendChild(this.buildCosmeticCard(skin, false));
            });
            return;
          }

          // Default 'all' view: Owned section then Locked section
          if (filter === 'all') {
            const ownedList = sortedSkins.filter(s => this.isCosmeticUnlocked(s));
            const lockedList = sortedSkins.filter(s => !this.isCosmeticUnlocked(s));

            const divOwned = document.createElement('div');
            divOwned.className = 'skins-section-divider owned-header';
            divOwned.innerHTML = `<span>✅ OWNED BIRD SKINS (${ownedList.length})</span><span>Click to Equip</span>`;
            gridEl.appendChild(divOwned);
            ownedList.forEach(skin => {
              gridEl.appendChild(this.buildCosmeticCard(skin, false));
            });

            if (lockedList.length > 0) {
              const divLocked = document.createElement('div');
              divLocked.className = 'skins-section-divider locked-header';
              divLocked.innerHTML = `<span>🔒 UNOWNED BIRD SKINS (${lockedList.length})</span><span>Click to 3D-Preview</span>`;
              gridEl.appendChild(divLocked);
              lockedList.forEach(skin => {
                gridEl.appendChild(this.buildCosmeticCard(skin, false));
              });
            }
            gridEl.scrollTop = prevScrollTop;
            if (viewSkinsEl && prevViewScroll) viewSkinsEl.scrollTop = prevViewScroll;
            requestAnimationFrame(() => {
              gridEl.scrollTop = prevScrollTop;
              if (viewSkinsEl && prevViewScroll) viewSkinsEl.scrollTop = prevViewScroll;
            });
            return;
          }

          // Specific 'owned' or 'locked' view
          const divFilterHeader = document.createElement('div');
          divFilterHeader.className = 'skins-section-divider ' + (filter === 'owned' ? 'owned-header' : 'locked-header');
          divFilterHeader.innerHTML = filter === 'owned'
            ? `<span>✅ OWNED BIRD SKINS (${sortedSkins.length})</span><span>Click to Equip</span>`
            : `<span>🔒 UNOWNED BIRD SKINS (${sortedSkins.length})</span><span>Click to 3D-Preview</span>`;
          gridEl.appendChild(divFilterHeader);
          sortedSkins.forEach(skin => {
            gridEl.appendChild(this.buildCosmeticCard(skin, false));
          });

          gridEl.scrollTop = prevScrollTop;
          if (viewSkinsEl && prevViewScroll) viewSkinsEl.scrollTop = prevViewScroll;
          requestAnimationFrame(() => {
            gridEl.scrollTop = prevScrollTop;
            if (viewSkinsEl && prevViewScroll) viewSkinsEl.scrollTop = prevViewScroll;
          });
        }

        renderPipeSkinsGrid() {
          const gridEl = document.getElementById('pipe-skins-grid');
          if (!gridEl) return;
          // Cache current scroll positions so equipping never resets to the top
          const prevScrollTop = gridEl.scrollTop;
          const viewSkinsEl = document.getElementById('view-skins');
          const prevViewScroll = viewSkinsEl ? viewSkinsEl.scrollTop : 0;
          gridEl.innerHTML = '';

          const activePipeId = this.previewPipeSkinId || this.selectedPipeSkinId;
          const activePipeSkin = PIPE_SKINS.find(p => p.id === activePipeId) || PIPE_SKINS[0];
          this.renderSpotlightBox('pipe-skin-spotlight', activePipeSkin, true);

          const filter = this.pipeLockerFilter || 'all';
          const sortOrder = this.lockerSortOrder || 'default';
          const query = (this.skinSearchQuery || '').trim().toLowerCase();

          // Step 1: Base Category Filtering
          let filteredPipes = PIPE_SKINS;
          if (filter === 'owned') {
            filteredPipes = filteredPipes.filter(p => this.isCosmeticUnlocked(p));
          } else if (filter === 'locked') {
            filteredPipes = filteredPipes.filter(p => !this.isCosmeticUnlocked(p));
          } else if (filter === 'pokemon') {
            filteredPipes = filteredPipes.filter(p => p.reqMode === 'pokemon' || p.rarity === 'POKEMON');
          } else if (filter === 'meme') {
            filteredPipes = filteredPipes.filter(p => p.reqMode === 'meme' || p.rarity === 'MEME' || p.rarity === 'TROLL');
          } else if (filter === 'easy' || filter === 'medium' || filter === 'hard') {
            filteredPipes = filteredPipes.filter(p => p.reqMode === filter);
          }

          // Step 2: Search Query Filtering
          if (query) {
            filteredPipes = filteredPipes.filter(p =>
              (p.name && p.name.toLowerCase().includes(query)) ||
              (p.desc && p.desc.toLowerCase().includes(query)) ||
              (p.rarity && p.rarity.toLowerCase().includes(query)) ||
              (p.reqText && p.reqText.toLowerCase().includes(query)) ||
              (p.emoji && p.emoji.includes(query))
            );
          }

          // Step 3: Sorting
          const sortedPipes = this.sortCosmetics(filteredPipes, sortOrder);

          // Step 4: Empty state handling
          if (sortedPipes.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'lb-empty';
            emptyEl.style.gridColumn = '1 / -1';
            emptyEl.style.padding = '36px 16px';
            emptyEl.style.textAlign = 'center';
            emptyEl.textContent = query
              ? `🔍 No pipe skins match "${query}". Try another search term.`
              : '🔒 No pipe skins found in this category.';
            gridEl.appendChild(emptyEl);
            return;
          }

          // Step 5: Rendering
          // If a custom sort or search query is active, render unified sorted cards with banner
          if (sortOrder !== 'default' || query) {
            const sortLabels = {
              score_asc: 'Score: Low → High',
              score_desc: 'Score: High → Low',
              rarity: 'Rarest First',
              name: 'Alphabetical A → Z',
              status: 'Owned First'
            };
            const divSortHeader = document.createElement('div');
            divSortHeader.className = 'skins-section-divider owned-header';
            divSortHeader.innerHTML = query
              ? `<span>🔍 SEARCH & SORT RESULTS (${sortedPipes.length} PIPES)</span><span>${sortLabels[sortOrder] || 'Filtered'}</span>`
              : `<span>🔃 SORTED PIPE SKINS (${sortedPipes.length} PIPES)</span><span>${sortLabels[sortOrder] || 'Custom Sort'}</span>`;
            gridEl.appendChild(divSortHeader);

            sortedPipes.forEach(pipeSkin => {
              gridEl.appendChild(this.buildCosmeticCard(pipeSkin, true));
            });
            return;
          }

          // Category-specific divider when viewing specific mode/theme
          if (filter === 'easy' || filter === 'medium' || filter === 'hard' || filter === 'pokemon' || filter === 'meme') {
            const divMode = document.createElement('div');
            divMode.className = 'skins-section-divider ' + (filter === 'pokemon' ? 'pokemon-header' : (filter === 'meme' ? 'meme-header' : (filter === 'easy' ? 'owned-header' : 'locked-header')));
            divMode.innerHTML = filter === 'easy'
              ? `<span>🟢 EASY MODE EXCLUSIVE PIPE SKINS (${sortedPipes.length} • UP TO SCORE 150)</span><span>Easy Mode Only</span>`
              : (filter === 'medium'
                ? `<span>🟡 MEDIUM MODE EXCLUSIVE PIPE SKINS (${sortedPipes.length})</span><span>Medium Mode Only</span>`
                : (filter === 'hard'
                  ? `<span>🔴 HARD MODE EXCLUSIVE PIPE SKINS (${sortedPipes.length})</span><span>Hard Mode Only</span>`
                  : (filter === 'pokemon'
                    ? `<span>🔴 POKÉMON GYM & POKÉ BALL PIPE SKINS (${sortedPipes.length})</span><span>Complete Pokémon Quests!</span>`
                    : `<span>😂 MEME QUEST PIPE SKINS (${sortedPipes.length})</span><span>Complete Meme Quests!</span>`)));
            gridEl.appendChild(divMode);
            sortedPipes.forEach(pipeSkin => {
              gridEl.appendChild(this.buildCosmeticCard(pipeSkin, true));
            });
            return;
          }

          // Default 'all' view: Owned section then Locked section
          if (filter === 'all') {
            const ownedList = sortedPipes.filter(p => this.isCosmeticUnlocked(p));
            const lockedList = sortedPipes.filter(p => !this.isCosmeticUnlocked(p));

            const divOwned = document.createElement('div');
            divOwned.className = 'skins-section-divider owned-header';
            divOwned.innerHTML = `<span>✅ OWNED PIPE SKINS (${ownedList.length})</span><span>Click to Equip</span>`;
            gridEl.appendChild(divOwned);
            ownedList.forEach(pipeSkin => {
              gridEl.appendChild(this.buildCosmeticCard(pipeSkin, true));
            });

            if (lockedList.length > 0) {
              const divLocked = document.createElement('div');
              divLocked.className = 'skins-section-divider locked-header';
              divLocked.innerHTML = `<span>🔒 UNOWNED PIPE SKINS (${lockedList.length})</span><span>Click to 3D-Preview</span>`;
              gridEl.appendChild(divLocked);
              lockedList.forEach(pipeSkin => {
                gridEl.appendChild(this.buildCosmeticCard(pipeSkin, true));
              });
            }
            gridEl.scrollTop = prevScrollTop;
            if (viewSkinsEl && prevViewScroll) viewSkinsEl.scrollTop = prevViewScroll;
            requestAnimationFrame(() => {
              gridEl.scrollTop = prevScrollTop;
              if (viewSkinsEl && prevViewScroll) viewSkinsEl.scrollTop = prevViewScroll;
            });
            return;
          }

          // Specific 'owned' or 'locked' view
          const divFilterHeader = document.createElement('div');
          divFilterHeader.className = 'skins-section-divider ' + (filter === 'owned' ? 'owned-header' : 'locked-header');
          divFilterHeader.innerHTML = filter === 'owned'
            ? `<span>✅ OWNED PIPE SKINS (${sortedPipes.length})</span><span>Click to Equip</span>`
            : `<span>🔒 UNOWNED PIPE SKINS (${sortedPipes.length})</span><span>Click to 3D-Preview</span>`;
          gridEl.appendChild(divFilterHeader);
          sortedPipes.forEach(pipeSkin => {
            gridEl.appendChild(this.buildCosmeticCard(pipeSkin, true));
          });

          gridEl.scrollTop = prevScrollTop;
          if (viewSkinsEl && prevViewScroll) viewSkinsEl.scrollTop = prevViewScroll;
          requestAnimationFrame(() => {
            gridEl.scrollTop = prevScrollTop;
            if (viewSkinsEl && prevViewScroll) viewSkinsEl.scrollTop = prevViewScroll;
          });
        }

        // ------------------------------------------------------------------------
        // APPLYING BIRD SKINS & PIPE SKINS IN 3D
        // ------------------------------------------------------------------------
        applySkin(skinId, saveToServer = false, force = false) {
          const skin = BIRD_SKINS.find(s => s.id === skinId) || BIRD_SKINS[0];
          if (!force && !this.isCosmeticUnlocked(skin)) return;

          this.selectedSkinId = skin.id;
          localStorage.setItem('flappy3d_skin', skin.id);

          this.applySkinVisualsOnly(skin);

          if (saveToServer && this.authToken && this.currentUser) {
            this.apiRequest('/api/skin', 'POST', { skinId: skin.id }).catch(() => {});
          }
        }

        applySkinVisualsOnly(skin) {
          this.currentSkin = skin;
          const labelEl = document.getElementById('current-skin-label');
          if (labelEl) labelEl.textContent = skin.name;
          const birdPreviewEmoji = document.getElementById('loadout-bird-preview-emoji');
          if (birdPreviewEmoji) birdPreviewEmoji.textContent = skin.emoji || '🐤';
          const birdPreviewBadge = document.getElementById('loadout-bird-preview-badge');
          if (birdPreviewBadge && skin.body !== undefined) {
            const hex = '#' + skin.body.toString(16).padStart(6, '0');
            birdPreviewBadge.style.background = `linear-gradient(135deg, ${hex}55 0%, ${hex}22 100%)`;
            birdPreviewBadge.style.borderColor = hex;
          }

          const isPokemon = skin.category === 'pokemon' || (skin.modelPreset && skin.modelPreset.startsWith('poke_'));

          if (this.standardBirdBodyGroup) {
            this.standardBirdBodyGroup.visible = !isPokemon;
          }
          if (this.leftWingPivot) {
            this.leftWingPivot.visible = !isPokemon;
          }
          if (this.rightWingPivot) {
            this.rightWingPivot.visible = !isPokemon;
          }
          if (this.defaultTailGroup) {
            this.defaultTailGroup.visible = !isPokemon && !skin.hideDefaultTail;
          }
          if (this.fierceBrowGroup) {
            this.fierceBrowGroup.visible = !isPokemon && Boolean(skin.fierceBrow);
          }

          if (this.birdMats) {
            const bumpMap = (this.bumpTextures && this.bumpTextures[skin.bumpType]) || null;

            this.birdMats.body.color.setHex(skin.body);
            this.birdMats.body.emissive.setHex(skin.emissive || 0x000000);
            this.birdMats.body.emissiveIntensity = skin.rarity === 'GODLIKE' ? 0.58 : (skin.rarity === 'MYTHIC' ? 0.48 : 0.36);
            this.birdMats.body.metalness = skin.metalness;
            this.birdMats.body.roughness = skin.roughness;
            this.birdMats.body.bumpMap = bumpMap;
            this.birdMats.body.bumpScale = skin.bumpType === 'scales' ? 0.052 : 0.026;
            this.birdMats.body.needsUpdate = true;

            this.birdMats.belly.color.setHex(skin.belly);
            this.birdMats.belly.metalness = Math.min(0.68, skin.metalness * 0.65);
            this.birdMats.belly.roughness = Math.max(0.12, skin.roughness * 0.9);

            this.birdMats.wing.color.setHex(skin.wing);
            this.birdMats.wing.emissive.setHex(skin.emissive || 0x000000);
            this.birdMats.wing.emissiveIntensity = skin.rarity === 'GODLIKE' ? 0.62 : (skin.rarity === 'MYTHIC' ? 0.52 : 0.38);
            this.birdMats.wing.metalness = skin.metalness;
            this.birdMats.wing.roughness = skin.roughness;
            this.birdMats.wing.bumpMap = bumpMap;
            this.birdMats.wing.bumpScale = 0.028;
            this.birdMats.wing.needsUpdate = true;

            this.birdMats.beak.color.setHex(skin.beak);
            this.birdMats.beak.metalness = Math.min(0.85, skin.metalness * 0.85);
            this.birdMats.beak.roughness = Math.max(0.10, skin.roughness * 0.75);

            if (this.birdMats.iris) {
              this.birdMats.iris.color.setHex(skin.iris || 0x0284c7);
              this.birdMats.iris.emissive.setHex(skin.iris || 0x0284c7);
              this.birdMats.iris.emissiveIntensity = 0.35;
            }
          }

          // Toggle bespoke 3D model preset groups and restore calibrated hitbox-centered baseScale & basePos
          if (this.skinModelGroups) {
            Object.keys(this.skinModelGroups).forEach(k => {
              const grp = this.skinModelGroups[k];
              grp.visible = (k === skin.modelPreset);
              const bs = (grp.userData && grp.userData.baseScale) || 1;
              const bp = (grp.userData && grp.userData.basePos) || { x: 0, y: 0, z: 0 };
              grp.scale.set(bs, bs, bs);
              grp.position.set(bp.x, bp.y, bp.z);
            });
          }

          // Toggle custom 3D wing style attachments
          if (this.wingStyleGroups) {
            Object.keys(this.wingStyleGroups).forEach(k => {
              const pair = this.wingStyleGroups[k];
              const isMatch = !isPokemon && (k === skin.wingStyle);
              pair.left.visible = isMatch;
              pair.right.visible = isMatch;
            });
          }

          this.updateProfileRecordPills();
        }

        getOrCreatePipeSkinAssets(pipeSkin) {
          if (this.pipeSkinCache[pipeSkin.id]) {
            return this.pipeSkinCache[pipeSkin.id];
          }
          const tex = createPipeSkinTextures(pipeSkin);
          const bodyMat = new THREE.MeshStandardMaterial({
            map: tex,
            roughness: pipeSkin.roughness,
            metalness: pipeSkin.metalness,
            emissive: new THREE.Color(pipeSkin.emissive || 0x000000),
            emissiveIntensity: pipeSkin.rarity === 'GODLIKE' ? 0.65 : (pipeSkin.rarity === 'MYTHIC' ? 0.55 : 0.45),
            bumpMap: tex,
            bumpScale: 0.036
          });

          const isGlowTrim = (
            pipeSkin.trimStyle === 'neon_rings' ||
            pipeSkin.trimStyle === 'halos' ||
            pipeSkin.trimStyle === 'crystals' ||
            pipeSkin.trimStyle === 'laser_matrix' ||
            pipeSkin.trimStyle === 'imperial_crown' ||
            pipeSkin.trimStyle === 'nature_vines' ||
            pipeSkin.trimStyle === 'clockwork_gears' ||
            pipeSkin.trimStyle === 'classic_rim'
          );
          const trimMat = new THREE.MeshStandardMaterial({
            color: pipeSkin.trimColor,
            metalness: isGlowTrim ? 0.92 : Math.max(0.65, pipeSkin.metalness),
            roughness: isGlowTrim ? 0.06 : 0.16,
            emissive: new THREE.Color(pipeSkin.trimColor),
            emissiveIntensity: pipeSkin.trimStyle === 'laser_matrix' ? 0.85 : (isGlowTrim ? 0.62 : 0.42)
          });

          const coreColor = (
            pipeSkin.rarity === 'GODLIKE' ||
            pipeSkin.rarity === 'MYTHIC' ||
            pipeSkin.rarity === 'EPIC' ||
            pipeSkin.rarity === 'RARE'
          )
            ? pipeSkin.trimColor
            : 0x10b981;
          const coreMat = new THREE.MeshBasicMaterial({
            color: coreColor
          });

          const cached = { bodyMat, trimMat, coreMat, pipeSkin };
          this.pipeSkinCache[pipeSkin.id] = cached;
          return cached;
        }

        applyPipeSkin(pipeSkinId, saveToServer = false, force = false) {
          const pipeSkin = PIPE_SKINS.find(p => p.id === pipeSkinId) || PIPE_SKINS[0];
          if (!force && !this.isCosmeticUnlocked(pipeSkin)) return;

          this.selectedPipeSkinId = pipeSkin.id;
          localStorage.setItem('flappy3d_pipe_skin', pipeSkin.id);

          this.applyPipeSkinVisualsOnly(pipeSkin);

          if (saveToServer && this.authToken && this.currentUser) {
            this.apiRequest('/api/skin', 'POST', { pipeSkinId: pipeSkin.id }).catch(() => {});
          }
        }

        applyPipeSkinVisualsOnly(pipeSkin) {
          this.currentPipeSkin = pipeSkin;
          const pipeLabelEl = document.getElementById('current-pipe-skin-label');
          if (pipeLabelEl) pipeLabelEl.textContent = pipeSkin.name;
          const pipePreviewEmoji = document.getElementById('loadout-pipe-preview-emoji');
          if (pipePreviewEmoji) pipePreviewEmoji.textContent = pipeSkin.emoji || '🟢';
          const pipePreviewBadge = document.getElementById('loadout-pipe-preview-badge');
          if (pipePreviewBadge && pipeSkin.colors && pipeSkin.colors[0]) {
            pipePreviewBadge.style.background = `linear-gradient(135deg, ${pipeSkin.colors[0]}55 0%, ${pipeSkin.colors[0]}22 100%)`;
            pipePreviewBadge.style.borderColor = pipeSkin.colors[0];
          }
          this.activePipeAssets = this.getOrCreatePipeSkinAssets(pipeSkin);

          // Rebuild existing visible pipes in place so 3D Pipe Skin changes appear immediately!
          if (this.pipes.length === 0 && typeof this.spawnLobbyPreviewPipes === 'function') {
            this.spawnLobbyPreviewPipes();
          } else {
            for (let i = 0; i < this.pipes.length; i++) {
              const p = this.pipes[i];
              this.rebuildPipePairVisuals(p);
            }
          }

          this.updateProfileRecordPills();
        }

        initSettings() {
          const DEFAULT_SETTINGS = {
            graphicsQuality: 'high',
            theme: 'dark',
            volume: 1.0,
            screenShake: 'full',
            particles: true,
            cameraTilt: true,
            showFPS: true,
            showHitbox: false
          };
          this.settings = { ...DEFAULT_SETTINGS };
          try {
            const raw = localStorage.getItem('flappy3d_settings');
            if (raw) Object.assign(this.settings, JSON.parse(raw));
          } catch (_) {}

          this.applyGraphicsQuality(this.settings.graphicsQuality);
          this.applyTheme(this.settings.theme);
          this.applyAudioVolume(this.settings.volume);

          const shakeBtn = document.querySelector(`#setting-shake-segmented [data-shake="${this.settings.screenShake}"]`);
          if (shakeBtn) {
            document.querySelectorAll('#setting-shake-segmented .setting-seg-btn').forEach(b => b.classList.remove('active'));
            shakeBtn.classList.add('active');
          }
          const partCb = document.getElementById('setting-particles');
          if (partCb) partCb.checked = Boolean(this.settings.particles);
          const camCb = document.getElementById('setting-cam-tilt');
          if (camCb) camCb.checked = Boolean(this.settings.cameraTilt);
          const fpsCb = document.getElementById('setting-show-fps');
          if (fpsCb) fpsCb.checked = Boolean(this.settings.showFPS);
          const fpsBadge = document.getElementById('header-fps-badge');
          if (fpsBadge) fpsBadge.style.display = this.settings.showFPS ? 'inline-block' : 'none';
          const hitboxCb = document.getElementById('setting-show-hitbox');
          if (hitboxCb) hitboxCb.checked = Boolean(this.settings.showHitbox);
          if (this.hitboxRingMesh) {
            this.hitboxRingMesh.visible = Boolean(this.settings.showHitbox);
          }
        }

        saveSettings() {
          try {
            localStorage.setItem('flappy3d_settings', JSON.stringify(this.settings));
          } catch (_) {}
        }

        applyGraphicsQuality(quality) {
          this.settings.graphicsQuality = quality;
          this.saveSettings();

          const isLow = quality === 'low';
          const isMed = quality === 'medium';
          const isHigh = quality === 'high';
          const isUltra = quality === 'ultra';

          if (this.renderer) {
            if (isLow) {
              this.renderer.shadowMap.enabled = false;
              this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.0));
              if (this.dirLight) this.dirLight.castShadow = false;
            } else if (isMed) {
              this.renderer.shadowMap.enabled = true;
              this.renderer.shadowMap.type = THREE.BasicShadowMap;
              if (this.dirLight) {
                this.dirLight.castShadow = true;
                this.dirLight.shadow.mapSize.width = 1024;
                this.dirLight.shadow.mapSize.height = 1024;
              }
              this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
            } else if (isHigh) {
              this.renderer.shadowMap.enabled = true;
              this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
              if (this.dirLight) {
                this.dirLight.castShadow = true;
                this.dirLight.shadow.mapSize.width = 2048;
                this.dirLight.shadow.mapSize.height = 2048;
              }
              this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
            } else if (isUltra) {
              this.renderer.shadowMap.enabled = true;
              this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
              if (this.dirLight) {
                this.dirLight.castShadow = true;
                this.dirLight.shadow.mapSize.width = 2048;
                this.dirLight.shadow.mapSize.height = 2048;
              }
              this.renderer.setPixelRatio(window.devicePixelRatio || 1);
            }
          }

          document.querySelectorAll('#setting-gfx-segmented .setting-seg-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-gfx') === quality);
          });
          const descEl = document.getElementById('setting-gfx-desc');
          if (descEl) {
            descEl.textContent = isLow
              ? 'Low: Max FPS, Shadows Disabled, 1.0x Screen Resolution'
              : (isMed
                ? 'Medium: 1024 Shadows, 1.25x Balanced Resolution'
                : (isHigh
                  ? 'High: 2048 PCFSoft Shadows, 1.75x Resolution & Particle Effects'
                  : 'Ultra: 2048 Soft Shadows, Full Native Screen Pixel Ratio (120FPS+)'));
          }
        }

        applyTheme(themeName) {
          if (themeName === 'retro') themeName = 'cyber';
          this.settings.theme = themeName;
          this.saveSettings();

          document.documentElement.className = 'theme-' + themeName;
          document.body.className = (document.body.className || '')
            .replace(/\btheme-[a-z0-9_-]+\b/g, '')
            .trim() + ' theme-' + themeName;

          const themeIconEl = document.getElementById('theme-icon');
          if (themeIconEl) {
            themeIconEl.textContent = themeName === 'light' ? '☀️' : (themeName === 'cyber' ? '👾' : '🌙');
          }

          document.querySelectorAll('#setting-theme-segmented .setting-seg-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-thm') === themeName);
          });

          // Harmonize 3D WebGL sky & atmosphere fog with the active color scheme
          if (this.renderer && this.scene && this.scene.fog) {
            if (themeName === 'light') {
              this.renderer.setClearColor(0x7dd3fc, 1);
              this.scene.fog.color.setHex(0x93e1fa);
            } else if (themeName === 'cyber') {
              this.renderer.setClearColor(0x1e1136, 1);
              this.scene.fog.color.setHex(0x2e1065);
            } else {
              this.renderer.setClearColor(0x3898d8, 1);
              this.scene.fog.color.setHex(0x5bb8e8);
            }
          }

          // Re-render Leaderboard, Stats Menu, and Cosmetic Grids so mode-specific elements adapt in real-time
          if (typeof this.renderStatsMenu === 'function') {
            this.renderStatsMenu();
          }
          if (typeof this.renderLeaderboard === 'function') {
            this.renderLeaderboard();
          }
          if (typeof this.renderAllCosmeticGrids === 'function') {
            this.renderAllCosmeticGrids();
          }
        }

        applyAudioVolume(vol) {
          this.settings.volume = Math.max(0, Math.min(1, Number(vol)));
          this.saveSettings();
          const slider = document.getElementById('setting-vol-slider');
          if (slider) slider.value = String(Math.round(this.settings.volume * 100));
          const text = document.getElementById('setting-vol-text');
          if (text) text.textContent = Math.round(this.settings.volume * 100) + '%';
        }

        switchView(viewName) {
          this.currentAppView = viewName;

          // 1. If currently on Game Over screen, dismiss it immediately so requested view can pop up
          const gameoverScreen = document.getElementById('gameover-screen');
          if (gameoverScreen && gameoverScreen.classList.contains('active')) {
            gameoverScreen.classList.remove('active');
          }

          // 2. Ensure start-screen hub container is active and visible
          const startScreen = document.getElementById('start-screen');
          if (startScreen && !startScreen.classList.contains('active')) {
            startScreen.classList.add('active');
          }

          // 3. Ensure in-game classes are stripped and top navigation bar is fully visible
          document.body.classList.remove('in-game');
          const topBarEl = document.getElementById('top-app-bar');
          if (topBarEl) {
            topBarEl.classList.remove('in-game');
            if (topBarEl.style) {
              if (typeof topBarEl.style.removeProperty === 'function') topBarEl.style.removeProperty('display');
              else topBarEl.style.display = '';
            }
          }

          // 4. If coming from GAMEOVER state, reset 3D world to clean start state
          if (this.state === GAME_STATE.GAMEOVER) {
            this.state = GAME_STATE.START;
            if (typeof this.spawnLobbyPreviewPipes === 'function') {
              this.spawnLobbyPreviewPipes();
            }
            if (this.birdGroup) {
              this.simBirdY = CONFIG.birdStartY;
              this.prevBirdY = CONFIG.birdStartY;
              this.birdGroup.position.set(CONFIG.birdX, CONFIG.birdStartY, 0);
              this.birdGroup.rotation.set(0, 0, 0);
              if (this.birdMeshGroup) {
                this.birdMeshGroup.rotation.set(0, 0, 0);
              }
            }
            if (typeof this.renderAllCosmeticGrids === 'function') {
              this.renderAllCosmeticGrids();
            }
          }

          // 5. Update top navigation dock tabs
          document.querySelectorAll('#main-nav-dock .dock-tab').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-view') === viewName);
          });

          // 6. Switch active view panel
          const views = {
            lobby: document.getElementById('view-lobby'),
            skins: document.getElementById('view-skins'),
            leaderboard: document.getElementById('view-leaderboard'),
            stats: document.getElementById('view-stats'),
            settings: document.getElementById('view-settings'),
            account: document.getElementById('view-account')
          };

          Object.keys(views).forEach(k => {
            if (views[k]) {
              views[k].classList.toggle('active-view', k === viewName);
            }
          });

          if (viewName === 'skins') {
            if (this.currentLockerTab === 'pipes') {
              this.renderPipeSkinsGrid();
            } else {
              this.renderBirdSkinsGrid();
            }
          } else if (viewName === 'leaderboard') {
            this.fetchLeaderboards(this.lbShowAllPlayers);
            if (typeof this.updateLeaderboardUniqueToggleUI === 'function') {
              this.updateLeaderboardUniqueToggleUI();
            }
          } else if (viewName === 'stats') {
            this.renderStatsMenu();
          } else if (viewName === 'account') {
            this.updateProfileRecordPills();
          }
        }

        toggleProfileModal(forceOpen) {
          const modal = document.getElementById('profile-modal');
          if (!modal) return;
          const isAct = modal.classList.contains('active');
          const target = typeof forceOpen === 'boolean' ? forceOpen : !isAct;
          modal.classList.toggle('active', target);
        }

        toggleFullscreen() {
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
          } else {
            if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
          }
        }

        toggleChangelogModal() {}
        initChangelog() {}

        // ------------------------------------------------------------------------
        // LIVE USER DATA & SKIN SYNC (INSTANT UPDATES FROM DATABASE PANEL)
        // ------------------------------------------------------------------------
        applyLiveUserSync(userSync) {
          if (!userSync || !this.currentUser) return;
          if (userSync.username && this.currentUser.username && userSync.username.toLowerCase() !== this.currentUser.username.toLowerCase()) {
            return;
          }

          let hasVisualChanges = false;
          let hasGridChanges = false;

          // 1. Sync granted skins
          if (Array.isArray(userSync.grantedSkins)) {
            const oldG = JSON.stringify(this.currentUser.grantedSkins || []);
            const newG = JSON.stringify(userSync.grantedSkins);
            if (oldG !== newG) {
              this.currentUser.grantedSkins = [...userSync.grantedSkins];
              hasGridChanges = true;
            }
          }

          // 2. Sync admin locked skins
          if (Array.isArray(userSync.adminLockedSkins)) {
            const oldL = JSON.stringify(this.currentUser.adminLockedSkins || []);
            const newL = JSON.stringify(userSync.adminLockedSkins);
            if (oldL !== newL) {
              this.currentUser.adminLockedSkins = [...userSync.adminLockedSkins];
              hasGridChanges = true;
            }
          }

          // 3. Sync player records
          if (userSync.records && typeof userSync.records === 'object') {
            const oldR = JSON.stringify(this.currentUser.records || {});
            const newR = JSON.stringify(userSync.records);
            if (oldR !== newR) {
              this.currentUser.records = { ...userSync.records };
              hasGridChanges = true;
            }
          }

          // 4. Sync equipped bird skin
          const targetBirdSkin = userSync.selectedSkin || 'classic';
          if (this.currentUser.selectedSkin !== targetBirdSkin || this.selectedSkinId !== targetBirdSkin) {
            this.currentUser.selectedSkin = targetBirdSkin;
            this.selectedSkinId = targetBirdSkin;
            localStorage.setItem('flappy3d_skin', targetBirdSkin);
            this.applySkin(targetBirdSkin, false, true);
            hasVisualChanges = true;
            hasGridChanges = true;
          }

          // 5. Sync equipped pipe skin
          const targetPipeSkin = userSync.selectedPipeSkin || 'classic_pipe';
          if (this.currentUser.selectedPipeSkin !== targetPipeSkin || this.selectedPipeSkinId !== targetPipeSkin) {
            this.currentUser.selectedPipeSkin = targetPipeSkin;
            this.selectedPipeSkinId = targetPipeSkin;
            localStorage.setItem('flappy3d_pipe_skin', targetPipeSkin);
            this.applyPipeSkin(targetPipeSkin, false, true);
            hasVisualChanges = true;
            hasGridChanges = true;
          }

          if (hasGridChanges || hasVisualChanges) {
            this.renderAllCosmeticGrids();
            this.updateLobbySkinCapsuleUI();
            this.updateHUD();
            if (typeof this.renderStatsMenu === 'function' && document.getElementById('stats-screen')?.classList.contains('active')) {
              this.renderStatsMenu();
            }
          }
        }
      }

window.FlappyBirdUIAndProgression = FlappyBirdUIAndProgression;
