/**
 * ============================================================================
 * GLOBAL LIVE CHAT CONTROLLER (chat.js)
 * ============================================================================
 * Features:
 * - 3-Second Cooldown with visual countdown timer and progress bar
 * - Right-corner toggle button (💬) with unread message badge
 * - Fixed/floating right-side drawer matching active theme (Dark, Light, Cyber)
 * - Rich message bubbles with player skin icon & name on top
 * - Interactive Message Replies with quoted snippet banners
 * - Automatic Celebratory Announcements for Personal Bests & Top 10 Runs
 * - Strict In-Game suppression (auto-hides during rounds, restores in lobby)
 * - Audio Chimes with mute toggle
 */

'use strict';

class ChatManager {
  constructor(game) {
    this.game = game;
    this.isOpen = false;
    this.chatWasOpenBeforeRound = false;
    this.lastFetchedTimestamp = 0;
    this.renderedMessageIds = new Set();
    this.unreadCount = 0;
    this.activeReply = null;

    // Cooldown state (3-second rate limit)
    this.cooldownActive = false;
    this.cooldownEndTime = 0;
    this.cooldownTimer = null;
    this.cooldownDurationMs = 3000;

    // Chime sound preference
    this.soundEnabled = localStorage.getItem('flappy3d_chat_sound') !== 'false';

    // Global Broadcast & Coin Giveaway state
    this.seenAnnouncementIds = this.loadSeenAnnouncementIds();
    this.enqueuedAnnouncementIds = new Set(this.seenAnnouncementIds);
    this.pendingBroadcastQueue = [];
    this.activeBroadcast = null;
    this.broadcastAutoDismissTimer = null;
    this.broadcastDisplayDurationMs = 5000;
    this.activeGiveaways = [];
    this.giveawayTickTimer = null;
    this.giveawayExpiredPollTriggered = new Set();

    // Feedback modal state
    this.feedbackCategory = 'suggestion';
    this.feedbackModalOpen = false;

    this.pollTimer = null;
    this.isPolling = false;

    this.initDOM();
    this.bindEvents();
    this.startPolling();
    this.startGiveawayCountdownLoop();
  }

