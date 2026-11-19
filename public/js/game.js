/**
 * ============================================================================
 * MAIN 3D FLAPPY BIRD CONTROLLER, 60HZ PHYSICS & ONLINE ENGINE (game.js)
 * ============================================================================
 */
'use strict';

      class FlappyBirdOnline {
        constructor() {
          this.container = document.getElementById('game-canvas-container');
          this.sound = new SoundManager();
          this.chat = (typeof ChatManager !== 'undefined') ? new ChatManager(this) : null;

          this.authToken = localStorage.getItem('flappy3d_token') || null;
          this.currentUser = null;
          this.localRecords = this.loadLocalRecords();
          this.careerStats = this.loadCareerStats();
          this.trollQuests = this.loadTrollQuests();
          this.statsSubfilter = 'all';

          this.selectedSkinId = localStorage.getItem('flappy3d_skin') || 'classic';
          this.previewSkinId = null;
          this.avatarSkinId = localStorage.getItem('flappy3d_avatar_skin') || this.selectedSkinId || 'classic';

          this.selectedPipeSkinId = localStorage.getItem('flappy3d_pipe_skin') || 'classic_pipe';
          this.previewPipeSkinId = null;
          this.pipeSkinCache = {};

          this.selectedBackgroundId = localStorage.getItem('flappy3d_background_skin') || 'bg_classic';
          this.previewBgSkinId = null;
          this.currentBackgroundSkin = null;

          this.birdLockerFilter = 'all';
          this.pipeLockerFilter = 'all';
          this.bgLockerFilter = 'all';
          this.skinSearchQuery = '';
          this.lockerSortOrder = 'default';

          this.leaderboards = { easy: [], medium: [], hard: [], extreme: [] };
          this.timeframeLeaderboards = {
            all: { easy: [], medium: [], hard: [], extreme: [] },
            weekly: { easy: [], medium: [], hard: [], extreme: [] },
            daily: { easy: [], medium: [], hard: [], extreme: [] }
          };
          this.extremeSolver = null;
          this.lastExtremeFrameTime = 0;
          this.activeTimeframeTab = 'all';
          this.resetBoundaries = null;
          this.clientServerTimeOffset = 0;
          this.lbShowAllPlayers = false;
          this.selectedDifficulty = 'medium';
          this.activeLbTab = 'medium';
          this.lbUniqueRecordsOnly = true;
          this.isStartingRun = false;
          this.prefetchedRun = null;
          this.prefetchPromise = null;
          this.prefetchingDifficulty = null;
          this.activeRunPromise = null;

          // Anti-Cheat & Sub-Tick Interpolation State
          this.activeRunId = null;
          this.activeSeed = 123456789;
          this.prng = createSeededPRNG(this.activeSeed);
          this.extremeSolver = null;
          this.lastExtremeFrameTime = 0;
          this.currentTick = 0;
          this.flapTicks = [];
          this.pendingFlap = false;
          this.queuedFlaps = 0;
          this.flapBufferTicks = 0;
          this.lastFlapTick = -2;
          this.lastQueueFlapTime = -1000;
          this.lastKbdQueueTime = -1000;
          this.lastPtrQueueTime = -1000;
          this.lastQueueSource = '';
          this.physicsAccumulator = 0;

          // Authoritative 60Hz coordinates + Previous tick coordinates for 120Hz/144Hz interpolation
          this.simBirdY = CONFIG.birdStartY;
          this.prevBirdY = CONFIG.birdStartY;
          this.birdVelocityY = 0;

          // Gameplay State
          this.state = GAME_STATE.START;
          this.score = 0;
          this.wingFlapBoost = 0;
          this.wingPhase = 0;
          this.distanceSinceLastPipe = 0;
          this.elapsedTime = 0;
          this.shakeTimer = 0;
          this.auraSpawnAccum = 0;

          // 3D Entities & Zero-Allocation Particle Pool
          this.pipes = [];
          this.particlePool = [];
          this.clouds = [];
          this.sceneryItems = [];

          this.initThree();
          this.initLights();
          this.initMaterials();
          this.initSettings();
          this.createEnvironment();
          this.createBird();
          this.initParticlePool();

          // Apply saved Bird Skin, Pipe Skin & Background Skin and spawn preview pipes in the Start screen
          this.applySkin(this.selectedSkinId, false);
          this.applyPipeSkin(this.selectedPipeSkinId, false);
          if (typeof this.applyBackgroundSkin === 'function') {
            this.applyBackgroundSkin(this.selectedBackgroundId, false);
          }
          this.spawnLobbyPreviewPipes();

          this.bindEvents();

          this.updateHUD();
          this.renderAllCosmeticGrids();
          this.updateAllProfilePictures();
          if (typeof this.renderDuelCasesShop === 'function') {
            this.renderDuelCasesShop();
          }

          // Connect to Online Server & poll leaderboards every 5s while in menus
          this.initOnlineSession();
          this.switchView('lobby');
          if (typeof this.updateLeaderboardToggleBtn === 'function') {
            this.updateLeaderboardToggleBtn();
          }
          setInterval(() => {
            if (document.hidden) return;
            if (this.state === GAME_STATE.START || this.state === GAME_STATE.GAMEOVER) {
              this.fetchLeaderboards(this.lbShowAllPlayers);
            }
          }, 5000);

          this.startLiveUserSyncPolling();
          this.initResetCountdownTimer();
          this.initDuelsEngine();

          this.lastFrameTime = performance.now();
          this.animate = this.animate.bind(this);
          requestAnimationFrame(this.animate);
        }

        startLiveUserSyncPolling() {
          if (this._liveSyncTimer) clearInterval(this._liveSyncTimer);
          // ChatManager already polls /api/chat every 2.5s and applies data.userSync via applyLiveUserSync.
          // Only run a fallback /api/chat?since=0 sync if ChatManager is not present.
          if (this.chat) return;
          this._liveSyncTimer = setInterval(async () => {
            if (document.hidden) return;
            if (!this.currentUser || !this.authToken) return;
            try {
              const sigHeaders = typeof this.getClientSignalHeaders === 'function' ? this.getClientSignalHeaders() : {};
              const res = await fetch('/api/chat?limit=1', {
                headers: { ...sigHeaders, 'Authorization': `Bearer ${this.authToken}` }
              });
              if (!res.ok) return;
              const data = await res.json();
              if (data && data.userSync && typeof this.applyLiveUserSync === 'function') {
                this.applyLiveUserSync(data.userSync);
              }
            } catch (_) {}
          }, 3000);
        }

        // ------------------------------------------------------------------------
        // CONTROLS & UI BINDINGS
        // ------------------------------------------------------------------------
        bindEvents() {
          const isModalActive = () => {
            const guestModal = document.getElementById('guest-login-modal');
            if (guestModal && (guestModal.classList.contains('active') || guestModal.classList.contains('visible') || (guestModal.style.display && guestModal.style.display !== 'none'))) {
              return true;
            }
            const pubProfileModal = document.getElementById('player-public-profile-modal');
            if (pubProfileModal && (pubProfileModal.classList.contains('active') || pubProfileModal.classList.contains('visible') || (pubProfileModal.style.display && pubProfileModal.style.display !== 'none'))) {
              return true;
            }
            const pModal = document.getElementById('profile-modal');
            if (pModal && (pModal.classList.contains('active') || (pModal.style.display && pModal.style.display !== 'none'))) {
              return true;
            }
            const duelPwModal = document.getElementById('duel-password-modal');
            if (duelPwModal && (duelPwModal.classList.contains('active') || duelPwModal.classList.contains('visible') || (duelPwModal.style.display && duelPwModal.style.display !== 'none'))) {
              return true;
            }
            const cookieModal = document.getElementById('cookie-consent-modal');
            if (cookieModal && (cookieModal.classList.contains('active') || cookieModal.classList.contains('visible') || (cookieModal.style.display && cookieModal.style.display !== 'none'))) {
              return true;
            }
            return false;
          };

          let lastStartActionTime = 0;
          const triggerStartGame = () => {
            if (this.duelSpectatingLobbyId) return;
            if (this.activeDuelLobby && this.activeDuelLobby.status !== 'waiting') return;
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            if (now - lastStartActionTime < 250) return;
            lastStartActionTime = now;
            this.startGame();
          };

          window.addEventListener('keydown', (e) => {
            const activeEl = document.activeElement;
            const tag = activeEl && activeEl.tagName;
            const isJumpKey = (
              e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW' ||
              e.key === ' ' || e.key === 'Spacebar' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W' ||
              e.keyCode === 32 || e.keyCode === 38 || e.keyCode === 87
            );

            if (this.state === GAME_STATE.PLAYING && isJumpKey) {
              // Capture phase: never let lingering input focus, chat drawer, or child stopPropagation swallow a jump!
              if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') {
                if (activeEl && typeof activeEl.blur === 'function') activeEl.blur();
              }
              if (this.chat && this.chat.isOpen && typeof this.chat.onRoundStart === 'function') {
                this.chat.onRoundStart();
              }
              e.preventDefault();
              e.stopPropagation();
              if (e.repeat) return;
              this.queueFlap('kbd');
              return;
            }

            if (tag === 'INPUT' || tag === 'TEXTAREA') {
              if (this.state === GAME_STATE.PLAYING && !(this.chat && this.chat.isOpen)) {
                activeEl.blur();
              } else {
                if (e.key === 'Enter') {
                  if (activeEl && (activeEl.id === 'guest-modal-username' || activeEl.id === 'guest-modal-password')) {
                    this.handleGuestModalAuth('smart');
                  } else if (activeEl && (activeEl.id === 'auth-username' || activeEl.id === 'auth-password')) {
                    this.handleAuth('smart');
                  } else if (activeEl && activeEl.id === 'duel-join-password-input') {
                    this.submitDuelPasswordModal();
                  }
                }
                return;
              }
            }

            if (isModalActive()) {
              if (e.code === 'Escape') {
                const duelPwModal = document.getElementById('duel-password-modal');
                if (duelPwModal && duelPwModal.style.display !== 'none') {
                  this.closeDuelPasswordModal();
                }
                const guestModal = document.getElementById('guest-login-modal');
                if (guestModal && (guestModal.classList.contains('active') || guestModal.classList.contains('visible'))) {
                  this.toggleGuestLoginModal(false);
                }
                const pubProfileModal = document.getElementById('player-public-profile-modal');
                if (pubProfileModal && (pubProfileModal.classList.contains('active') || (pubProfileModal.style.display && pubProfileModal.style.display !== 'none'))) {
                  this.closePublicProfileModal();
                }
                const pModal = document.getElementById('profile-modal');
                if (pModal && pModal.classList.contains('active')) {
                  this.toggleProfileModal(false);
                }
              }
              return;
            }

            if (isJumpKey) {
              e.preventDefault();
              if (e.repeat) return;
              if (this.state === GAME_STATE.START || this.state === GAME_STATE.GAMEOVER) {
                triggerStartGame();
              }
            } else if (e.code === 'KeyM') {
              this.sound.toggleMute();
            } else if (e.code === 'KeyR') {
              this.resetVisualSceneAndRecover(true);
            } else if (e.code === 'Escape') {
              if (this.duelSpectatingLobbyId) {
                this.stopSpectatingDuel();
                return;
              }
              const pModal = document.getElementById('profile-modal');
              if (pModal && pModal.classList.contains('active')) {
                this.toggleProfileModal(false);
              } else if (this.currentAppView && this.currentAppView !== 'lobby') {
                this.switchView('lobby');
              }
            }
          }, { capture: true });

          let lastPointerActionTime = 0;

          const isInsideMenuUi = (el) => {
            if (!el || typeof el.closest !== 'function') return false;
            return Boolean(
              el.closest(
                'button, a, input, textarea, select, option, label, ' +
                'header, nav, .app-header, #top-app-bar, #main-nav-dock, .nav-dock, ' +
                '#game-chat-panel, #btn-chat-toggle, .floating-chat-btn, .chat-panel, ' +
                '.card, .play-deck-card, .lb-full-card, .locker-full-card, .locker-panel-card, ' +
                '.stats-full-card, .duels-full-card, .duels-container, .duels-arena-card, .duels-shop-card, .duels-tabs-bar, .duels-tab-btn, .duels-tab-panel, #view-duels, ' +
                '#duel-overlay-backdrop, #duel-spectator-overlay, #duel-live-hud, .duel-modal-box, .duel-lobby-row, ' +
                '.settings-modal-card, .account-panel-card, .gameover-card, ' +
                '.guest-modal-card, .public-profile-card, .modal-card, .modal-dialog, ' +
                '.modal-backdrop, .guest-modal-overlay, [role="dialog"], ' +
                '.mode-select-deck, .lb-toolbar, .lb-timeframe-bar, .lb-list, .lb-row, .lb-my-standing-card, ' +
                '.scoreboard, .gameover-actions, ' +
                '#hud, .hud-pill, .hud-left, .hud-right, .top-bar, ' +
                '[class*="-card"], [class*="-modal"]'
              )
            );
          };

          const handlePointerFlapAction = (e) => {
            if (e.type === 'pointerdown') {
              if (e.pointerType === 'mouse' && typeof e.button === 'number' && e.button !== 0) return;
              if (this.state !== GAME_STATE.PLAYING && e.isPrimary === false) return;
            }

            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            // Deduplicate synthetic / hardware bounce only (<14ms), allowing fast intentional double-taps
            if (now - lastPointerActionTime < 14) {
              return;
            }
            lastPointerActionTime = now;

            const target = e.target;

            // During active gameplay, tapping anywhere (except interactive chat/buttons) triggers an instant jump!
            if (this.state === GAME_STATE.PLAYING) {
              if (target && target.closest && target.closest('button, a, input, textarea, select, option, #top-app-bar, #game-chat-panel, #btn-chat-toggle, .floating-chat-btn')) {
                return;
              }
              if (document.activeElement && typeof document.activeElement.blur === 'function') {
                document.activeElement.blur();
              }
              if (e.cancelable) e.preventDefault();
              this.queueFlap('ptr');
              return;
            }

            // Never start a run from menu if an active modal dialog is currently open
            if (isModalActive()) {
              return;
            }

            // When in menu states: clicking on the 3D background (outside menu UI) starts a run
            if (this.state === GAME_STATE.START || this.state === GAME_STATE.GAMEOVER) {
              if (isInsideMenuUi(target)) {
                return;
              }
              if (e.cancelable) e.preventDefault();
              triggerStartGame();
            }
          };

          if (window.PointerEvent) {
            window.addEventListener('pointerdown', handlePointerFlapAction, { capture: true, passive: false });
          } else {
            window.addEventListener('touchstart', handlePointerFlapAction, { capture: true, passive: false });
            window.addEventListener('mousedown', (e) => {
              if (e.button === 0) handlePointerFlapAction(e);
            }, { capture: true, passive: false });
          }

          window.addEventListener('keyup', (e) => {
            if (this.state === GAME_STATE.PLAYING && (e.code === 'Space' || e.key === ' ')) {
              e.preventDefault();
            }
          });

          const bindStartButton = (btnId) => {
            const btn = document.getElementById(btnId);
            if (!btn) return;
            const startHandler = (e) => {
              e.stopPropagation();
              triggerStartGame();
            };
            btn.addEventListener('pointerdown', startHandler);
            btn.addEventListener('click', startHandler);
          };
          bindStartButton('start-btn');
          bindStartButton('restart-btn');

          const backHubBtn = document.getElementById('back-hub-btn');
          if (backHubBtn) {
            const backHubHandler = (e) => {
              e.stopPropagation();
              this.showLobbyScreen();
            };
            backHubBtn.addEventListener('pointerdown', backHubHandler);
            backHubBtn.addEventListener('click', backHubHandler);
          }

          // Dedicated "See All Players" & Leaderboard Top 100 Toggle Actions
          const openAllPlayersHandler = (e) => {
            if (e) e.stopPropagation();
            this.lbShowAllPlayers = true;
            if (typeof this.updateLeaderboardToggleBtn === 'function') {
              this.updateLeaderboardToggleBtn();
            }
            this.switchView('leaderboard');
            this.fetchLeaderboards(true);
          };

          const btnLobbyAllPlayers = document.getElementById('btn-lobby-goto-all-players');
          if (btnLobbyAllPlayers) {
            btnLobbyAllPlayers.addEventListener('click', openAllPlayersHandler);
          }

          const btnAccountAllPlayers = document.getElementById('btn-account-goto-all-players');
          if (btnAccountAllPlayers) {
            btnAccountAllPlayers.addEventListener('click', openAllPlayersHandler);
          }

          const lbToggleBtn = document.getElementById('lb-toggle-top100-btn');
          if (lbToggleBtn) {
            lbToggleBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.lbShowAllPlayers = !this.lbShowAllPlayers;
              if (typeof this.updateLeaderboardToggleBtn === 'function') {
                this.updateLeaderboardToggleBtn();
              }
              this.fetchLeaderboards(this.lbShowAllPlayers);
            });
          }

          document.getElementById('mute-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.sound.toggleMute();
            e.currentTarget.blur();
          });

          // Top Navigation Dock Views (Lobby vs Duels vs Locker vs Leaderboard vs Stats vs Settings)
          let lastDockActionTime = 0;
          const handleDockNavigation = (btn, e) => {
            e.stopPropagation();
            const now = Date.now();
            if (now - lastDockActionTime < 100) return;
            lastDockActionTime = now;
            const view = btn.getAttribute('data-view') || 'lobby';
            this.switchView(view);
          };
          document.querySelectorAll('#main-nav-dock .dock-tab').forEach(btn => {
            btn.addEventListener('pointerdown', (e) => handleDockNavigation(btn, e));
            btn.addEventListener('click', (e) => handleDockNavigation(btn, e));
          });

          // Duels Arena Tab Navigation (Join Match vs Create Match vs Ranked Leaderboard)
          let lastDuelTabActionTime = 0;
          const activateDuelTab = (tabName, playChime = true) => {
            if (!tabName) return;
            this.currentDuelTab = tabName;
            document.querySelectorAll('.duels-tab-btn').forEach(b => {
              const isSelected = b.getAttribute('data-duel-tab') === tabName;
              b.classList.toggle('active', isSelected);
              b.setAttribute('aria-selected', isSelected ? 'true' : 'false');
            });
            document.querySelectorAll('.duels-tab-panel').forEach(panel => {
              const isMatch = panel.id === `duel-panel-${tabName}`;
              panel.classList.toggle('active', isMatch);
              panel.style.display = isMatch ? 'flex' : 'none';
            });
            if (playChime && this.sound) this.sound.playFlap();
            if (typeof this.fetchDuelsState === 'function') {
              this.fetchDuelsState();
            }
          };
          this.activateDuelTab = activateDuelTab;

          const handleDuelTabTrigger = (btn, e) => {
            e.stopPropagation();
            const now = Date.now();
            if (now - lastDuelTabActionTime < 100) return;
            lastDuelTabActionTime = now;
            const tab = btn.getAttribute('data-duel-tab');
            activateDuelTab(tab, true);
          };

          document.querySelectorAll('.duels-tab-btn').forEach(btn => {
            btn.addEventListener('pointerdown', (e) => handleDuelTabTrigger(btn, e));
            btn.addEventListener('click', (e) => handleDuelTabTrigger(btn, e));
          });

          document.querySelectorAll('.duel-ranked-mode-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const mode = btn.getAttribute('data-duel-ranked-mode') === 'points' ? 'points' : 'elo';
              this.currentDuelRankedMode = mode;
              document.querySelectorAll('.duel-ranked-mode-btn').forEach(b => {
                const isSel = b.getAttribute('data-duel-ranked-mode') === mode;
                b.classList.toggle('active', isSel);
                b.setAttribute('aria-selected', isSel ? 'true' : 'false');
              });
              if (this.sound) this.sound.playFlap();
              if (typeof this.renderDuelRankedLeaderboard === 'function') {
                this.renderDuelRankedLeaderboard();
              }
            });
          });

          const qmBtn = document.getElementById('btn-duel-quick-match');
          if (qmBtn) {
            qmBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.handleDuelQuickMatch();
            });
          }

          this.duelCreateIsFriendly = false;
          this._pendingPasswordLobbyId = null;

          const setCreateMode = (isFriendly) => {
            this.duelCreateIsFriendly = Boolean(isFriendly);
            const rankedBtn = document.getElementById('btn-duel-type-ranked');
            const friendlyBtn = document.getElementById('btn-duel-type-friendly');
            const pwWrap = document.getElementById('duel-create-password-wrap');
            const pwInput = document.getElementById('duel-create-password-input');
            if (rankedBtn) rankedBtn.classList.toggle('active', !this.duelCreateIsFriendly);
            if (friendlyBtn) friendlyBtn.classList.toggle('active', this.duelCreateIsFriendly);
            if (pwWrap) pwWrap.style.display = this.duelCreateIsFriendly ? 'block' : 'none';
            if (!this.duelCreateIsFriendly && pwInput) pwInput.value = '';
          };

          const rankedTypeBtn = document.getElementById('btn-duel-type-ranked');
          if (rankedTypeBtn) {
            rankedTypeBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              setCreateMode(false);
            });
          }

          const friendlyTypeBtn = document.getElementById('btn-duel-type-friendly');
          if (friendlyTypeBtn) {
            friendlyTypeBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              setCreateMode(true);
            });
          }

          const createSubmitBtn = document.getElementById('btn-duel-create-submit');
          if (createSubmitBtn) {
            createSubmitBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.handleDuelCreateLobby();
            });
          }

          const createNameInput = document.getElementById('duel-create-name-input');
          if (createNameInput) {
            createNameInput.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                this.handleDuelCreateLobby();
              }
            });
          }

          const createPwInput = document.getElementById('duel-create-password-input');
          if (createPwInput) {
            createPwInput.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                this.handleDuelCreateLobby();
              }
            });
          }

          const pwModalEl = document.getElementById('duel-password-modal');
          const pwModalClose = document.getElementById('duel-password-modal-close');
          const pwModalSubmit = document.getElementById('btn-duel-password-submit');
          const pwJoinInput = document.getElementById('duel-join-password-input');
          if (pwModalClose) {
            pwModalClose.addEventListener('click', (e) => {
              e.stopPropagation();
              this.closeDuelPasswordModal();
            });
          }
          if (pwModalEl) {
            pwModalEl.addEventListener('click', (e) => {
              if (e.target === pwModalEl) this.closeDuelPasswordModal();
            });
          }
          if (pwModalSubmit) {
            pwModalSubmit.addEventListener('click', (e) => {
              e.stopPropagation();
              this.submitDuelPasswordModal();
            });
          }
          if (pwJoinInput) {
            pwJoinInput.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                this.submitDuelPasswordModal();
              }
            });
          }

          const leaveWaitBtn = document.getElementById('btn-duel-leave-waiting');
          if (leaveWaitBtn) {
            leaveWaitBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.handleDuelLeaveLobby();
            });
          }

          const finishBackBtn = document.getElementById('btn-duel-finish-back');
          if (finishBackBtn) {
            finishBackBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.handleDuelFinishBackToHub();
            });
          }

          const exitSpecBtn = document.getElementById('btn-duel-exit-spectate');
          if (exitSpecBtn) {
            exitSpecBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.stopSpectatingDuel();
            });
          }

          const callBotInstantBtn = document.getElementById('btn-duel-call-bot-instant');
          if (callBotInstantBtn) {
            callBotInstantBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.handleDuelCallBot('join_or_start', '');
            });
          }

          const spawnBotLobbyBtn = document.getElementById('btn-duel-spawn-bot-lobby');
          if (spawnBotLobbyBtn) {
            spawnBotLobbyBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.handleDuelCallBot('bot_lobby', '');
            });
          }

          const callBotWaitBtn = document.getElementById('btn-duel-call-bot-waiting');
          if (callBotWaitBtn) {
            callBotWaitBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.handleDuelCallBot('join_or_start', this.activeDuelLobbyId || '');
            });
          }

          const brandHomeBtn = document.getElementById('brand-home-btn');
          if (brandHomeBtn) {
            brandHomeBtn.addEventListener('click', () => this.switchView('lobby'));
          }

          // Show Local Test Server badge when running in offline simulation mode
          const simBadge = document.getElementById('sim-server-badge');
          if (simBadge && (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '0.0.0.0')) {
            simBadge.style.display = 'inline-flex';
          }

          // Profile / Auth Capsule Button
          const openProfileBtn = document.getElementById('open-profile-btn');
          if (openProfileBtn) {
            openProfileBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.switchView('account');
            });
          }

          const btnLobbyAuthAction = document.getElementById('btn-lobby-auth-action');
          if (btnLobbyAuthAction) {
            btnLobbyAuthAction.addEventListener('click', (e) => {
              e.stopPropagation();
              this.switchView('account');
            });
          }

          const btnAccountGotoLobby = document.getElementById('btn-account-goto-lobby');
          if (btnAccountGotoLobby) {
            btnAccountGotoLobby.addEventListener('click', (e) => {
              e.stopPropagation();
              this.switchView('lobby');
            });
          }

          const btnAccountGotoLocker = document.getElementById('btn-account-goto-locker');
          if (btnAccountGotoLocker) {
            btnAccountGotoLocker.addEventListener('click', (e) => {
              e.stopPropagation();
              this.switchView('skins');
            });
          }

          const btnAccountGotoLb = document.getElementById('btn-account-goto-lb');
          if (btnAccountGotoLb) {
            btnAccountGotoLb.addEventListener('click', (e) => {
              e.stopPropagation();
              this.switchView('leaderboard');
            });
          }

          const profBirdCard = document.getElementById('profile-equipped-bird-card');
          if (profBirdCard) {
            profBirdCard.addEventListener('click', (e) => {
              e.stopPropagation();
              if (this.switchRightPanelFn) this.switchRightPanelFn('birds');
              else this.switchView('skins');
            });
          }

          const profPipeCard = document.getElementById('profile-equipped-pipe-card');
          if (profPipeCard) {
            profPipeCard.addEventListener('click', (e) => {
              e.stopPropagation();
              if (this.switchRightPanelFn) this.switchRightPanelFn('pipes');
              else this.switchView('skins');
            });
          }

          document.querySelectorAll('.btn-logout').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.handleLogout();
            });
          });

          const profileModalClose = document.getElementById('profile-modal-close');
          if (profileModalClose) {
            profileModalClose.addEventListener('click', () => this.toggleProfileModal(false));
          }

          const profileModalOverlay = document.getElementById('profile-modal');
          if (profileModalOverlay) {
            profileModalOverlay.addEventListener('click', (e) => {
              if (e.target === profileModalOverlay) this.toggleProfileModal(false);
            });
          }

          // Instant 3D View / Black Screen Recovery Button
          const btnResetView = document.getElementById('btn-reset-view');
          if (btnResetView) {
            btnResetView.addEventListener('click', (e) => {
              e.stopPropagation();
              this.resetVisualSceneAndRecover(true);
            });
          }

          // Guest Login Prompt Modal Controls
          const btnGuestModalLogin = document.getElementById('btn-guest-modal-login');
          if (btnGuestModalLogin) {
            btnGuestModalLogin.addEventListener('click', (e) => {
              e.stopPropagation();
              this.handleGuestModalAuth('login');
            });
          }
          const btnGuestModalRegister = document.getElementById('btn-guest-modal-register');
          if (btnGuestModalRegister) {
            btnGuestModalRegister.addEventListener('click', (e) => {
              e.stopPropagation();
              this.handleGuestModalAuth('register');
            });
          }
          const btnGuestModalSkip = document.getElementById('btn-guest-modal-skip');
          if (btnGuestModalSkip) {
            btnGuestModalSkip.addEventListener('click', (e) => {
              e.stopPropagation();
              this.toggleGuestLoginModal(false);
            });
          }
          const btnGuestModalClose = document.getElementById('guest-modal-close-btn');
          if (btnGuestModalClose) {
            btnGuestModalClose.addEventListener('click', (e) => {
              e.stopPropagation();
              this.toggleGuestLoginModal(false);
            });
          }
          const guestModalOverlay = document.getElementById('guest-login-modal');
          if (guestModalOverlay) {
            guestModalOverlay.addEventListener('click', (e) => {
              if (e.target === guestModalOverlay) this.toggleGuestLoginModal(false);
            });
          }

          // Dedicated Public Profile Modal Controls
          const publicProfileClose = document.getElementById('public-profile-close-btn');
          if (publicProfileClose) {
            publicProfileClose.addEventListener('click', () => this.closePublicProfileModal());
          }
          const publicProfileFooterClose = document.getElementById('public-profile-footer-close-btn');
          if (publicProfileFooterClose) {
            publicProfileFooterClose.addEventListener('click', () => this.closePublicProfileModal());
          }
          const publicProfileModal = document.getElementById('player-public-profile-modal');
          if (publicProfileModal) {
            publicProfileModal.addEventListener('click', (e) => {
              if (e.target === publicProfileModal) this.closePublicProfileModal();
            });
          }

          // Instant Theme Switcher Button
          const btnThemeToggle = document.getElementById('btn-theme-toggle');
          if (btnThemeToggle) {
            btnThemeToggle.addEventListener('click', (e) => {
              e.stopPropagation();
              const current = this.settings.theme || 'dark';
              const next = current === 'dark' ? 'light' : (current === 'light' ? 'cyber' : 'dark');
              this.applyTheme(next);
            });
          }

          // Fullscreen Button
          const btnFullscreenToggle = document.getElementById('btn-fullscreen-toggle');
          if (btnFullscreenToggle) {
            btnFullscreenToggle.addEventListener('click', (e) => {
              e.stopPropagation();
              this.toggleFullscreen();
            });
          }

          // Audio Quick Button in Header
          const btnAudioToggle = document.getElementById('btn-audio-toggle');
          if (btnAudioToggle) {
            btnAudioToggle.addEventListener('click', (e) => {
              e.stopPropagation();
              this.sound.toggleMute();
              const displayEl = document.getElementById('audio-icon-display');
              if (displayEl) displayEl.textContent = this.sound.isMuted ? '🔇' : '🔊';
            });
          }

          // Live Skin Search Input in Locker
          const skinSearchInput = document.getElementById('skin-search-input');
          if (skinSearchInput) {
            skinSearchInput.addEventListener('input', (e) => {
              this.skinSearchQuery = (e.target.value || '').trim().toLowerCase();
              if (this.currentLockerTab === 'pipes') {
                this.renderPipeSkinsGrid();
              } else if (this.currentLockerTab === 'bg' && typeof this.renderBgSkinsGrid === 'function') {
                this.renderBgSkinsGrid();
              } else {
                this.renderBirdSkinsGrid();
              }
            });
          }

          // Live Skin Sorting in Locker (Rounded Custom Dropdown + Native Fallback)
          const customSortDropdown = document.getElementById('custom-sort-dropdown');
          const customSortTrigger = document.getElementById('custom-sort-trigger');
          const customSortLabel = document.getElementById('custom-sort-label');
          const customSortMenu = document.getElementById('custom-sort-menu');
          const lockerSortSelect = document.getElementById('locker-sort-select');

          const updateLockerSort = (val, text) => {
            this.lockerSortOrder = val || 'default';
            if (lockerSortSelect && lockerSortSelect.value !== this.lockerSortOrder) {
              lockerSortSelect.value = this.lockerSortOrder;
            }
            if (customSortLabel && text) {
              customSortLabel.textContent = text.startsWith('Sort:') ? text : `Sort: ${text}`;
            }
            if (customSortMenu) {
              customSortMenu.querySelectorAll('.custom-sort-item').forEach(item => {
                if (item.getAttribute('data-val') === this.lockerSortOrder) {
                  item.classList.add('active');
                } else {
                  item.classList.remove('active');
                }
              });
            }
            if (this.currentLockerTab === 'pipes') {
              this.renderPipeSkinsGrid();
            } else if (this.currentLockerTab === 'bg' && typeof this.renderBgSkinsGrid === 'function') {
              this.renderBgSkinsGrid();
            } else {
              this.renderBirdSkinsGrid();
            }
          };

          if (customSortTrigger && customSortDropdown) {
            customSortTrigger.addEventListener('click', (e) => {
              e.stopPropagation();
              const isOpen = customSortDropdown.classList.toggle('is-open');
              customSortTrigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            });

            if (customSortMenu) {
              customSortMenu.querySelectorAll('.custom-sort-item').forEach(btn => {
                btn.addEventListener('click', (e) => {
                  e.stopPropagation();
                  const val = btn.getAttribute('data-val') || 'default';
                  const text = btn.textContent.trim().replace(/^[^a-zA-Z0-9]+/, '').trim();
                  updateLockerSort(val, text);
                  customSortDropdown.classList.remove('is-open');
                  customSortTrigger.setAttribute('aria-expanded', 'false');
                });
              });
            }

            if (typeof window !== 'undefined' && window.addEventListener) {
              window.addEventListener('click', (e) => {
                if (customSortDropdown && !customSortDropdown.contains(e.target)) {
                  customSortDropdown.classList.remove('is-open');
                  customSortTrigger.setAttribute('aria-expanded', 'false');
                }
              });
            }
          }

          if (lockerSortSelect) {
            lockerSortSelect.addEventListener('change', (e) => {
              const selectedOption = lockerSortSelect.options[lockerSortSelect.selectedIndex];
              updateLockerSort(e.target.value, selectedOption ? selectedOption.textContent : '');
            });
          }

          // Settings Controls: Graphics Quality Segmented Buttons
          document.querySelectorAll('#setting-gfx-segmented .setting-seg-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const gfx = btn.getAttribute('data-gfx') || 'high';
              this.applyGraphicsQuality(gfx);
            });
          });

          // Settings Controls: Theme Segmented Buttons
          document.querySelectorAll('#setting-theme-segmented .setting-seg-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const thm = btn.getAttribute('data-thm') || 'dark';
              this.applyTheme(thm);
            });
          });

          // Settings Controls: Volume Slider
          const volSlider = document.getElementById('setting-vol-slider');
          if (volSlider) {
            volSlider.addEventListener('input', (e) => {
              this.applyAudioVolume(Number(e.target.value) / 100);
            });
          }

          // Settings Controls: Screen Shake
          document.querySelectorAll('#setting-shake-segmented .setting-seg-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.settings.screenShake = btn.getAttribute('data-shake') || 'full';
              this.saveSettings();
              document.querySelectorAll('#setting-shake-segmented .setting-seg-btn').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
            });
          });

          // Settings Controls: Ambient Particles Checkbox
          const cbPart = document.getElementById('setting-particles');
          if (cbPart) {
            cbPart.addEventListener('change', (e) => {
              this.settings.particles = e.target.checked;
              this.saveSettings();
            });
          }

          // Settings Controls: Camera Tilt Checkbox
          const cbTilt = document.getElementById('setting-cam-tilt');
          if (cbTilt) {
            cbTilt.addEventListener('change', (e) => {
              this.settings.cameraTilt = e.target.checked;
              this.saveSettings();
            });
          }

          // Settings Controls: Show FPS Checkbox
          const cbFps = document.getElementById('setting-show-fps');
          if (cbFps) {
            cbFps.addEventListener('change', (e) => {
              this.settings.showFPS = e.target.checked;
              this.saveSettings();
              const fpsBadge = document.getElementById('header-fps-badge');
              if (fpsBadge) fpsBadge.style.display = e.target.checked ? 'inline-block' : 'none';
            });
          }

          // Settings Controls: Show 0.60m Hitbox Ring Checkbox
          const cbHitbox = document.getElementById('setting-show-hitbox');
          if (cbHitbox) {
            cbHitbox.addEventListener('change', (e) => {
              this.settings.showHitbox = e.target.checked;
              this.saveSettings();
              if (this.hitboxRingMesh) {
                this.hitboxRingMesh.visible = Boolean(e.target.checked);
              }
            });
          }

          // Settings Controls: Reset to Defaults
          const btnResetSettings = document.getElementById('btn-settings-reset');
          if (btnResetSettings) {
            btnResetSettings.addEventListener('click', (e) => {
              e.stopPropagation();
              localStorage.removeItem('flappy3d_settings');
              this.initSettings();
            });
          }

          // Locker Sub-Tabs (Bird Skins vs Pipe Skins vs Background Skins)
          const tabBirds = document.getElementById('tab-btn-bird-skins');
          const tabPipes = document.getElementById('tab-btn-pipe-skins');
          const tabBgs = document.getElementById('tab-btn-bg-skins');
          const viewBirds = document.getElementById('panel-view-bird-skins');
          const viewPipes = document.getElementById('panel-view-pipe-skins');
          const viewBgs = document.getElementById('panel-view-bg-skins');
          const spotBirds = document.getElementById('bird-skin-spotlight');
          const spotPipes = document.getElementById('pipe-skin-spotlight');
          const spotBgs = document.getElementById('bg-skin-spotlight');

          const switchLockerTab = (tab) => {
            this.currentLockerTab = tab;
            if (tabBirds) tabBirds.classList.toggle('active', tab === 'birds');
            if (tabPipes) tabPipes.classList.toggle('active', tab === 'pipes');
            if (tabBgs) tabBgs.classList.toggle('active', tab === 'bg');
            if (viewBirds) viewBirds.style.display = tab === 'birds' ? 'flex' : 'none';
            if (viewPipes) viewPipes.style.display = tab === 'pipes' ? 'flex' : 'none';
            if (viewBgs) viewBgs.style.display = tab === 'bg' ? 'flex' : 'none';
            if (spotBirds) spotBirds.style.display = tab === 'birds' ? 'flex' : 'none';
            if (spotPipes) spotPipes.style.display = tab === 'pipes' ? 'flex' : 'none';
            if (spotBgs) spotBgs.style.display = tab === 'bg' ? 'flex' : 'none';
            if (tab === 'birds') this.renderBirdSkinsGrid();
            if (tab === 'pipes') {
              if (this.pipes.length === 0 && typeof this.spawnLobbyPreviewPipes === 'function') {
                this.spawnLobbyPreviewPipes();
              }
              this.renderPipeSkinsGrid();
            }
            if (tab === 'bg' && typeof this.renderBgSkinsGrid === 'function') {
              this.renderBgSkinsGrid();
            }
          };
          this.switchLockerTabFn = switchLockerTab;

          if (tabBirds) tabBirds.addEventListener('click', () => switchLockerTab('birds'));
          if (tabPipes) tabPipes.addEventListener('click', () => switchLockerTab('pipes'));
          if (tabBgs) tabBgs.addEventListener('click', () => switchLockerTab('bg'));

          const switchRightPanel = (mode) => {
            if (mode === 'lb') this.switchView('leaderboard');
            else if (mode === 'stats') this.switchView('stats');
            else if (mode === 'birds') {
              this.switchView('skins');
              switchLockerTab('birds');
            } else if (mode === 'pipes') {
              this.switchView('skins');
              switchLockerTab('pipes');
            } else if (mode === 'bg') {
              this.switchView('skins');
              switchLockerTab('bg');
            }
          };
          this.switchRightPanelFn = switchRightPanel;

          const profileEqBgCard = document.getElementById('profile-equipped-bg-card');
          if (profileEqBgCard) {
            profileEqBgCard.addEventListener('click', () => switchRightPanel('bg'));
          }

          const openStatsBtn = document.getElementById('open-stats-btn');
          if (openStatsBtn) {
            openStatsBtn.addEventListener('click', () => switchRightPanel('stats'));
          }

          // Stats Menu Sub-Filter Tabs (All Modes | Easy | Medium | Hard | Records | Collection | Unlocks)
          document.querySelectorAll('#stats-subfilter-bar .stats-subfilter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              this.statsSubfilter = btn.getAttribute('data-mode') || btn.getAttribute('data-sfilter') || 'all';
              document.querySelectorAll('#stats-subfilter-bar .stats-subfilter-btn').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              this.renderStatsMenu();
            });
          });

          document.getElementById('open-bird-skins-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            switchRightPanel('birds');
          });
          document.getElementById('open-pipe-skins-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            switchRightPanel('pipes');
          });

          const loadoutCardBird = document.getElementById('loadout-card-bird');
          if (loadoutCardBird) {
            loadoutCardBird.addEventListener('click', () => switchRightPanel('birds'));
          }
          const loadoutCardPipe = document.getElementById('loadout-card-pipe');
          if (loadoutCardPipe) {
            loadoutCardPipe.addEventListener('click', () => switchRightPanel('pipes'));
          }

          // Clickable Next-Unlock Goal cards (Jump to locker & preview in 3D!)
          const nextBirdGoalEl = document.getElementById('next-bird-goal');
          if (nextBirdGoalEl) {
            nextBirdGoalEl.addEventListener('click', () => {
              if (this.nextGoalBirdSkin) {
                this.previewSkinId = this.nextGoalBirdSkin.id;
                this.applySkinVisualsOnly(this.nextGoalBirdSkin);
                this.updatePreviewBanner();
              }
              switchRightPanel('birds');
            });
          }
          const nextPipeGoalEl = document.getElementById('next-pipe-goal');
          if (nextPipeGoalEl) {
            nextPipeGoalEl.addEventListener('click', () => {
              if (this.nextGoalPipeSkin) {
                this.previewPipeSkinId = this.nextGoalPipeSkin.id;
                this.applyPipeSkinVisualsOnly(this.nextGoalPipeSkin);
                this.updatePreviewBanner();
              }
              switchRightPanel('pipes');
            });
          }

          // Reset 3D Preview button inside Preview Banner
          const previewResetBtn = document.getElementById('preview-reset-btn');
          if (previewResetBtn) {
            previewResetBtn.addEventListener('click', () => {
              if (this.previewSkinId) {
                this.previewSkinId = null;
                this.applySkin(this.selectedSkinId, false);
              }
              if (this.previewPipeSkinId) {
                this.previewPipeSkinId = null;
                this.applyPipeSkin(this.selectedPipeSkinId, false);
              }
              if (this.previewBgSkinId) {
                this.previewBgSkinId = null;
                if (typeof this.applyBackgroundSkin === 'function') {
                  this.applyBackgroundSkin(this.selectedBackgroundId || 'bg_classic', false);
                }
              }
              this.updatePreviewBanner();
              this.renderBirdSkinsGrid();
              this.renderPipeSkinsGrid();
              if (typeof this.renderBgSkinsGrid === 'function') this.renderBgSkinsGrid();
            });
          }

          // Ownership & Mode Filter Tabs (All | Owned | Locked | Pokémon | Easy | Medium | Hard | Meme)
          document.querySelectorAll('#bird-filter-bar .locker-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              this.birdLockerFilter = btn.getAttribute('data-filter') || 'all';
              document.querySelectorAll('#bird-filter-bar .locker-filter-btn').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              this.renderBirdSkinsGrid();
            });
          });

          document.querySelectorAll('#pipe-filter-bar .locker-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              this.pipeLockerFilter = btn.getAttribute('data-filter') || 'all';
              document.querySelectorAll('#pipe-filter-bar .locker-filter-btn').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              this.renderPipeSkinsGrid();
            });
          });

          document.querySelectorAll('#bg-filter-bar .locker-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              this.bgLockerFilter = btn.getAttribute('data-filter') || 'all';
              document.querySelectorAll('#bg-filter-bar .locker-filter-btn').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              if (typeof this.renderBgSkinsGrid === 'function') this.renderBgSkinsGrid();
            });
          });

          // Auth buttons
          document.getElementById('btn-login').addEventListener('click', () => this.handleAuth('login'));
          document.getElementById('btn-register').addEventListener('click', () => this.handleAuth('register'));
          document.getElementById('hud-logout-btn').addEventListener('click', () => this.handleLogout());

          // Difficulty selector buttons
          document.querySelectorAll('#difficulty-selector .diff-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const diff = btn.getAttribute('data-diff');
              if (!CONFIG.difficulties[diff]) return;
              if (diff === 'extreme' && !this.hasUnlockedExtremeMode()) {
                this.showExtremeLockNotice();
                return;
              }
              this.selectedDifficulty = diff;
              document.querySelectorAll('#difficulty-selector .diff-btn').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');

              this.setLeaderboardTab(diff);
              this.updateNextUnlockTracker();
              this.updateHUD();
              if (this.sound) this.sound.playFlap();
              this.prefetchRunSession(diff);
            });
          });

          // Leaderboard difficulty tab buttons & live search bar
          document.querySelectorAll('#lb-tabs .lb-tab').forEach(tabBtn => {
            tabBtn.addEventListener('click', () => {
              this.setLeaderboardTab(tabBtn.getAttribute('data-tab'));
            });
          });

          // Leaderboard timeframe tab buttons (Daily / Weekly / All Time)
          document.querySelectorAll('.lb-timeframe-tab').forEach(tabBtn => {
            tabBtn.addEventListener('click', () => {
              this.setTimeframeTab(tabBtn.getAttribute('data-timeframe'));
            });
          });

          // Game Over screen timeframe buttons
          document.querySelectorAll('.gameover-timeframe-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              this.setTimeframeTab(btn.getAttribute('data-timeframe'));
            });
          });

          const lbSearchInput = document.getElementById('lb-search-input');
          if (lbSearchInput) {
            lbSearchInput.addEventListener('input', (e) => {
              this.lbSearchQuery = (e.target.value || '').trim().toLowerCase();
              this.renderLeaderboard();
            });
          }

          const lbUniqueToggleBtn = document.getElementById('btn-toggle-lb-unique');
          if (lbUniqueToggleBtn) {
            lbUniqueToggleBtn.addEventListener('click', () => {
              this.toggleLeaderboardUniqueRecords();
            });
          }

          window.addEventListener('resize', () => {
            const width = window.innerWidth;
            const height = window.innerHeight;
            const aspect = width / height;
            this.camera.aspect = aspect;
            this.camera.updateProjectionMatrix();
            this.adjustCameraForAspect(aspect);
            this.renderer.setSize(width, height);
            if (this.scene && this.scene.background && this.scene.background.isTexture && typeof this.applyCoverAspectToBgTexture === 'function') {
              this.applyCoverAspectToBgTexture(this.scene.background);
            }
          });
        }

        getEffectiveRecords() {
          return (this.currentUser && this.currentUser.records) ? this.currentUser.records : (this.localRecords || {});
        }

        getExtremeUnlockProgress() {
          const rec = this.getEffectiveRecords();
          const easy = Number(rec.easy) || 0;
          const medium = Number(rec.medium) || 0;
          const hard = Number(rec.hard) || 0;
          return {
            easy,
            medium,
            hard,
            unlocked: easy >= 100 && medium >= 40 && hard >= 25
          };
        }

        hasUnlockedExtremeMode() {
          return this.getExtremeUnlockProgress().unlocked;
        }

        showExtremeLockNotice() {
          const p = this.getExtremeUnlockProgress();
          const msg = `⚡ Extreme Mode Locked! Reach 100 Easy (${p.easy}/100), 40 Medium (${p.medium}/40) & 25 Hard (${p.hard}/25).`;
          if (typeof this.showLockerToast === 'function') {
            this.showLockerToast(msg, true);
          }
        }

        setLeaderboardTab(tabKey) {
          if (!CONFIG.difficulties[tabKey]) return;
          this.activeLbTab = tabKey;
          document.querySelectorAll('#lb-tabs .lb-tab').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-tab') === tabKey);
          });
          this.renderLeaderboard();
        }

        setTimeframeTab(timeframeKey) {
          if (timeframeKey !== 'all' && timeframeKey !== 'weekly' && timeframeKey !== 'daily') return;
          this.activeTimeframeTab = timeframeKey;
          document.querySelectorAll('.lb-timeframe-tab').forEach(b => {
            const isMatch = b.getAttribute('data-timeframe') === timeframeKey;
            b.classList.toggle('active', isMatch);
            b.setAttribute('aria-selected', isMatch ? 'true' : 'false');
          });
          document.querySelectorAll('.gameover-timeframe-btn').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-timeframe') === timeframeKey);
          });
          this.updateResetTimerUI();
          this.renderLeaderboard();
        }

        initResetCountdownTimer() {
          if (this._countdownTimer) clearInterval(this._countdownTimer);
          this.updateResetTimerUI();
          this._countdownTimer = setInterval(() => {
            this.updateResetTimerUI();
          }, 1000);
        }

        toggleLeaderboardUniqueRecords() {
          this.lbUniqueRecordsOnly = !this.lbUniqueRecordsOnly;
          this.updateLeaderboardUniqueToggleUI();
          this.renderLeaderboard();
        }

        updateLeaderboardUniqueToggleUI() {
          const btn = document.getElementById('btn-toggle-lb-unique');
          const pill = document.getElementById('lb-unique-pill');
          if (btn) {
            btn.classList.toggle('active', Boolean(this.lbUniqueRecordsOnly));
            btn.setAttribute('aria-pressed', this.lbUniqueRecordsOnly ? 'true' : 'false');
          }
          if (pill) {
            pill.textContent = this.lbUniqueRecordsOnly ? 'ON' : 'OFF';
          }
        }

        showLobbyScreen() {
          document.body.classList.remove('in-game');
          document.getElementById('gameover-screen').classList.remove('active');
          document.getElementById('start-screen').classList.add('active');
          const topBarEl = document.getElementById('top-app-bar');
          if (topBarEl) {
            topBarEl.classList.remove('in-game');
            if (topBarEl.style) {
              if (typeof topBarEl.style.removeProperty === 'function') topBarEl.style.removeProperty('display');
              else topBarEl.style.display = '';
            }
          }
          if (this.chat && typeof this.chat.onRoundEnd === 'function') {
            this.chat.onRoundEnd();
          }
          this.switchView('lobby');
          this.state = GAME_STATE.START;
          this.spawnLobbyPreviewPipes();
          this.simBirdY = CONFIG.birdStartY;
          this.prevBirdY = CONFIG.birdStartY;
          this.birdGroup.position.set(CONFIG.birdX, CONFIG.birdStartY, 0);
          this.birdGroup.rotation.set(0, 0, 0);
          this.birdMeshGroup.rotation.set(0, 0, 0);
          if (this.currentAppView === 'skins') {
            this.renderAllCosmeticGrids();
          }
          this.fetchLeaderboards();
          this.prefetchRunSession(this.selectedDifficulty);
        }

        prefetchRunSession(difficulty = this.selectedDifficulty) {
          if (!this.currentUser || !this.authToken) return;
          const diffKey = CONFIG.difficulties[difficulty] ? difficulty : 'medium';
          if (diffKey === 'extreme' && !this.hasUnlockedExtremeMode()) return;

          if (this.prefetchedRun &&
              this.prefetchedRun.difficulty === diffKey &&
              (Date.now() - this.prefetchedRun.fetchedAt < 10 * 60 * 1000)) {
            return;
          }

          if (this.prefetchPromise && this.prefetchingDifficulty === diffKey) {
            return;
          }

          this.prefetchingDifficulty = diffKey;
          this.prefetchPromise = this.apiRequest('/api/run/start', 'POST', { difficulty: diffKey })
            .then(data => {
              if (data && data.runId) {
                this.prefetchedRun = {
                  difficulty: diffKey,
                  runId: data.runId,
                  seed: data.seed,
                  fetchedAt: Date.now()
                };
              }
              this.prefetchPromise = null;
              this.prefetchingDifficulty = null;
              return this.prefetchedRun;
            })
            .catch(() => {
              this.prefetchPromise = null;
              this.prefetchingDifficulty = null;
            });
        }

        startGame() {
          if (this.isAccountBanned || this.state === GAME_STATE.PLAYING || this.isStartingRun) return;
          if ((this.selectedDifficulty || 'medium') === 'extreme' && !this.hasUnlockedExtremeMode()) {
            this.showExtremeLockNotice();
            return;
          }
          this.isStartingRun = true;
          document.body.classList.add('in-game');
          const topBarEl2 = document.getElementById('top-app-bar');
          if (topBarEl2) {
            topBarEl2.classList.add('in-game');
            topBarEl2.style.setProperty('display', 'none', 'important');
          }
          const pModalEl = document.getElementById('profile-modal');
          if (pModalEl) pModalEl.classList.remove('active');
          if (this.chat && typeof this.chat.onRoundStart === 'function') {
            this.chat.onRoundStart();
          }

          // If the player was previewing a locked skin/pipe/background in the lobby, revert to their equipped unlocked cosmetic!
          if (this.previewSkinId) {
            this.previewSkinId = null;
            this.applySkin(this.selectedSkinId, false);
          }
          if (this.previewPipeSkinId) {
            this.previewPipeSkinId = null;
            this.applyPipeSkin(this.selectedPipeSkinId, false);
          }
          if (this.previewBgSkinId) {
            this.previewBgSkinId = null;
            if (typeof this.applyBackgroundSkin === 'function') {
              this.applyBackgroundSkin(this.selectedBackgroundId || 'bg_classic', false);
            }
          }
          this.updatePreviewBanner();

          const targetDifficulty = this.selectedDifficulty || 'medium';
          this.activeRunId = null;
          this.activeRunPromise = null;

          if (this.currentUser && this.authToken) {
            // 1. Consume instant pre-fetched token if available (0ms delay)
            if (this.prefetchedRun &&
                this.prefetchedRun.difficulty === targetDifficulty &&
                (Date.now() - this.prefetchedRun.fetchedAt < 10 * 60 * 1000)) {
              this.activeRunId = this.prefetchedRun.runId;
              this.activeSeed = this.prefetchedRun.seed;
              this.prefetchedRun = null;
            } else {
              // 2. Generate local seed so gameplay starts INSTANTLY with 0ms network latency!
              this.activeSeed = (Math.floor(Math.random() * 0x7fffffff)) | 1;
              const seedToSend = this.activeSeed;
              this.activeRunPromise = this.apiRequest('/api/run/start', 'POST', {
                difficulty: targetDifficulty,
                seed: seedToSend
              }).then(runData => {
                if (runData && runData.runId) {
                  this.activeRunId = runData.runId;
                }
                return runData;
              }).catch(err => {
                if (err && String(err.message).toLowerCase().includes('log in')) {
                  this.clearLoggedInUser();
                }
                this.activeRunId = null;
              });
            }

            // Schedule background prefetch for subsequent runs
            setTimeout(() => {
              this.prefetchRunSession(this.selectedDifficulty);
            }, 120);
          } else {
            this.activeSeed = (Math.floor(Math.random() * 0x7fffffff)) | 1;
          }

          if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
          }
          if (typeof window.focus === 'function') {
            window.focus();
          }

          this.prng = createSeededPRNG(this.activeSeed);
          this.extremeSolver = (targetDifficulty === 'extreme' && typeof createExtremePipeSolver === 'function')
            ? createExtremePipeSolver(this.activeSeed, CONFIG)
            : null;
          this.lastExtremeFrameTime = 0;
          this.currentTick = 0;
          this.flapTicks = [];
          this.pendingFlap = false;
          this.queuedFlaps = 0;
          this.flapBufferTicks = 0;
          this.lastFlapTick = -2;
          this.lastQueueFlapTime = -1000;
          this.lastKbdQueueTime = -1000;
          this.lastPtrQueueTime = -1000;
          this.lastQueueSource = '';
          this.physicsAccumulator = 0;

          // Reset any lingering particles from prior crash/score
          if (this.particlePool) {
            for (let i = 0; i < this.particlePool.length; i++) {
              this.particlePool[i].active = false;
              this.particlePool[i].mesh.visible = false;
            }
          }

          document.getElementById('start-screen').classList.remove('active');
          document.getElementById('gameover-screen').classList.remove('active');

          this.state = GAME_STATE.PLAYING;
          this.isStartingRun = false;
          this.score = 0;
          this.distanceSinceLastPipe = 0;
          this.updateHUD();

          this.clearPipes();
          if (targetDifficulty === 'extreme') {
            const extCfg = CONFIG.difficulties.extreme;
            const firstX = CONFIG.birdX + extCfg.firstPipeDist;
            for (let pIdx = 0; pIdx < 4; pIdx++) {
              this.spawnPipePair(firstX + pIdx * extCfg.spawnDistance);
            }
          } else {
            const firstNormalX = CONFIG.birdX + CONFIG.baseSpawnDistance;
            this.spawnPipePair(firstNormalX);
            this.spawnPipePair(firstNormalX + CONFIG.baseSpawnDistance);
            this.spawnPipePair(firstNormalX + CONFIG.baseSpawnDistance * 2);
          }

          this.simBirdY = CONFIG.birdStartY;
          this.prevBirdY = CONFIG.birdStartY;
          this.birdGroup.position.set(CONFIG.birdX, CONFIG.birdStartY, 0);
          this.birdGroup.rotation.set(0, 0, 0);
          this.birdMeshGroup.rotation.set(0, 0, 0);

          this.birdVelocityY = this.getDifficultyParams().flapImpulse;
          this.wingFlapBoost = 1.0;
          this.pendingFlap = false;
          this.queuedFlaps = 0;
          this.flapBufferTicks = 0;
          this.lastQueueFlapTime = -1000;
          this.lastKbdQueueTime = -1000;
          this.lastPtrQueueTime = -1000;
          this.lastQueueSource = '';
          if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
          }
          this.physicsAccumulator = 0;
          this.lastFrameTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          this.sound.playFlap();
        }

        queueFlap(source = 'auto') {
          if (this.state !== GAME_STATE.PLAYING) return;
          const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          const lastAny = this.lastQueueFlapTime || 0;
          const isSameSource = source !== 'auto' && this.lastQueueSource === source;
          const lastChanTime = source === 'kbd' ? (this.lastKbdQueueTime || 0) : (source === 'ptr' ? (this.lastPtrQueueTime || 0) : lastAny);

          // Prevent switch bounce (<18ms same channel) or accidental simultaneous Space+Click overlap (<24ms cross-channel),
          // while allowing a second intentional rapid tap (>=32ms later) to buffer without being dropped.
          if (isSameSource && (now - lastChanTime < 18)) {
            return;
          }
          if (!isSameSource && (now - lastAny < 24)) {
            return;
          }

          const elapsedSinceLastQueue = now - lastAny;
          this.lastQueueFlapTime = now;
          this.lastQueueSource = source;
          if (source === 'kbd') this.lastKbdQueueTime = now;
          else if (source === 'ptr') this.lastPtrQueueTime = now;

          this.pendingFlap = true;
          this.queuedFlaps = (elapsedSinceLastQueue >= 32 && (this.queuedFlaps || 0) >= 1)
            ? Math.min(2, this.queuedFlaps + 1)
            : 1;
          this.flapBufferTicks = 12;
          this.wingFlapBoost = 1.0;
        }

        async triggerGameOver() {
          if (this.state === GAME_STATE.CRASHING || this.state === GAME_STATE.GAMEOVER) return;

          if (this.activeDuelLobbyId && this.activeDuelLobby && this.duelRoundPlaying) {
            this.handleDuelRoundCrash();
            return;
          }

          const unlockedBefore = this.getUnlockedBirdSkinCount() + this.getUnlockedPipeSkinCount();

          this.state = GAME_STATE.CRASHING;
          this.sound.playCollision();
          this.shakeTimer = 0.30;

          // Start pre-fetching the NEXT run token immediately on crash so it's ready when player clicks "Play Again"!
          this.prefetchRunSession(this.selectedDifficulty);

          const flash = document.getElementById('damage-flash');
          flash.style.opacity = '0.72';
          setTimeout(() => { flash.style.opacity = '0'; }, 90);

          this.extremeSolver = null;
          this.spawnCrashParticles(this.birdGroup.position.x, this.birdGroup.position.y);

          const diffKey = this.selectedDifficulty;
          const diffLabel = CONFIG.difficulties[diffKey].label;
          const finalTicks = this.currentTick;
          const recordedFlaps = this.flapTicks.slice();
          const achievedScore = this.score;
          const runFlaps = recordedFlaps.length + 1;

          // Update Lifetime & Per-Gamemode Career Flight Telemetry
          this.careerStats.totalRuns += 1;
          this.careerStats.totalScore += achievedScore;
          this.careerStats.totalFlaps += runFlaps;
          this.careerStats.lastScore = achievedScore;
          this.careerStats.lastMode = diffKey;

          if (!this.careerStats.modes) {
            this.careerStats.modes = {
              easy: { runs: 0, totalScore: 0, totalFlaps: 0, lastScore: 0 },
              medium: { runs: 0, totalScore: 0, totalFlaps: 0, lastScore: 0 },
              hard: { runs: 0, totalScore: 0, totalFlaps: 0, lastScore: 0 },
              extreme: { runs: 0, totalScore: 0, totalFlaps: 0, lastScore: 0 }
            };
          }
          if (!this.careerStats.modes[diffKey]) {
            this.careerStats.modes[diffKey] = { runs: 0, totalScore: 0, totalFlaps: 0, lastScore: 0 };
          }
          this.careerStats.modes[diffKey].runs += 1;
          this.careerStats.modes[diffKey].totalScore += achievedScore;
          this.careerStats.modes[diffKey].totalFlaps += runFlaps;
          this.careerStats.modes[diffKey].lastScore = achievedScore;

          this.saveCareerStats();

          // Update all Meme Quests & Pokémon Quests
          this.recordTrollQuestRun(achievedScore, diffKey, recordedFlaps.length);

          let isNewRecord = false;
          if (achievedScore > (this.localRecords[diffKey] || 0)) {
            this.localRecords[diffKey] = achievedScore;
            this.saveLocalRecords();
            isNewRecord = true;
          }

          document.getElementById('final-score').textContent = String(achievedScore);
          document.getElementById('gameover-best-label').textContent = `Best (${diffLabel})`;
          document.getElementById('best-score').textContent = String(this.getBestForDifficulty(diffKey));

          const statusPill = document.getElementById('anticheat-status-pill');
          const badge = document.getElementById('new-record-badge');
          badge.classList.toggle('visible', isNewRecord && achievedScore > 0);

          // If activeRunPromise was still in-flight, await it here before finishing the run
          if (this.activeRunPromise && !this.activeRunId) {
            try {
              await this.activeRunPromise;
            } catch (_) {}
          }
          this.activeRunPromise = null;

          if (this.activeRunId && this.currentUser) {
            statusPill.className = 'anticheat-status';
            statusPill.textContent = '🛡️ Verifying run replay with server anti-cheat...';

            try {
              const verifyRes = await this.apiRequest('/api/run/finish', 'POST', {
                runId: this.activeRunId,
                flapTicks: recordedFlaps,
                totalTicks: finalTicks,
                claimedScore: achievedScore
              });

              this.currentUser.records = verifyRes.records;
              if (verifyRes.records) {
                this.localRecords = {
                  easy: Number(verifyRes.records.easy) || 0,
                  medium: Number(verifyRes.records.medium) || 0,
                  hard: Number(verifyRes.records.hard) || 0,
                  extreme: Number(verifyRes.records.extreme) || 0
                };
                this.saveLocalRecords();
              }
              if (typeof this.updateProfileRecordPills === 'function') {
                this.updateProfileRecordPills();
              }
              this.leaderboards = verifyRes.leaderboards || this.leaderboards;
              if (verifyRes.timeframeLeaderboards) {
                this.timeframeLeaderboards = verifyRes.timeframeLeaderboards;
              }
              if (verifyRes.resetBoundaries) {
                this.resetBoundaries = verifyRes.resetBoundaries;
                if (typeof verifyRes.resetBoundaries.serverTime === 'number') {
                  this.clientServerTimeOffset = verifyRes.resetBoundaries.serverTime - Date.now();
                }
              }
              if (typeof this.updateResetTimerUI === 'function') {
                this.updateResetTimerUI();
              }
              if (this.currentAppView === 'skins') {
                this.renderAllCosmeticGrids();
              }
              this.renderLeaderboard(verifyRes.entryId || null);

              document.getElementById('final-score').textContent = String(verifyRes.verifiedScore);
              document.getElementById('best-score').textContent = String(this.getBestForDifficulty(diffKey));
              badge.classList.toggle('visible', Boolean(verifyRes.isNewRecord && verifyRes.verifiedScore > 0));

              statusPill.className = 'anticheat-status verified';
              if (verifyRes.autoHidden) {
                statusPill.textContent = `🛡️ Verified (${finalTicks} ticks) • 🕒 Weekend / Off-Hours — Saved & Hidden from Leaderboard`;
              } else if (verifyRes.timeframePlacements) {
                const p = verifyRes.timeframePlacements;
                statusPill.textContent = `🛡️ Verified (${finalTicks} ticks) • #${p.daily} Daily · #${p.weekly} Weekly · #${p.all} All-Time!`;
              } else {
                statusPill.textContent = `🛡️ Anti-Cheat Verified (${finalTicks} ticks) • Added to ${diffLabel} Leaderboard!`;
              }
            } catch (err) {
              statusPill.className = 'anticheat-status rejected';
              statusPill.textContent = `⚠️ ${err.message}`;
              this.fetchLeaderboards();
            }
          } else {
            if (this.currentAppView === 'skins') {
              this.renderAllCosmeticGrids();
            }
            statusPill.className = 'anticheat-status';
            statusPill.textContent = 'ℹ️ Guest Run — Log in on the Start screen to rank on the Online Leaderboard!';
            this.fetchLeaderboards();
          }

          const unlockedAfter = this.getUnlockedBirdSkinCount() + this.getUnlockedPipeSkinCount();
          const unlockToast = document.getElementById('unlock-toast');
          if (unlockedAfter > unlockedBefore) {
            unlockToast.classList.add('visible');
          } else {
            unlockToast.classList.remove('visible');
          }

          setTimeout(() => {
            if (this.activeDuelLobbyId && this.activeDuelLobby && this.activeDuelLobby.status !== 'waiting') {
              return;
            }
            this.state = GAME_STATE.GAMEOVER;
            document.body.classList.remove('in-game');
            if (this.chat && typeof this.chat.onRoundEnd === 'function') {
              this.chat.onRoundEnd();
            }
            const topBarEl = document.getElementById('top-app-bar');
            if (topBarEl) {
              topBarEl.classList.remove('in-game');
              if (topBarEl.style) {
                if (typeof topBarEl.style.removeProperty === 'function') topBarEl.style.removeProperty('display');
                else topBarEl.style.display = '';
              }
            }
            document.getElementById('gameover-screen').classList.add('active');
          }, 380);
        }

        updateHUD(pop = false) {
          if (!this.cachedHud) {
            this.cachedHud = {
              scoreEl: document.getElementById('hud-score'),
              speedEl: document.getElementById('speed-mult-text'),
              modeEl: document.getElementById('hud-mode-text')
            };
          }
          const { scoreEl, speedEl, modeEl } = this.cachedHud;

          if (scoreEl) scoreEl.textContent = String(this.score);
          const diff = this.getDifficultyParams();
          if (speedEl) speedEl.textContent = `${diff.speedMult}x`;
          if (modeEl) modeEl.textContent = diff.label.toUpperCase();

          if (pop && scoreEl) {
            scoreEl.classList.remove('score-pop');
            requestAnimationFrame(() => {
              scoreEl.classList.add('score-pop');
              if (this.hudPopTimeout) clearTimeout(this.hudPopTimeout);
              this.hudPopTimeout = setTimeout(() => scoreEl.classList.remove('score-pop'), 180);
            });
          }
        }

        clearPipes() {
          if (!this.pipePool) this.pipePool = [];
          for (const pipe of this.pipes) {
            if (pipe && pipe.group) {
              this.scene.remove(pipe.group);
              if (this.pipePool.length < 12) {
                this.pipePool.push(pipe.group);
              }
            }
          }
          this.pipes.length = 0;
        }

        checkCollisions() {
          const bx = CONFIG.birdX;
          const by = this.simBirdY;
          const r = CONFIG.birdRadius;

          if (by - r <= CONFIG.groundY) {
            this.simBirdY = CONFIG.groundY + r;
            return true;
          }

          const capReachX = CONFIG.pipeCapRadius + r - 0.08;
          const shaftReachX = CONFIG.pipeRadius + r - 0.08;

          for (const pipe of this.pipes) {
            const dx = Math.abs(bx - pipe.x);
            if (dx > capReachX) continue;

            const hitBottom = (by - r * 0.85) < pipe.bottomTopY;
            const hitTop = (by + r * 0.85) > pipe.topBottomY;

            if (hitBottom || hitTop) {
              const nearBottomCap = by >= (pipe.bottomTopY - CONFIG.pipeCapHeight - r);
              const nearTopCap = by <= (pipe.topBottomY + CONFIG.pipeCapHeight + r);

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

        // ------------------------------------------------------------------------
        // FIXED 60HZ DETERMINISTIC SIMULATION STEP (MATCHES SERVER.JS 100%)
        // ------------------------------------------------------------------------
        stepPlayingPhysics() {
          this.currentTick += 1;
          const dt = CONFIG.dt;
          const { speed: scrollSpeed, gravity, flapImpulse, maxFallSpeed, spawnDistance } = this.getDifficultyParams();

          // Store previous tick coordinates for smooth sub-tick visual interpolation
          this.prevBirdY = this.simBirdY;
          for (let i = 0; i < this.pipes.length; i++) {
            this.pipes[i].prevX = this.pipes[i].x;
          }

          // Bulletproof non-dropping jump execution: checks if jump is queued and valid against anti-cheat rate limit (>= 2 ticks)
          if (this.queuedFlaps > 0 || this.pendingFlap) {
            if ((this.currentTick - this.lastFlapTick) >= 2) {
              this.birdVelocityY = flapImpulse;
              this.wingFlapBoost = 1.0;
              this.flapTicks.push(this.currentTick);
              this.lastFlapTick = this.currentTick;
              if (this.sound) this.sound.playFlap();
              if (this.queuedFlaps > 0) {
                this.queuedFlaps--;
              }
              this.pendingFlap = (this.queuedFlaps > 0);
              this.flapBufferTicks = (this.queuedFlaps > 0) ? 20 : 0;
            } else {
              // Only 1 tick elapsed since last flap (tick T+1). Retain queued jump for tick T+2!
              if (this.flapBufferTicks > 0) {
                this.flapBufferTicks--;
              }
              if (this.flapBufferTicks <= 0) {
                this.pendingFlap = false;
                this.queuedFlaps = 0;
              }
            }
          }

          this.birdVelocityY += gravity * dt;
          if (this.birdVelocityY < maxFallSpeed) {
            this.birdVelocityY = maxFallSpeed;
          }

          this.simBirdY += this.birdVelocityY * dt;

          if (this.simBirdY > CONFIG.ceilingY) {
            this.simBirdY = CONFIG.ceilingY;
            if (this.birdVelocityY > 0) this.birdVelocityY = 0;
          }

          for (let i = this.pipes.length - 1; i >= 0; i--) {
            const pipe = this.pipes[i];
            pipe.x -= scrollSpeed * dt;

            if (!pipe.passed && pipe.x < CONFIG.birdX) {
              pipe.passed = true;
              this.score += 1;
              this.sound.playScore();
              this.updateHUD(true);
              this.spawnScoreParticles(CONFIG.birdX + 0.4, this.simBirdY);
            }

            if (pipe.x < CONFIG.pipeDespawnX) {
              this.scene.remove(pipe.group);
              if (!this.pipePool) this.pipePool = [];
              if (this.pipePool.length < 12) {
                this.pipePool.push(pipe.group);
              }
              this.pipes.splice(i, 1);
            }
          }

          const isExtremeRun = (this.selectedDifficulty === 'extreme');
          const activeSpawnDist = isExtremeRun
            ? (spawnDistance || CONFIG.difficulties.extreme.spawnDistance)
            : CONFIG.baseSpawnDistance;
          const spawnTriggerX = (isExtremeRun
            ? CONFIG.difficulties.extreme.initialPipeSpawnX
            : CONFIG.pipeSpawnX) - activeSpawnDist;
          while (this.pipes.length === 0 || this.pipes[this.pipes.length - 1].x <= spawnTriggerX + 1e-9) {
            const nextX = this.pipes.length > 0
              ? (this.pipes[this.pipes.length - 1].x + activeSpawnDist)
              : (isExtremeRun ? CONFIG.difficulties.extreme.initialPipeSpawnX : CONFIG.pipeSpawnX);
            this.spawnPipePair(nextX);
          }

          if (this.checkCollisions()) {
            this.birdGroup.position.y = this.simBirdY;
            for (let i = 0; i < this.pipes.length; i++) {
              this.pipes[i].group.position.x = this.pipes[i].x;
            }
            this.triggerGameOver();
          }
        }

        // ------------------------------------------------------------------------
        // INTERPOLATED VISUAL FRAME UPDATE (60FPS / 120FPS / 144FPS / 240FPS)
        // ------------------------------------------------------------------------
        update(frameDt) {
          this.elapsedTime += frameDt;
          const activeSpecLobby = (this.duelSpectatingLobbyId && this.duelSpectatingLobby)
            ? this.duelSpectatingLobby
            : (this.duelSoloSpectatingOpp && this.activeDuelLobby && this.activeDuelLobby.status === 'playing'
              ? this.activeDuelLobby
              : null);
          const isSpectatingDuel = Boolean(activeSpecLobby);
          const specRoundKey = (activeSpecLobby && activeSpecLobby.currentRound) || this.selectedDifficulty || 'medium';
          const specDiffCfg = CONFIG.difficulties[specRoundKey] || CONFIG.difficulties.medium;
          const activeSpecSimSpeed = (this.duelSoloSpectatingOpp && this.duelSpecSim && this.duelSpecSim.opp && this.duelSpecSim.opp.speed > 0)
            ? this.duelSpecSim.opp.speed
            : ((this.duelSpecSim && this.duelSpecSim.p1 && this.duelSpecSim.p1.speed > 0)
              ? this.duelSpecSim.p1.speed
              : ((this.duelSpecSim && this.duelSpecSim.p2 && this.duelSpecSim.p2.speed > 0)
                ? this.duelSpecSim.p2.speed
                : (specDiffCfg.startSpeed || CONFIG.baseSpeed)));
          const diff = this.getDifficultyParams();
          const visualScrollSpeed = (this.state === GAME_STATE.PLAYING)
            ? diff.speed
            : (isSpectatingDuel && activeSpecLobby.status === 'playing'
              ? activeSpecSimSpeed
              : (this.state === GAME_STATE.START ? 3.2 : 0));

          if (visualScrollSpeed > 0) {
            this.groundTexture.offset.x = (this.groundTexture.offset.x + (visualScrollSpeed * frameDt) * 0.25) % 1.0;

            for (const c of this.clouds) {
              c.mesh.position.x -= visualScrollSpeed * c.speedFactor * frameDt;
              if (c.mesh.position.x < -42) {
                c.mesh.position.x = 45 + Math.random() * 6;
              }
            }

            for (const item of this.sceneryItems) {
              item.mesh.position.x -= visualScrollSpeed * item.speedFactor * frameDt;
              if (item.mesh.position.x < -44) {
                item.mesh.position.x = 46 + Math.random() * 4;
              }
            }
          }

          if (this.state === GAME_STATE.START && !isSpectatingDuel) {
            const hoverY = CONFIG.birdStartY + Math.sin(this.elapsedTime * 3.6) * 0.42;
            this.birdGroup.position.set(CONFIG.birdX, hoverY, 0);
            this.birdGroup.rotation.z = Math.cos(this.elapsedTime * 3.6) * 0.08;
            // Subtle turn in the lobby so players can admire 3D wings, back katanas, jetpacks & tails!
            this.birdMeshGroup.rotation.y = Math.sin(this.elapsedTime * 1.4) * 0.32;

            this.wingPhase += frameDt * 11;
            const flapAngle = Math.sin(this.wingPhase) * 0.65;
            this.leftWingPivot.rotation.x = flapAngle;
            this.rightWingPivot.rotation.x = -flapAngle;
          } else if (this.state === GAME_STATE.PLAYING) {
            this.birdMeshGroup.rotation.y = 0;
            if (this.selectedDifficulty === 'extreme') {
              this.physicsAccumulator = 0;
              this.stepPlayingPhysics();
              if (this.state === GAME_STATE.PLAYING) {
                this.birdGroup.position.y = this.simBirdY;
                for (let i = 0; i < this.pipes.length; i++) {
                  const p = this.pipes[i];
                  p.group.position.x = p.x;
                }
              }
            } else {
              const is60HzFrame = (frameDt >= 0.0148 && frameDt <= 0.0188);
              this.physicsAccumulator += frameDt;
              let ran60HzDirect = false;
              if (is60HzFrame && this.physicsAccumulator >= (CONFIG.dt - 0.0015) && this.physicsAccumulator < CONFIG.dt * 1.5) {
                this.physicsAccumulator = Math.max(-0.0015, this.physicsAccumulator - CONFIG.dt);
                this.stepPlayingPhysics();
                ran60HzDirect = true;
              } else {
                const maxSteps = 5;
                let steps = 0;
                while (this.physicsAccumulator >= CONFIG.dt && steps < maxSteps && this.state === GAME_STATE.PLAYING) {
                  this.physicsAccumulator -= CONFIG.dt;
                  this.stepPlayingPhysics();
                  steps++;
                }
              }

              // Sub-tick interpolation factor alpha in [0, 1) (or direct post-tick pose on 60Hz) eliminates jump stutter
              if (this.state === GAME_STATE.PLAYING) {
                if (ran60HzDirect) {
                  this.birdGroup.position.y = this.simBirdY;
                  for (let i = 0; i < this.pipes.length; i++) {
                    const p = this.pipes[i];
                    p.group.position.x = p.x;
                  }
                } else {
                  const alpha = Math.max(0, Math.min(1, this.physicsAccumulator / CONFIG.dt));
                  this.birdGroup.position.y = this.prevBirdY + (this.simBirdY - this.prevBirdY) * alpha;

                  for (let i = 0; i < this.pipes.length; i++) {
                    const p = this.pipes[i];
                    p.group.position.x = p.prevX + (p.x - p.prevX) * alpha;
                  }
                }
              }
            }

            const targetPitch = THREE.MathUtils.clamp(
              (this.birdVelocityY / diff.speedRatio) * 0.065,
              -Math.PI * 0.42,
              Math.PI * 0.24
            );
            this.birdGroup.rotation.z = THREE.MathUtils.lerp(
              this.birdGroup.rotation.z,
              targetPitch,
              Math.min(1, frameDt * 16)
            );

            this.wingFlapBoost = Math.max(0, this.wingFlapBoost - frameDt * 2.5);
            const wingSpeed = 12 + this.wingFlapBoost * 18;
            this.wingPhase += frameDt * wingSpeed;
            const flapAmp = 0.55 + this.wingFlapBoost * 0.4;
            const flapAngle = Math.sin(this.wingPhase) * flapAmp;
            this.leftWingPivot.rotation.x = flapAngle;
            this.rightWingPivot.rotation.x = -flapAngle;
          } else if ((this.state === GAME_STATE.CRASHING || this.state === GAME_STATE.GAMEOVER) && !isSpectatingDuel) {
            if (this.birdGroup.position.y > CONFIG.groundY + CONFIG.birdRadius) {
              this.birdVelocityY += CONFIG.gravity * 1.2 * frameDt;
              this.birdGroup.position.y = Math.max(
                CONFIG.groundY + CONFIG.birdRadius,
                this.birdGroup.position.y + this.birdVelocityY * frameDt
              );
              this.birdGroup.rotation.z = Math.max(-Math.PI * 0.48, this.birdGroup.rotation.z - frameDt * 6);
              this.birdMeshGroup.rotation.x += frameDt * 8;
            }
          }

          if (!isSpectatingDuel) {
            this.updateAnimatedSkinEffects(frameDt);
            if (typeof this.updateAnimatedBackground === 'function') {
              this.updateAnimatedBackground(frameDt);
            }
          }

          // Update pooled particles with zero garbage collection
          for (let i = 0; i < this.particlePool.length; i++) {
            const p = this.particlePool[i];
            if (!p.active) continue;
            p.life += frameDt;
            if (p.life >= p.maxLife) {
              p.active = false;
              p.mesh.visible = false;
              continue;
            }
            p.vy -= 14.0 * p.gravityScale * frameDt;
            p.mesh.position.x += p.vx * frameDt;
            p.mesh.position.y += p.vy * frameDt;
            p.mesh.position.z += p.vz * frameDt;
            p.mesh.rotation.x += 6 * frameDt;
            p.mesh.rotation.y += 6 * frameDt;

            const progress = p.life / p.maxLife;
            p.mat.opacity = 1 - progress;
            p.mesh.scale.setScalar((1 - progress * 0.5));
          }

          // Guard against NaN / Infinity in coordinates or camera so WebGL never blanks out
          if (!Number.isFinite(this.simBirdY)) this.simBirdY = CONFIG.birdStartY;
          if (!Number.isFinite(this.prevBirdY)) this.prevBirdY = CONFIG.birdStartY;
          if (!Number.isFinite(this.birdVelocityY)) this.birdVelocityY = 0;
          if (!Number.isFinite(this.birdGroup.position.y)) this.birdGroup.position.set(CONFIG.birdX, CONFIG.birdStartY, 0);
          if (!Number.isFinite(this.birdGroup.rotation.z)) this.birdGroup.rotation.set(0, 0, 0);

          if (this.shakeTimer > 0) {
            this.shakeTimer -= frameDt;
            const intensity = this.shakeTimer * 0.85;
            this.camera.position.set(
              this.baseCameraPos.x + (Math.random() - 0.5) * intensity,
              this.baseCameraPos.y + (Math.random() - 0.5) * intensity,
              this.baseCameraPos.z
            );
          } else {
            this.camera.position.copy(this.baseCameraPos);
          }
        }

        resetVisualSceneAndRecover(showFeedback = true) {
          try {
            const w = Math.max(1, window.innerWidth);
            const h = Math.max(1, window.innerHeight);
            const aspect = w / h;
            if (this.renderer) {
              this.renderer.setScissorTest(false);
              this.renderer.setSize(w, h);
              this.renderer.setViewport(0, 0, w, h);
            }
            if (this.camera) {
              this.camera.aspect = aspect;
              this.camera.updateProjectionMatrix();
              this.adjustCameraForAspect(aspect);
            }
            const flash = document.getElementById('damage-flash');
            if (flash) flash.style.opacity = '0';

            if (!Number.isFinite(this.simBirdY) || this.state === GAME_STATE.START) {
              this.simBirdY = CONFIG.birdStartY;
              this.prevBirdY = CONFIG.birdStartY;
              this.birdVelocityY = 0;
            }
            if (this.birdGroup) {
              this.birdGroup.visible = true;
              this.birdGroup.position.set(CONFIG.birdX, this.simBirdY || CONFIG.birdStartY, 0);
              this.birdGroup.rotation.set(0, 0, 0);
            }
            if (this.birdMeshGroup) {
              this.birdMeshGroup.visible = true;
              this.birdMeshGroup.rotation.set(0, 0, 0);
              this.birdMeshGroup.scale.set(1, 1, 1);
            }
            this.applyTheme((this.settings && this.settings.theme) || 'dark');
            this.applySkin(this.selectedSkinId || 'classic', false);
            this.applyPipeSkin(this.selectedPipeSkinId || 'classic_pipe', false);
            if (this.state === GAME_STATE.START && this.pipes.length === 0) {
              this.spawnLobbyPreviewPipes();
            }
            if (this.renderer && this.scene && this.camera) {
              this.renderer.render(this.scene, this.camera);
            }
            if (showFeedback) {
              const btn = document.getElementById('btn-reset-view');
              if (btn) {
                btn.style.transform = 'rotate(360deg)';
                setTimeout(() => { btn.style.transform = ''; }, 360);
              }
            }
          } catch (err) {
            console.warn('3D scene recovery error:', err);
          }
        }

        animate(now) {
          requestAnimationFrame(this.animate);
          const isExtremeLocked = (this.state === GAME_STATE.PLAYING || this.state === GAME_STATE.CRASHING)
            && this.selectedDifficulty === 'extreme';
          if (isExtremeLocked) {
            const EXTREME_FRAME_MS = 1000 / 60;
            if (!this.lastExtremeFrameTime) {
              this.lastExtremeFrameTime = now - EXTREME_FRAME_MS;
            }
            const elapsedExt = now - this.lastExtremeFrameTime;
            if (elapsedExt < (EXTREME_FRAME_MS - 0.6)) {
              return;
            }
            this.lastExtremeFrameTime = (elapsedExt > 120)
              ? now
              : (this.lastExtremeFrameTime + EXTREME_FRAME_MS);
          } else {
            this.lastExtremeFrameTime = 0;
          }

          const rawDt = (now - (this.lastFrameTime || now)) * 0.001;
          this.lastFrameTime = now;
          const dt = isExtremeLocked
            ? CONFIG.dt
            : (Number.isFinite(rawDt) ? Math.max(0.0001, Math.min(rawDt, 0.05)) : 0.016);
          try {
            this.update(dt);
          } catch (err) {
            console.warn('Recoverable frame update error:', err);
          }
          try {
            if (this.activeDuelLobbyId && this.state === GAME_STATE.PLAYING) {
              this.sendDuelLiveTelemetryIfNeeded(now);
              this.updateDuelLiveHUD();
            }
          } catch (_) {}
          try {
            this.renderSpotlight3DTurntable();
          } catch (_) {}
          if (this.renderer && this.scene && this.camera) {
            if (this.duelSpectatingLobbyId && this.duelSpectatingLobby) {
              this.renderDuelSpectatorSplitScreen(dt);
            } else if (this.duelSoloSpectatingOpp && this.activeDuelLobby && this.activeDuelLobby.status === 'playing') {
              this.renderSoloOpponentSpectate(dt);
            } else {
              this.renderer.setScissorTest(false);
              this.renderer.setViewport(0, 0, Math.max(1, window.innerWidth), Math.max(1, window.innerHeight));
              this.renderer.render(this.scene, this.camera);
            }
          }
        }

        // ====================================================================
        // RANKED DUELS ARENA CLIENT ENGINE (3-Round Easy 1x / Med 2x / Hard 3x)
        // ====================================================================
        initDuelsEngine() {
          let cid = null;
          try { cid = sessionStorage.getItem('flappy3d_duel_cid'); } catch (_) {}
          if (!cid) {
            cid = 'cid_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
            try { sessionStorage.setItem('flappy3d_duel_cid', cid); } catch (_) {}
          }
          this.duelClientId = cid;

          let gName = null;
          try { gName = localStorage.getItem('flappy3d_duel_guest'); } catch (_) {}
          if (!gName) {
            gName = 'Pilot_' + Math.floor(1000 + Math.random() * 9000);
            try { localStorage.setItem('flappy3d_duel_guest', gName); } catch (_) {}
          }
          this.duelGuestName = gName;

          this.currentDuelTab = 'join';
          this.currentDuelRankedMode = 'elo';
          this.duelLobbies = [];
          this.duelRankedLeaderboard = [];
          this.duelHighScoreLeaderboard = [];
          this.duelHighScoreAllMatches = [];
          this.myDuelStats = { duelElo: 1000, duelWins: 0, duelLosses: 0, duelMatches: 0, duelCoins: 0, duelBestMatchPoints: 0, rank: null, highScoreRank: null };
          this.activeDuelLobby = null;
          this.activeDuelLobbyId = null;
          this.duelSpectatingLobby = null;
          this.duelSpectatingLobbyId = null;
          this.duelRoundPlaying = null;
          this.duelRoundFinishedLocal = false;
          this.pendingDuelRoundFinish = null;
          this._submittingDuelRoundFinish = false;
          this.lastDuelTelemetrySentAt = 0;
          this.lastDuelPollAt = 0;
          this.duelCountdownTargetMs = 0;

          this.duelSoloSpectatingOpp = false;
          this.duelSoloSpectateDelayUntil = 0;
          this._specServerClockOffset = null;
          this.duelEloGapBlockedOver150 = false;

          this.duelSpecSim = {
            p1: this.createEmptySpecSim(),
            p2: this.createEmptySpecSim(),
            opp: this.createEmptySpecSim()
          };
          this.duelSpecPipePools = { p1: [], p2: [], opp: [] };
          this._lastSpecAppliedSkinId = null;

          this.hideAllDuelOverlays();

          if (this._duelPollTimer) clearInterval(this._duelPollTimer);
          if (!this._duelVisibilityHandlerAdded) {
            this._duelVisibilityHandlerAdded = true;
            document.addEventListener('visibilitychange', () => {
              if (!document.hidden && (this.activeDuelLobbyId || this.duelSpectatingLobbyId)) {
                this.fetchDuelsState();
              }
            });
          }
          if (!this._duelUnloadHandlerAdded && typeof window !== 'undefined' && window.addEventListener) {
            this._duelUnloadHandlerAdded = true;
            const sendTabCloseForfeit = () => {
              const lid = this.activeDuelLobbyId;
              const lobby = this.activeDuelLobby;
              if (!lid) return;
              if (lobby && lobby.status === 'finished') return;
              const tokenQs = this.authToken ? `?token=${encodeURIComponent(this.authToken)}` : '';
              const payloadStr = JSON.stringify({
                lobbyId: lid,
                clientId: this.duelClientId,
                guestUsername: this.getDuelDisplayUsername(),
                reason: 'tab_closed'
              });
              let beaconSent = false;
              if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
                try {
                  const blob = new Blob([payloadStr], { type: 'text/plain;charset=UTF-8' });
                  beaconSent = navigator.sendBeacon(`/api/duels/leave${tokenQs}`, blob);
                } catch (_) {}
              }
              if (!beaconSent && typeof fetch === 'function') {
                try {
                  const hdrs = { 'Content-Type': 'application/json' };
                  if (this.authToken) hdrs['Authorization'] = `Bearer ${this.authToken}`;
                  fetch('/api/duels/leave', { method: 'POST', headers: hdrs, body: payloadStr, keepalive: true }).catch(() => {});
                } catch (_) {}
              }
            };
            window.addEventListener('pagehide', sendTabCloseForfeit);
            window.addEventListener('beforeunload', sendTabCloseForfeit);
          }
          this._duelPollTimer = setInterval(() => {
            const inActiveMatch = Boolean(
              this.activeDuelLobbyId &&
              this.activeDuelLobby &&
              this.activeDuelLobby.status !== 'waiting' &&
              this.activeDuelLobby.status !== 'finished'
            );
            const now = Date.now();
            // Keep lightweight keepalive heartbeat running even while alt-tabbed during an active match
            if (document.hidden) {
              if (inActiveMatch && (now - (this.lastDuelPollAt || 0) >= 2000)) {
                this.lastDuelPollAt = now;
                this.fetchDuelsState();
              }
              return;
            }
            const isLiveSpectating = Boolean(
              this.duelSpectatingLobbyId ||
              this.duelSoloSpectatingOpp ||
              (this.activeDuelLobby && this.activeDuelLobby.status === 'playing' && this.duelRoundFinishedLocal)
            );
            const isNearCountdownEnd = Boolean(
              this.activeDuelLobby &&
              this.activeDuelLobby.status === 'countdown' &&
              (this.duelCountdownTargetMs - now < 500)
            );
            const isFastPoll = Boolean(this.activeDuelLobbyId || this.duelSpectatingLobbyId);
            const intervalMs = (isLiveSpectating || isNearCountdownEnd) ? 75 : (isFastPoll ? 200 : 1200);
            if (!isFastPoll && this.currentAppView !== 'duels') return;
            if (now - this.lastDuelPollAt >= intervalMs) {
              this.lastDuelPollAt = now;
              this.fetchDuelsState();
            }
          }, 50);

          if (this._duelCountdownTicker) clearInterval(this._duelCountdownTicker);
          this._duelCountdownTicker = setInterval(() => {
            const targetLobby = this.activeDuelLobby || this.duelSpectatingLobby;
            if (!targetLobby || targetLobby.status !== 'countdown') return;
            const numEl = document.getElementById('duel-countdown-number');
            if (!numEl || !this.duelCountdownTargetMs) return;
            const remMs = Math.max(0, this.duelCountdownTargetMs - Date.now());
            const sec = Math.max(1, Math.ceil(remMs / 1000));
            numEl.textContent = String(sec);
            if (remMs <= 0 && !this._fetchingDuelTransition) {
              this._fetchingDuelTransition = true;
              this.fetchDuelsState().finally(() => { this._fetchingDuelTransition = false; });
            }
          }, 80);
        }

        getDuelDisplayUsername() {
          if (this.currentUser && this.currentUser.username) {
            return this.currentUser.username;
          }
          return this.duelGuestName || 'GuestPilot';
        }

        isMeDonutUser() {
          const uname = (this.currentUser && this.currentUser.username) ? this.currentUser.username : '';
          return uname.toLowerCase() === 'medonut';
        }

        async handleDuelCallBot(mode = 'join_or_start', lobbyId = '') {
          if (!this.isMeDonutUser()) return;
          try {
            const res = await this.apiRequest('/api/duels/call-bot', 'POST', {
              mode,
              lobbyId,
              clientId: this.duelClientId,
              guestUsername: this.getDuelDisplayUsername(),
              selectedSkin: this.selectedSkinId || 'classic',
              selectedPipeSkin: this.selectedPipeSkinId || 'classic_pipe'
            });
            if (res) {
              if (Array.isArray(res.lobbies)) this.duelLobbies = res.lobbies;
              if (res.lobby && (res.action === 'bot_duel_started' || (res.action === 'bot_joined_lobby' && (!lobbyId || lobbyId === this.activeDuelLobbyId)))) {
                this.activeDuelLobby = res.lobby;
                this.activeDuelLobbyId = res.lobby.id;
                this.syncDuelMatchState(res.lobby);
              }
              this.renderDuelLobbiesList();
            }
          } catch (err) {
            console.warn('Call bot error:', err);
          }
        }

        async handleDuelAdminSetElo(targetUsername, newElo) {
          if (!this.isMeDonutUser() || !targetUsername) return;
          try {
            const res = await this.apiRequest('/api/duels/admin-set-elo', 'POST', {
              username: targetUsername,
              newElo: Number(newElo),
              clientId: this.duelClientId
            });
            if (res && res.ok) {
              if (Array.isArray(res.rankedLeaderboard)) {
                this.duelRankedLeaderboard = res.rankedLeaderboard;
              }
              if (Array.isArray(res.lobbies)) {
                this.duelLobbies = res.lobbies;
              }
              if (res.myDuelStats) {
                this.myDuelStats = res.myDuelStats;
              }
              this.renderDuelRankedLeaderboard();
              this.renderDuelLobbiesList();
            }
          } catch (err) {
            console.warn('Admin set Elo error:', err);
          }
        }

        async fetchDuelsState() {
          if (this._fetchingDuelState) return;
          this._fetchingDuelState = true;
          try {
            const payload = {
              clientId: this.duelClientId,
              guestUsername: this.getDuelDisplayUsername(),
              selectedSkin: this.selectedSkinId || 'classic',
              selectedPipeSkin: this.selectedPipeSkinId || 'classic_pipe',
              lobbyId: this.activeDuelLobbyId || '',
              spectateLobbyId: this.duelSpectatingLobbyId || ''
            };
            const data = await this.apiRequest('/api/duels/state', 'POST', payload);
            if (!data) return;

            if (typeof data.serverTime === 'number' && Number.isFinite(data.serverTime)) {
              const localNow = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
              const sampleOffset = data.serverTime - localNow;
              if (this._specServerClockOffset === null) {
                this._specServerClockOffset = sampleOffset;
              } else {
                const diff = sampleOffset - this._specServerClockOffset;
                this._specServerClockOffset += Math.abs(diff) > 350 ? diff * 0.35 : diff * 0.06;
              }
            }
            if (data.adminSettings && typeof data.adminSettings.blockDuelEloGapOver150 === 'boolean') {
              this.duelEloGapBlockedOver150 = data.adminSettings.blockDuelEloGapOver150;
            }

            if (Array.isArray(data.lobbies)) {
              this.duelLobbies = data.lobbies;
            }
            if (Array.isArray(data.rankedLeaderboard)) {
              this.duelRankedLeaderboard = data.rankedLeaderboard;
            }
            if (Array.isArray(data.duelHighScoreLeaderboard)) {
              this.duelHighScoreLeaderboard = data.duelHighScoreLeaderboard;
            }
            if (Array.isArray(data.duelHighScoreAllMatches)) {
              this.duelHighScoreAllMatches = data.duelHighScoreAllMatches;
            }
            if (data.myDuelStats) {
              this.myDuelStats = data.myDuelStats;
              if (this.currentUser) {
                if (typeof data.myDuelStats.duelElo === 'number') {
                  this.currentUser.duelElo = data.myDuelStats.duelElo;
                }
                if (typeof data.myDuelStats.duelCoins === 'number') {
                  this.currentUser.duelCoins = Math.round(data.myDuelStats.duelCoins);
                }
              }
              this.updateDuelShopCoinsUI();
            }

            if (this.duelSpectatingLobbyId) {
              if (data.spectatingLobby) {
                this.duelSpectatingLobby = data.spectatingLobby;
                this.syncSpectatorLobbyState(data.spectatingLobby);
              } else {
                this.stopSpectatingDuel();
              }
            } else if (data.activeLobby) {
              this.activeDuelLobby = data.activeLobby;
              this.activeDuelLobbyId = data.activeLobby.id;
              this.syncDuelMatchState(data.activeLobby);
            } else if (this.activeDuelLobbyId && (!this.activeDuelLobby || this.activeDuelLobby.status !== 'finished')) {
              const wasInMatchView = Boolean(
                this.activeDuelLobby && this.activeDuelLobby.status !== 'waiting'
              ) || document.body.classList.contains('in-game');
              this.releaseStuckDuelState(wasInMatchView);
            }

            this.renderDuelLobbiesList();
            this.renderDuelRankedLeaderboard();
          } catch (_) {
          } finally {
            this._fetchingDuelState = false;
          }
        }

        async handleDuelQuickMatch() {
          try {
            const res = await this.apiRequest('/api/duels/quick-match', 'POST', {
              clientId: this.duelClientId,
              guestUsername: this.getDuelDisplayUsername(),
              selectedSkin: this.selectedSkinId || 'classic',
              selectedPipeSkin: this.selectedPipeSkinId || 'classic_pipe'
            });
            if (res && res.lobby) {
              this.activeDuelLobby = res.lobby;
              this.activeDuelLobbyId = res.lobby.id;
              if (Array.isArray(res.lobbies)) this.duelLobbies = res.lobbies;
              this.renderDuelLobbiesList();
              this.syncDuelMatchState(res.lobby);
            }
          } catch (err) {
            console.warn('Quick Match error:', err);
          }
        }

        async handleDuelCreateLobby() {
          const nameInput = document.getElementById('duel-create-name-input');
          const pwInput = document.getElementById('duel-create-password-input');
          const msgEl = document.getElementById('duel-create-msg');
          const customName = nameInput ? nameInput.value.trim() : '';
          const isFriendly = Boolean(this.duelCreateIsFriendly);
          const customPassword = (isFriendly && pwInput) ? pwInput.value.trim() : '';
          try {
            if (msgEl) msgEl.textContent = 'Creating lobby...';
            const res = await this.apiRequest('/api/duels/create', 'POST', {
              name: customName || `${this.getDuelDisplayUsername()}'s Duel`,
              isFriendly,
              password: customPassword,
              clientId: this.duelClientId,
              guestUsername: this.getDuelDisplayUsername(),
              selectedSkin: this.selectedSkinId || 'classic',
              selectedPipeSkin: this.selectedPipeSkinId || 'classic_pipe'
            });
            if (nameInput) nameInput.value = '';
            if (pwInput) pwInput.value = '';
            if (msgEl) msgEl.textContent = '';
            if (res && res.lobby) {
              this.activeDuelLobby = res.lobby;
              this.activeDuelLobbyId = res.lobby.id;
              if (Array.isArray(res.lobbies)) this.duelLobbies = res.lobbies;
              if (Array.isArray(res.rankedLeaderboard)) this.duelRankedLeaderboard = res.rankedLeaderboard;
              if (typeof this.activateDuelTab === 'function') {
                this.activateDuelTab('join', false);
              }
              this.renderDuelLobbiesList();
              this.syncDuelMatchState(res.lobby);
            }
          } catch (err) {
            if (msgEl) msgEl.textContent = err.message || 'Could not create lobby.';
          }
        }

        openDuelPasswordModal(lobbyId, lobbyName = 'Friendly Duel', errorMsg = '') {
          this._pendingPasswordLobbyId = lobbyId;
          const modal = document.getElementById('duel-password-modal');
          const titleEl = document.getElementById('duel-password-modal-title');
          const errEl = document.getElementById('duel-password-modal-error');
          const inputEl = document.getElementById('duel-join-password-input');
          if (titleEl) titleEl.textContent = `Join "${lobbyName}"`;
          if (errEl) errEl.textContent = errorMsg || '';
          if (inputEl) {
            if (!errorMsg) inputEl.value = '';
          }
          if (modal) {
            modal.style.display = 'flex';
            modal.classList.add('active');
          }
          if (inputEl) {
            setTimeout(() => { inputEl.focus(); }, 30);
          }
        }

        closeDuelPasswordModal() {
          this._pendingPasswordLobbyId = null;
          const modal = document.getElementById('duel-password-modal');
          const errEl = document.getElementById('duel-password-modal-error');
          if (errEl) errEl.textContent = '';
          if (modal) {
            modal.classList.remove('active', 'visible');
            modal.style.display = 'none';
          }
        }

        submitDuelPasswordModal() {
          const lobbyId = this._pendingPasswordLobbyId;
          const inputEl = document.getElementById('duel-join-password-input');
          const errEl = document.getElementById('duel-password-modal-error');
          if (!lobbyId) {
            this.closeDuelPasswordModal();
            return;
          }
          const entered = inputEl ? inputEl.value.trim() : '';
          if (!entered) {
            if (errEl) errEl.textContent = 'Please enter the lobby password.';
            if (inputEl) inputEl.focus();
            return;
          }
          this.handleDuelJoinLobby(lobbyId, entered);
        }

        async handleDuelJoinLobby(lobbyId, password = null) {
          if (!lobbyId) return;
          const targetLobby = (this.duelLobbies || []).find(l => l && l.id === lobbyId);
          if (targetLobby && targetLobby.hasPassword && password === null) {
            this.openDuelPasswordModal(lobbyId, targetLobby.name || 'Friendly Duel');
            return;
          }
          try {
            const payload = {
              lobbyId,
              clientId: this.duelClientId,
              guestUsername: this.getDuelDisplayUsername(),
              selectedSkin: this.selectedSkinId || 'classic',
              selectedPipeSkin: this.selectedPipeSkinId || 'classic_pipe'
            };
            if (typeof password === 'string' && password.length > 0) {
              payload.password = password;
            }
            const res = await this.apiRequest('/api/duels/join', 'POST', payload);
            this.closeDuelPasswordModal();
            if (res && res.lobby) {
              this.activeDuelLobby = res.lobby;
              this.activeDuelLobbyId = res.lobby.id;
              if (Array.isArray(res.lobbies)) this.duelLobbies = res.lobbies;
              this.renderDuelLobbiesList();
              this.syncDuelMatchState(res.lobby);
            }
          } catch (err) {
            const msg = (err && err.message) ? err.message : '';
            if (password !== null || (/password/i.test(msg) && !/elo/i.test(msg))) {
              const lobbyTitle = (targetLobby && targetLobby.name) || 'Friendly Duel';
              this.openDuelPasswordModal(lobbyId, lobbyTitle, msg || 'Incorrect password.');
              return;
            }
            if (msg) {
              const msgEl = document.getElementById('duel-create-msg');
              if (msgEl) msgEl.textContent = msg;
              if (typeof this.showLockerToast === 'function') {
                this.showLockerToast(msg, true);
              }
              if (typeof alert === 'function' && /elo|alt|boosting/i.test(msg)) {
                alert(msg);
              }
            }
            this.fetchDuelsState();
          }
        }

        releaseStuckDuelState(returnToHub = true) {
          this.activeDuelLobby = null;
          this.activeDuelLobbyId = null;
          this.duelRoundPlaying = null;
          this.duelRoundFinishedLocal = false;
          this.pendingDuelRoundFinish = null;
          this._submittingDuelRoundFinish = false;
          if (this.state === GAME_STATE.PLAYING) {
            this.state = GAME_STATE.START;
          }
          this.exitSoloOpponentSpectate();
          this.hideAllDuelOverlays();
          if (returnToHub) {
            this.showLobbyScreen();
            this.switchView('duels');
            if (typeof this.activateDuelTab === 'function') {
              this.activateDuelTab('join', false);
            }
          }
        }

        async handleDuelLeaveLobby() {
          const targetId = this.activeDuelLobbyId;
          if (!targetId) return;
          if (this.activeDuelLobby && this.activeDuelLobby.status !== 'waiting') {
            return;
          }
          this.releaseStuckDuelState(false);
          try {
            const res = await this.apiRequest('/api/duels/leave', 'POST', {
              lobbyId: targetId,
              clientId: this.duelClientId,
              guestUsername: this.getDuelDisplayUsername()
            });
            if (res && Array.isArray(res.lobbies)) {
              this.duelLobbies = res.lobbies;
            }
          } catch (_) {}
          this.renderDuelLobbiesList();
        }

        handleDuelFinishBackToHub() {
          this.activeDuelLobby = null;
          this.activeDuelLobbyId = null;
          this.duelRoundPlaying = null;
          this.duelRoundFinishedLocal = false;
          if (this.duelSpectatingLobbyId) {
            this.stopSpectatingDuel();
            return;
          }
          this.hideAllDuelOverlays();
          this.showLobbyScreen();
          this.switchView('duels');
          if (typeof this.activateDuelTab === 'function') {
            this.activateDuelTab('join', false);
          }
          this.fetchDuelsState();
        }

        hideAllDuelOverlays() {
          const backdrop = document.getElementById('duel-overlay-backdrop');
          if (backdrop) backdrop.style.display = 'none';
          const liveHud = document.getElementById('duel-live-hud');
          if (liveHud) liveHud.style.display = 'none';
          const specOverlay = document.getElementById('duel-spectator-overlay');
          if (specOverlay) specOverlay.style.display = 'none';
          const soloSpecOverlay = document.getElementById('duel-solo-spectate-overlay');
          if (soloSpecOverlay) soloSpecOverlay.style.display = 'none';
          ['duel-view-countdown', 'duel-view-waiting-opponent', 'duel-view-round-summary', 'duel-view-final-results'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
          });
        }

        showDuelBackdropSubView(viewId) {
          const backdrop = document.getElementById('duel-overlay-backdrop');
          if (backdrop) backdrop.style.display = 'flex';
          ['duel-view-countdown', 'duel-view-waiting-opponent', 'duel-view-round-summary', 'duel-view-final-results'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = (id === viewId) ? 'flex' : 'none';
          });
        }

        getDuelMyAndOppSlots(lobby) {
          if (!lobby || !Array.isArray(lobby.players)) return { me: null, opp: null, p1: null, p2: null };
          const p1 = lobby.players[0] || null;
          const p2 = lobby.players[1] || null;
          let me = lobby.players.find(p => p.slotId === this.duelClientId) || null;
          if (!me) {
            const myUKey = this.getDuelDisplayUsername().toLowerCase();
            me = lobby.players.find(p => p.usernameKey === myUKey) || p1;
          }
          const opp = (me === p1) ? p2 : p1;
          return { me, opp, p1, p2 };
        }

        syncDuelMatchState(lobby) {
          if (!lobby) return;
          const { me, opp, p1, p2 } = this.getDuelMyAndOppSlots(lobby);

          if (me && me.leftMatch) {
            this.releaseStuckDuelState(true);
            return;
          }

          // 1. Waiting for 2nd player
          if (lobby.status === 'waiting') {
            this.exitSoloOpponentSpectate();
            this.hideAllDuelOverlays();
            if (document.body.classList.contains('in-game')) {
              this.showLobbyScreen();
            }
            this.renderDuelLobbiesList();
            return;
          }

          // When 2 players are in the lobby (countdown / playing / round_summary / finished),
          // hide the menu cards so the 3D Flappy Bird gameplay is visible in the background!
          const startScr = document.getElementById('start-screen');
          if (startScr) startScr.classList.remove('active');
          const goScr = document.getElementById('gameover-screen');
          if (goScr) goScr.classList.remove('active');
          document.body.classList.add('in-game');
          const topBarEl = document.getElementById('top-app-bar');
          if (topBarEl) {
            topBarEl.classList.add('in-game');
            topBarEl.style.setProperty('display', 'none', 'important');
          }

          // 2. 3-Second Countdown before Round 1 (Easy 1x), Round 2 (Medium 2x), or Round 3 (Hard 3x)
          if (lobby.status === 'countdown') {
            this.duelRoundPlaying = null;
            this.duelRoundFinishedLocal = false;
            this.pendingDuelRoundFinish = null;
            this.exitSoloOpponentSpectate();
            if (this.duelSpecSim && this.duelSpecSim.opp) {
              this.duelSpecSim.opp = this.createEmptySpecSim();
            }
            if (this.state === GAME_STATE.PLAYING) {
              this.state = GAME_STATE.START;
            }
            if (this.pipes.length === 0) {
              this.spawnLobbyPreviewPipes();
            }
            const liveHud = document.getElementById('duel-live-hud');
            if (liveHud) liveHud.style.display = 'none';

            this.duelCountdownTargetMs = Date.now() + (lobby.countdownRemainingMs || 1500);
            const sec = Math.max(1, Math.ceil((lobby.countdownRemainingMs || 1000) / 1000));

            const matchupEl = document.getElementById('duel-countdown-matchup');
            if (matchupEl) {
              const p1Text = p1 ? `${p1.username} (${p1.elo} ELO)` : 'Player 1';
              const p2Text = p2 ? `${p2.username} (${p2.elo} ELO)` : 'Player 2';
              matchupEl.textContent = `${p1Text}  ⚔️  ${p2Text}`;
            }
            const roundTagEl = document.getElementById('duel-countdown-round-tag');
            if (roundTagEl) {
              const modePrefix = lobby.isFriendly ? '🤝 FRIENDLY (0 ELO) • ' : '🏆 RANKED • ';
              const totalRnds = lobby.totalRounds || 4;
              roundTagEl.textContent = `${modePrefix}ROUND ${lobby.currentRoundNumber} OF ${totalRnds} — ${(lobby.currentRoundLabel || 'EASY').toUpperCase()} MODE (${lobby.currentMultiplier}x POINTS)`;
            }
            const numEl = document.getElementById('duel-countdown-number');
            if (numEl) numEl.textContent = String(sec);
            const subEl = document.getElementById('duel-countdown-sub');
            if (subEl) {
              subEl.textContent = `Every pipe passed in ${lobby.currentRoundLabel} mode counts ${lobby.currentMultiplier}x towards your Total Points!`;
            }

            this.showDuelBackdropSubView('duel-view-countdown');
            return;
          }

          // 3. Playing Active Round (Easy / Medium / Hard)
          if (lobby.status === 'playing') {
            const rKey = lobby.currentRound || 'easy';
            const myRound = me && me.rounds && me.rounds[rKey] ? me.rounds[rKey] : { rawScore: 0, weightedScore: 0, finished: false };
            const oppRound = opp && opp.rounds && opp.rounds[rKey] ? opp.rounds[rKey] : { rawScore: 0, weightedScore: 0, finished: false };

            // If we missed summary/countdown (e.g. tab hidden or network lag), clear stale local finish flags from earlier rounds
            if (this.duelRoundPlaying !== rKey && (!this.pendingDuelRoundFinish || this.pendingDuelRoundFinish.round !== rKey)) {
              this.duelRoundFinishedLocal = false;
              this.pendingDuelRoundFinish = null;
            }
            if (myRound.finished && this.pendingDuelRoundFinish && this.pendingDuelRoundFinish.round === rKey) {
              this.pendingDuelRoundFinish = null;
            }

            if (!myRound.finished && !this.duelRoundFinishedLocal) {
              this.exitSoloOpponentSpectate();
              // Start flying this round if not already started
              if (this.duelRoundPlaying !== rKey) {
                this.startDuelRoundGameplay(rKey, lobby.roundSeed);
              }
              const backdrop = document.getElementById('duel-overlay-backdrop');
              if (backdrop) backdrop.style.display = 'none';
              const liveHud = document.getElementById('duel-live-hud');
              if (liveHud) liveHud.style.display = 'flex';
              this.updateDuelLiveHUD();
            } else {
              // If local crash submission failed earlier on this round, automatically retry so the match never deadlocks
              if (
                !myRound.finished &&
                this.duelRoundFinishedLocal &&
                this.pendingDuelRoundFinish &&
                this.pendingDuelRoundFinish.lobbyId === lobby.id &&
                this.pendingDuelRoundFinish.round === rKey &&
                !this._submittingDuelRoundFinish &&
                (Date.now() - (this.pendingDuelRoundFinish.lastAttemptAt || 0) >= 800)
              ) {
                this.submitPendingDuelRoundFinish();
              }

              // I have already crashed in this round — spectate opponent full-screen until they die!
              const liveHud = document.getElementById('duel-live-hud');
              if (liveHud) liveHud.style.display = 'none';

              const oppStillFlying = Boolean(opp && !oppRound.finished && (!opp.live || opp.live.alive !== false));
              if (oppStillFlying && this.duelSpecSim && this.duelSpecSim.opp) {
                this.pushSpectatorSnapshot(this.duelSpecSim.opp, opp, lobby.status);
                if (Date.now() >= (this.duelSoloSpectateDelayUntil || 0)) {
                  this.enterSoloOpponentSpectate(lobby, me, opp);
                  return;
                }
                const backdrop = document.getElementById('duel-overlay-backdrop');
                if (backdrop) backdrop.style.display = 'none';
                return;
              }

              this.exitSoloOpponentSpectate();
              const waitTitle = document.getElementById('duel-waiting-opp-title');
              if (waitTitle) {
                waitTitle.textContent = `Round ${lobby.currentRoundNumber} (${lobby.currentRoundLabel} • ${lobby.currentMultiplier}x) — You Got ${myRound.rawScore} (${myRound.weightedScore} PTS)`;
              }
              const waitSub = document.getElementById('duel-waiting-opp-sub');
              if (waitSub) {
                waitSub.textContent = `Waiting for ${opp ? opp.username : 'opponent'} to finish Round ${lobby.currentRoundNumber}...`;
              }

              const wP1Name = document.getElementById('duel-wait-p1-name');
              const wP1Val = document.getElementById('duel-wait-p1-val');
              const wP1St = document.getElementById('duel-wait-p1-status');
              if (wP1Name) wP1Name.textContent = me ? me.username : 'You';
              if (wP1Val) wP1Val.textContent = `${myRound.rawScore} (${myRound.weightedScore} pts)`;
              if (wP1St) wP1St.textContent = '💥 Finished Round';

              const wP2Name = document.getElementById('duel-wait-p2-name');
              const wP2Val = document.getElementById('duel-wait-p2-val');
              const wP2St = document.getElementById('duel-wait-p2-status');
              const oppLiveRaw = opp && opp.live ? opp.live.score : oppRound.rawScore;
              const oppLivePts = oppLiveRaw * (lobby.currentMultiplier || 1);
              if (wP2Name) wP2Name.textContent = opp ? opp.username : 'Opponent';
              if (wP2Val) wP2Val.textContent = `${oppLiveRaw} (${oppLivePts} pts)`;
              if (wP2St) wP2St.textContent = oppRound.finished ? '💥 Finished Round' : '🟢 Still Flying...';

              this.showDuelBackdropSubView('duel-view-waiting-opponent');
            }
            return;
          }

          // 4. Between-Round Summary (First when BOTH players have died in the round!)
          if (lobby.status === 'round_summary') {
            this.duelRoundPlaying = null;
            this.duelRoundFinishedLocal = false;
            this.pendingDuelRoundFinish = null;
            this.exitSoloOpponentSpectate();
            if (this.state === GAME_STATE.PLAYING) {
              this.state = GAME_STATE.START;
            }
            const liveHud = document.getElementById('duel-live-hud');
            if (liveHud) liveHud.style.display = 'none';

            this.populateDuelRoundSummaryModal(lobby);
            this.showDuelBackdropSubView('duel-view-round-summary');
            return;
          }

          // 5. Final Match Results (After Round 3 Hard: All points counted together + Ranked Elo changes!)
          if (lobby.status === 'finished') {
            this.duelRoundPlaying = null;
            this.duelRoundFinishedLocal = false;
            this.pendingDuelRoundFinish = null;
            this.exitSoloOpponentSpectate();
            if (this.state === GAME_STATE.PLAYING) {
              this.state = GAME_STATE.START;
            }
            const liveHud = document.getElementById('duel-live-hud');
            if (liveHud) liveHud.style.display = 'none';

            this.populateDuelFinalResultsModal(lobby);
            this.showDuelBackdropSubView('duel-view-final-results');
          }
        }

        populateDuelRoundSummaryModal(lobby) {
          const rKey = lobby.currentRound || 'easy';
          const mult = lobby.currentMultiplier || 1;
          const p1 = lobby.players[0] || { username: 'Player 1', elo: 1000, totalPoints: 0, rounds: {} };
          const p2 = lobby.players[1] || { username: 'Player 2', elo: 1000, totalPoints: 0, rounds: {} };
          const r1 = (p1.rounds && p1.rounds[rKey]) || { rawScore: 0, weightedScore: 0 };
          const r2 = (p2.rounds && p2.rounds[rKey]) || { rawScore: 0, weightedScore: 0 };

          const badgeEl = document.getElementById('duel-summary-round-badge');
          const totalRnds = lobby.totalRounds || 4;
          if (badgeEl) badgeEl.textContent = `ROUND ${lobby.currentRoundNumber} OF ${totalRnds} COMPLETE`;
          const titleEl = document.getElementById('duel-summary-title');
          if (titleEl) titleEl.textContent = `Round ${lobby.currentRoundNumber}: ${lobby.currentRoundLabel} (${mult}x) Results`;

          const sP1Name = document.getElementById('duel-sum-p1-name');
          const sP1Raw = document.getElementById('duel-sum-p1-raw');
          const sP1Pts = document.getElementById('duel-sum-p1-pts');
          const sP1Tot = document.getElementById('duel-sum-p1-total');
          if (sP1Name) sP1Name.textContent = `${p1.username} (${p1.elo} ELO)`;
          if (sP1Raw) sP1Raw.textContent = mult > 1 ? `Score: ${r1.rawScore} × ${mult} (${lobby.currentRoundLabel})` : `Score: ${r1.rawScore} (${lobby.currentRoundLabel})`;
          if (sP1Pts) sP1Pts.textContent = `+${r1.weightedScore} PTS`;
          if (sP1Tot) sP1Tot.textContent = `Total So Far: ${p1.totalPoints} PTS`;

          const sP2Name = document.getElementById('duel-sum-p2-name');
          const sP2Raw = document.getElementById('duel-sum-p2-raw');
          const sP2Pts = document.getElementById('duel-sum-p2-pts');
          const sP2Tot = document.getElementById('duel-sum-p2-total');
          if (sP2Name) sP2Name.textContent = `${p2.username} (${p2.elo} ELO)`;
          if (sP2Raw) sP2Raw.textContent = mult > 1 ? `Score: ${r2.rawScore} × ${mult} (${lobby.currentRoundLabel})` : `Score: ${r2.rawScore} (${lobby.currentRoundLabel})`;
          if (sP2Pts) sP2Pts.textContent = `+${r2.weightedScore} PTS`;
          if (sP2Tot) sP2Tot.textContent = `Total So Far: ${p2.totalPoints} PTS`;

          const nextHint = document.getElementById('duel-summary-next-hint');
          if (nextHint) {
            if (rKey === 'easy') {
              nextHint.textContent = '⏱️ Next up: Round 2 — Medium Mode (Counts Double: 2x Points)...';
            } else if (rKey === 'medium') {
              nextHint.textContent = '⏱️ Next up: Round 3 — Hard Mode (Counts Triple: 3x Points)...';
            } else if (rKey === 'hard') {
              nextHint.textContent = '⏱️ Next up: Round 4 — Extreme Mode (30-FP • Counts 10x Points!!)...';
            } else {
              nextHint.textContent = '🏆 All 4 rounds complete! Counting all points together...';
            }
          }
        }

        populateDuelFinalResultsModal(lobby) {
          const p1 = (lobby.result && lobby.result.p1) || lobby.players[0] || { username: 'Player 1', oldElo: 1000, newElo: 1000, eloDelta: 0, totalPoints: 0, rounds: { easy: {}, medium: {}, hard: {}, extreme: {} } };
          const p2 = (lobby.result && lobby.result.p2) || lobby.players[1] || { username: 'Player 2', oldElo: 1000, newElo: 1000, eloDelta: 0, totalPoints: 0, rounds: { easy: {}, medium: {}, hard: {}, extreme: {} } };

          const isFriendlyMatch = Boolean(lobby.isFriendly || (lobby.result && lobby.result.isFriendly));

          const winTitle = document.getElementById('duel-final-winner-title');
          if (winTitle) {
            if (lobby.result && lobby.result.forfeit && lobby.result.winnerUsername) {
              const quitName = lobby.result.forfeitedUsername || 'Opponent';
              winTitle.textContent = isFriendlyMatch
                ? `🤝 ${lobby.result.winnerUsername} Wins! (${quitName} left)`
                : `🏆 ${lobby.result.winnerUsername} Wins by Forfeit! (${quitName} closed tab / left)`;
            } else if (lobby.result && lobby.result.isDraw) {
              winTitle.textContent = isFriendlyMatch
                ? `🤝 Friendly Draw! (${p1.totalPoints} - ${p2.totalPoints} PTS)`
                : `🤝 Draw Match! (${p1.totalPoints} - ${p2.totalPoints} PTS)`;
            } else if (lobby.result && lobby.result.winnerUsername) {
              winTitle.textContent = isFriendlyMatch
                ? `🤝 ${lobby.result.winnerUsername} Wins the Friendly Duel!`
                : `🏆 ${lobby.result.winnerUsername} Wins the Duel!`;
            } else {
              const winnerName = p1.totalPoints >= p2.totalPoints ? p1.username : p2.username;
              winTitle.textContent = isFriendlyMatch
                ? `🤝 ${winnerName} Wins (Friendly)!`
                : `🏆 ${winnerName} Wins!`;
            }
          }

          const col1 = document.getElementById('duel-final-col-p1');
          const col2 = document.getElementById('duel-final-col-p2');
          const p1WonCol = lobby.result && lobby.result.winnerSlotId
            ? lobby.result.winnerSlotId === p1.slotId
            : (p1.totalPoints > p2.totalPoints);
          const p2WonCol = lobby.result && lobby.result.winnerSlotId
            ? lobby.result.winnerSlotId === p2.slotId
            : (p2.totalPoints > p1.totalPoints);
          if (col1) col1.classList.toggle('winner-col', p1WonCol);
          if (col2) col2.classList.toggle('winner-col', p2WonCol);

          const fillCol = (prefix, p) => {
            const nameEl = document.getElementById(`duel-final-${prefix}-name`);
            const eloEl = document.getElementById(`duel-final-${prefix}-elo`);
            const easyEl = document.getElementById(`duel-final-${prefix}-easy`);
            const medEl = document.getElementById(`duel-final-${prefix}-med`);
            const hardEl = document.getElementById(`duel-final-${prefix}-hard`);
            const extEl = document.getElementById(`duel-final-${prefix}-extreme`);
            const totEl = document.getElementById(`duel-final-${prefix}-total`);

            if (nameEl) nameEl.textContent = p.username;
            if (eloEl) {
              if (isFriendlyMatch) {
                eloEl.textContent = `🤝 Friendly Match (${p.oldElo || 1000} ELO • ±0 ELO)`;
                eloEl.className = 'duel-final-elo-change';
              } else {
                const d = Number(p.eloDelta) || 0;
                const sign = d >= 0 ? `+${d}` : `${d}`;
                eloEl.textContent = `🏆 ${p.oldElo || 1000} → ${p.newElo || p.elo || 1000} (${sign} ELO)`;
                eloEl.className = 'duel-final-elo-change ' + (d > 0 ? 'positive' : (d < 0 ? 'negative' : ''));
              }
            }
            const rE = (p.rounds && p.rounds.easy) || { rawScore: 0, weightedScore: 0 };
            const rM = (p.rounds && p.rounds.medium) || { rawScore: 0, weightedScore: 0 };
            const rH = (p.rounds && p.rounds.hard) || { rawScore: 0, weightedScore: 0 };
            const rX = (p.rounds && p.rounds.extreme) || { rawScore: 0, weightedScore: 0 };
            if (easyEl) easyEl.textContent = `${rE.rawScore || 0} = ${rE.weightedScore || 0} pts`;
            if (medEl) medEl.textContent = `${rM.rawScore || 0} × 2 = ${rM.weightedScore || 0} pts`;
            if (hardEl) hardEl.textContent = `${rH.rawScore || 0} × 3 = ${rH.weightedScore || 0} pts`;
            if (extEl) extEl.textContent = `${rX.rawScore || 0} × 10 = ${rX.weightedScore || 0} pts`;
            if (totEl) totEl.textContent = `${p.totalPoints || 0} PTS`;
            const coinsRowEl = document.getElementById(`duel-final-${prefix}-coins`);
            if (coinsRowEl) {
              if (isFriendlyMatch) {
                coinsRowEl.textContent = '🤝 Friendly (0 Coins)';
              } else {
                const earned = Math.max(0, Math.round(Number(p.coinsEarned) || 0));
                coinsRowEl.textContent = `+${earned} 🪙`;
              }
            }
          };

          fillCol('p1', p1);
          fillCol('p2', p2);
        }

        startDuelRoundGameplay(roundDiff, roundSeed) {
          this.duelRoundPlaying = roundDiff;
          this.duelRoundFinishedLocal = false;
          this.pendingDuelRoundFinish = null;
          this.selectedDifficulty = roundDiff;
          this.exitSoloOpponentSpectate();
          this.hideAllDuelOverlays();

          document.body.classList.add('in-game');
          const topBarEl = document.getElementById('top-app-bar');
          if (topBarEl) {
            topBarEl.classList.add('in-game');
            topBarEl.style.setProperty('display', 'none', 'important');
          }
          const pModalEl = document.getElementById('profile-modal');
          if (pModalEl) pModalEl.classList.remove('active');
          const pubProfEl = document.getElementById('player-public-profile-modal');
          if (pubProfEl) {
            pubProfEl.classList.remove('active', 'visible');
            pubProfEl.style.display = 'none';
          }
          const guestModalEl = document.getElementById('guest-login-modal');
          if (guestModalEl) {
            guestModalEl.classList.remove('active', 'visible');
            guestModalEl.style.display = 'none';
          }
          if (this.chat && typeof this.chat.onRoundStart === 'function') {
            this.chat.onRoundStart();
          }
          if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
          }
          if (typeof window.focus === 'function') {
            window.focus();
          }

          if (this.previewSkinId) {
            this.previewSkinId = null;
            this.applySkin(this.selectedSkinId, false);
          }
          if (this.previewPipeSkinId) {
            this.previewPipeSkinId = null;
            this.applyPipeSkin(this.selectedPipeSkinId, false);
          }
          this.updatePreviewBanner();

          this.activeRunId = null;
          this.activeSeed = (typeof roundSeed === 'number' && roundSeed > 0) ? roundSeed : ((Math.floor(Math.random() * 0x7fffffff)) | 1);
          this.prng = createSeededPRNG(this.activeSeed);
          this.extremeSolver = (roundDiff === 'extreme' && typeof createExtremePipeSolver === 'function')
            ? createExtremePipeSolver(this.activeSeed, CONFIG)
            : null;
          this.lastExtremeFrameTime = 0;
          this.currentTick = 0;
          this.flapTicks = [];
          this.pendingFlap = false;
          this.queuedFlaps = 0;
          this.flapBufferTicks = 0;
          this.lastFlapTick = -2;
          this.lastQueueFlapTime = -1000;
          this.lastKbdQueueTime = -1000;
          this.lastPtrQueueTime = -1000;
          this.lastQueueSource = '';
          this.physicsAccumulator = 0;

          if (this.particlePool) {
            for (let i = 0; i < this.particlePool.length; i++) {
              this.particlePool[i].active = false;
              this.particlePool[i].mesh.visible = false;
            }
          }

          document.getElementById('start-screen').classList.remove('active');
          document.getElementById('gameover-screen').classList.remove('active');

          this.state = GAME_STATE.PLAYING;
          this.isStartingRun = false;
          this.score = 0;
          this.distanceSinceLastPipe = 0;
          this.updateHUD();

          this.clearPipes();
          if (roundDiff === 'extreme') {
            const extCfg = CONFIG.difficulties.extreme;
            const firstX = CONFIG.birdX + extCfg.firstPipeDist;
            for (let pIdx = 0; pIdx < 4; pIdx++) {
              this.spawnPipePair(firstX + pIdx * extCfg.spawnDistance);
            }
          } else {
            const firstNormalX = CONFIG.birdX + CONFIG.baseSpawnDistance;
            this.spawnPipePair(firstNormalX);
            this.spawnPipePair(firstNormalX + CONFIG.baseSpawnDistance);
            this.spawnPipePair(firstNormalX + CONFIG.baseSpawnDistance * 2);
          }

          this.simBirdY = CONFIG.birdStartY;
          this.prevBirdY = CONFIG.birdStartY;
          this.birdGroup.position.set(CONFIG.birdX, CONFIG.birdStartY, 0);
          this.birdGroup.rotation.set(0, 0, 0);
          this.birdMeshGroup.rotation.set(0, 0, 0);

          this.birdVelocityY = this.getDifficultyParams().flapImpulse;
          this.wingFlapBoost = 1.0;
          this.physicsAccumulator = 0;
          this.lastFrameTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          this.sound.playFlap();
        }

        async handleDuelRoundCrash() {
          const crashedRound = this.duelRoundPlaying || (this.activeDuelLobby && this.activeDuelLobby.currentRound) || 'easy';
          const achievedScore = this.score;
          const recordedFlaps = this.flapTicks ? this.flapTicks.slice() : [];
          const finalTicks = this.currentTick || 0;
          this.duelRoundFinishedLocal = true;
          this.duelSoloSpectateDelayUntil = Date.now() + 420;

          if (achievedScore > (this.localRecords[crashedRound] || 0)) {
            this.localRecords[crashedRound] = achievedScore;
            this.saveLocalRecords();
          }

          this.state = GAME_STATE.CRASHING;
          this.sound.playCollision();
          this.shakeTimer = 0.28;
          const flash = document.getElementById('damage-flash');
          if (flash) {
            flash.style.opacity = '0.72';
            setTimeout(() => { flash.style.opacity = '0'; }, 90);
          }
          this.spawnCrashParticles(this.birdGroup.position.x, this.birdGroup.position.y);

          setTimeout(() => {
            if (this.state === GAME_STATE.CRASHING) {
              this.state = GAME_STATE.START;
            }
          }, 320);

          this.pendingDuelRoundFinish = {
            lobbyId: this.activeDuelLobbyId,
            round: crashedRound,
            rawScore: achievedScore,
            flapTicks: recordedFlaps,
            totalTicks: finalTicks,
            lastAttemptAt: 0
          };
          await this.submitPendingDuelRoundFinish();
        }

        async submitPendingDuelRoundFinish() {
          const payload = this.pendingDuelRoundFinish;
          if (!payload || !payload.lobbyId || this._submittingDuelRoundFinish) return;
          if (!this.activeDuelLobbyId || payload.lobbyId !== this.activeDuelLobbyId) {
            this.pendingDuelRoundFinish = null;
            return;
          }
          this._submittingDuelRoundFinish = true;
          payload.lastAttemptAt = Date.now();
          try {
            const res = await this.apiRequest('/api/duels/round-finish', 'POST', {
              lobbyId: payload.lobbyId,
              clientId: this.duelClientId,
              guestUsername: this.getDuelDisplayUsername(),
              round: payload.round,
              rawScore: payload.rawScore,
              flapTicks: payload.flapTicks,
              totalTicks: payload.totalTicks
            });
            if (this.pendingDuelRoundFinish === payload) {
              this.pendingDuelRoundFinish = null;
            }
            if (res && res.runResult) {
              const rr = res.runResult;
              if (this.currentUser && rr.records) {
                this.currentUser.records = rr.records;
              }
              if (rr.leaderboards) {
                this.leaderboards = rr.leaderboards;
              }
              if (rr.timeframeLeaderboards) {
                this.timeframeLeaderboards = rr.timeframeLeaderboards;
              }
              if (rr.resetBoundaries) {
                this.resetBoundaries = rr.resetBoundaries;
              }
              this.renderLeaderboard(rr.entryId || null);
              if (typeof this.updateProfileRecordPills === 'function') {
                this.updateProfileRecordPills();
              }
            }
            if (res && res.lobby) {
              this.activeDuelLobby = res.lobby;
              this.syncDuelMatchState(res.lobby);
            }
          } catch (_) {
            this.fetchDuelsState();
          } finally {
            this._submittingDuelRoundFinish = false;
          }
        }

        sendDuelLiveTelemetryIfNeeded(now) {
          if (!this.activeDuelLobbyId || !this.duelRoundPlaying || this.duelRoundFinishedLocal) return;
          if (now - this.lastDuelTelemetrySentAt < 45) return;
          this.lastDuelTelemetrySentAt = now;

          const sentRound = this.duelRoundPlaying;
          const diff = this.getDifficultyParams();
          const pipeData = this.pipes.slice(0, 5).map(p => ({
            x: Number(p.x.toFixed(4)),
            bottomTopY: Number(p.bottomTopY.toFixed(4)),
            topBottomY: Number(p.topBottomY.toFixed(4)),
            gapCenterY: Number(p.gapCenterY.toFixed(4)),
            gapSize: Number(p.gapSize.toFixed(4))
          }));

          this.apiRequest('/api/duels/live-update', 'POST', {
            lobbyId: this.activeDuelLobbyId,
            clientId: this.duelClientId,
            guestUsername: this.getDuelDisplayUsername(),
            round: sentRound,
            score: this.score,
            birdY: Number(this.simBirdY.toFixed(4)),
            birdVelocityY: Number(this.birdVelocityY.toFixed(4)),
            rotZ: Number((this.birdGroup ? this.birdGroup.rotation.z : 0).toFixed(4)),
            alive: this.state === GAME_STATE.PLAYING,
            speed: Number((diff.speed || CONFIG.baseSpeed).toFixed(4)),
            pipes: pipeData
          }).then(res => {
            if (res && res.lobby) {
              if (this.duelRoundFinishedLocal && res.lobby.status === 'playing' && res.lobby.currentRound === sentRound) {
                return;
              }
              this.activeDuelLobby = res.lobby;
              if (res.lobby.status !== 'playing') {
                this.syncDuelMatchState(res.lobby);
              } else {
                this.updateDuelLiveHUD();
              }
            }
          }).catch(() => {});
        }

        updateDuelLiveHUD() {
          const lobby = this.activeDuelLobby;
          if (!lobby) return;
          const { me, opp } = this.getDuelMyAndOppSlots(lobby);
          const mult = lobby.currentMultiplier || 1;
          const rKey = lobby.currentRound || 'easy';

          const totalRnds = lobby.totalRounds || 4;
          const badgeEl = document.getElementById('duel-hud-round-badge');
          if (badgeEl) {
            const modeTag = lobby.isFriendly ? '🤝 FRIENDLY • ' : '🏆 RANKED • ';
            badgeEl.textContent = `${modeTag}ROUND ${lobby.currentRoundNumber}/${totalRnds} • ${(lobby.currentRoundLabel || 'EASY').toUpperCase()} (${mult}x)`;
          }

          const myRaw = this.state === GAME_STATE.PLAYING ? this.score : (me && me.rounds && me.rounds[rKey] ? me.rounds[rKey].rawScore : 0);
          const myPts = myRaw * mult;
          const prevRoundsPts = me && me.rounds
            ? (
                (rKey !== 'easy' ? (me.rounds.easy?.weightedScore || 0) : 0) +
                ((rKey === 'hard' || rKey === 'extreme') ? (me.rounds.medium?.weightedScore || 0) : 0) +
                (rKey === 'extreme' ? (me.rounds.hard?.weightedScore || 0) : 0)
              )
            : 0;

          const p1NameEl = document.getElementById('duel-hud-p1-name');
          const p1ScoreEl = document.getElementById('duel-hud-p1-score');
          const p1TotEl = document.getElementById('duel-hud-p1-total');
          if (p1NameEl) p1NameEl.textContent = me ? me.username : 'You';
          if (p1ScoreEl) p1ScoreEl.textContent = `${myRaw} (${myPts} pts)`;
          if (p1TotEl) p1TotEl.textContent = `Total: ${prevRoundsPts + myPts}`;

          const oppRaw = opp && opp.live ? opp.live.score : (opp && opp.rounds && opp.rounds[rKey] ? opp.rounds[rKey].rawScore : 0);
          const oppPts = oppRaw * mult;
          const oppDone = opp && opp.rounds && opp.rounds[rKey] ? opp.rounds[rKey].finished : false;

          const p2NameEl = document.getElementById('duel-hud-p2-name');
          const p2ScoreEl = document.getElementById('duel-hud-p2-score');
          const p2StatEl = document.getElementById('duel-hud-p2-status');
          if (p2NameEl) p2NameEl.textContent = opp ? opp.username : 'Opponent';
          if (p2ScoreEl) p2ScoreEl.textContent = `${oppRaw} (${oppPts} pts)`;
          if (p2StatEl) p2StatEl.textContent = oppDone ? '💥 Crashed' : '🟢 Flying';
        }

        // --------------------------------------------------------------------
        // JOIN MATCH & RANKED LEADERBOARD DOM RENDERING
        // --------------------------------------------------------------------
        updateDuelShopCoinsUI(explicitCoins = null) {
          const coinsEl = document.getElementById('duel-shop-coins-display');
          let rawCoins = explicitCoins;
          if (rawCoins === null || rawCoins === undefined) {
            if (this.myDuelStats && typeof this.myDuelStats.duelCoins === 'number') {
              rawCoins = this.myDuelStats.duelCoins;
            } else if (this.currentUser && typeof this.currentUser.duelCoins === 'number') {
              rawCoins = this.currentUser.duelCoins;
            } else {
              rawCoins = 0;
            }
          }
          const cleanCoins = Math.max(0, Math.round(Number(rawCoins) || 0));
          if (coinsEl) {
            coinsEl.textContent = String(cleanCoins);
          }
          if (!this._renderingDuelShop) {
            this._renderingDuelShop = true;
            try { this.renderDuelCasesShop(cleanCoins); } finally { this._renderingDuelShop = false; }
          }
        }

        renderDuelCasesShop(overrideCoins = null) {
          const container = document.getElementById('duel-shop-cases-container');
          if (!container || typeof BACKGROUND_CASES === 'undefined' || typeof BACKGROUND_SKINS === 'undefined') return;

          const coins = overrideCoins !== null
            ? Math.max(0, Math.round(Number(overrideCoins) || 0))
            : Math.max(0, Math.round(Number((this.currentUser && this.currentUser.duelCoins) ?? (this.myDuelStats && this.myDuelStats.duelCoins) ?? 0)));
          const isLoggedIn = Boolean(this.authToken && this.currentUser);
          const unlockedIdsSig = BACKGROUND_SKINS
            .filter(b => this.isCosmeticUnlocked(b))
            .map(b => b.id)
            .join(',');
          const renderSig = `${coins}|${isLoggedIn ? 1 : 0}|${this._caseSpinning ? 1 : 0}|${unlockedIdsSig}`;
          const prevGrid = container.querySelector ? container.querySelector('.duels-cases-grid') : null;
          if (container.dataset && container.dataset.shopRenderSig === renderSig && prevGrid) {
            return;
          }

          const savedGridScroll = prevGrid ? (prevGrid.scrollTop || 0) : 0;
          const savedContainerScroll = container.scrollTop || 0;
          const shopCardEl = container.closest ? container.closest('.duels-shop-card') : null;
          const savedCardScroll = shopCardEl ? (shopCardEl.scrollTop || 0) : 0;
          const duelsContainerEl = document.querySelector && document.querySelector('#view-duels .duels-container');
          const savedOuterScroll = duelsContainerEl ? (duelsContainerEl.scrollTop || 0) : 0;

          const tierClasses = {
            case_basic: 'case-tier-basic',
            case_pattern: 'case-tier-pattern',
            case_ultimate: 'case-tier-ultimate'
          };

          container.innerHTML = '';
          const grid = document.createElement('div');
          grid.className = 'duels-cases-grid';

          for (const box of BACKGROUND_CASES) {
            const boxItems = BACKGROUND_SKINS.filter(b => b.caseId === box.id);
            const ownedInCase = boxItems.filter(b => this.isCosmeticUnlocked(b)).length;
            const canAfford = isLoggedIn && coins >= box.price && !this._caseSpinning;

            const card = document.createElement('div');
            card.className = `duel-case-card ${tierClasses[box.id] || ''}`;

            const chipsHtml = boxItems.map(item => {
              const is1Pct = item.id === 'bg_custom_image';
              const is01Pct = item.id === 'bg_custom_video';
              const extraCls = is01Pct ? ' special-01pct' : (is1Pct ? ' special-1pct' : '');
              const ownedMark = this.isCosmeticUnlocked(item) ? ' ✓' : '';
              return `<span class="duel-case-chip${extraCls}" title="${item.desc}">${item.emoji} ${item.name} (${item.dropPct}%)${ownedMark}</span>`;
            }).join('');

            card.innerHTML = `
              <div class="duel-case-top">
                <div class="duel-case-title-wrap">
                  <div class="duel-case-icon">${box.emoji}</div>
                  <div>
                    <div class="duel-case-name">${box.name}</div>
                    <div class="duel-case-sub">${box.subtitle}</div>
                  </div>
                </div>
                <span class="duel-case-owned-pill">${ownedInCase}/${boxItems.length} Owned</span>
              </div>
              <div class="duel-case-preview-chips">${chipsHtml}</div>
              <div class="duel-case-footer">
                <span class="duel-case-price">🪙 ${box.price} Coins</span>
                <button type="button" class="btn-open-case" id="btn-open-${box.id}" data-case="${box.id}" ${canAfford ? '' : 'disabled'}>
                  ${!isLoggedIn ? '🔑 Log in to Open' : (coins < box.price ? `Need ${box.price - coins} More 🪙` : `🎲 Open Case (${box.price} 🪙)`)}
                </button>
              </div>
            `;

            const openBtn = card.querySelector('.btn-open-case');
            if (openBtn) {
              openBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openDuelCaseWithAnimation(box.id);
              });
            }
            grid.appendChild(card);
          }

          container.appendChild(grid);
          if (container.dataset) container.dataset.shopRenderSig = renderSig;

          const restoreScrolls = () => {
            if (savedGridScroll) grid.scrollTop = savedGridScroll;
            if (savedContainerScroll) container.scrollTop = savedContainerScroll;
            if (shopCardEl && savedCardScroll) shopCardEl.scrollTop = savedCardScroll;
            if (duelsContainerEl && savedOuterScroll) duelsContainerEl.scrollTop = savedOuterScroll;
          };
          restoreScrolls();
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(restoreScrolls);
          }
        }

        async openDuelCaseWithAnimation(caseId) {
          if (this._caseSpinning) return;
          if (!this.authToken || !this.currentUser) {
            this.showLockerToast('🔑 Please log in to open Background Cases!', true);
            return;
          }

          this._caseSpinning = true;
          this.renderDuelCasesShop();

          try {
            const res = await this.apiRequest('/api/shop/open-case', 'POST', { caseId });
            if (!res || !res.ok || !res.wonItem) {
              throw new Error('Could not open case.');
            }

            // Update balance & unlocks immediately from authoritative server result
            this.currentUser.duelCoins = res.newBalance;
            this.currentUser.unlockedBackgrounds = Array.isArray(res.unlockedBackgrounds) ? res.unlockedBackgrounds : [];
            if (this.myDuelStats) this.myDuelStats.duelCoins = res.newBalance;

            const modal = document.getElementById('case-spinner-modal');
            const badgeEl = document.getElementById('case-spinner-badge');
            const titleEl = document.getElementById('case-spinner-title');
            const viewportEl = document.getElementById('case-spinner-viewport');
            const trackEl = document.getElementById('case-spinner-track');
            const resultEl = document.getElementById('case-spinner-result');
            const actionsEl = document.getElementById('case-spinner-actions');
            const closeBtn = document.getElementById('case-spinner-close-btn');
            const doneBtn = document.getElementById('btn-case-done');
            const equipBtn = document.getElementById('btn-case-equip-won');
            const gotoUploadBtn = document.getElementById('btn-case-goto-upload');

            const won = res.wonItem;
            const winIdx = typeof res.winIndex === 'number' ? res.winIndex : 38;
            const reel = Array.isArray(res.spinReel) && res.spinReel.length > 0 ? res.spinReel : [won];

            if (modal && trackEl) {
              modal.style.display = 'flex';
              modal.classList.add('active');
              if (badgeEl) badgeEl.textContent = `📦 OPENING ${String(res.caseName || 'CASE').toUpperCase()}...`;
              if (titleEl) titleEl.textContent = 'Spinning for a Background Skin...';
              if (resultEl) resultEl.style.display = 'none';
              if (actionsEl) actionsEl.style.display = 'none';

              trackEl.style.transform = 'translateX(0px)';
              trackEl.innerHTML = reel.map((slot) => {
                const cols = Array.isArray(slot.colors) && slot.colors.length >= 2 ? slot.colors : ['#1e293b', '#38bdf8'];
                const bgStyle = slot.pattern === 'solid'
                  ? cols[0]
                  : `linear-gradient(135deg, ${cols[0]} 0%, ${cols[1]} 65%, ${cols[2] || cols[1]} 100%)`;
                const mythicCls = slot.dropPct <= 1 ? ' is-mythic-tile' : '';
                return `
                  <div class="case-spin-tile${mythicCls}" style="background:${bgStyle};">
                    <span class="case-spin-tile-emoji">${slot.emoji || '🎨'}</span>
                    <span class="case-spin-tile-name">${slot.name || ''}</span>
                    <span class="case-spin-tile-pct">${slot.dropPct || 0}%</span>
                  </div>
                `;
              }).join('');

              const STRIDE = 114;
              const TILE_W = 106;
              const PAD_LEFT = 12;
              const vpW = (viewportEl && viewportEl.clientWidth) ? viewportEl.clientWidth : 580;
              const jitter = (Math.random() - 0.5) * 44;
              const targetX = (vpW * 0.5) - (PAD_LEFT + winIdx * STRIDE + TILE_W * 0.5) + jitter;

              if (this._caseAnimRaf) cancelAnimationFrame(this._caseAnimRaf);

              const revealResult = () => {
                const resSwatch = document.getElementById('case-result-swatch');
                const resRarity = document.getElementById('case-result-rarity');
                const resStatus = document.getElementById('case-result-status');
                const resName = document.getElementById('case-result-name');
                const resDesc = document.getElementById('case-result-desc');

                if (badgeEl) badgeEl.textContent = res.isDuplicate ? '🪙 DUPLICATE REFUND' : '🎉 UNBOXED BACKGROUND!';
                if (titleEl) titleEl.textContent = `You unboxed ${won.emoji || '🎨'} ${won.name}!`;
                if (resSwatch) {
                  const cols = Array.isArray(won.colors) && won.colors.length >= 2 ? won.colors : ['#1e293b', '#38bdf8'];
                  resSwatch.textContent = won.emoji || '🎨';
                  resSwatch.style.background = won.pattern === 'solid'
                    ? cols[0]
                    : `linear-gradient(135deg, ${cols[0]}, ${cols[1]})`;
                }
                if (resRarity) {
                  resRarity.textContent = `${won.rarity || 'RARE'} (${won.dropPct}%)`;
                  resRarity.className = `rarity-tag rarity-${won.rarity || 'RARE'}`;
                }
                if (resStatus) {
                  resStatus.textContent = res.isDuplicate
                    ? `🔁 Already Owned — Refunded +${res.refundCoins || 0} 🪙!`
                    : '✨ NEWLY UNLOCKED!';
                }
                if (resName) resName.textContent = won.name;
                if (resDesc) resDesc.textContent = won.desc || '';
                if (resultEl) resultEl.style.display = 'flex';
                if (actionsEl) actionsEl.style.display = 'flex';

                if (gotoUploadBtn) {
                  const isCustomUpload = won.id === 'bg_custom_image' || won.id === 'bg_custom_video';
                  gotoUploadBtn.style.display = isCustomUpload ? 'inline-flex' : 'none';
                  gotoUploadBtn.onclick = () => {
                    closeSpinnerModal();
                    this.applyBackgroundSkin(won.id, true);
                    this.switchView('skins');
                    if (typeof this.switchLockerTabFn === 'function') this.switchLockerTabFn('bg');
                  };
                }
                if (equipBtn) {
                  equipBtn.onclick = () => {
                    this.applyBackgroundSkin(won.id, true);
                    closeSpinnerModal();
                  };
                }
              };

              const closeSpinnerModal = () => {
                if (this._caseAnimRaf) {
                  cancelAnimationFrame(this._caseAnimRaf);
                  this._caseAnimRaf = null;
                }
                modal.style.display = 'none';
                modal.classList.remove('active');
              };

              if (closeBtn) closeBtn.onclick = closeSpinnerModal;
              if (doneBtn) doneBtn.onclick = closeSpinnerModal;

              const startAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
              const DURATION = 3200;
              let lastTickBucket = -1;

              const step = () => {
                const nowT = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                const elapsed = Math.min(1, (nowT - startAt) / DURATION);
                const eased = 1 - Math.pow(1 - elapsed, 3.2);
                const curX = targetX * eased;
                trackEl.style.transform = `translateX(${curX.toFixed(1)}px)`;

                const bucket = Math.floor(((-curX) + vpW * 0.5) / STRIDE);
                if (bucket !== lastTickBucket) {
                  lastTickBucket = bucket;
                  if (this.sound && typeof this.sound.playFlap === 'function' && elapsed < 0.96) {
                    try { this.sound.playFlap(); } catch (_) {}
                  }
                }

                if (elapsed < 1 && modal.style.display !== 'none') {
                  this._caseAnimRaf = requestAnimationFrame(step);
                } else {
                  this._caseAnimRaf = null;
                  if (this.sound && typeof this.sound.playScore === 'function') {
                    try { this.sound.playScore(); } catch (_) {}
                  }
                  revealResult();
                }
              };

              if (typeof requestAnimationFrame === 'function') {
                this._caseAnimRaf = requestAnimationFrame(step);
              } else {
                trackEl.style.transform = `translateX(${targetX}px)`;
                revealResult();
              }
            }

            this.updateDuelShopCoinsUI(res.newBalance);
            this.updateProfileRecordPills();
            if (typeof this.renderBgSkinsGrid === 'function') this.renderBgSkinsGrid();
          } catch (err) {
            this.showLockerToast(`❌ ${err.message || 'Failed to open case.'}`, true);
          } finally {
            this._caseSpinning = false;
            this.renderDuelCasesShop();
          }
        }

        renderDuelLobbiesList() {
          this.updateDuelShopCoinsUI();
          const isMeDonut = this.isMeDonutUser();
          const adminBar = document.getElementById('duel-medonut-admin-bar');
          if (adminBar) {
            adminBar.style.display = isMeDonut ? 'flex' : 'none';
          }
          const callBotWaitBtn = document.getElementById('btn-duel-call-bot-waiting');
          if (callBotWaitBtn) {
            callBotWaitBtn.style.display = isMeDonut ? 'inline-flex' : 'none';
          }

          const eloDisplay = document.getElementById('duel-my-elo-display');
          const wlDisplay = document.getElementById('duel-my-wl-display');
          if (eloDisplay) {
            eloDisplay.textContent = String(this.myDuelStats.duelElo || (this.currentUser && this.currentUser.duelElo) || 1000);
          }
          if (wlDisplay) {
            wlDisplay.textContent = `${this.myDuelStats.duelWins || 0}W - ${this.myDuelStats.duelLosses || 0}L`;
          }

          const waitingBanner = document.getElementById('duel-waiting-room-banner');
          if (waitingBanner) {
            if (this.activeDuelLobby && this.activeDuelLobby.status === 'waiting') {
              waitingBanner.style.display = 'flex';
              const wTitle = document.getElementById('duel-waiting-room-title');
              if (wTitle) {
                const modeLabel = this.activeDuelLobby.isFriendly ? '🤝 Friendly (0 ELO)' : '🏆 Ranked (ELO)';
                const lockLabel = this.activeDuelLobby.hasPassword ? ' • 🔒 Password' : '';
                wTitle.textContent = `[${modeLabel}${lockLabel}] Lobby "${this.activeDuelLobby.name}" — Waiting for Opponent...`;
              }
            } else {
              waitingBanner.style.display = 'none';
            }
          }

          const countEl = document.getElementById('duel-lobby-count');
          if (countEl) countEl.textContent = String(this.duelLobbies.length);

          const listEl = document.getElementById('duel-lobbies-list');
          if (!listEl) return;
          listEl.innerHTML = '';

          if (this.duelLobbies.length === 0) {
            listEl.innerHTML = `
              <div class="duels-empty-state">
                <div class="duels-empty-icon">⚔️</div>
                <div class="duels-empty-title">No Active Lobbies Right Now</div>
                <div class="duels-empty-sub">Click <strong>Quick Match</strong> above or open <strong>Create Match</strong> to start a Ranked Duel!</div>
              </div>
            `;
            return;
          }

          for (const lobby of this.duelLobbies) {
            const row = document.createElement('div');
            row.className = 'duel-lobby-row';

            const isWaiting = lobby.status === 'waiting';
            const p1 = lobby.players && lobby.players[0] ? lobby.players[0] : null;
            const p2 = lobby.players && lobby.players[1] ? lobby.players[1] : null;
            const isMyWaitingLobby = isWaiting && p1 && p1.slotId === this.duelClientId;

            const totalRnds = lobby.totalRounds || 4;
            let statusText = '🟢 Waiting (1/2)';
            if (lobby.status === 'countdown') {
              statusText = `⏱️ Starting Round ${lobby.currentRoundNumber}/${totalRnds} (${lobby.currentRoundLabel} ${lobby.currentMultiplier}x)`;
            } else if (lobby.status === 'playing') {
              statusText = `🔥 Round ${lobby.currentRoundNumber}/${totalRnds}: ${lobby.currentRoundLabel} (${lobby.currentMultiplier}x)`;
            } else if (lobby.status === 'round_summary') {
              statusText = `📊 Round ${lobby.currentRoundNumber}/${totalRnds} Results`;
            }

            const infoDiv = document.createElement('div');
            infoDiv.className = 'duel-lobby-info';

            const topLine = document.createElement('div');
            topLine.className = 'duel-lobby-top-line';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'duel-lobby-name';
            nameSpan.textContent = lobby.name || 'Duel Lobby';

            const modeSpan = document.createElement('span');
            modeSpan.className = 'duel-mode-tag ' + (lobby.isFriendly ? 'friendly' : 'ranked');
            modeSpan.textContent = lobby.isFriendly ? '🤝 Friendly (No ELO)' : '🏆 Ranked (ELO)';

            topLine.append(nameSpan, modeSpan);

            if (lobby.hasPassword) {
              const lockSpan = document.createElement('span');
              lockSpan.className = 'duel-lock-tag';
              lockSpan.textContent = '🔒 Password';
              topLine.appendChild(lockSpan);
            }

            const myCurrentElo = Number(this.myDuelStats && typeof this.myDuelStats.duelElo === 'number'
              ? this.myDuelStats.duelElo
              : (this.currentUser && typeof this.currentUser.duelElo === 'number' ? this.currentUser.duelElo : 1000));
            const hostElo = p1 && typeof p1.elo === 'number' ? p1.elo : 1000;
            const isEloGapBlocked = Boolean(
              isWaiting &&
              !lobby.isFriendly &&
              this.duelEloGapBlockedOver150 &&
              p1 &&
              Math.abs(hostElo - myCurrentElo) > 150
            );
            if (isEloGapBlocked) {
              const eloLockSpan = document.createElement('span');
              eloLockSpan.className = 'duel-elo-lock-tag';
              eloLockSpan.textContent = `⛔ >150 ELO Gap (${Math.abs(hostElo - myCurrentElo)})`;
              topLine.appendChild(eloLockSpan);
            }

            const statusSpan = document.createElement('span');
            statusSpan.className = 'duel-lobby-status-tag ' + (isWaiting ? 'waiting' : 'ongoing');
            statusSpan.textContent = statusText;

            topLine.appendChild(statusSpan);

            const playersLine = document.createElement('div');
            playersLine.className = 'duel-lobby-players-line';

            const p1Chip = document.createElement('span');
            p1Chip.className = 'duel-player-elo-chip';
            p1Chip.innerHTML = `👤 <strong>${this.escapeHtml(p1 ? p1.username : 'Host')}</strong> <span class="elo-tag">🏆 ${p1 ? p1.elo : 1000} ELO</span>` +
              (!isWaiting && p1 ? ` <span>(${p1.totalPoints || 0} pts)</span>` : '');

            const vsSpan = document.createElement('span');
            vsSpan.className = 'duel-vs-text';
            vsSpan.textContent = 'VS';

            const p2Chip = document.createElement('span');
            if (p2) {
              p2Chip.className = 'duel-player-elo-chip';
              p2Chip.innerHTML = `👤 <strong>${this.escapeHtml(p2.username)}</strong> <span class="elo-tag">🏆 ${p2.elo} ELO</span>` +
                (!isWaiting ? ` <span>(${p2.totalPoints || 0} pts)</span>` : '');
            } else {
              p2Chip.className = 'duel-player-elo-chip open-slot';
              p2Chip.textContent = '⏳ Open Slot (Waiting for Player)';
            }

            playersLine.append(p1Chip, vsSpan, p2Chip);
            infoDiv.append(topLine, playersLine);

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'duel-lobby-actions';

            if (isWaiting && (!lobby.players || lobby.players.length < 2) && !isMyWaitingLobby) {
              const joinBtn = document.createElement('button');
              joinBtn.type = 'button';
              joinBtn.className = 'btn-duel-join-lobby' + (isEloGapBlocked ? ' elo-blocked' : '');
              if (isEloGapBlocked) {
                joinBtn.textContent = '⛔ >150 ELO Gap';
                joinBtn.title = `MeDonut enabled the 150 ELO limit. Diff: ${Math.abs(hostElo - myCurrentElo)} ELO.`;
              } else {
                joinBtn.textContent = lobby.hasPassword ? '🔑 Unlock & Join' : '⚔️ Join';
              }
              joinBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleDuelJoinLobby(lobby.id);
              });
              actionsDiv.appendChild(joinBtn);
            }

            if (isWaiting && (!lobby.players || lobby.players.length < 2) && isMeDonut) {
              const botBtn = document.createElement('button');
              botBtn.type = 'button';
              botBtn.className = 'btn-duel-bot-action';
              botBtn.textContent = '🤖 Call Bot';
              botBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleDuelCallBot('join_or_start', lobby.id);
              });
              actionsDiv.appendChild(botBtn);
            }

            const specBtn = document.createElement('button');
            specBtn.type = 'button';
            specBtn.className = 'btn-duel-spectate-lobby';
            specBtn.textContent = '👁️ Spectate';
            specBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.startSpectatingDuel(lobby.id);
            });
            actionsDiv.appendChild(specBtn);

            row.append(infoDiv, actionsDiv);
            listEl.appendChild(row);
          }
        }

        renderDuelRankedLeaderboard() {
          const isPointsMode = this.currentDuelRankedMode === 'points';
          const isMeDonut = this.isMeDonutUser();
          const titleEl = document.getElementById('duel-ranked-title');
          const subEl = document.getElementById('duel-ranked-sub');
          if (titleEl) {
            titleEl.textContent = isPointsMode ? '🔥 Most Points in 1 Ranked Game' : '🏆 Ranked Elo Leaderboard';
          }
          if (subEl) {
            subEl.textContent = isPointsMode
              ? 'Best total points in a single 4-round duel (Easy 1x + Med 2x + Hard 3x + Extreme 10x) • 1 placement per player'
              : '1 placement per player • Beat higher Elo opponents to gain more rating!';
          }

          const myPill = document.getElementById('duel-ranked-my-pill');
          if (myPill) {
            if (isPointsMode) {
              const hsRank = this.myDuelStats.highScoreRank ? `Rank #${this.myDuelStats.highScoreRank}` : 'Unranked';
              myPill.textContent = `${hsRank} • 🔥 ${this.myDuelStats.duelBestMatchPoints || 0} PTS`;
            } else {
              const rText = this.myDuelStats.rank ? `Rank #${this.myDuelStats.rank}` : 'Unranked';
              myPill.textContent = `${rText} • 🏆 ${this.myDuelStats.duelElo || 1000} ELO`;
            }
          }

          const listEl = document.getElementById('duel-ranked-list');
          if (!listEl) return;

          // If MeDonut is currently typing inside an Elo input in this list, don't wipe focus on background poll
          if (!isPointsMode && document.activeElement && listEl.contains(document.activeElement) && document.activeElement.classList.contains('duel-elo-admin-input')) {
            return;
          }

          listEl.innerHTML = '';

          const myUKey = this.getDuelDisplayUsername().toLowerCase();

          if (isPointsMode) {
            const entries = Array.isArray(this.duelHighScoreLeaderboard) ? this.duelHighScoreLeaderboard : [];
            if (entries.length === 0) {
              listEl.innerHTML = '<div class="lb-empty">No completed ranked matches recorded yet. Finish a 4-round duel to set a record!</div>';
              return;
            }
            for (const entry of entries) {
              const row = document.createElement('div');
              const isMe = entry.username.toLowerCase() === myUKey;
              row.className = 'duel-ranked-row' + (isMe ? ' is-me' : '');

              const leftDiv = document.createElement('div');
              leftDiv.className = 'duel-ranked-left';

              const posSpan = document.createElement('span');
              posSpan.className = 'duel-ranked-pos' + (entry.rank <= 3 ? ` top-${entry.rank}` : '');
              posSpan.textContent = entry.rank === 1 ? '🥇 #1' : (entry.rank === 2 ? '🥈 #2' : (entry.rank === 3 ? '🥉 #3' : `#${entry.rank}`));

              const userSpan = document.createElement('span');
              userSpan.className = 'duel-ranked-user';
              userSpan.textContent = entry.username;
              userSpan.addEventListener('click', (e) => {
                e.stopPropagation();
                if (typeof this.openPublicProfileModal === 'function') {
                  this.openPublicProfileModal(entry.username);
                }
              });

              leftDiv.append(posSpan, userSpan);

              const rightDiv = document.createElement('div');
              rightDiv.className = 'duel-ranked-right';

              const bdSpan = document.createElement('span');
              bdSpan.className = 'duel-ranked-breakdown';
              const oppSuffix = entry.opponent ? ` vs ${entry.opponent}` : '';
              bdSpan.textContent = `E:${entry.easyRaw || 0} • M:${entry.mediumRaw || 0} • H:${entry.hardRaw || 0} • ⚡:${entry.extremeRaw || 0}${oppSuffix}`;

              const ptsSpan = document.createElement('span');
              ptsSpan.className = 'duel-ranked-points-badge';
              ptsSpan.textContent = `🔥 ${entry.points} PTS`;

              rightDiv.append(bdSpan, ptsSpan);
              row.append(leftDiv, rightDiv);
              listEl.appendChild(row);
            }
            return;
          }

          if (!Array.isArray(this.duelRankedLeaderboard) || this.duelRankedLeaderboard.length === 0) {
            listEl.innerHTML = '<div class="lb-empty">No ranked players found yet.</div>';
            return;
          }

          for (const entry of this.duelRankedLeaderboard) {
            const row = document.createElement('div');
            const isMe = entry.username.toLowerCase() === myUKey;
            row.className = 'duel-ranked-row' + (isMe ? ' is-me' : '');

            const leftDiv = document.createElement('div');
            leftDiv.className = 'duel-ranked-left';

            const posSpan = document.createElement('span');
            posSpan.className = 'duel-ranked-pos' + (entry.rank <= 3 ? ` top-${entry.rank}` : '');
            posSpan.textContent = entry.rank === 1 ? '🥇 #1' : (entry.rank === 2 ? '🥈 #2' : (entry.rank === 3 ? '🥉 #3' : `#${entry.rank}`));

            const userSpan = document.createElement('span');
            userSpan.className = 'duel-ranked-user';
            userSpan.textContent = entry.username;
            userSpan.addEventListener('click', (e) => {
              e.stopPropagation();
              if (typeof this.openPublicProfileModal === 'function') {
                this.openPublicProfileModal(entry.username);
              }
            });

            leftDiv.append(posSpan, userSpan);

            const rightDiv = document.createElement('div');
            rightDiv.className = 'duel-ranked-right';

            const wlSpan = document.createElement('span');
            wlSpan.className = 'duel-ranked-wl';
            wlSpan.textContent = `${entry.duelWins || 0}W - ${entry.duelLosses || 0}L`;

            const eloSpan = document.createElement('span');
            eloSpan.className = 'duel-ranked-elo-badge';
            eloSpan.textContent = `🏆 ${entry.duelElo} ELO`;

            rightDiv.append(wlSpan, eloSpan);

            if (isMeDonut) {
              const editWrap = document.createElement('div');
              editWrap.className = 'duel-elo-admin-edit-wrap';

              const eloInp = document.createElement('input');
              eloInp.type = 'number';
              eloInp.min = '0';
              eloInp.step = '10';
              eloInp.className = 'duel-elo-admin-input';
              eloInp.value = String(entry.duelElo || 1000);
              eloInp.title = `Change ${entry.username}'s Ranked Elo`;
              eloInp.addEventListener('click', (e) => e.stopPropagation());
              eloInp.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  this.handleDuelAdminSetElo(entry.username, eloInp.value);
                  eloInp.blur();
                }
              });

              const saveBtn = document.createElement('button');
              saveBtn.type = 'button';
              saveBtn.className = 'btn-duel-save-elo';
              saveBtn.textContent = '💾 Elo';
              saveBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleDuelAdminSetElo(entry.username, eloInp.value);
              });

              editWrap.append(eloInp, saveBtn);
              rightDiv.appendChild(editWrap);
            }

            row.append(leftDiv, rightDiv);
            listEl.appendChild(row);
          }
        }

        escapeHtml(str) {
          return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        }

        // --------------------------------------------------------------------
        // SPLIT-SCREEN & SOLO OPPONENT SPECTATOR ENGINE (Snapshot Interpolation)
        // --------------------------------------------------------------------
        getDefaultSpectatorPipes() {
          return [
            { x: 3.5, bottomTopY: 3.3, topBottomY: 8.3, gapCenterY: 5.8, gapSize: 5.0 },
            { x: 11.5, bottomTopY: 4.7, topBottomY: 9.7, gapCenterY: 7.2, gapSize: 5.0 },
            { x: 19.5, bottomTopY: 2.7, topBottomY: 7.7, gapCenterY: 5.2, gapSize: 5.0 }
          ];
        }

        createEmptySpecSim() {
          return {
            y: CONFIG.birdStartY,
            vy: 0,
            prevVy: 0,
            rotZ: 0,
            alive: true,
            speed: 0,
            lastLiveUpdatedAt: 0,
            selectedSkin: 'classic',
            selectedPipeSkin: 'classic_pipe',
            wingPhase: 0,
            wingFlapBoost: 0,
            pipes: this.getDefaultSpectatorPipes(),
            snapshots: []
          };
        }

        getSpectatorRenderServerTime(dt = 0.016) {
          const localNow = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          const estServerNow = (this._specServerClockOffset !== null)
            ? (localNow + this._specServerClockOffset)
            : Date.now();
          const targetRenderTs = estServerNow - 240;
          if (!this._lastRenderServerTime || Math.abs(targetRenderTs - this._lastRenderServerTime) > 1100) {
            this._lastRenderServerTime = targetRenderTs;
          } else {
            // Smooth frame-dt servo: advances continuously every frame (60Hz/120Hz/144Hz) without micro-freezes or snaps
            const errMs = targetRenderTs - this._lastRenderServerTime;
            const rate = THREE.MathUtils.clamp(1 + errMs * 0.0018, 0.90, 1.12);
            this._lastRenderServerTime += Math.min(0.05, Math.max(0.001, dt)) * 1000 * rate;
          }
          return this._lastRenderServerTime;
        }

        pushSpectatorSnapshot(simTarget, p, lobbyStatus, rObjFinished = false) {
          if (!simTarget || !p) return;
          simTarget.selectedSkin = p.selectedSkin || 'classic';
          simTarget.selectedPipeSkin = p.selectedPipeSkin || 'classic_pipe';
          if (!p.live) return;

          const liveTs = Number(p.live.updatedAt) || 0;
          const isAliveNow = Boolean(p.live.alive && !rObjFinished);
          simTarget.alive = isAliveNow;

          if (!Array.isArray(simTarget.snapshots)) simTarget.snapshots = [];
          if (liveTs > (simTarget.lastLiveUpdatedAt || 0) || simTarget.snapshots.length === 0) {
            const newVy = typeof p.live.birdVelocityY === 'number' ? p.live.birdVelocityY : 0;
            const isFlapTick = Boolean(newVy > 2.0 && newVy > (simTarget.prevVy || 0) + 1.2);
            simTarget.prevVy = newVy;

            const newY = typeof p.live.birdY === 'number' ? p.live.birdY : CONFIG.birdStartY;
            const newRotZ = typeof p.live.rotZ === 'number' ? p.live.rotZ : 0;
            const newSpeed = (typeof p.live.speed === 'number' && p.live.speed > 0) ? p.live.speed : 0;
            const snapPipes = (Array.isArray(p.live.pipes) && p.live.pipes.length > 0)
              ? p.live.pipes.map(pp => ({ ...pp }))
              : (lobbyStatus !== 'playing' ? this.getDefaultSpectatorPipes() : []);

            const tsToStore = liveTs > 0 ? liveTs : Date.now();
            simTarget.lastLiveUpdatedAt = Math.max(simTarget.lastLiveUpdatedAt || 0, tsToStore);
            simTarget.y = newY;
            simTarget.vy = newVy;
            simTarget.rotZ = newRotZ;
            if (newSpeed > 0) simTarget.speed = newSpeed;
            if (snapPipes.length > 0) simTarget.pipes = snapPipes;

            simTarget.snapshots.push({
              ts: tsToStore,
              y: newY,
              vy: newVy,
              rotZ: newRotZ,
              speed: newSpeed,
              alive: isAliveNow,
              isFlapTick,
              pipes: snapPipes
            });
            simTarget.snapshots.sort((a, b) => a.ts - b.ts);
            if (simTarget.snapshots.length > 24) {
              simTarget.snapshots.splice(0, simTarget.snapshots.length - 24);
            }
          }
        }

        evaluateSpectatorSimAt(sim, renderServerTime, dt, defaultSpeed, isPlaying) {
          sim.wingFlapBoost = Math.max(0, (sim.wingFlapBoost || 0) - dt * 2.5);
          const wingSpeed = isPlaying ? (sim.alive ? (12 + sim.wingFlapBoost * 18) : 0) : 11;
          sim.wingPhase = (sim.wingPhase || 0) + dt * wingSpeed;

          if (!isPlaying) {
            sim.renderY = CONFIG.birdStartY + Math.sin(this.elapsedTime * 3.6) * 0.4;
            sim.renderRotZ = Math.cos(this.elapsedTime * 3.6) * 0.08;
            sim.renderPipes = this.getDefaultSpectatorPipes();
            return;
          }

          if (!sim.alive) {
            if (typeof sim.renderY !== 'number') sim.renderY = sim.y || CONFIG.birdStartY;
            if (sim.renderY > CONFIG.groundY + CONFIG.birdRadius) {
              sim.vy = Math.max(CONFIG.maxFallSpeed, (sim.vy || 0) + CONFIG.gravity * 1.2 * dt);
              sim.renderY = Math.max(CONFIG.groundY + CONFIG.birdRadius, sim.renderY + sim.vy * dt);
            }
            sim.renderRotZ = THREE.MathUtils.lerp(sim.renderRotZ || 0, -Math.PI * 0.42, Math.min(1, dt * 10));
            if (!Array.isArray(sim.renderPipes) || sim.renderPipes.length === 0) {
              sim.renderPipes = (Array.isArray(sim.pipes) && sim.pipes.length > 0) ? sim.pipes : this.getDefaultSpectatorPipes();
            }
            return;
          }

          const snaps = Array.isArray(sim.snapshots) ? sim.snapshots : [];
          if (snaps.length === 0) {
            sim.renderY = typeof sim.y === 'number' ? sim.y : CONFIG.birdStartY;
            sim.renderRotZ = typeof sim.rotZ === 'number' ? sim.rotZ : 0;
            sim.renderPipes = (Array.isArray(sim.pipes) && sim.pipes.length > 0) ? sim.pipes : this.getDefaultSpectatorPipes();
            return;
          }

          // Prune stale snapshots older than renderServerTime - 700 while keeping at least the newest 2
          while (snaps.length > 2 && snaps[1].ts < renderServerTime - 700) {
            snaps.shift();
          }

          const first = snaps[0];
          const last = snaps[snaps.length - 1];

          if (renderServerTime <= first.ts || snaps.length === 1) {
            if (renderServerTime <= last.ts) {
              sim.renderY = first.y;
              sim.renderRotZ = first.rotZ;
              sim.renderPipes = first.pipes.length > 0 ? first.pipes : this.getDefaultSpectatorPipes();
              return;
            }
          }

          if (renderServerTime >= last.ts) {
            const overSec = Math.min(0.28, Math.max(0, (renderServerTime - last.ts) / 1000));
            const spd = (last.speed && last.speed > 0) ? last.speed : ((sim.speed && sim.speed > 0) ? sim.speed : defaultSpeed);
            const speedRatio = Math.min(2.0, spd / CONFIG.baseSpeed);
            const highSpeedFactor = Math.max(0, Math.min(1, (speedRatio - 1.15) / 0.70));
            const fallSlowdown = 1.0 - 0.20 * highSpeedFactor;
            const simGravity = CONFIG.gravity * speedRatio * speedRatio * fallSlowdown;

            const extrapVy = Math.max(CONFIG.maxFallSpeed * speedRatio * fallSlowdown, last.vy + simGravity * overSec);
            const avgVy = 0.5 * (last.vy + extrapVy);
            sim.renderY = Math.max(CONFIG.groundY + CONFIG.birdRadius, Math.min(CONFIG.ceilingY, last.y + avgVy * overSec));
            const targetPitch = THREE.MathUtils.clamp((extrapVy / speedRatio) * 0.065, -Math.PI * 0.42, Math.PI * 0.24);
            sim.renderRotZ = THREE.MathUtils.lerp(
              typeof sim.renderRotZ === 'number' ? sim.renderRotZ : targetPitch,
              targetPitch,
              Math.min(1, dt * 16)
            );
            const srcPipes = last.pipes.length > 0 ? last.pipes : this.getDefaultSpectatorPipes();
            sim.renderPipes = srcPipes.map(pp => ({ ...pp, x: pp.x - spd * overSec }));
            return;
          }

          // Interpolate between bracketing snapshots [snapA, snapB] using ballistic Flappy Bird gravity kinematics
          let snapA = first;
          let snapB = last;
          for (let i = 0; i < snaps.length - 1; i++) {
            if (snaps[i].ts <= renderServerTime && snaps[i + 1].ts >= renderServerTime) {
              snapA = snaps[i];
              snapB = snaps[i + 1];
              break;
            }
          }

          const spanMs = Math.max(1, snapB.ts - snapA.ts);
          const spanSec = spanMs / 1000;
          const t = THREE.MathUtils.clamp((renderServerTime - snapA.ts) / spanMs, 0, 1);
          const spd = (snapB.speed && snapB.speed > 0) ? snapB.speed : ((snapA.speed && snapA.speed > 0) ? snapA.speed : defaultSpeed);
          const speedRatio = Math.max(0.5, Math.min(2.0, spd / CONFIG.baseSpeed));
          const highSpeedFactor = Math.max(0, Math.min(1, (speedRatio - 1.15) / 0.70));
          const fallSlowdown = 1.0 - 0.20 * highSpeedFactor;
          const simGravity = CONFIG.gravity * speedRatio * speedRatio * fallSlowdown;

          let nextY;
          let curVy;
          if (!snapB.isFlapTick && snapB.vy <= snapA.vy + 1.2 && spanSec <= 0.35) {
            // Pure ballistic fall/glide parabola blended forward from A and backward from B for seamless C1 continuity
            const dtFwd = spanSec * t;
            const dtBwd = spanSec * (1 - t);
            const yFwd = snapA.y + snapA.vy * dtFwd + 0.5 * simGravity * dtFwd * dtFwd;
            const yBwd = snapB.y - snapB.vy * dtBwd + 0.5 * simGravity * dtBwd * dtBwd;
            nextY = THREE.MathUtils.lerp(yFwd, yBwd, t);
            curVy = THREE.MathUtils.lerp(snapA.vy, snapB.vy, t);
          } else if (snapB.isFlapTick || snapB.vy > snapA.vy + 1.2) {
            // Reconstruct exact two-segment parabola around the flap instant
            const dtSinceFlap = Math.max(0, Math.min(spanSec, (snapB.vy - CONFIG.flapImpulse * speedRatio) / simGravity));
            const uJump = THREE.MathUtils.clamp(1 - (dtSinceFlap / spanSec), 0.05, 0.92);
            if (t >= uJump && (sim.lastTriggeredFlapTs || 0) < snapB.ts) {
              sim.wingFlapBoost = 1.0;
              sim.lastTriggeredFlapTs = snapB.ts;
            }
            if (t < uJump) {
              const dt1 = spanSec * t;
              nextY = snapA.y + snapA.vy * dt1 + 0.5 * simGravity * dt1 * dt1;
              curVy = snapA.vy + simGravity * dt1;
            } else {
              const dtBack = spanSec * (1 - t);
              nextY = snapB.y - snapB.vy * dtBack + 0.5 * simGravity * dtBack * dtBack;
              curVy = snapB.vy - simGravity * dtBack;
            }
          } else {
            nextY = THREE.MathUtils.lerp(snapA.y, snapB.y, t);
            curVy = THREE.MathUtils.lerp(snapA.vy, snapB.vy, t);
          }

          const safeY = Number.isFinite(nextY) ? nextY : (Number.isFinite(sim.renderY) ? sim.renderY : snapA.y);
          const safeVy = Number.isFinite(curVy) ? curVy : 0;
          sim.renderY = Math.max(CONFIG.groundY + CONFIG.birdRadius, Math.min(CONFIG.ceilingY, safeY));
          const targetPitch = THREE.MathUtils.clamp((safeVy / speedRatio) * 0.065, -Math.PI * 0.42, Math.PI * 0.24);
          sim.renderRotZ = THREE.MathUtils.lerp(
            (typeof sim.renderRotZ === 'number' && Number.isFinite(sim.renderRotZ)) ? sim.renderRotZ : targetPitch,
            targetPitch,
            Math.min(1, dt * 16)
          );

          const pipesA = snapA.pipes || [];
          const pipesB = snapB.pipes || [];
          if (pipesB.length > 0) {
            sim.renderPipes = pipesB.map(bp => {
              const matchA = pipesA.find(ap =>
                Math.abs((ap.gapCenterY || 0) - (bp.gapCenterY || 0)) < 0.08 &&
                Math.abs((ap.gapSize || 0) - (bp.gapSize || 0)) < 0.08 &&
                ap.x >= bp.x - 0.2 &&
                (ap.x - bp.x) < 5.5
              );
              const xInterp = matchA
                ? THREE.MathUtils.lerp(matchA.x, bp.x, t)
                : (bp.x + spd * spanSec * (1 - t));
              return { ...bp, x: xInterp };
            });
          } else if (pipesA.length > 0) {
            sim.renderPipes = pipesA.map(ap => ({ ...ap, x: ap.x - spd * spanSec * t }));
          } else {
            sim.renderPipes = this.getDefaultSpectatorPipes();
          }
        }

        async startSpectatingDuel(lobbyId) {
          if (!lobbyId) return;
          this.exitSoloOpponentSpectate();
          this.duelSpectatingLobbyId = lobbyId;
          this._lastSpecAppliedSkinId = null;
          this._lastSpecRoundKey = null;
          this._lastSpecStatus = null;
          this._lastRenderServerTime = 0;
          this.clearSpectatorPipePools();
          this.duelSpecSim = {
            p1: this.createEmptySpecSim(),
            p2: this.createEmptySpecSim(),
            opp: this.createEmptySpecSim()
          };
          if (Array.isArray(this.pipes)) {
            this.pipes.forEach(p => { if (p && p.group) p.group.visible = false; });
          }
          if (this.birdGroup) this.birdGroup.rotation.set(0, 0, 0);
          if (this.birdMeshGroup) this.birdMeshGroup.rotation.set(0, 0, 0);
          const startScr = document.getElementById('start-screen');
          if (startScr) startScr.classList.remove('active');
          const goScr = document.getElementById('gameover-screen');
          if (goScr) goScr.classList.remove('active');
          document.body.classList.add('in-game');
          const topBarEl = document.getElementById('top-app-bar');
          if (topBarEl) {
            topBarEl.classList.add('in-game');
            topBarEl.style.setProperty('display', 'none', 'important');
          }

          const specOverlay = document.getElementById('duel-spectator-overlay');
          if (specOverlay) specOverlay.style.display = 'block';

          await this.fetchDuelsState();
        }

        clearSpectatorPipePools() {
          if (!this.duelSpecPipePools) {
            this.duelSpecPipePools = { p1: [], p2: [], opp: [] };
            return;
          }
          ['p1', 'p2', 'opp'].forEach(side => {
            const pool = this.duelSpecPipePools[side];
            if (Array.isArray(pool)) {
              while (pool.length > 0) {
                const rem = pool.pop();
                if (rem && rem.group && this.scene) this.scene.remove(rem.group);
              }
            } else {
              this.duelSpecPipePools[side] = [];
            }
          });
        }

        stopSpectatingDuel() {
          this.duelSpectatingLobbyId = null;
          this.duelSpectatingLobby = null;
          this._lastSpecAppliedSkinId = null;
          this._lastSpecRoundKey = null;
          this._lastSpecStatus = null;
          this._lastRenderServerTime = 0;
          this.clearSpectatorPipePools();
          if (Array.isArray(this.pipes)) {
            this.pipes.forEach(p => { if (p && p.group) p.group.visible = true; });
          }
          if (this.birdGroup) this.birdGroup.rotation.set(0, 0, 0);
          if (this.birdMeshGroup) this.birdMeshGroup.rotation.set(0, 0, 0);
          this.hideAllDuelOverlays();
          if (this.birdGroup) this.birdGroup.rotation.set(0, 0, 0);
          if (this.birdMeshGroup) this.birdMeshGroup.rotation.set(0, 0, 0);
          // Restore spectator's own equipped Bird Skin & Pipe Skin before returning to lobby
          this.applySkin(this.selectedSkinId || 'classic', false, true, true);
          this.applyPipeSkin(this.selectedPipeSkinId || 'classic_pipe', false, true, true);
          this.spawnLobbyPreviewPipes();
          this.showLobbyScreen();
          this.switchView('duels');
          if (typeof this.activateDuelTab === 'function') {
            this.activateDuelTab('join', false);
          }
          this.fetchDuelsState();
        }

        enterSoloOpponentSpectate(lobby, me, opp) {
          if (!lobby || !opp) return;
          if (!this.duelSoloSpectatingOpp) {
            this.duelSoloSpectatingOpp = true;
            this._lastSpecAppliedSkinId = null;
            this._lastRenderServerTime = 0;
            if (this.state === GAME_STATE.CRASHING || this.state === GAME_STATE.PLAYING) {
              this.state = GAME_STATE.START;
            }
            if (this.birdGroup) this.birdGroup.rotation.set(0, 0, 0);
            if (this.birdMeshGroup) this.birdMeshGroup.rotation.set(0, 0, 0);
            if (Array.isArray(this.pipes)) {
              this.pipes.forEach(p => { if (p && p.group) p.group.visible = false; });
            }
          }

          const backdrop = document.getElementById('duel-overlay-backdrop');
          if (backdrop) backdrop.style.display = 'none';

          const soloOverlay = document.getElementById('duel-solo-spectate-overlay');
          if (soloOverlay) soloOverlay.style.display = 'block';

          const rKey = lobby.currentRound || 'easy';
          const mult = lobby.currentMultiplier || 1;
          const myRound = me && me.rounds && me.rounds[rKey] ? me.rounds[rKey] : { rawScore: 0, weightedScore: 0 };
          const oppRound = opp.rounds && opp.rounds[rKey] ? opp.rounds[rKey] : { rawScore: 0, weightedScore: 0 };
          const oppRaw = (opp.live && typeof opp.live.score === 'number') ? opp.live.score : oppRound.rawScore;
          const oppPts = oppRaw * mult;

          const nameEl = document.getElementById('duel-solo-opp-name');
          if (nameEl) nameEl.textContent = opp.username || 'Opponent';
          const eloEl = document.getElementById('duel-solo-opp-elo');
          if (eloEl) eloEl.textContent = `${opp.elo || 1000} ELO`;
          const scoreEl = document.getElementById('duel-solo-opp-score');
          if (scoreEl) scoreEl.textContent = `${oppRaw} (${oppPts} pts)`;
          const myScoreEl = document.getElementById('duel-solo-my-score');
          if (myScoreEl) myScoreEl.textContent = `You: ${myRound.rawScore} (${myRound.weightedScore} pts)`;
        }

        exitSoloOpponentSpectate() {
          const soloOverlay = document.getElementById('duel-solo-spectate-overlay');
          if (soloOverlay) soloOverlay.style.display = 'none';
          if (!this.duelSoloSpectatingOpp) return;

          this.duelSoloSpectatingOpp = false;
          this._lastSpecAppliedSkinId = null;
          this._lastRenderServerTime = 0;

          if (this.duelSpecPipePools && Array.isArray(this.duelSpecPipePools.opp)) {
            while (this.duelSpecPipePools.opp.length > 0) {
              const rem = this.duelSpecPipePools.opp.pop();
              if (rem && rem.group && this.scene) this.scene.remove(rem.group);
            }
          }
          if (this.duelSpecSim && this.duelSpecSim.opp) {
            this.duelSpecSim.opp = this.createEmptySpecSim();
          }
          if (Array.isArray(this.pipes)) {
            this.pipes.forEach(p => { if (p && p.group) p.group.visible = true; });
          }
          if (this.birdGroup) this.birdGroup.rotation.set(0, 0, 0);
          if (this.birdMeshGroup) this.birdMeshGroup.rotation.set(0, 0, 0);

          this.applySkin(this.selectedSkinId || 'classic', false, true, true);
          this.applyPipeSkin(this.selectedPipeSkinId || 'classic_pipe', false, true, true);
        }

        syncSpectatorLobbyState(lobby) {
          if (!lobby) return;
          const specOverlay = document.getElementById('duel-spectator-overlay');
          if (specOverlay) specOverlay.style.display = 'block';

          const rKey = lobby.currentRound || 'easy';
          const roundChanged = this._lastSpecRoundKey !== null && this._lastSpecRoundKey !== rKey;
          const enteredCountdown = lobby.status === 'countdown' && this._lastSpecStatus !== 'countdown';
          if (roundChanged || enteredCountdown) {
            this._lastRenderServerTime = 0;
            this.duelSpecSim.p1 = this.createEmptySpecSim();
            this.duelSpecSim.p2 = this.createEmptySpecSim();
          }
          this._lastSpecRoundKey = rKey;
          this._lastSpecStatus = lobby.status;

          const lobbyNameEl = document.getElementById('duel-spec-lobby-name');
          if (lobbyNameEl) lobbyNameEl.textContent = lobby.name || 'Duel Match';

          const roundPillEl = document.getElementById('duel-spec-round-pill');
          if (roundPillEl) {
            if (lobby.status === 'waiting') {
              roundPillEl.textContent = 'Waiting for Challenger (1/2)';
            } else if (lobby.status === 'finished') {
              roundPillEl.textContent = 'Match Complete';
            } else {
              roundPillEl.textContent = `Round ${lobby.currentRoundNumber}/${lobby.totalRounds || 4}: ${lobby.currentRoundLabel} (${lobby.currentMultiplier}x)`;
            }
          }

          const p1 = lobby.players && lobby.players[0] ? lobby.players[0] : null;
          const p2 = lobby.players && lobby.players[1] ? lobby.players[1] : null;
          const mult = lobby.currentMultiplier || 1;

          const updateSpecCard = (prefix, p, simTarget) => {
            const nameEl = document.getElementById(`duel-spec-${prefix}-name`);
            const eloEl = document.getElementById(`duel-spec-${prefix}-elo`);
            const rScoreEl = document.getElementById(`duel-spec-${prefix}-round-score`);
            const totEl = document.getElementById(`duel-spec-${prefix}-total-pts`);
            const statEl = document.getElementById(`duel-spec-${prefix}-status`);

            if (!p) {
              if (nameEl) nameEl.textContent = 'Waiting...';
              if (eloEl) eloEl.textContent = '🏆 —';
              if (rScoreEl) rScoreEl.textContent = '0';
              if (totEl) totEl.textContent = '0 PTS';
              if (statEl) {
                statEl.textContent = '⏳ Waiting';
                statEl.dataset.state = 'waiting';
              }
              return;
            }

            const rObj = (p.rounds && p.rounds[rKey]) || { rawScore: 0, weightedScore: 0, finished: false };
            const rawScore = (lobby.status === 'playing' && p.live) ? p.live.score : rObj.rawScore;
            const ptsScore = rawScore * mult;

            if (nameEl) nameEl.textContent = p.username;
            if (eloEl) eloEl.textContent = `🏆 ${p.elo || 1000}`;
            if (rScoreEl) rScoreEl.textContent = `${rawScore} (${ptsScore})`;
            if (totEl) totEl.textContent = `${p.totalPoints || 0} PTS`;

            if (statEl) {
              if (lobby.status === 'waiting') {
                statEl.textContent = '⏳ Ready';
                statEl.dataset.state = 'waiting';
              } else if (rObj.finished || (p.live && !p.live.alive)) {
                statEl.textContent = '💥 Crashed';
                statEl.dataset.state = 'crashed';
              } else {
                statEl.textContent = '🟢 Flying';
                statEl.dataset.state = 'flying';
              }
            }

            this.pushSpectatorSnapshot(simTarget, p, lobby.status, rObj.finished);
          };

          updateSpecCard('p1', p1, this.duelSpecSim.p1);
          updateSpecCard('p2', p2, this.duelSpecSim.p2);

          if (lobby.status === 'countdown') {
            this.duelCountdownTargetMs = Date.now() + (lobby.countdownRemainingMs || 1500);
            const matchupEl = document.getElementById('duel-countdown-matchup');
            if (matchupEl) {
              matchupEl.textContent = `${p1 ? p1.username : 'P1'} (${p1 ? p1.elo : 1000} ELO) ⚔️ ${p2 ? p2.username : 'P2'} (${p2 ? p2.elo : 1000} ELO)`;
            }
            const roundTagEl = document.getElementById('duel-countdown-round-tag');
            if (roundTagEl) {
              roundTagEl.textContent = `ROUND ${lobby.currentRoundNumber} OF ${lobby.totalRounds || 4} — ${(lobby.currentRoundLabel || 'EASY').toUpperCase()} (${lobby.currentMultiplier}x)`;
            }
            this.showDuelBackdropSubView('duel-view-countdown');
          } else if (lobby.status === 'round_summary') {
            this.populateDuelRoundSummaryModal(lobby);
            this.showDuelBackdropSubView('duel-view-round-summary');
          } else if (lobby.status === 'finished') {
            this.populateDuelFinalResultsModal(lobby);
            this.showDuelBackdropSubView('duel-view-final-results');
          } else {
            const backdrop = document.getElementById('duel-overlay-backdrop');
            if (backdrop) backdrop.style.display = 'none';
          }
        }

        applySpectatorPipesToScene(sideKey, pipesData, pipeSkinId = 'classic_pipe') {
          if (!this.duelSpecPipePools) {
            this.duelSpecPipePools = { p1: [], p2: [], opp: [] };
          }
          ['p1', 'p2', 'opp'].forEach(k => {
            if (k !== sideKey && Array.isArray(this.duelSpecPipePools[k])) {
              for (let i = 0; i < this.duelSpecPipePools[k].length; i++) {
                if (this.duelSpecPipePools[k][i] && this.duelSpecPipePools[k][i].group) {
                  this.duelSpecPipePools[k][i].group.visible = false;
                }
              }
            }
          });

          if (!this.duelSpecPipePools[sideKey]) this.duelSpecPipePools[sideKey] = [];
          const pool = this.duelSpecPipePools[sideKey];
          const safePipes = (Array.isArray(pipesData) && pipesData.length > 0)
            ? pipesData
            : this.getDefaultSpectatorPipes();

          while (
            pool.length > 1 &&
            safePipes.length > 0 &&
            Math.abs((pool[1].bottomTopY || 0) - safePipes[0].bottomTopY) < 0.05 &&
            Math.abs((pool[1].topBottomY || 0) - safePipes[0].topBottomY) < 0.05 &&
            (Math.abs((pool[0].bottomTopY || 0) - safePipes[0].bottomTopY) > 0.05 ||
             Math.abs((pool[0].topBottomY || 0) - safePipes[0].topBottomY) > 0.05)
          ) {
            const recycled = pool.shift();
            pool.push(recycled);
          }

          while (pool.length > safePipes.length) {
            const rem = pool.pop();
            if (rem && rem.group) this.scene.remove(rem.group);
          }
          for (let i = 0; i < safePipes.length; i++) {
            const pd = safePipes[i];
            const renderX = pd.x;
            if (!pool[i]) {
              const grp = new THREE.Group();
              this.scene.add(grp);
              pool[i] = {
                group: grp,
                x: renderX,
                prevX: renderX,
                gapCenterY: pd.gapCenterY,
                gapSize: pd.gapSize,
                bottomTopY: pd.bottomTopY,
                topBottomY: pd.topBottomY,
                pipeSkinId,
                passed: false
              };
              this.rebuildPipePairVisuals(pool[i]);
              grp.position.x = renderX;
              grp.visible = true;
            } else {
              const po = pool[i];
              const gapChanged = Math.abs((po.bottomTopY || 0) - pd.bottomTopY) > 0.05 || Math.abs((po.topBottomY || 0) - pd.topBottomY) > 0.05;
              const skinChanged = po.pipeSkinId !== pipeSkinId;
              po.x = renderX;
              po.prevX = renderX;
              po.bottomTopY = pd.bottomTopY;
              po.topBottomY = pd.topBottomY;
              po.gapCenterY = pd.gapCenterY;
              po.gapSize = pd.gapSize;
              if (gapChanged || skinChanged) {
                po.pipeSkinId = pipeSkinId;
                this.rebuildPipePairVisuals(po);
              }
              po.group.position.x = renderX;
              po.group.visible = true;
            }
          }
        }

        renderSpectatorSimHalf(sideKey, sim, dt, isPlaying, vx, vw, h) {
          const skinObj = (typeof BIRD_SKINS !== 'undefined' && BIRD_SKINS.find(s => s.id === (sim.selectedSkin || 'classic'))) || BIRD_SKINS[0];
          const pipeSkinObj = (typeof PIPE_SKINS !== 'undefined' && PIPE_SKINS.find(p => p.id === (sim.selectedPipeSkin || 'classic_pipe'))) || PIPE_SKINS[0];

          if (this._lastSpecAppliedSkinId !== skinObj.id) {
            this.applySkinVisualsOnly(skinObj, true, true);
            this._lastSpecAppliedSkinId = skinObj.id;
          }
          this.activePipeAssets = this.getOrCreatePipeSkinAssets(pipeSkinObj);

          const displayY = Math.max(CONFIG.groundY + CONFIG.birdRadius, Math.min(CONFIG.ceilingY, (typeof sim.renderY === 'number' ? sim.renderY : CONFIG.birdStartY)));
          if (this.birdGroup) {
            this.birdGroup.position.set(CONFIG.birdX, displayY, 0);
            this.birdGroup.rotation.set(0, 0, sim.renderRotZ || 0);
          }
          if (this.birdMeshGroup) {
            this.birdMeshGroup.rotation.set(0, isPlaying ? 0 : Math.sin(this.elapsedTime * 1.4) * 0.32, 0);
          }
          this.wingFlapBoost = sim.wingFlapBoost || 0;
          const flapAmp = isPlaying ? (sim.alive ? (0.55 + this.wingFlapBoost * 0.4) : 0.06) : 0.65;
          const flapAngle = Math.sin(sim.wingPhase || 0) * flapAmp;
          if (this.leftWingPivot) this.leftWingPivot.rotation.x = flapAngle;
          if (this.rightWingPivot) this.rightWingPivot.rotation.x = -flapAngle;

          this.updateAnimatedSkinEffects(dt);
          this.applySpectatorPipesToScene(sideKey, sim.renderPipes || sim.pipes, pipeSkinObj.id);

          this.renderer.setViewport(vx, 0, vw, h);
          this.renderer.setScissor(vx, 0, vw, h);
          this.renderer.render(this.scene, this.camera);
        }

        renderSoloOpponentSpectate(dt) {
          const w = Math.max(2, window.innerWidth);
          const h = Math.max(1, window.innerHeight);
          const lobby = this.activeDuelLobby;
          const isPlaying = Boolean(lobby && lobby.status === 'playing');
          const roundKey = (lobby && lobby.currentRound) || 'easy';
          const diffCfg = CONFIG.difficulties[roundKey] || CONFIG.difficulties.easy;
          const defaultSpeed = diffCfg.startSpeed || CONFIG.baseSpeed;
          const renderServerTime = this.getSpectatorRenderServerTime(dt);

          this.evaluateSpectatorSimAt(this.duelSpecSim.opp, renderServerTime, dt, defaultSpeed, isPlaying);

          this.renderer.setScissorTest(false);
          const fullAspect = w / h;
          this.camera.aspect = fullAspect;
          this.camera.updateProjectionMatrix();
          this.adjustCameraForAspect(fullAspect);

          this.renderSpectatorSimHalf('opp', this.duelSpecSim.opp, dt, isPlaying, 0, w, h);
        }

        renderDuelSpectatorSplitScreen(dt) {
          const w = Math.max(2, window.innerWidth);
          const h = Math.max(1, window.innerHeight);
          const halfW = Math.floor(w / 2);
          const lobby = this.duelSpectatingLobby;
          const isPlaying = Boolean(lobby && lobby.status === 'playing');
          const roundKey = (lobby && lobby.currentRound) || 'easy';
          const diffCfg = CONFIG.difficulties[roundKey] || CONFIG.difficulties.easy;
          const defaultSpeed = diffCfg.startSpeed || CONFIG.baseSpeed;
          const renderServerTime = this.getSpectatorRenderServerTime(dt);

          this.evaluateSpectatorSimAt(this.duelSpecSim.p1, renderServerTime, dt, defaultSpeed, isPlaying);
          this.evaluateSpectatorSimAt(this.duelSpecSim.p2, renderServerTime, dt, defaultSpeed, isPlaying);

          const subAspect = halfW / h;
          this.camera.aspect = subAspect;
          this.camera.updateProjectionMatrix();
          this.adjustCameraForAspect(subAspect);

          this.renderer.setScissorTest(true);

          try {
            // 1. Render Left Half (Player 1)
            this.renderSpectatorSimHalf('p1', this.duelSpecSim.p1, dt, isPlaying, 0, halfW, h);

            // 2. Render Right Half (Player 2)
            this.renderSpectatorSimHalf('p2', this.duelSpecSim.p2, dt, isPlaying, halfW, w - halfW, h);
          } finally {
            this.renderer.setScissorTest(false);
            const fullAspect = w / h;
            this.camera.aspect = fullAspect;
            this.camera.updateProjectionMatrix();
            this.adjustCameraForAspect(fullAspect);
          }
        }
      }

// Mix in UI/Progression and 3D Model builders onto FlappyBirdOnline.prototype
[window.FlappyBirdUIAndProgression, window.FlappyBird3DModels].forEach(MixinClass => {
  if (!MixinClass) return;
  Object.getOwnPropertyNames(MixinClass.prototype).forEach(name => {
    if (name !== 'constructor') {
      Object.defineProperty(
        FlappyBirdOnline.prototype,
        name,
        Object.getOwnPropertyDescriptor(MixinClass.prototype, name)
      );
    }
  });
});

window.addEventListener('DOMContentLoaded', () => {
  window.flappyGame = new FlappyBirdOnline();
});
