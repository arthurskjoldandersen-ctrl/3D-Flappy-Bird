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
          this.birdLockerFilter = 'all';
          this.pipeLockerFilter = 'all';
          this.skinSearchQuery = '';
          this.lockerSortOrder = 'default';

          this.leaderboards = { easy: [], medium: [], hard: [] };
          this.timeframeLeaderboards = {
            all: { easy: [], medium: [], hard: [] },
            weekly: { easy: [], medium: [], hard: [] },
            daily: { easy: [], medium: [], hard: [] }
          };
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
          this.currentTick = 0;
          this.flapTicks = [];
          this.pendingFlap = false;
          this.queuedFlaps = 0;
          this.flapBufferTicks = 0;
          this.lastFlapTick = -10;
          this.lastQueueFlapTime = 0;
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

          // Apply saved Bird Skin & Pipe Skin and spawn preview pipes in the Start screen
          this.applySkin(this.selectedSkinId, false);
          this.applyPipeSkin(this.selectedPipeSkinId, false);
          this.spawnLobbyPreviewPipes();

          this.bindEvents();

          this.updateHUD();
          this.renderAllCosmeticGrids();
          this.updateAllProfilePictures();

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
              const res = await fetch('/api/chat?limit=1', {
                headers: { 'Authorization': `Bearer ${this.authToken}` }
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
            if (tag === 'INPUT' || tag === 'TEXTAREA') {
              if (this.state === GAME_STATE.PLAYING && !(this.chat && this.chat.isOpen)) {
                activeEl.blur();
              } else {
                if (e.key === 'Enter') {
                  if (activeEl && (activeEl.id === 'guest-modal-username' || activeEl.id === 'guest-modal-password')) {
                    this.handleGuestModalAuth('smart');
                  } else if (activeEl && (activeEl.id === 'auth-username' || activeEl.id === 'auth-password')) {
                    this.handleAuth('smart');
                  }
                }
                return;
              }
            }

            if (isModalActive()) {
              if (e.code === 'Escape') {
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

            const isJumpKey = (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW' || e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W');
            if (isJumpKey) {
              e.preventDefault();
              if (e.repeat) return;
              if (this.state === GAME_STATE.PLAYING) {
                this.queueFlap();
              } else if (this.state === GAME_STATE.START || this.state === GAME_STATE.GAMEOVER) {
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
          });

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
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            // Deduplicate companion synthetic events (e.g. pointerdown + mousedown / touchstart at the same instant)
            if (now - lastPointerActionTime < 18) {
              return;
            }
            lastPointerActionTime = now;

            const target = e.target;

            //During active gameplay, tapping anywhere (except interactive chat/buttons) triggers an instant jump!
            if (this.state === GAME_STATE.PLAYING) {
              if (target && target.closest && target.closest('button, a, input, textarea, select, option, label, header, #top-app-bar, #game-chat-panel, #btn-chat-toggle, .floating-chat-btn')) {
                return;
              }
              if (e.cancelable) e.preventDefault();
              this.queueFlap();
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
            window.addEventListener('pointerdown', handlePointerFlapAction, { passive: false });
          }
          window.addEventListener('touchstart', handlePointerFlapAction, { passive: false });
          window.addEventListener('mousedown', (e) => {
            if (e.button === 0) handlePointerFlapAction(e);
          }, { passive: false });

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

          const qmBtn = document.getElementById('btn-duel-quick-match');
          if (qmBtn) {
            qmBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.handleDuelQuickMatch();
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

          // Locker Sub-Tabs (Bird Skins vs Pipe Skins)
          const tabBirds = document.getElementById('tab-btn-bird-skins');
          const tabPipes = document.getElementById('tab-btn-pipe-skins');
          const viewBirds = document.getElementById('panel-view-bird-skins');
          const viewPipes = document.getElementById('panel-view-pipe-skins');
          const spotBirds = document.getElementById('bird-skin-spotlight');
          const spotPipes = document.getElementById('pipe-skin-spotlight');

          const switchLockerTab = (tab) => {
            this.currentLockerTab = tab;
            if (tabBirds) tabBirds.classList.toggle('active', tab === 'birds');
            if (tabPipes) tabPipes.classList.toggle('active', tab === 'pipes');
            if (viewBirds) viewBirds.style.display = tab === 'birds' ? 'flex' : 'none';
            if (viewPipes) viewPipes.style.display = tab === 'pipes' ? 'flex' : 'none';
            if (spotBirds) spotBirds.style.display = tab === 'birds' ? 'flex' : 'none';
            if (spotPipes) spotPipes.style.display = tab === 'pipes' ? 'flex' : 'none';
            if (tab === 'birds') this.renderBirdSkinsGrid();
            if (tab === 'pipes') {
              if (this.pipes.length === 0 && typeof this.spawnLobbyPreviewPipes === 'function') {
                this.spawnLobbyPreviewPipes();
              }
              this.renderPipeSkinsGrid();
            }
          };

          if (tabBirds) tabBirds.addEventListener('click', () => switchLockerTab('birds'));
          if (tabPipes) tabPipes.addEventListener('click', () => switchLockerTab('pipes'));

          const switchRightPanel = (mode) => {
            if (mode === 'lb') this.switchView('leaderboard');
            else if (mode === 'stats') this.switchView('stats');
            else if (mode === 'birds') {
              this.switchView('skins');
              switchLockerTab('birds');
            } else if (mode === 'pipes') {
              this.switchView('skins');
              switchLockerTab('pipes');
            }
          };
          this.switchRightPanelFn = switchRightPanel;

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
              this.updatePreviewBanner();
              this.renderBirdSkinsGrid();
              this.renderPipeSkinsGrid();
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
          });
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
          if (this.state === GAME_STATE.PLAYING || this.isStartingRun) return;
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

          // If the player was previewing a locked Bird Skin or Pipe Skin in the lobby, revert to their equipped unlocked skin for actual gameplay!
          if (this.previewSkinId) {
            this.previewSkinId = null;
            this.applySkin(this.selectedSkinId, false);
          }
          if (this.previewPipeSkinId) {
            this.previewPipeSkinId = null;
            this.applyPipeSkin(this.selectedPipeSkinId, false);
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
          this.currentTick = 0;
          this.flapTicks = [];
          this.pendingFlap = false;
          this.queuedFlaps = 0;
          this.flapBufferTicks = 0;
          this.lastFlapTick = -10;
          this.lastQueueFlapTime = 0;
          this.physicsAccumulator = 0;
          this.lastFrameTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

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
          this.spawnPipePair(CONFIG.pipeSpawnX - CONFIG.baseSpawnDistance * 2);
          this.spawnPipePair(CONFIG.pipeSpawnX - CONFIG.baseSpawnDistance);
          this.spawnPipePair(CONFIG.pipeSpawnX);

          this.simBirdY = CONFIG.birdStartY;
          this.prevBirdY = CONFIG.birdStartY;
          this.birdGroup.position.set(CONFIG.birdX, CONFIG.birdStartY, 0);
          this.birdGroup.rotation.set(0, 0, 0);
          this.birdMeshGroup.rotation.set(0, 0, 0);

          this.birdVelocityY = CONFIG.flapImpulse;
          this.wingFlapBoost = 1.0;
          this.pendingFlap = false;
          this.queuedFlaps = 0;
          this.flapBufferTicks = 0;
          this.lastQueueFlapTime = 0;
          this.sound.playFlap();
        }

        queueFlap() {
          if (this.state !== GAME_STATE.PLAYING) return;
          this.pendingFlap = true;
          this.queuedFlaps = Math.min(3, (this.queuedFlaps || 0) + 1);
          this.flapBufferTicks = 20; // Generous 20-tick buffer (~333ms) so rapid taps and double taps are never dropped
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
              hard: { runs: 0, totalScore: 0, totalFlaps: 0, lastScore: 0 }
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
          const { speed: scrollSpeed, gravity, flapImpulse, maxFallSpeed } = this.getDifficultyParams();

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
              // NEVER zero out queuedFlaps or pendingFlap here!
              if (this.flapBufferTicks > 0) {
                this.flapBufferTicks--;
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

          this.distanceSinceLastPipe += scrollSpeed * dt;
          if (this.distanceSinceLastPipe >= CONFIG.baseSpawnDistance) {
            this.distanceSinceLastPipe = 0;
            this.spawnPipePair(CONFIG.pipeSpawnX);
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
          const isSpectatingDuel = Boolean(this.duelSpectatingLobbyId && this.duelSpectatingLobby);
          const specRoundKey = (isSpectatingDuel && this.duelSpectatingLobby.currentRound) || this.selectedDifficulty || 'medium';
          const specDiffCfg = CONFIG.difficulties[specRoundKey] || CONFIG.difficulties.medium;
          const diff = this.getDifficultyParams();
          const visualScrollSpeed = (this.state === GAME_STATE.PLAYING)
            ? diff.speed
            : (isSpectatingDuel && this.duelSpectatingLobby.status === 'playing'
              ? (specDiffCfg.maxSpeed ? (CONFIG.baseSpeed + specDiffCfg.maxSpeed) * 0.5 : CONFIG.baseSpeed)
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

          if (this.state === GAME_STATE.START) {
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
            this.physicsAccumulator += frameDt;
            const maxSteps = 5;
            let steps = 0;
            while (this.physicsAccumulator >= CONFIG.dt && steps < maxSteps && this.state === GAME_STATE.PLAYING) {
              this.physicsAccumulator -= CONFIG.dt;
              this.stepPlayingPhysics();
              steps++;
            }

            // Sub-tick interpolation factor alpha in [0, 1) eliminates all micro-stutter!
            if (this.state === GAME_STATE.PLAYING) {
              const alpha = Math.max(0, Math.min(1, this.physicsAccumulator / CONFIG.dt));
              this.birdGroup.position.y = this.prevBirdY + (this.simBirdY - this.prevBirdY) * alpha;

              for (let i = 0; i < this.pipes.length; i++) {
                const p = this.pipes[i];
                p.group.position.x = p.prevX + (p.x - p.prevX) * alpha;
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
          } else if (this.state === GAME_STATE.CRASHING || this.state === GAME_STATE.GAMEOVER) {
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
          const rawDt = (now - (this.lastFrameTime || now)) * 0.001;
          this.lastFrameTime = now;
          const dt = Number.isFinite(rawDt) ? Math.max(0.0001, Math.min(rawDt, 0.05)) : 0.016;
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
          this.duelLobbies = [];
          this.duelRankedLeaderboard = [];
          this.myDuelStats = { duelElo: 1000, duelWins: 0, duelLosses: 0, duelMatches: 0, duelCoins: 0, rank: null };
          this.activeDuelLobby = null;
          this.activeDuelLobbyId = null;
          this.duelSpectatingLobby = null;
          this.duelSpectatingLobbyId = null;
          this.duelRoundPlaying = null;
          this.duelRoundFinishedLocal = false;
          this.lastDuelTelemetrySentAt = 0;
          this.lastDuelPollAt = 0;
          this.duelCountdownTargetMs = 0;

          this.duelSpecSim = {
            p1: { y: CONFIG.birdStartY, vy: 0, prevVy: 0, rotZ: 0, alive: true, speed: 0, birdOffsetY: 0, pipeOffsetX: 0, lastLiveUpdatedAt: 0, selectedSkin: 'classic', selectedPipeSkin: 'classic_pipe', wingPhase: 0, wingFlapBoost: 0, pipes: [] },
            p2: { y: CONFIG.birdStartY, vy: 0, prevVy: 0, rotZ: 0, alive: true, speed: 0, birdOffsetY: 0, pipeOffsetX: 0, lastLiveUpdatedAt: 0, selectedSkin: 'classic', selectedPipeSkin: 'classic_pipe', wingPhase: 0, wingFlapBoost: 0, pipes: [] }
          };
          this.duelSpecPipePools = { p1: [], p2: [] };
          this._lastSpecAppliedSkinId = null;

          this.hideAllDuelOverlays();

          if (this._duelPollTimer) clearInterval(this._duelPollTimer);
          this._duelPollTimer = setInterval(() => {
            if (document.hidden) return;
            const now = Date.now();
            const isSpectating = Boolean(this.duelSpectatingLobbyId);
            const isFastPoll = Boolean(this.activeDuelLobbyId || isSpectating);
            const intervalMs = isSpectating ? 150 : (isFastPoll ? 250 : 1200);
            if (!isFastPoll && this.currentAppView !== 'duels') return;
            if (now - this.lastDuelPollAt >= intervalMs) {
              this.lastDuelPollAt = now;
              this.fetchDuelsState();
            }
          }, 75);

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

            if (Array.isArray(data.lobbies)) {
              this.duelLobbies = data.lobbies;
            }
            if (Array.isArray(data.rankedLeaderboard)) {
              this.duelRankedLeaderboard = data.rankedLeaderboard;
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
            } else if (this.activeDuelLobbyId && (!this.activeDuelLobby || this.activeDuelLobby.status === 'waiting')) {
              this.activeDuelLobby = null;
              this.activeDuelLobbyId = null;
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
          const msgEl = document.getElementById('duel-create-msg');
          const customName = nameInput ? nameInput.value.trim() : '';
          try {
            if (msgEl) msgEl.textContent = 'Creating lobby...';
            const res = await this.apiRequest('/api/duels/create', 'POST', {
              name: customName || `${this.getDuelDisplayUsername()}'s Duel`,
              clientId: this.duelClientId,
              guestUsername: this.getDuelDisplayUsername(),
              selectedSkin: this.selectedSkinId || 'classic',
              selectedPipeSkin: this.selectedPipeSkinId || 'classic_pipe'
            });
            if (nameInput) nameInput.value = '';
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

        async handleDuelJoinLobby(lobbyId) {
          if (!lobbyId) return;
          try {
            const res = await this.apiRequest('/api/duels/join', 'POST', {
              lobbyId,
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
            this.fetchDuelsState();
          }
        }

        async handleDuelLeaveLobby() {
          const targetId = this.activeDuelLobbyId;
          this.activeDuelLobby = null;
          this.activeDuelLobbyId = null;
          this.duelRoundPlaying = null;
          this.duelRoundFinishedLocal = false;
          this.hideAllDuelOverlays();
          if (targetId) {
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
          }
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

          // 1. Waiting for 2nd player
          if (lobby.status === 'waiting') {
            this.hideAllDuelOverlays();
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
              roundTagEl.textContent = `ROUND ${lobby.currentRoundNumber} OF 3 — ${(lobby.currentRoundLabel || 'EASY').toUpperCase()} MODE (${lobby.currentMultiplier}x POINTS)`;
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

            if (!myRound.finished && !this.duelRoundFinishedLocal) {
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
              // I have already crashed in this round — waiting for the other player to die so both can see the Round Summary!
              const liveHud = document.getElementById('duel-live-hud');
              if (liveHud) liveHud.style.display = 'none';

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
          if (badgeEl) badgeEl.textContent = `ROUND ${lobby.currentRoundNumber} OF 3 COMPLETE`;
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
            } else {
              nextHint.textContent = '🏆 All 3 rounds complete! Counting all points together...';
            }
          }
        }

        populateDuelFinalResultsModal(lobby) {
          const p1 = (lobby.result && lobby.result.p1) || lobby.players[0] || { username: 'Player 1', oldElo: 1000, newElo: 1000, eloDelta: 0, totalPoints: 0, rounds: { easy: {}, medium: {}, hard: {} } };
          const p2 = (lobby.result && lobby.result.p2) || lobby.players[1] || { username: 'Player 2', oldElo: 1000, newElo: 1000, eloDelta: 0, totalPoints: 0, rounds: { easy: {}, medium: {}, hard: {} } };

          const winTitle = document.getElementById('duel-final-winner-title');
          if (winTitle) {
            if (lobby.result && lobby.result.isDraw) {
              winTitle.textContent = `🤝 Draw Match! (${p1.totalPoints} - ${p2.totalPoints} PTS)`;
            } else if (lobby.result && lobby.result.winnerUsername) {
              winTitle.textContent = `🏆 ${lobby.result.winnerUsername} Wins the Duel!`;
            } else {
              winTitle.textContent = p1.totalPoints >= p2.totalPoints ? `🏆 ${p1.username} Wins!` : `🏆 ${p2.username} Wins!`;
            }
          }

          const col1 = document.getElementById('duel-final-col-p1');
          const col2 = document.getElementById('duel-final-col-p2');
          if (col1) col1.classList.toggle('winner-col', p1.totalPoints > p2.totalPoints);
          if (col2) col2.classList.toggle('winner-col', p2.totalPoints > p1.totalPoints);

          const fillCol = (prefix, p) => {
            const nameEl = document.getElementById(`duel-final-${prefix}-name`);
            const eloEl = document.getElementById(`duel-final-${prefix}-elo`);
            const easyEl = document.getElementById(`duel-final-${prefix}-easy`);
            const medEl = document.getElementById(`duel-final-${prefix}-med`);
            const hardEl = document.getElementById(`duel-final-${prefix}-hard`);
            const totEl = document.getElementById(`duel-final-${prefix}-total`);

            if (nameEl) nameEl.textContent = p.username;
            if (eloEl) {
              const d = Number(p.eloDelta) || 0;
              const sign = d >= 0 ? `+${d}` : `${d}`;
              eloEl.textContent = `🏆 ${p.oldElo || 1000} → ${p.newElo || p.elo || 1000} (${sign} ELO)`;
              eloEl.className = 'duel-final-elo-change ' + (d > 0 ? 'positive' : (d < 0 ? 'negative' : ''));
            }
            const rE = (p.rounds && p.rounds.easy) || { rawScore: 0, weightedScore: 0 };
            const rM = (p.rounds && p.rounds.medium) || { rawScore: 0, weightedScore: 0 };
            const rH = (p.rounds && p.rounds.hard) || { rawScore: 0, weightedScore: 0 };
            if (easyEl) easyEl.textContent = `${rE.rawScore || 0} = ${rE.weightedScore || 0} pts`;
            if (medEl) medEl.textContent = `${rM.rawScore || 0} × 2 = ${rM.weightedScore || 0} pts`;
            if (hardEl) hardEl.textContent = `${rH.rawScore || 0} × 3 = ${rH.weightedScore || 0} pts`;
            if (totEl) totEl.textContent = `${p.totalPoints || 0} PTS`;
          };

          fillCol('p1', p1);
          fillCol('p2', p2);
        }

        startDuelRoundGameplay(roundDiff, roundSeed) {
          this.duelRoundPlaying = roundDiff;
          this.duelRoundFinishedLocal = false;
          this.selectedDifficulty = roundDiff;

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
          this.currentTick = 0;
          this.flapTicks = [];
          this.pendingFlap = false;
          this.queuedFlaps = 0;
          this.flapBufferTicks = 0;
          this.lastFlapTick = -10;
          this.lastQueueFlapTime = 0;
          this.physicsAccumulator = 0;
          this.lastFrameTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

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
          this.spawnPipePair(CONFIG.pipeSpawnX - CONFIG.baseSpawnDistance * 2);
          this.spawnPipePair(CONFIG.pipeSpawnX - CONFIG.baseSpawnDistance);
          this.spawnPipePair(CONFIG.pipeSpawnX);

          this.simBirdY = CONFIG.birdStartY;
          this.prevBirdY = CONFIG.birdStartY;
          this.birdGroup.position.set(CONFIG.birdX, CONFIG.birdStartY, 0);
          this.birdGroup.rotation.set(0, 0, 0);
          this.birdMeshGroup.rotation.set(0, 0, 0);

          this.birdVelocityY = CONFIG.flapImpulse;
          this.wingFlapBoost = 1.0;
          this.sound.playFlap();
        }

        async handleDuelRoundCrash() {
          const crashedRound = this.duelRoundPlaying || (this.activeDuelLobby && this.activeDuelLobby.currentRound) || 'easy';
          const achievedScore = this.score;
          this.duelRoundFinishedLocal = true;

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

          try {
            const res = await this.apiRequest('/api/duels/round-finish', 'POST', {
              lobbyId: this.activeDuelLobbyId,
              clientId: this.duelClientId,
              guestUsername: this.getDuelDisplayUsername(),
              round: crashedRound,
              rawScore: achievedScore
            });
            if (res && res.lobby) {
              this.activeDuelLobby = res.lobby;
              this.syncDuelMatchState(res.lobby);
            }
          } catch (_) {
            this.fetchDuelsState();
          }
        }

        sendDuelLiveTelemetryIfNeeded(now) {
          if (!this.activeDuelLobbyId || !this.duelRoundPlaying) return;
          if (now - this.lastDuelTelemetrySentAt < 85) return;
          this.lastDuelTelemetrySentAt = now;

          const diff = this.getDifficultyParams();
          const pipeData = this.pipes.slice(0, 4).map(p => ({
            x: Number(p.x.toFixed(2)),
            bottomTopY: Number(p.bottomTopY.toFixed(2)),
            topBottomY: Number(p.topBottomY.toFixed(2)),
            gapCenterY: Number(p.gapCenterY.toFixed(2)),
            gapSize: Number(p.gapSize.toFixed(2))
          }));

          this.apiRequest('/api/duels/live-update', 'POST', {
            lobbyId: this.activeDuelLobbyId,
            clientId: this.duelClientId,
            guestUsername: this.getDuelDisplayUsername(),
            round: this.duelRoundPlaying,
            score: this.score,
            birdY: Number(this.simBirdY.toFixed(2)),
            birdVelocityY: Number(this.birdVelocityY.toFixed(2)),
            rotZ: Number((this.birdGroup ? this.birdGroup.rotation.z : 0).toFixed(2)),
            alive: this.state === GAME_STATE.PLAYING,
            speed: Number((diff.speed || CONFIG.baseSpeed).toFixed(2)),
            pipes: pipeData
          }).then(res => {
            if (res && res.lobby) {
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

          const badgeEl = document.getElementById('duel-hud-round-badge');
          if (badgeEl) {
            badgeEl.textContent = `ROUND ${lobby.currentRoundNumber}/3 • ${(lobby.currentRoundLabel || 'EASY').toUpperCase()} (${mult}x)`;
          }

          const myRaw = this.state === GAME_STATE.PLAYING ? this.score : (me && me.rounds && me.rounds[rKey] ? me.rounds[rKey].rawScore : 0);
          const myPts = myRaw * mult;
          const prevRoundsPts = me && me.rounds
            ? ((rKey !== 'easy' ? (me.rounds.easy.weightedScore || 0) : 0) + (rKey === 'hard' ? (me.rounds.medium.weightedScore || 0) : 0))
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
          if (!coinsEl) return;
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
          coinsEl.textContent = String(Math.max(0, Math.round(Number(rawCoins) || 0)));
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
                wTitle.textContent = `Lobby "${this.activeDuelLobby.name}" — Waiting for Opponent...`;
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

            let statusText = '🟢 Waiting (1/2)';
            if (lobby.status === 'countdown') {
              statusText = `⏱️ Starting Round ${lobby.currentRoundNumber}/3 (${lobby.currentRoundLabel} ${lobby.currentMultiplier}x)`;
            } else if (lobby.status === 'playing') {
              statusText = `🔥 Round ${lobby.currentRoundNumber}/3: ${lobby.currentRoundLabel} (${lobby.currentMultiplier}x)`;
            } else if (lobby.status === 'round_summary') {
              statusText = `📊 Round ${lobby.currentRoundNumber}/3 Results`;
            }

            const infoDiv = document.createElement('div');
            infoDiv.className = 'duel-lobby-info';

            const topLine = document.createElement('div');
            topLine.className = 'duel-lobby-top-line';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'duel-lobby-name';
            nameSpan.textContent = lobby.name || 'Duel Lobby';

            const statusSpan = document.createElement('span');
            statusSpan.className = 'duel-lobby-status-tag ' + (isWaiting ? 'waiting' : 'ongoing');
            statusSpan.textContent = statusText;

            topLine.append(nameSpan, statusSpan);

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
              joinBtn.className = 'btn-duel-join-lobby';
              joinBtn.textContent = '⚔️ Join';
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
          const isMeDonut = this.isMeDonutUser();
          const myPill = document.getElementById('duel-ranked-my-pill');
          if (myPill) {
            const rText = this.myDuelStats.rank ? `Rank #${this.myDuelStats.rank}` : 'Unranked';
            myPill.textContent = `${rText} • 🏆 ${this.myDuelStats.duelElo || 1000} ELO`;
          }

          const listEl = document.getElementById('duel-ranked-list');
          if (!listEl) return;

          // If MeDonut is currently typing inside an Elo input in this list, don't wipe focus on background poll
          if (document.activeElement && listEl.contains(document.activeElement) && document.activeElement.classList.contains('duel-elo-admin-input')) {
            return;
          }

          listEl.innerHTML = '';

          if (!Array.isArray(this.duelRankedLeaderboard) || this.duelRankedLeaderboard.length === 0) {
            listEl.innerHTML = '<div class="lb-empty">No ranked players found yet.</div>';
            return;
          }

          const myUKey = this.getDuelDisplayUsername().toLowerCase();

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
        // SPLIT-SCREEN SPECTATOR MODE (Left = Player 1, Right = Player 2)
        // --------------------------------------------------------------------
        getDefaultSpectatorPipes() {
          return [
            { x: 3.5, bottomTopY: 3.3, topBottomY: 8.3, gapCenterY: 5.8, gapSize: 5.0 },
            { x: 11.5, bottomTopY: 4.7, topBottomY: 9.7, gapCenterY: 7.2, gapSize: 5.0 },
            { x: 19.5, bottomTopY: 2.7, topBottomY: 7.7, gapCenterY: 5.2, gapSize: 5.0 }
          ];
        }

        async startSpectatingDuel(lobbyId) {
          if (!lobbyId) return;
          this.duelSpectatingLobbyId = lobbyId;
          this._lastSpecAppliedSkinId = null;
          this.clearSpectatorPipePools();
          this.duelSpecSim = {
            p1: { y: CONFIG.birdStartY, vy: 0, prevVy: 0, rotZ: 0, alive: true, speed: 0, birdOffsetY: 0, pipeOffsetX: 0, lastLiveUpdatedAt: 0, selectedSkin: 'classic', selectedPipeSkin: 'classic_pipe', wingPhase: 0, wingFlapBoost: 0, pipes: this.getDefaultSpectatorPipes() },
            p2: { y: CONFIG.birdStartY, vy: 0, prevVy: 0, rotZ: 0, alive: true, speed: 0, birdOffsetY: 0, pipeOffsetX: 0, lastLiveUpdatedAt: 0, selectedSkin: 'classic', selectedPipeSkin: 'classic_pipe', wingPhase: 0, wingFlapBoost: 0, pipes: this.getDefaultSpectatorPipes() }
          };
          if (Array.isArray(this.pipes)) {
            this.pipes.forEach(p => { if (p && p.group) p.group.visible = false; });
          }
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
            this.duelSpecPipePools = { p1: [], p2: [] };
            return;
          }
          ['p1', 'p2'].forEach(side => {
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
          this.clearSpectatorPipePools();
          if (Array.isArray(this.pipes)) {
            this.pipes.forEach(p => { if (p && p.group) p.group.visible = true; });
          }
          this.hideAllDuelOverlays();
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

        syncSpectatorLobbyState(lobby) {
          if (!lobby) return;
          const specOverlay = document.getElementById('duel-spectator-overlay');
          if (specOverlay) specOverlay.style.display = 'block';

          const lobbyNameEl = document.getElementById('duel-spec-lobby-name');
          if (lobbyNameEl) lobbyNameEl.textContent = lobby.name || 'Duel Match';

          const roundPillEl = document.getElementById('duel-spec-round-pill');
          if (roundPillEl) {
            if (lobby.status === 'waiting') {
              roundPillEl.textContent = 'Waiting for Challenger (1/2)';
            } else if (lobby.status === 'finished') {
              roundPillEl.textContent = 'Match Complete';
            } else {
              roundPillEl.textContent = `Round ${lobby.currentRoundNumber}/3: ${lobby.currentRoundLabel} (${lobby.currentMultiplier}x)`;
            }
          }

          const p1 = lobby.players && lobby.players[0] ? lobby.players[0] : null;
          const p2 = lobby.players && lobby.players[1] ? lobby.players[1] : null;
          const rKey = lobby.currentRound || 'easy';
          const mult = lobby.currentMultiplier || 1;

          const updateSpecCard = (prefix, p, simTarget) => {
            const nameEl = document.getElementById(`duel-spec-${prefix}-name`);
            const eloEl = document.getElementById(`duel-spec-${prefix}-elo`);
            const rScoreEl = document.getElementById(`duel-spec-${prefix}-round-score`);
            const totEl = document.getElementById(`duel-spec-${prefix}-total-pts`);
            const statEl = document.getElementById(`duel-spec-${prefix}-status`);
            const roundsEl = document.getElementById(`duel-spec-${prefix}-rounds`);

            if (!p) {
              if (nameEl) nameEl.textContent = 'Waiting for Player...';
              if (eloEl) eloEl.textContent = '🏆 — ELO';
              if (rScoreEl) rScoreEl.textContent = '0';
              if (totEl) totEl.textContent = '0 PTS';
              if (statEl) statEl.textContent = '⏳ Waiting';
              if (roundsEl) roundsEl.textContent = 'Easy (1x): 0 • Med (2x): 0 • Hard (3x): 0';
              return;
            }

            const rObj = (p.rounds && p.rounds[rKey]) || { rawScore: 0, weightedScore: 0, finished: false };
            const rawScore = (lobby.status === 'playing' && p.live) ? p.live.score : rObj.rawScore;
            const ptsScore = rawScore * mult;

            if (nameEl) nameEl.textContent = p.username;
            if (eloEl) eloEl.textContent = `🏆 ${p.elo || 1000} ELO`;
            if (rScoreEl) rScoreEl.textContent = `${rawScore} (${ptsScore} pts)`;
            if (totEl) totEl.textContent = `${p.totalPoints || 0} PTS`;

            if (statEl) {
              if (lobby.status === 'waiting') statEl.textContent = '⏳ Ready in Lobby';
              else if (rObj.finished || (p.live && !p.live.alive)) statEl.textContent = '💥 Crashed';
              else statEl.textContent = '🟢 Flying';
            }

            if (roundsEl && p.rounds) {
              const ePts = p.rounds.easy ? p.rounds.easy.weightedScore : 0;
              const mPts = p.rounds.medium ? p.rounds.medium.weightedScore : 0;
              const hPts = p.rounds.hard ? p.rounds.hard.weightedScore : 0;
              roundsEl.textContent = `Easy (1x): ${ePts} • Med (2x): ${mPts} • Hard (3x): ${hPts}`;
            }

            if (simTarget) {
              simTarget.selectedSkin = p.selectedSkin || 'classic';
              simTarget.selectedPipeSkin = p.selectedPipeSkin || 'classic_pipe';
            }

            if (p.live && simTarget) {
              const liveTs = Number(p.live.updatedAt) || 0;
              if (liveTs !== (simTarget.lastLiveUpdatedAt || 0) || !Array.isArray(simTarget.pipes) || simTarget.pipes.length === 0) {
                simTarget.lastLiveUpdatedAt = liveTs;
                const newVy = typeof p.live.birdVelocityY === 'number' ? p.live.birdVelocityY : 0;
                if (newVy > 2.2 && newVy > (simTarget.prevVy || 0) + 1.5) {
                  simTarget.wingFlapBoost = 1.0;
                }
                simTarget.prevVy = newVy;

                const newY = typeof p.live.birdY === 'number' ? p.live.birdY : CONFIG.birdStartY;
                const renderedY = (typeof simTarget.y === 'number' ? simTarget.y : newY) + (simTarget.birdOffsetY || 0);
                const yDiff = renderedY - newY;
                simTarget.birdOffsetY = (Math.abs(yDiff) < 3.5 && lobby.status === 'playing') ? yDiff : 0;
                simTarget.y = newY;
                simTarget.vy = newVy;
                simTarget.rotZ = typeof p.live.rotZ === 'number' ? p.live.rotZ : 0;
                simTarget.alive = Boolean(p.live.alive && !rObj.finished);
                if (typeof p.live.speed === 'number' && p.live.speed > 0) {
                  simTarget.speed = p.live.speed;
                }

                if (Array.isArray(p.live.pipes) && p.live.pipes.length > 0) {
                  const newPipes = p.live.pipes.map(pp => ({ ...pp }));
                  if (lobby.status === 'playing' && Array.isArray(simTarget.pipes) && simTarget.pipes.length > 0) {
                    let matchedDx = null;
                    for (const op of simTarget.pipes) {
                      const opRenderX = op.x + (simTarget.pipeOffsetX || 0);
                      const matchingNew = newPipes.find(np =>
                        Math.abs((op.gapCenterY || 0) - (np.gapCenterY || 0)) < 0.15 &&
                        Math.abs(opRenderX - np.x) < 3.5
                      );
                      if (matchingNew) {
                        matchedDx = opRenderX - matchingNew.x;
                        break;
                      }
                    }
                    simTarget.pipeOffsetX = matchedDx !== null ? Math.max(-2.5, Math.min(2.5, matchedDx)) : 0;
                  } else {
                    simTarget.pipeOffsetX = 0;
                  }
                  simTarget.pipes = newPipes;
                } else if (lobby.status !== 'playing' || !Array.isArray(simTarget.pipes) || simTarget.pipes.length === 0) {
                  simTarget.pipeOffsetX = 0;
                  simTarget.pipes = this.getDefaultSpectatorPipes();
                }
              }
            }
          };

          updateSpecCard('p1', p1, this.duelSpecSim.p1);
          updateSpecCard('p2', p2, this.duelSpecSim.p2);

          // Also display 70% dark backdrop overlays for spectators during Countdown, Round Summary, or Final Results!
          if (lobby.status === 'countdown') {
            this.duelCountdownTargetMs = Date.now() + (lobby.countdownRemainingMs || 1500);
            const matchupEl = document.getElementById('duel-countdown-matchup');
            if (matchupEl) {
              matchupEl.textContent = `${p1 ? p1.username : 'P1'} (${p1 ? p1.elo : 1000} ELO) ⚔️ ${p2 ? p2.username : 'P2'} (${p2 ? p2.elo : 1000} ELO)`;
            }
            const roundTagEl = document.getElementById('duel-countdown-round-tag');
            if (roundTagEl) {
              roundTagEl.textContent = `ROUND ${lobby.currentRoundNumber} OF 3 — ${(lobby.currentRoundLabel || 'EASY').toUpperCase()} (${lobby.currentMultiplier}x)`;
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

        applySpectatorPipesToScene(sideKey, pipesData, pipeSkinId = 'classic_pipe', pipeOffsetX = 0) {
          if (!this.duelSpecPipePools) {
            this.duelSpecPipePools = { p1: [], p2: [] };
          }
          const otherKey = sideKey === 'p1' ? 'p2' : 'p1';
          const otherPool = this.duelSpecPipePools[otherKey];
          if (Array.isArray(otherPool)) {
            for (let i = 0; i < otherPool.length; i++) {
              if (otherPool[i] && otherPool[i].group) otherPool[i].group.visible = false;
            }
          }

          const pool = this.duelSpecPipePools[sideKey];
          const safePipes = (Array.isArray(pipesData) && pipesData.length > 0)
            ? pipesData
            : this.getDefaultSpectatorPipes();

          while (pool.length > safePipes.length) {
            const rem = pool.pop();
            if (rem && rem.group) this.scene.remove(rem.group);
          }
          for (let i = 0; i < safePipes.length; i++) {
            const pd = safePipes[i];
            const renderX = pd.x + pipeOffsetX;
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

        renderDuelSpectatorSplitScreen(dt) {
          const w = Math.max(2, window.innerWidth);
          const h = Math.max(1, window.innerHeight);
          const halfW = Math.floor(w / 2);
          const lobby = this.duelSpectatingLobby;
          const isPlaying = lobby && lobby.status === 'playing';
          const roundKey = (lobby && lobby.currentRound) || 'easy';
          const diffCfg = CONFIG.difficulties[roundKey] || CONFIG.difficulties.easy;
          const defaultSpeed = diffCfg.startSpeed || CONFIG.baseSpeed;
          const decayFactor = Math.exp(-13 * dt);

          // Smoothly extrapolate P1 and P2 bird positions, wing flaps, and pipes between network updates
          [this.duelSpecSim.p1, this.duelSpecSim.p2].forEach(sim => {
            sim.wingFlapBoost = Math.max(0, (sim.wingFlapBoost || 0) - dt * 2.5);
            const wingSpeed = isPlaying ? (12 + sim.wingFlapBoost * 18) : 11;
            sim.wingPhase = (sim.wingPhase || 0) + dt * wingSpeed;
            sim.birdOffsetY = (sim.birdOffsetY || 0) * decayFactor;
            sim.pipeOffsetX = (sim.pipeOffsetX || 0) * decayFactor;

            const scrollSpeed = (sim.speed && sim.speed > 0) ? sim.speed : defaultSpeed;
            const speedRatio = Math.min(2.0, scrollSpeed / CONFIG.baseSpeed);
            const simGravity = CONFIG.gravity * speedRatio * speedRatio;

            if (isPlaying && sim.alive) {
              sim.vy = Math.max(CONFIG.maxFallSpeed * speedRatio, (sim.vy || 0) + simGravity * dt);
              sim.y = Math.max(CONFIG.groundY + CONFIG.birdRadius, Math.min(CONFIG.ceilingY, (sim.y || CONFIG.birdStartY) + sim.vy * dt));
              sim.rotZ = THREE.MathUtils.clamp((sim.vy / speedRatio) * 0.065, -Math.PI * 0.42, Math.PI * 0.24);
              if (Array.isArray(sim.pipes)) {
                for (const pp of sim.pipes) {
                  pp.x -= scrollSpeed * dt;
                }
              }
            } else if (!isPlaying) {
              sim.birdOffsetY = 0;
              sim.pipeOffsetX = 0;
              sim.y = CONFIG.birdStartY + Math.sin(this.elapsedTime * 3.6) * 0.4;
              sim.rotZ = Math.cos(this.elapsedTime * 3.6) * 0.08;
            }
          });

          const subAspect = halfW / h;
          this.camera.aspect = subAspect;
          this.camera.updateProjectionMatrix();
          this.adjustCameraForAspect(subAspect);

          this.renderer.setScissorTest(true);

          const renderHalf = (sideKey, sim, vx, vw) => {
            const skinObj = (typeof BIRD_SKINS !== 'undefined' && BIRD_SKINS.find(s => s.id === (sim.selectedSkin || 'classic'))) || BIRD_SKINS[0];
            const pipeSkinObj = (typeof PIPE_SKINS !== 'undefined' && PIPE_SKINS.find(p => p.id === (sim.selectedPipeSkin || 'classic_pipe'))) || PIPE_SKINS[0];

            if (this._lastSpecAppliedSkinId !== skinObj.id) {
              this.applySkinVisualsOnly(skinObj, true, true);
              this._lastSpecAppliedSkinId = skinObj.id;
            }
            this.activePipeAssets = this.getOrCreatePipeSkinAssets(pipeSkinObj);

            const displayY = Math.max(CONFIG.groundY + CONFIG.birdRadius, Math.min(CONFIG.ceilingY, (sim.y || CONFIG.birdStartY) + (sim.birdOffsetY || 0)));
            if (this.birdGroup) {
              this.birdGroup.position.set(CONFIG.birdX, displayY, 0);
              this.birdGroup.rotation.z = sim.rotZ || 0;
            }
            if (this.birdMeshGroup) {
              this.birdMeshGroup.rotation.y = isPlaying ? 0 : Math.sin(this.elapsedTime * 1.4) * 0.32;
            }
            this.wingFlapBoost = sim.wingFlapBoost || 0;
            const flapAmp = isPlaying ? (0.55 + this.wingFlapBoost * 0.4) : 0.65;
            const flapAngle = Math.sin(sim.wingPhase || 0) * flapAmp;
            if (this.leftWingPivot) this.leftWingPivot.rotation.x = flapAngle;
            if (this.rightWingPivot) this.rightWingPivot.rotation.x = -flapAngle;

            this.updateAnimatedSkinEffects(dt);
            this.applySpectatorPipesToScene(sideKey, sim.pipes, pipeSkinObj.id, sim.pipeOffsetX || 0);

            this.renderer.setViewport(vx, 0, vw, h);
            this.renderer.setScissor(vx, 0, vw, h);
            this.renderer.render(this.scene, this.camera);
          };

          // 1. Render Left Half (Player 1)
          renderHalf('p1', this.duelSpecSim.p1, 0, halfW);

          // 2. Render Right Half (Player 2)
          renderHalf('p2', this.duelSpecSim.p2, halfW, w - halfW);

          this.renderer.setScissorTest(false);
          const fullAspect = w / h;
          this.camera.aspect = fullAspect;
          this.camera.updateProjectionMatrix();
          this.adjustCameraForAspect(fullAspect);
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