  loadSeenAnnouncementIds() {
    try {
      const raw = localStorage.getItem('flappy3d_seen_announcements_v1');
      const parsed = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed.slice(-80) : []);
    } catch (_) {
      return new Set();
    }
  }

  saveSeenAnnouncementIds() {
    try {
      const arr = Array.from(this.seenAnnouncementIds).slice(-80);
      localStorage.setItem('flappy3d_seen_announcements_v1', JSON.stringify(arr));
    } catch (_) {}
  }

  isMeDonutUser() {
    const name = String(this.game?.currentUser?.username || '').trim().toLowerCase();
    return name === 'medonut';
  }

  isPlayerInActiveRun() {
    if (typeof document !== 'undefined' && document.body && document.body.classList.contains('in-game')) {
      return true;
    }
    const st = this.game && this.game.state;
    if (!st) return false;
    if (typeof GAME_STATE !== 'undefined') {
      return st === GAME_STATE.PLAYING || st === GAME_STATE.CRASHING;
    }
    return st === 'PLAYING' || st === 'CRASHING';
  }

  initDOM() {
    this.panelEl = document.getElementById('game-chat-panel');
    this.toggleBtn = document.getElementById('btn-chat-toggle');
    this.closeBtn = document.getElementById('btn-close-chat');
    this.messagesListEl = document.getElementById('chat-messages-list');
    this.inputFormEl = document.getElementById('chat-input-form');
    this.inputFieldEl = document.getElementById('chat-input-field');
    this.sendBtn = document.getElementById('chat-send-btn');
    this.sendLabelEl = document.getElementById('chat-send-label');
    this.unreadBadgeEl = document.getElementById('chat-unread-badge');
    this.charCounterEl = document.getElementById('chat-char-counter');
    this.replyPreviewEl = document.getElementById('chat-reply-preview');
    this.replyUsernameEl = document.getElementById('chat-reply-username');
    this.replySnippetEl = document.getElementById('chat-reply-text');
    this.cancelReplyBtn = document.getElementById('btn-cancel-reply');
    this.soundToggleBtn = document.getElementById('chat-sound-toggle-btn');
    this.cooldownBarWrap = document.getElementById('chat-cooldown-bar-wrap');
    this.cooldownProgress = document.getElementById('chat-cooldown-bar-progress');
    this.warningBannerEl = document.getElementById('chat-warning-banner');
    this.warningTextEl = document.getElementById('chat-warning-text');
    this.warningTimeout = null;

    // Global Broadcast Banner elements
    this.broadcastBannerEl = document.getElementById('global-broadcast-banner');
    this.broadcastIconEl = document.getElementById('global-broadcast-icon');
    this.broadcastTitleEl = document.getElementById('global-broadcast-title');
    this.broadcastMetaEl = document.getElementById('global-broadcast-meta');
    this.broadcastQueuePillEl = document.getElementById('global-broadcast-queue-pill');
    this.broadcastTextEl = document.getElementById('global-broadcast-text');
    this.broadcastGiveawayMetaEl = document.getElementById('global-broadcast-giveaway-meta');
    this.broadcastEnterBtn = document.getElementById('global-broadcast-enter-btn');
    this.broadcastDismissBtn = document.getElementById('global-broadcast-dismiss-btn');
    this.broadcastTimerFillEl = document.getElementById('global-broadcast-timer-fill');

    // MeDonut Admin Chat Controls & Giveaways
    this.chatGiveawayPinEl = document.getElementById('chat-giveaway-pin');
    this.adminBarEl = document.getElementById('chat-admin-bar');
    this.btnGlobalMode = document.getElementById('btn-chat-global-mode');
    this.btnGiveawayOpen = document.getElementById('btn-chat-giveaway-open');
    this.globalDrawerEl = document.getElementById('chat-global-drawer');
    this.globalInputEl = document.getElementById('chat-global-input');
    this.globalCharCountEl = document.getElementById('chat-global-char-count');
    this.btnGlobalSend = document.getElementById('btn-chat-global-send');
    this.btnGlobalCancel = document.getElementById('btn-chat-global-cancel');
    this.giveawayDrawerEl = document.getElementById('chat-giveaway-drawer');
    this.giveawayCoinsInput = document.getElementById('giveaway-coins-input');
    this.giveawayWinnersInput = document.getElementById('giveaway-winners-input');
    this.giveawayDurationInput = document.getElementById('giveaway-duration-input');
    this.giveawaySplitPreviewEl = document.getElementById('giveaway-split-preview');
    this.btnGiveawaySubmit = document.getElementById('btn-giveaway-submit');
    this.btnGiveawayCancel = document.getElementById('btn-giveaway-cancel');

    // Feedback Button & Modal elements
    this.feedbackToggleBtn = document.getElementById('btn-feedback-toggle');
    this.feedbackModalEl = document.getElementById('feedback-modal');
    this.feedbackFormEl = document.getElementById('feedback-modal-form');
    this.feedbackMsgInput = document.getElementById('feedback-message-input');
    this.feedbackCharCounterEl = document.getElementById('feedback-char-counter');
    this.feedbackSenderNameEl = document.getElementById('feedback-sender-name');
    this.feedbackStatusEl = document.getElementById('feedback-status-msg');
    this.feedbackCloseBtn = document.getElementById('btn-feedback-close');
    this.feedbackCancelBtn = document.getElementById('btn-feedback-cancel');
    this.feedbackSubmitBtn = document.getElementById('btn-feedback-submit');

    if (this.game) {
      this.game.closeFeedbackModal = () => this.closeFeedbackModal();
    }

    this.updateSoundToggleUI();
    this.updateAdminToolsVisibility();
    this.updateGiveawaySplitPreview();
  }

  updateAdminToolsVisibility() {
    const isAdmin = this.isMeDonutUser();
    if (this.adminBarEl) {
      this.adminBarEl.style.display = isAdmin ? 'flex' : 'none';
    }
    if (!isAdmin) {
      if (this.globalDrawerEl) this.globalDrawerEl.style.display = 'none';
      if (this.giveawayDrawerEl) this.giveawayDrawerEl.style.display = 'none';
      if (this.btnGlobalMode) this.btnGlobalMode.classList.remove('active');
      if (this.btnGiveawayOpen) this.btnGiveawayOpen.classList.remove('active');
    }
  }

  showWarning(msg) {
    if (!this.warningBannerEl) return;
    if (this.warningTimeout) clearTimeout(this.warningTimeout);
    if (this.warningTextEl) {
      this.warningTextEl.textContent = msg;
    }
    this.warningBannerEl.style.display = 'flex';
    this.warningTimeout = setTimeout(() => {
      this.hideWarning();
    }, 4500);
  }

  hideWarning() {
    if (this.warningTimeout) {
      clearTimeout(this.warningTimeout);
      this.warningTimeout = null;
    }
    if (this.warningBannerEl) {
      this.warningBannerEl.style.display = 'none';
    }
  }

  bindEvents() {
    // 1. Toggle Button in Top-Right Header
    if (this.toggleBtn) {
      this.toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleChat();
      });
    }

    // 2. Close Button inside Chat Header
    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeChat();
      });
    }

    // 3. Cancel Reply Button
    if (this.cancelReplyBtn) {
      this.cancelReplyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.clearReply();
      });
    }

    // 4. Sound Chime Toggle Button
    if (this.soundToggleBtn) {
      this.soundToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.soundEnabled = !this.soundEnabled;
        localStorage.setItem('flappy3d_chat_sound', String(this.soundEnabled));
        this.updateSoundToggleUI();
      });
    }

    // 5. Character counter on typing
    if (this.inputFieldEl) {
      this.inputFieldEl.addEventListener('input', () => {
        this.hideWarning();
        const len = this.inputFieldEl.value.length;
        if (this.charCounterEl) {
          this.charCounterEl.textContent = `${len}/200`;
          if (len >= 190) {
            this.charCounterEl.style.color = '#ef4444';
          } else {
            this.charCounterEl.style.color = '';
          }
        }
      });
    }

    // 6. Submit Form
    if (this.inputFormEl) {
      this.inputFormEl.addEventListener('submit', (e) => {
        e.preventDefault();
        this.sendMessage();
      });
    }

    // 7. Global 'C' shortcut to toggle chat (only when not typing in an input)
    window.addEventListener('keydown', (e) => {
      const activeEl = document.activeElement;
      const tag = activeEl && activeEl.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      // Do not open chat during active gameplay
      if (document.body.classList.contains('in-game')) return;

      if (e.code === 'KeyC' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        this.toggleChat();
      }
    });

    // 8. Event delegation for Reply buttons in message list
    if (this.messagesListEl) {
      this.messagesListEl.addEventListener('click', (e) => {
        const replyBtn = e.target.closest('.chat-reply-action-btn');
        if (replyBtn) {
          e.stopPropagation();
          const msgId = replyBtn.getAttribute('data-reply-id');
          const username = replyBtn.getAttribute('data-reply-user');
          const msgCard = replyBtn.closest('.chat-message-item');
          const snippet = msgCard ? msgCard.querySelector('.chat-text')?.textContent || '' : '';
          this.setReply(msgId, username, snippet);
        }
      });
    }

    // 9. MeDonut Global Broadcast Composer controls
    if (this.btnGlobalMode) {
      this.btnGlobalMode.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this.isMeDonutUser()) return;
        const willOpen = !this.globalDrawerEl || this.globalDrawerEl.style.display === 'none';
        if (this.giveawayDrawerEl) this.giveawayDrawerEl.style.display = 'none';
        if (this.btnGiveawayOpen) this.btnGiveawayOpen.classList.remove('active');
        if (this.globalDrawerEl) this.globalDrawerEl.style.display = willOpen ? 'flex' : 'none';
        this.btnGlobalMode.classList.toggle('active', willOpen);
        if (willOpen && this.globalInputEl) {
          setTimeout(() => this.globalInputEl.focus(), 50);
        }
      });
    }
    if (this.btnGlobalCancel) {
      this.btnGlobalCancel.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.globalDrawerEl) this.globalDrawerEl.style.display = 'none';
        if (this.btnGlobalMode) this.btnGlobalMode.classList.remove('active');
      });
    }
    if (this.globalInputEl) {
      this.globalInputEl.addEventListener('input', () => {
        if (this.globalCharCountEl) {
          this.globalCharCountEl.textContent = `${this.globalInputEl.value.length}/280`;
        }
      });
    }
    if (this.btnGlobalSend) {
      this.btnGlobalSend.addEventListener('click', (e) => {
        e.stopPropagation();
        this.sendGlobalBroadcast();
      });
    }

    // 10. MeDonut Coin Giveaway Composer controls
    if (this.btnGiveawayOpen) {
      this.btnGiveawayOpen.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this.isMeDonutUser()) return;
        const willOpen = !this.giveawayDrawerEl || this.giveawayDrawerEl.style.display === 'none';
        if (this.globalDrawerEl) this.globalDrawerEl.style.display = 'none';
        if (this.btnGlobalMode) this.btnGlobalMode.classList.remove('active');
        if (this.giveawayDrawerEl) this.giveawayDrawerEl.style.display = willOpen ? 'flex' : 'none';
        this.btnGiveawayOpen.classList.toggle('active', willOpen);
        this.updateGiveawaySplitPreview();
      });
    }
    if (this.btnGiveawayCancel) {
      this.btnGiveawayCancel.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.giveawayDrawerEl) this.giveawayDrawerEl.style.display = 'none';
        if (this.btnGiveawayOpen) this.btnGiveawayOpen.classList.remove('active');
      });
    }
    [this.giveawayCoinsInput, this.giveawayWinnersInput, this.giveawayDurationInput].forEach((inp) => {
      if (inp) {
        inp.addEventListener('input', () => this.updateGiveawaySplitPreview());
      }
    });
    if (this.giveawayDrawerEl) {
      this.giveawayDrawerEl.querySelectorAll('.giveaway-preset-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const sec = Math.max(10, Math.floor(Number(btn.getAttribute('data-dur')) || 60));
          if (this.giveawayDurationInput) this.giveawayDurationInput.value = String(sec);
          this.giveawayDrawerEl.querySelectorAll('.giveaway-preset-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
    }
    if (this.btnGiveawaySubmit) {
      this.btnGiveawaySubmit.addEventListener('click', (e) => {
        e.stopPropagation();
        this.createCoinGiveaway();
      });
    }

    // 11. Active Giveaway Enter click delegation inside Chat Pin
    if (this.chatGiveawayPinEl) {
      this.chatGiveawayPinEl.addEventListener('click', (e) => {
        const enterBtn = e.target.closest('.chat-giveaway-enter-btn');
        if (!enterBtn || enterBtn.disabled) return;
        e.stopPropagation();
        const gwId = enterBtn.getAttribute('data-giveaway-id');
        if (gwId) this.enterGiveaway(gwId, enterBtn);
      });
    }

    // 12. Top-of-Screen Global Broadcast Banner buttons
    if (this.broadcastDismissBtn) {
      this.broadcastDismissBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dismissActiveGlobalBroadcast();
      });
    }
    if (this.broadcastEnterBtn) {
      this.broadcastEnterBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const gwId = this.activeBroadcast && this.activeBroadcast.giveawayId;
        if (gwId) {
          this.enterGiveaway(gwId, this.broadcastEnterBtn);
        }
      });
    }

    // 13. Floating Feedback Button & Feedback Modal controls
    if (this.feedbackToggleBtn) {
      this.feedbackToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openFeedbackModal();
      });
    }
    if (this.feedbackCloseBtn) {
      this.feedbackCloseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeFeedbackModal();
      });
    }
    if (this.feedbackCancelBtn) {
      this.feedbackCancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeFeedbackModal();
      });
    }
    if (this.feedbackModalEl) {
      this.feedbackModalEl.addEventListener('click', (e) => {
        if (e.target === this.feedbackModalEl) {
          this.closeFeedbackModal();
        }
      });
      this.feedbackModalEl.querySelectorAll('.feedback-cat-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.feedbackCategory = btn.getAttribute('data-cat') || 'suggestion';
          this.feedbackModalEl.querySelectorAll('.feedback-cat-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
    }
    if (this.feedbackMsgInput) {
      this.feedbackMsgInput.addEventListener('input', () => {
        if (this.feedbackCharCounterEl) {
          this.feedbackCharCounterEl.textContent = `${this.feedbackMsgInput.value.length}/600`;
        }
      });
    }
    if (this.feedbackFormEl) {
      this.feedbackFormEl.addEventListener('submit', (e) => {
        e.preventDefault();
        this.submitFeedback();
      });
    }
  }

  updateSoundToggleUI() {
    if (this.soundToggleBtn) {
      this.soundToggleBtn.textContent = this.soundEnabled ? '🔔' : '🔕';
      this.soundToggleBtn.title = this.soundEnabled ? 'Chat sounds ON (Click to mute)' : 'Chat sounds MUTED (Click to enable)';
    }
  }

  toggleChat() {
    if (this.isOpen) {
      this.closeChat();
    } else {
      this.openChat();
    }
  }

  openChat() {
    // Don't open if currently in round
    if (document.body.classList.contains('in-game')) return;

    this.isOpen = true;
    this.updateAdminToolsVisibility();
    if (this.panelEl) {
      this.panelEl.style.display = 'flex';
      this.panelEl.classList.add('active');
    }
    if (this.toggleBtn) {
      this.toggleBtn.classList.add('active-tool');
      this.toggleBtn.classList.add('chat-open');
    }
    if (this.feedbackToggleBtn) {
      this.feedbackToggleBtn.classList.add('chat-open');
    }

    // Reset unread badge
    this.unreadCount = 0;
    this.updateUnreadBadgeUI();

    // Scroll to bottom of message feed
    this.scrollToBottom(true);

    // Focus input on desktop
    if (window.innerWidth > 768 && this.inputFieldEl) {
      setTimeout(() => this.inputFieldEl.focus(), 150);
    }

    // Trigger immediate poll
    this.fetchMessages();
  }

  closeChat() {
    this.isOpen = false;
    if (this.panelEl) {
      this.panelEl.style.display = 'none';
      this.panelEl.classList.remove('active');
    }
    if (this.toggleBtn) {
      this.toggleBtn.classList.remove('active-tool');
      this.toggleBtn.classList.remove('chat-open');
    }
    if (this.feedbackToggleBtn) {
      this.feedbackToggleBtn.classList.remove('chat-open');
    }
  }

  onRoundStart() {
    // Closing chat for flight should never auto-reopen it after dying or returning to menu
    this.chatWasOpenBeforeRound = false;
    if (this.isOpen) {
      this.closeChat();
    }
    if (this.feedbackModalOpen) {
      this.closeFeedbackModal();
    }
    // If an unread global broadcast/giveaway banner was still on screen when the run began,
    // cancel its 5s timer and requeue it so the player sees it once the run ends!
    if (this.broadcastAutoDismissTimer) {
      clearTimeout(this.broadcastAutoDismissTimer);
      this.broadcastAutoDismissTimer = null;
    }
    if (this.activeBroadcast) {
      this.pendingBroadcastQueue.unshift(this.activeBroadcast);
      this.activeBroadcast = null;
      if (this.broadcastBannerEl) {
        this.broadcastBannerEl.style.display = 'none';
      }
    }
  }

  onRoundEnd() {
    this.chatWasOpenBeforeRound = false;
    // Surface any Global Broadcast or Coin Giveaway popup that arrived while the player was mid-run
    setTimeout(() => {
      this.flushPendingGlobalBroadcasts();
    }, 240);
  }

  setReply(id, username, snippet) {
    this.activeReply = {
      id,
      username: username || 'Player',
      snippet: snippet ? snippet.slice(0, 50) : ''
    };

    if (this.replyPreviewEl) {
      this.replyPreviewEl.style.display = 'flex';
    }
    if (this.replyUsernameEl) {
      this.replyUsernameEl.textContent = `@${this.activeReply.username}`;
    }
    if (this.replySnippetEl) {
      this.replySnippetEl.textContent = `"${this.activeReply.snippet}"`;
    }

    if (this.inputFieldEl) {
      this.inputFieldEl.focus();
    }
  }

  clearReply() {
    this.activeReply = null;
    if (this.replyPreviewEl) {
      this.replyPreviewEl.style.display = 'none';
    }
  }

  // 3-Second Cooldown Management
  startCooldown(durationMs = 3000) {
    this.cooldownActive = true;
    this.cooldownEndTime = Date.now() + durationMs;

    if (this.sendBtn) {
      this.sendBtn.disabled = true;
      this.sendBtn.classList.add('cooling-down');
    }
    if (this.cooldownBarWrap) {
      this.cooldownBarWrap.style.display = 'block';
    }

    if (this.cooldownTimer) clearInterval(this.cooldownTimer);

    const updateCooldownTick = () => {
      const remainingMs = Math.max(0, this.cooldownEndTime - Date.now());
      const remainingSec = Math.ceil(remainingMs / 1000);

      if (this.sendLabelEl) {
        this.sendLabelEl.textContent = `${remainingSec}s`;
      }

      if (this.cooldownProgress) {
        const percent = ((durationMs - remainingMs) / durationMs) * 100;
        this.cooldownProgress.style.width = `${percent}%`;
      }

      if (remainingMs <= 0) {
        this.clearCooldown();
      }
    };

    updateCooldownTick();
    this.cooldownTimer = setInterval(updateCooldownTick, 100);
  }

  clearCooldown() {
    if (this.cooldownTimer) {
      clearInterval(this.cooldownTimer);
      this.cooldownTimer = null;
    }
    this.cooldownActive = false;
    if (this.sendBtn) {
      this.sendBtn.disabled = false;
      this.sendBtn.classList.remove('cooling-down');
    }
    if (this.sendLabelEl) {
      this.sendLabelEl.textContent = 'Send';
    }
    if (this.cooldownBarWrap) {
      this.cooldownBarWrap.style.display = 'none';
    }
    if (this.cooldownProgress) {
      this.cooldownProgress.style.width = '0%';
    }
  }

  containsProhibitedLanguage(text) {
    if (!text || typeof text !== 'string') return false;
    const clean = text.toLowerCase()
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/@/g, 'a').replace(/4/g, 'a')
      .replace(/3/g, 'e')
      .replace(/!/g, 'i').replace(/1/g, 'i').replace(/\|/g, 'i')
      .replace(/0/g, 'o')
      .replace(/\$/g, 's').replace(/5/g, 's')
      .replace(/7/g, 't')
      .replace(/v/g, 'u');

    const compressed = clean.replace(/(.)\1{2,}/g, '$1$1');
    const stripped = compressed.replace(/sh\+t/g, 'shit').replace(/[\s\.\-_/\\,;:~`'!()+=<>?[\]{}|]/g, '');

    // Severe Slurs & Hate Speech
    if (/n+[i!1|*#+]+g+g+[e3a4]+r*/i.test(stripped) || /n+[i!1|*#+]+g+g+[a4]/i.test(stripped)) return true;
    if (/f+[a@4*#]+g+g+[o0e3]*t*s*/i.test(stripped) || /f+[a@4*#]+g+s*/i.test(stripped)) return true;
    if (/r+[e3*#]+t+[a@4*#]+r+d+s*/i.test(stripped)) return true;
    if (/\bk+[i!1|]?y+s+\b/i.test(compressed) || /kill\s*your\s*self/i.test(compressed)) return true;

    // Common profanities with bypasses (sh!t, f*ck, b!tch, etc.)
    if (/s+h+[i*#_!1+]?t+/i.test(stripped) && !/shirt|sheet|shift/.test(compressed)) return true;
    if (/f+[u*#_ov]?c+k+/i.test(stripped) || /f+c+k+/i.test(stripped)) return true;
    if (/b+[i*#_!1+]?t+c+h+/i.test(stripped)) return true;
    if (/c+[u*#_ov]?n+t+/i.test(stripped)) return true;
    if (/s+l+[u*#_ov]t+/i.test(stripped)) return true;
    if (/w+h+[o*#0]r+e+/i.test(stripped)) return true;
    if (/a+s+s+h+[o*#0]l+e+/i.test(stripped)) return true;

    return false;
  }

  async sendMessage() {
    if (this.cooldownActive) return;
    if (!this.inputFieldEl) return;

    const raw = this.inputFieldEl.value.trim();
    if (!raw) return;

    // Instant client-side anti-slur check
    if (this.containsProhibitedLanguage(raw)) {
      this.showWarning('⚠️ Message blocked: Prohibited language or bypass attempt detected. Please keep the chat friendly and respectful!');
      return;
    }

    // Check token or guest identity
    const token = localStorage.getItem('flappy3d_token');
    const guestName = this.game.currentUser?.username || document.getElementById('hud-username')?.textContent || 'Guest';

    // Start 3-second cooldown immediately on client
    this.startCooldown(3000);

    const payload = {
      text: raw,
      replyTo: this.activeReply,
      guestName
    };

    // Clear input & reply immediately for fluid UI
    this.inputFieldEl.value = '';
    if (this.charCounterEl) this.charCounterEl.textContent = '0/200';
    const sentReply = this.activeReply;
    this.clearReply();

    try {
      const sigHeaders = (this.game && typeof this.game.getClientSignalHeaders === 'function')
        ? this.game.getClientSignalHeaders()
        : {};
      const headers = { 'Content-Type': 'application/json', ...sigHeaders };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 429 && data.cooldownRemainingMs) {
          this.startCooldown(data.cooldownRemainingMs);
        } else {
          // If blocked by anti-slur or invalid request, clear cooldown so user can fix their message
          this.clearCooldown();
        }
        throw new Error(data.error || 'Failed to send message');
      }

      if (data.message) {
        this.appendMessage(data.message, true);
      }
    } catch (err) {
      console.warn('Chat send error:', err.message);
      this.showWarning(err.message);
      this.clearCooldown();
      // Restore input text if send failed
      if (this.inputFieldEl && !this.inputFieldEl.value) {
        this.inputFieldEl.value = raw;
        if (sentReply) this.setReply(sentReply.id, sentReply.username, sentReply.snippet);
      }
    }
  }

  startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.fetchMessages();
    this.pollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      this.fetchMessages();
    }, 2500);
  }

  async fetchMessages() {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      const since = this.lastFetchedTimestamp;
      const token = localStorage.getItem('flappy3d_token') || (this.game && this.game.authToken);
      const sigHeaders = (this.game && typeof this.game.getClientSignalHeaders === 'function')
        ? this.game.getClientSignalHeaders()
        : {};
      const headers = { ...sigHeaders };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/chat?since=${since}&limit=60`, { headers });
      if (!res.ok) return;

      const data = await res.json();

      // Instant live sync of skin changes and unlocked cosmetics from database panel
      if (data && data.userSync && this.game && typeof this.game.applyLiveUserSync === 'function') {
        this.game.applyLiveUserSync(data.userSync);
      }
      this.updateAdminToolsVisibility();

      // Sync active coin giveaways & top-of-screen global broadcasts
      if (Array.isArray(data.activeGiveaways)) {
        this.activeGiveaways = data.activeGiveaways;
        this.renderActiveGiveaways();
        this.refreshActiveBroadcastGiveawayState();
      }
      if (Array.isArray(data.announcements) && data.announcements.length > 0) {
        this.processAnnouncements(data.announcements);
      }

      const messages = Array.isArray(data.messages) ? data.messages : [];

      if (messages.length > 0) {
        let hasNewExternalMsg = false;
        let hasAnnouncement = false;
        const myNameLower = (this.game.currentUser?.username || '').toLowerCase();

        for (const msg of messages) {
          if (!this.renderedMessageIds.has(msg.id)) {
            const isMine = myNameLower && msg.usernameKey === myNameLower;
            this.appendMessage(msg, false);

            if (!isMine) {
              hasNewExternalMsg = true;
              if (msg.type === 'system') hasAnnouncement = true;
            }

            if (!this.isOpen && !isMine) {
              this.unreadCount++;
            }
          }
        }

        this.updateUnreadBadgeUI();

        // Play subtle chimes if new message arrived from someone else
        if (this.soundEnabled && this.game.sound && !this.game.sound.isMuted) {
          if (hasAnnouncement && typeof this.game.sound.playAnnouncementChime === 'function') {
            this.game.sound.playAnnouncementChime();
          } else if (hasNewExternalMsg && typeof this.game.sound.playChatChime === 'function') {
            this.game.sound.playChatChime();
          }
        }
      }
    } catch (_) {
      // Quiet poll failure catch
    } finally {
      this.isPolling = false;
    }
  }

  appendMessage(msg, isLocalSend = false) {
    if (!msg || !msg.id || this.renderedMessageIds.has(msg.id)) return;
    this.renderedMessageIds.add(msg.id);

    if (msg.timestampMs && msg.timestampMs > this.lastFetchedTimestamp) {
      this.lastFetchedTimestamp = msg.timestampMs;
    }

    if (!this.messagesListEl) return;

    // Check if user was already near bottom before appending
    const wasNearBottom = this.isNearBottom();

    const card = this.createMessageElement(msg);
    this.messagesListEl.appendChild(card);

    if (wasNearBottom || isLocalSend) {
      this.scrollToBottom();
    }
  }

  createMessageElement(msg) {
    const card = document.createElement('div');
    const myNameLower = (this.game.currentUser?.username || '').toLowerCase();
    const isMine = Boolean(myNameLower && msg.usernameKey === myNameLower);

    // 1. SYSTEM ANNOUNCEMENTS (Personal Bests, Top 5 & Top 10 Runs)
    if (msg.type === 'system') {
      const isTop1 = msg.subtype === 'top1';
      const isTop2 = msg.subtype === 'top2';
      const isTop3 = msg.subtype === 'top3';
      const isPodium = isTop1 || isTop2 || isTop3;
      const isTop5 = msg.subtype === 'top5' || isPodium;
      const isTop10 = msg.subtype === 'top10';

      let cardClass = 'chat-system-card new-best-card';
      let icon = msg.avatar || '🎉';
      let tagLabel = msg.tagLabel || 'PERSONAL BEST';
      let tagClass = '';

      if (isTop1) {
        cardClass = 'chat-system-card top-podium-card top1-card';
        icon = msg.avatar || '👑';
        tagLabel = msg.tagLabel || 'NEW #1 RECORD';
        tagClass = 'top1-tag';
      } else if (isTop2) {
        cardClass = 'chat-system-card top-podium-card top2-card';
        icon = msg.avatar || '🥈';
        tagLabel = msg.tagLabel || 'NEW #2 RECORD';
        tagClass = 'top2-tag';
      } else if (isTop3) {
        cardClass = 'chat-system-card top-podium-card top3-card';
        icon = msg.avatar || '🥉';
        tagLabel = msg.tagLabel || 'NEW #3 RECORD';
        tagClass = 'top3-tag';
      } else if (isTop5) {
        cardClass = 'chat-system-card top5-card';
        icon = msg.avatar || '⭐';
        tagLabel = msg.tagLabel || 'TOP 5 RECORD';
        tagClass = 'top5-tag';
      } else if (isTop10) {
        cardClass = 'chat-system-card top10-card';
        icon = msg.avatar || '🔥';
        tagLabel = msg.tagLabel || 'TOP 10 RECORD';
        tagClass = 'top10-tag';
      } else if (msg.subtype === 'global_broadcast') {
        cardClass = 'chat-system-card global-broadcast-card';
        icon = msg.avatar || '📢';
        tagLabel = msg.tagLabel || '📢 GLOBAL ANNOUNCEMENT';
        tagClass = 'top1-tag';
      } else if (msg.subtype === 'giveaway_start' || msg.subtype === 'giveaway_end') {
        cardClass = 'chat-system-card giveaway-card';
        icon = msg.avatar || (msg.subtype === 'giveaway_end' ? '🎉' : '🎁');
        tagLabel = msg.tagLabel || (msg.subtype === 'giveaway_end' ? '🎉 GIVEAWAY RESULTS' : '🎁 LIVE GIVEAWAY');
        tagClass = 'top1-tag';
      }

      card.className = cardClass;
      card.innerHTML = `
        <div class="system-icon-wrap">${icon}</div>
        <div class="system-body">
          <div class="system-header">
            <span class="system-tag ${tagClass}">${tagLabel}</span>
            <span class="chat-time">${this.escape(msg.timeStr || '')}</span>
          </div>
          <div class="system-text">${this.escape(msg.text)}</div>
        </div>
      `;
      return card;
    }

    // 2. PLAYER CHAT MESSAGES
    card.className = `chat-message-item ${isMine ? 'my-message' : ''}`;
    card.setAttribute('data-msg-id', msg.id);

    const isMeDonut = Boolean(msg.isMeDonut || (msg.usernameKey === 'medonut'));
    const safeName = this.escape(msg.username || 'Player');
    const safeText = this.escape(msg.text || '');

    let replyHtml = '';
    if (msg.replyTo && msg.replyTo.username) {
      replyHtml = `
        <div class="chat-quoted-reply">
          <span class="quote-icon">↩️</span>
          <span class="quote-user">@${this.escape(msg.replyTo.username)}</span>
          <span class="quote-text">${this.escape(msg.replyTo.snippet || '')}</span>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="chat-avatar" title="${safeName}">${msg.avatar || '🐤'}</div>
      <div class="chat-content">
        <div class="chat-msg-header">
          <span class="chat-sender-name ${isMeDonut ? 'medonut-sender' : ''}">
            ${safeName}
            ${isMeDonut ? '<span class="medonut-vip-tag">👑 VIP</span>' : ''}
          </span>
          <span class="chat-time">${this.escape(msg.timeStr || '')}</span>
        </div>
        ${replyHtml}
        <div class="chat-bubble">
          <p class="chat-text">${safeText}</p>
          <button type="button" class="chat-reply-action-btn" title="Reply to ${safeName}" data-reply-id="${msg.id}" data-reply-user="${safeName}">↩️ Reply</button>
        </div>
      </div>
    `;

    return card;
  }

  isNearBottom(threshold = 120) {
    if (!this.messagesListEl) return true;
    const dist = this.messagesListEl.scrollHeight - this.messagesListEl.scrollTop - this.messagesListEl.clientHeight;
    return dist <= threshold;
  }

  scrollToBottom(immediate = false) {
    if (!this.messagesListEl) return;
    if (immediate) {
      this.messagesListEl.scrollTop = this.messagesListEl.scrollHeight;
    } else {
      this.messagesListEl.scrollTo({
        top: this.messagesListEl.scrollHeight,
        behavior: 'smooth'
      });
    }
  }

  updateUnreadBadgeUI() {
    if (!this.unreadBadgeEl) return;
    if (this.unreadCount > 0 && !this.isOpen) {
      this.unreadBadgeEl.style.display = 'inline-flex';
      this.unreadBadgeEl.textContent = this.unreadCount > 99 ? '99+' : String(this.unreadCount);
    } else {
      this.unreadBadgeEl.style.display = 'none';
      this.unreadBadgeEl.textContent = '0';
    }
  }

  escape(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ==========================================================================
  // GLOBAL ANNOUNCEMENTS (TOP-OF-SCREEN BANNER + MID-RUN QUEUEING)
  // ==========================================================================
  formatCountdown(remainingMs) {
    const totalSec = Math.max(0, Math.ceil((Number(remainingMs) || 0) / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
  }

  processAnnouncements(announcements) {
    if (!Array.isArray(announcements) || announcements.length === 0) return;
    const now = Date.now();
    const recentCutoffMs = 15 * 60 * 1000;

    for (const ann of announcements) {
      if (!ann || !ann.id) continue;
      // Giveaway winners are announced in Chat ONLY (never as a top-screen popup)
      if (ann.type === 'giveaway_end') {
        this.seenAnnouncementIds.add(ann.id);
        this.enqueuedAnnouncementIds.add(ann.id);
        continue;
      }
      if (this.seenAnnouncementIds.has(ann.id) || this.enqueuedAnnouncementIds.has(ann.id)) continue;

      const createdAt = Number(ann.createdAt) || now;
      const isLiveGiveaway = ann.type === 'giveaway_start' && (Number(ann.endsAt) || 0) > now;
      if (!isLiveGiveaway && (now - createdAt) > recentCutoffMs) {
        // Older historical announcement from a previous session — silently mark seen
        this.seenAnnouncementIds.add(ann.id);
        this.enqueuedAnnouncementIds.add(ann.id);
        continue;
      }

      this.enqueuedAnnouncementIds.add(ann.id);
      this.pendingBroadcastQueue.push(ann);
    }

    this.saveSeenAnnouncementIds();

    // If player is mid-run, keep queued so it displays right after their run ends!
    if (!this.isPlayerInActiveRun()) {
      this.flushPendingGlobalBroadcasts();
    }
  }

  flushPendingGlobalBroadcasts() {
    if (this.isPlayerInActiveRun()) return;
    if (this.activeBroadcast) {
      this.updateBroadcastQueuePill();
      return;
    }
    if (this.pendingBroadcastQueue.length === 0) return;
    this.showNextGlobalBroadcast();
  }

  updateBroadcastQueuePill() {
    if (!this.broadcastQueuePillEl) return;
    const remaining = this.pendingBroadcastQueue.length;
    if (remaining > 0) {
      this.broadcastQueuePillEl.textContent = `+${remaining} more`;
      this.broadcastQueuePillEl.style.display = 'inline-flex';
    } else {
      this.broadcastQueuePillEl.style.display = 'none';
    }
  }

  showNextGlobalBroadcast() {
    if (!this.broadcastBannerEl || this.isPlayerInActiveRun()) return;
    const next = this.pendingBroadcastQueue.shift();
    if (!next) return;

    this.activeBroadcast = next;
    const isGiveawayStart = next.type === 'giveaway_start';
    const isGiveawayEnd = next.type === 'giveaway_end';

    this.broadcastBannerEl.classList.remove('is-giveaway', 'is-giveaway-end');
    if (isGiveawayStart) this.broadcastBannerEl.classList.add('is-giveaway');
    if (isGiveawayEnd) this.broadcastBannerEl.classList.add('is-giveaway-end');

    if (this.broadcastIconEl) {
      this.broadcastIconEl.textContent = isGiveawayStart ? '🎁' : (isGiveawayEnd ? '🎉' : '📢');
    }
    if (this.broadcastTitleEl) {
      this.broadcastTitleEl.textContent = next.title || (isGiveawayStart ? 'LIVE COIN GIVEAWAY!' : (isGiveawayEnd ? 'GIVEAWAY WINNERS!' : 'GLOBAL ANNOUNCEMENT'));
    }
    if (this.broadcastMetaEl) {
      this.broadcastMetaEl.textContent = `from ${next.author || 'MeDonut'}`;
    }
    if (this.broadcastTextEl) {
      this.broadcastTextEl.textContent = next.text || '';
    }

    this.refreshActiveBroadcastGiveawayState();
    this.updateBroadcastQueuePill();
    this.broadcastBannerEl.style.display = 'block';

    // Auto-dismiss 5 seconds AFTER appearing on screen (mid-run players only start timer after run ends!)
    if (this.broadcastAutoDismissTimer) {
      clearTimeout(this.broadcastAutoDismissTimer);
      this.broadcastAutoDismissTimer = null;
    }
    if (this.broadcastTimerFillEl) {
      this.broadcastTimerFillEl.style.transition = 'none';
      this.broadcastTimerFillEl.style.width = '100%';
      // Force layout reflow if in browser so CSS transition animates smoothly over 5s
      void this.broadcastTimerFillEl.offsetWidth;
      this.broadcastTimerFillEl.style.transition = `width ${this.broadcastDisplayDurationMs}ms linear`;
      this.broadcastTimerFillEl.style.width = '0%';
    }
    this.broadcastAutoDismissTimer = setTimeout(() => {
      this.broadcastAutoDismissTimer = null;
      if (this.activeBroadcast && this.activeBroadcast.id === next.id) {
        this.dismissActiveGlobalBroadcast();
      }
    }, this.broadcastDisplayDurationMs);

    if (this.soundEnabled && this.game?.sound && !this.game.sound.isMuted && typeof this.game.sound.playAnnouncementChime === 'function') {
      this.game.sound.playAnnouncementChime();
    }
  }

  refreshActiveBroadcastGiveawayState() {
    if (!this.activeBroadcast) return;
    const isGiveawayStart = this.activeBroadcast.type === 'giveaway_start' && this.activeBroadcast.giveawayId;
    if (!isGiveawayStart) {
      if (this.broadcastGiveawayMetaEl) this.broadcastGiveawayMetaEl.style.display = 'none';
      if (this.broadcastEnterBtn) this.broadcastEnterBtn.style.display = 'none';
      return;
    }

    const liveGw = this.activeGiveaways.find(g => g.id === this.activeBroadcast.giveawayId);
    const endsAt = liveGw ? liveGw.endsAt : Number(this.activeBroadcast.endsAt || 0);
    const remainingMs = Math.max(0, endsAt - Date.now());
    const totalCoins = Math.floor(Number(liveGw?.totalCoins ?? this.activeBroadcast.totalCoins) || 0);
    const winnerCount = Math.max(1, Math.floor(Number(liveGw?.winnerCount ?? this.activeBroadcast.winnerCount) || 1));
    const coinsPerWinner = Math.floor(Number(liveGw?.coinsPerWinner ?? this.activeBroadcast.coinsPerWinner ?? Math.floor(totalCoins / winnerCount)) || 0);
    const entrants = liveGw ? liveGw.entrantsCount : null;
    const hasEntered = Boolean(liveGw && liveGw.hasEntered);

    if (this.broadcastGiveawayMetaEl) {
      const parts = [
        `🪙 Pool: ${totalCoins.toLocaleString('en-US')}`,
        `🏆 ${winnerCount} Winner${winnerCount === 1 ? '' : 's'} (${coinsPerWinner.toLocaleString('en-US')} 🪙 each)`
      ];
      if (entrants !== null) parts.push(`👥 ${entrants} Entered`);
      parts.push(remainingMs > 0 ? `⏱️ ${this.formatCountdown(remainingMs)} left` : '⏱️ Ended');
      this.broadcastGiveawayMetaEl.textContent = parts.join('  •  ');
      this.broadcastGiveawayMetaEl.style.display = 'flex';
    }

    if (this.broadcastEnterBtn) {
      this.broadcastEnterBtn.style.display = 'inline-flex';
      if (remainingMs <= 0) {
        this.broadcastEnterBtn.disabled = true;
        this.broadcastEnterBtn.textContent = '⏱️ Giveaway Ended';
      } else if (hasEntered) {
        this.broadcastEnterBtn.disabled = true;
        this.broadcastEnterBtn.textContent = '✅ Entered!';
      } else {
        this.broadcastEnterBtn.disabled = false;
        this.broadcastEnterBtn.textContent = '🎁 Enter Giveaway!';
      }
    }
  }

  dismissActiveGlobalBroadcast() {
    if (this.broadcastAutoDismissTimer) {
      clearTimeout(this.broadcastAutoDismissTimer);
      this.broadcastAutoDismissTimer = null;
    }
    if (this.activeBroadcast && this.activeBroadcast.id) {
      this.seenAnnouncementIds.add(this.activeBroadcast.id);
      this.saveSeenAnnouncementIds();
    }
    this.activeBroadcast = null;
    if (this.broadcastBannerEl) {
      this.broadcastBannerEl.style.display = 'none';
    }
    if (this.pendingBroadcastQueue.length > 0 && !this.isPlayerInActiveRun()) {
      setTimeout(() => this.showNextGlobalBroadcast(), 180);
    }
  }

  // ==========================================================================
  // MEDONUT GLOBAL BROADCAST & COIN GIVEAWAY CONTROLS
  // ==========================================================================
  getAuthHeaders() {
    const token = localStorage.getItem('flappy3d_token') || (this.game && this.game.authToken);
    const sigHeaders = (this.game && typeof this.game.getClientSignalHeaders === 'function')
      ? this.game.getClientSignalHeaders()
      : {};
    const headers = { 'Content-Type': 'application/json', ...sigHeaders };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  async sendGlobalBroadcast() {
    if (!this.isMeDonutUser() || !this.globalInputEl) return;
    const text = this.globalInputEl.value.trim();
    if (!text) {
      this.showWarning('Please type a global announcement message first.');
      return;
    }
    if (this.btnGlobalSend) this.btnGlobalSend.disabled = true;
    try {
      const res = await fetch('/api/chat/global', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ text })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send global broadcast');
      this.globalInputEl.value = '';
      if (this.globalCharCountEl) this.globalCharCountEl.textContent = '0/280';
      if (this.globalDrawerEl) this.globalDrawerEl.style.display = 'none';
      if (this.btnGlobalMode) this.btnGlobalMode.classList.remove('active');
      if (Array.isArray(data.announcements)) this.processAnnouncements(data.announcements);
      if (Array.isArray(data.messages)) {
        data.messages.forEach(m => this.appendMessage(m, true));
      }
    } catch (err) {
      this.showWarning(err.message);
    } finally {
      if (this.btnGlobalSend) this.btnGlobalSend.disabled = false;
    }
  }

  updateGiveawaySplitPreview() {
    if (!this.giveawaySplitPreviewEl) return;
    const total = Math.max(0, Math.floor(Number(this.giveawayCoinsInput?.value) || 0));
    const winners = Math.max(1, Math.min(50, Math.floor(Number(this.giveawayWinnersInput?.value) || 1)));
    // Strict integer division — removes any decimals!
    const perWinner = Math.floor(total / winners);
    if (perWinner < 1) {
      this.giveawaySplitPreviewEl.innerHTML = '⚠️ Total coins must be at least <strong>' + winners + ' 🪙</strong>';
      return;
    }
    this.giveawaySplitPreviewEl.innerHTML =
      `Each winner gets: <strong>${perWinner.toLocaleString('en-US')} 🪙</strong> (${winners} winner${winners === 1 ? '' : 's'})`;
  }

  async createCoinGiveaway() {
    if (!this.isMeDonutUser()) return;
    const totalCoins = Math.floor(Number(this.giveawayCoinsInput?.value) || 0);
    const winnerCount = Math.max(1, Math.min(50, Math.floor(Number(this.giveawayWinnersInput?.value) || 1)));
    const durationSec = Math.max(10, Math.min(86400, Math.floor(Number(this.giveawayDurationInput?.value) || 60)));
    const perWinner = Math.floor(totalCoins / winnerCount);
    if (perWinner < 1) {
      this.showWarning('Total coins must be at least equal to the number of winners.');
      return;
    }

    if (this.btnGiveawaySubmit) this.btnGiveawaySubmit.disabled = true;
    try {
      const res = await fetch('/api/giveaway/create', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ totalCoins, winnerCount, durationSec })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start coin giveaway');

      if (this.giveawayDrawerEl) this.giveawayDrawerEl.style.display = 'none';
      if (this.btnGiveawayOpen) this.btnGiveawayOpen.classList.remove('active');
      if (Array.isArray(data.activeGiveaways)) {
        this.activeGiveaways = data.activeGiveaways;
        this.renderActiveGiveaways();
      }
      if (Array.isArray(data.announcements)) {
        this.processAnnouncements(data.announcements);
      }
      if (Array.isArray(data.messages)) {
        data.messages.forEach(m => this.appendMessage(m, true));
      }
    } catch (err) {
      this.showWarning(err.message);
    } finally {
      if (this.btnGiveawaySubmit) this.btnGiveawaySubmit.disabled = false;
    }
  }

  async enterGiveaway(giveawayId, btnEl = null) {
    if (!giveawayId) return;
    const token = localStorage.getItem('flappy3d_token') || (this.game && this.game.authToken);
    if (!token) {
      if (btnEl) {
        const prev = btnEl.textContent;
        btnEl.textContent = '🔑 Log in first!';
        setTimeout(() => { if (btnEl && !btnEl.disabled) btnEl.textContent = prev; }, 2200);
      }
      this.showWarning('Please log in to your account to enter Coin Giveaways!');
      return;
    }
    if (btnEl) btnEl.disabled = true;
    try {
      const res = await fetch('/api/giveaway/enter', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ giveawayId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not enter giveaway');

      if (Array.isArray(data.activeGiveaways)) {
        this.activeGiveaways = data.activeGiveaways;
      } else {
        this.activeGiveaways = this.activeGiveaways.map(g =>
          g.id === giveawayId ? { ...g, hasEntered: true, entrantsCount: data.entry?.entrantsCount ?? g.entrantsCount } : g
        );
      }
      this.renderActiveGiveaways();
      this.refreshActiveBroadcastGiveawayState();
    } catch (err) {
      if (btnEl) btnEl.disabled = false;
      this.showWarning(err.message);
    }
  }

  renderActiveGiveaways() {
    if (!this.chatGiveawayPinEl) return;
    const now = Date.now();
    const live = (this.activeGiveaways || []).filter(g => g && (Number(g.endsAt) || 0) > now);
    if (live.length === 0) {
      this.chatGiveawayPinEl.style.display = 'none';
      this.chatGiveawayPinEl.innerHTML = '';
      return;
    }

    this.chatGiveawayPinEl.style.display = 'flex';
    this.chatGiveawayPinEl.innerHTML = live.map((g) => {
      const remainingMs = Math.max(0, (Number(g.endsAt) || 0) - now);
      const totalStr = Math.floor(Number(g.totalCoins) || 0).toLocaleString('en-US');
      const perStr = Math.floor(Number(g.coinsPerWinner) || 0).toLocaleString('en-US');
      const wCount = Math.max(1, Math.floor(Number(g.winnerCount) || 1));
      const entrants = Math.max(0, Math.floor(Number(g.entrantsCount) || 0));
      const entered = Boolean(g.hasEntered);
      return `
        <div class="chat-giveaway-card" data-giveaway-id="${this.escape(g.id)}">
          <div class="chat-giveaway-top">
            <span class="chat-giveaway-title">🎁 ${totalStr} 🪙 COIN GIVEAWAY</span>
            <span class="chat-giveaway-timer" data-ends-at="${Number(g.endsAt) || 0}">⏱️ ${this.formatCountdown(remainingMs)}</span>
          </div>
          <div class="chat-giveaway-details">
            Host: <strong>${this.escape(g.host || 'MeDonut')}</strong> • ${wCount} winner${wCount === 1 ? '' : 's'} × <strong>${perStr} 🪙</strong> each
          </div>
          <div class="chat-giveaway-bottom">
            <span class="chat-giveaway-entrants">👥 ${entrants} entrant${entrants === 1 ? '' : 's'}</span>
            <button type="button" class="chat-giveaway-enter-btn ${entered ? 'entered' : ''}" data-giveaway-id="${this.escape(g.id)}" ${entered ? 'disabled' : ''}>
              ${entered ? '✅ Entered' : '🎁 Enter Giveaway'}
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  startGiveawayCountdownLoop() {
    if (this.giveawayTickTimer) clearInterval(this.giveawayTickTimer);
    this.giveawayTickTimer = setInterval(() => {
      const now = Date.now();
      let expiredNow = false;

      if (this.activeGiveaways.length > 0) {
        if (this.chatGiveawayPinEl) {
          this.chatGiveawayPinEl.querySelectorAll('.chat-giveaway-timer').forEach((el) => {
            const endsAt = Number(el.getAttribute('data-ends-at')) || 0;
            const rem = Math.max(0, endsAt - now);
            el.textContent = rem > 0 ? `⏱️ ${this.formatCountdown(rem)}` : '⏱️ Drawing...';
          });
        }
        for (const g of this.activeGiveaways) {
          if (g && (Number(g.endsAt) || 0) <= now && !this.giveawayExpiredPollTriggered.has(g.id)) {
            this.giveawayExpiredPollTriggered.add(g.id);
            expiredNow = true;
          }
        }
      }

      if (this.activeBroadcast && this.activeBroadcast.type === 'giveaway_start') {
        this.refreshActiveBroadcastGiveawayState();
      }

      if (expiredNow) {
        this.fetchMessages();
      }
    }, 1000);
  }

  // ==========================================================================
  // PLAYER FEEDBACK & UPDATE SUGGESTIONS MODAL
  // ==========================================================================
  openFeedbackModal() {
    if (this.isPlayerInActiveRun()) return;
    if (!this.feedbackModalEl) return;
    this.feedbackModalOpen = true;
    const sender = this.game?.currentUser?.username || document.getElementById('hud-username')?.textContent || 'Guest';
    if (this.feedbackSenderNameEl) {
      this.feedbackSenderNameEl.textContent = sender;
    }
    if (this.feedbackStatusEl) {
      this.feedbackStatusEl.style.display = 'none';
      this.feedbackStatusEl.className = 'feedback-status-msg';
    }
    this.feedbackModalEl.style.display = 'flex';
    if (this.feedbackMsgInput) {
      setTimeout(() => this.feedbackMsgInput.focus(), 60);
    }
  }

  closeFeedbackModal() {
    this.feedbackModalOpen = false;
    if (this.feedbackModalEl) {
      this.feedbackModalEl.style.display = 'none';
    }
  }

  setFeedbackStatus(text, type = 'success') {
    if (!this.feedbackStatusEl) return;
    this.feedbackStatusEl.textContent = text;
    this.feedbackStatusEl.className = `feedback-status-msg ${type}`;
    this.feedbackStatusEl.style.display = 'block';
  }

  async submitFeedback() {
    if (!this.feedbackMsgInput) return;
    const message = this.feedbackMsgInput.value.trim();
    if (message.length < 3) {
      this.setFeedbackStatus('Please write at least 3 characters for your feedback or update idea.', 'error');
      return;
    }
    if (this.containsProhibitedLanguage(message)) {
      this.setFeedbackStatus('Please keep feedback respectful!', 'error');
      return;
    }

    const guestName = this.game?.currentUser?.username || document.getElementById('hud-username')?.textContent || 'Guest';
    if (this.feedbackSubmitBtn) this.feedbackSubmitBtn.disabled = true;
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          category: this.feedbackCategory || 'suggestion',
          message,
          guestName
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit feedback.');

      this.feedbackMsgInput.value = '';
      if (this.feedbackCharCounterEl) this.feedbackCharCounterEl.textContent = '0/600';
      this.setFeedbackStatus('✅ Thank you! Your feedback was sent to MeDonut!', 'success');
      setTimeout(() => {
        if (this.feedbackModalOpen) this.closeFeedbackModal();
      }, 1400);
    } catch (err) {
      this.setFeedbackStatus(err.message, 'error');
    } finally {
      if (this.feedbackSubmitBtn) this.feedbackSubmitBtn.disabled = false;
    }
  }
}

window.ChatManager = ChatManager;
