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

    this.pollTimer = null;
    this.isPolling = false;

    this.initDOM();
    this.bindEvents();
    this.startPolling();
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

    this.updateSoundToggleUI();
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
    if (this.panelEl) {
      this.panelEl.style.display = 'flex';
      this.panelEl.classList.add('active');
    }
    if (this.toggleBtn) {
      this.toggleBtn.classList.add('active-tool');
      this.toggleBtn.classList.add('chat-open');
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
  }

  onRoundStart() {
    if (this.isOpen) {
      this.chatWasOpenBeforeRound = true;
      this.closeChat();
    } else {
      this.chatWasOpenBeforeRound = false;
    }
  }

  onRoundEnd() {
    if (this.chatWasOpenBeforeRound) {
      setTimeout(() => {
        this.openChat();
      }, 400);
    }
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
      const headers = { 'Content-Type': 'application/json' };
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
      this.fetchMessages();
    }, 2500);
  }

  async fetchMessages() {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      const since = this.lastFetchedTimestamp;
      const token = localStorage.getItem('flappy3d_token') || (this.game && this.game.authToken);
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/chat?since=${since}&limit=60`, { headers });
      if (!res.ok) return;

      const data = await res.json();

      // Instant live sync of skin changes and unlocked cosmetics from database panel
      if (data && data.userSync && this.game && typeof this.game.applyLiveUserSync === 'function') {
        this.game.applyLiveUserSync(data.userSync);
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
      const isTop5 = msg.subtype === 'top5' || isTop1;
      const isTop10 = msg.subtype === 'top10';

      let cardClass = 'chat-system-card new-best-card';
      let icon = msg.avatar || '🎉';
      let tagLabel = msg.tagLabel || 'PERSONAL BEST';
      let tagClass = '';

      if (isTop1) {
        cardClass = 'chat-system-card top1-card top5-card';
        icon = msg.avatar || '👑';
        tagLabel = msg.tagLabel || 'NEW #1 RECORD';
        tagClass = 'top1-tag';
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
}

window.ChatManager = ChatManager;
