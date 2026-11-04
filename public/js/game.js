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
          this.lbShowAllPlayers = false;
          this.selectedDifficulty = 'medium';
          this.activeLbTab = 'medium';
          this.lbUniqueRecordsOnly = true;
          this.isStartingRun = false;

          // Anti-Cheat & Sub-Tick Interpolation State
          this.activeRunId = null;
          this.activeSeed = 123456789;
          this.prng = createSeededPRNG(this.activeSeed);
          this.currentTick = 0;
          this.flapTicks = [];
          this.pendingFlap = false;
          this.flapBufferTicks = 0;
          this.lastFlapTick = -10;
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
            if (this.state === GAME_STATE.START || this.state === GAME_STATE.GAMEOVER) {
              this.fetchLeaderboards(this.lbShowAllPlayers);
            }
          }, 5000);

          this.lastFrameTime = performance.now();
          this.animate = this.animate.bind(this);
          requestAnimationFrame(this.animate);
        }

        // ------------------------------------------------------------------------
        // CONTROLS & UI BINDINGS
        // ------------------------------------------------------------------------
        bindEvents() {
          window.addEventListener('keydown', (e) => {
            const activeEl = document.activeElement;
            const tag = activeEl && activeEl.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') {
              if (e.key === 'Enter') {
                if (activeEl && (activeEl.id === 'guest-modal-username' || activeEl.id === 'guest-modal-password')) {
                  this.handleGuestModalAuth('smart');
                } else if (activeEl && (activeEl.id === 'auth-username' || activeEl.id === 'auth-password')) {
                  this.handleAuth('smart');
                }
              }
              return;
            }

            const guestModal = document.getElementById('guest-login-modal');
            if (guestModal && guestModal.classList.contains('active')) {
              if (e.code === 'Escape') {
                this.toggleGuestLoginModal(false);
              }
              return;
            }

            const isJumpKey = (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW' || e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W');
            if (isJumpKey) {
              e.preventDefault();
              if (this.state === GAME_STATE.START) {
                this.startGame();
              } else if (this.state === GAME_STATE.PLAYING) {
                this.queueFlap();
              } else if (this.state === GAME_STATE.GAMEOVER) {
                this.startGame();
              }
            } else if (e.code === 'KeyM') {
              this.sound.toggleMute();
            } else if (e.code === 'KeyR') {
              this.resetVisualSceneAndRecover(true);
            } else if (e.code === 'Escape') {
              const pModal = document.getElementById('profile-modal');
              if (pModal && pModal.classList.contains('active')) {
                this.toggleProfileModal(false);
              } else if (this.currentAppView && this.currentAppView !== 'lobby') {
                this.switchView('lobby');
              }
            }
          });

          this.renderer.domElement.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            if (this.state === GAME_STATE.START) {
              this.startGame();
            } else if (this.state === GAME_STATE.PLAYING) {
              this.queueFlap();
            }
          });

          // Global pointerdown listener to ensure jump clicks anywhere on screen are never missed during gameplay
          window.addEventListener('pointerdown', (e) => {
            if (this.state === GAME_STATE.PLAYING) {
              const target = e.target;
              if (target && (target.closest('button') || target.closest('a') || target.closest('input') || target.closest('select') || target.closest('.modal-backdrop') || target.closest('.app-header'))) {
                return;
              }
              this.queueFlap();
            }
          }, { passive: true });

          document.getElementById('start-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.startGame();
          });

          document.getElementById('restart-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.startGame();
          });

          document.getElementById('back-hub-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.showLobbyScreen();
          });

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

          // Top Navigation Dock Views (Lobby vs Locker vs Leaderboard vs Stats vs Settings)
          document.querySelectorAll('#main-nav-dock .dock-tab').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const view = btn.getAttribute('data-view') || 'lobby';
              this.switchView(view);
            });
          });

          const brandHomeBtn = document.getElementById('brand-home-btn');
          if (brandHomeBtn) {
            brandHomeBtn.addEventListener('click', () => this.switchView('lobby'));
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
            });
          });

          // Leaderboard tab buttons & live search bar
          document.querySelectorAll('#lb-tabs .lb-tab').forEach(tabBtn => {
            tabBtn.addEventListener('click', () => {
              this.setLeaderboardTab(tabBtn.getAttribute('data-tab'));
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

          if (typeof this.initChangelog === 'function') {
            this.initChangelog();
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
          this.switchView('lobby');
          this.state = GAME_STATE.START;
          this.spawnLobbyPreviewPipes();
          this.simBirdY = CONFIG.birdStartY;
          this.prevBirdY = CONFIG.birdStartY;
          this.birdGroup.position.set(CONFIG.birdX, CONFIG.birdStartY, 0);
          this.birdGroup.rotation.set(0, 0, 0);
          this.birdMeshGroup.rotation.set(0, 0, 0);
          this.renderAllCosmeticGrids();
          this.fetchLeaderboards();
        }

        async startGame() {
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

          this.activeRunId = null;
          this.activeSeed = (Math.random() * 0x7fffffff) | 1;

          if (this.currentUser && this.authToken) {
            try {
              const runData = await this.apiRequest('/api/run/start', 'POST', {
                difficulty: this.selectedDifficulty
              });
              this.activeRunId = runData.runId;
              this.activeSeed = runData.seed;
            } catch (err) {
              if (err && String(err.message).toLowerCase().includes('log in')) {
                this.clearLoggedInUser();
              }
              this.activeRunId = null;
            }
          }

          this.prng = createSeededPRNG(this.activeSeed);
          this.currentTick = 0;
          this.flapTicks = [];
          this.pendingFlap = false;
          this.lastFlapTick = -10;
          this.physicsAccumulator = 0;

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
          this.flapBufferTicks = 0;
          this.sound.playFlap();
        }

        queueFlap() {
          if (this.state !== GAME_STATE.PLAYING) return;
          this.pendingFlap = true;
          this.flapBufferTicks = 6; // Buffers jump for up to 6 ticks (~100ms) so it is never dropped
        }

        async triggerGameOver() {
          if (this.state === GAME_STATE.CRASHING || this.state === GAME_STATE.GAMEOVER) return;

          const unlockedBefore = this.getUnlockedBirdSkinCount() + this.getUnlockedPipeSkinCount();

          this.state = GAME_STATE.CRASHING;
          this.sound.playCollision();
          this.shakeTimer = 0.30;

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
              this.renderAllCosmeticGrids();
              this.renderLeaderboard(verifyRes.entryId || null);

              document.getElementById('final-score').textContent = String(verifyRes.verifiedScore);
              document.getElementById('best-score').textContent = String(this.getBestForDifficulty(diffKey));
              badge.classList.toggle('visible', Boolean(verifyRes.isNewRecord && verifyRes.verifiedScore > 0));

              statusPill.className = 'anticheat-status verified';
              if (verifyRes.autoHidden) {
                statusPill.textContent = `🛡️ Verified (${finalTicks} ticks) • 🕒 Off-Hours (Outside 7:50-14:10 Danish) — Saved & Hidden from Leaderboard`;
              } else {
                statusPill.textContent = `🛡️ Anti-Cheat Verified (${finalTicks} ticks) • Added to ${diffLabel} Leaderboard!`;
              }
            } catch (err) {
              statusPill.className = 'anticheat-status rejected';
              statusPill.textContent = `⚠️ ${err.message}`;
              this.fetchLeaderboards();
            }
          } else {
            this.renderAllCosmeticGrids();
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
          const scoreEl = document.getElementById('hud-score');
          const speedEl = document.getElementById('speed-mult-text');
          const modeEl = document.getElementById('hud-mode-text');

          scoreEl.textContent = String(this.score);
          const diff = this.getDifficultyParams();
          speedEl.textContent = `${diff.speedMult}x`;
          modeEl.textContent = diff.label.toUpperCase();

          if (pop) {
            scoreEl.classList.remove('score-pop');
            void scoreEl.offsetWidth;
            scoreEl.classList.add('score-pop');
            setTimeout(() => scoreEl.classList.remove('score-pop'), 180);
          }
        }

        clearPipes() {
          for (const pipe of this.pipes) {
            this.scene.remove(pipe.group);
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

          // Smooth, non-dropping jump execution: checks if jump is queued and valid against anti-cheat rate limit
          if (this.pendingFlap || this.flapBufferTicks > 0) {
            if ((this.currentTick - this.lastFlapTick) >= 2) {
              this.birdVelocityY = flapImpulse;
              this.wingFlapBoost = 1.0;
              this.flapTicks.push(this.currentTick);
              this.lastFlapTick = this.currentTick;
              this.sound.playFlap();
              this.pendingFlap = false;
              this.flapBufferTicks = 0;
            } else if (this.flapBufferTicks > 0) {
              // Decrement buffer timer, retaining the queued jump for the very next tick
              this.flapBufferTicks--;
              this.pendingFlap = false;
            } else {
              this.pendingFlap = false;
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
          const diff = this.getDifficultyParams();
          const visualScrollSpeed = (this.state === GAME_STATE.PLAYING)
            ? diff.speed
            : (this.state === GAME_STATE.START ? 3.2 : 0);

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

          this.updateAnimatedSkinEffects(frameDt);

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
            this.renderSpotlight3DTurntable();
          } catch (_) {}
          if (this.renderer && this.scene && this.camera) {
            this.renderer.setScissorTest(false);
            this.renderer.setViewport(0, 0, Math.max(1, window.innerWidth), Math.max(1, window.innerHeight));
            this.renderer.render(this.scene, this.camera);
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
