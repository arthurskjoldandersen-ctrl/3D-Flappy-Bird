/**
 * ============================================================================
 * WEB AUDIO SYNTHESIZER SOUND MANAGER (sound.js)
 * ============================================================================
 */
'use strict';

      // --------------------------------------------------------------------------
      // 5. WEB AUDIO SYNTHESIZER
      // --------------------------------------------------------------------------
      class SoundManager {
        constructor() {
          this.ctx = null;
          this.isMuted = localStorage.getItem('flappy3d_muted') === 'true';
          this.updateMuteUI();
        }

        initContext() {
          if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) this.ctx = new AudioCtx();
          }
          if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
          }
        }

        toggleMute() {
          this.isMuted = !this.isMuted;
          localStorage.setItem('flappy3d_muted', String(this.isMuted));
          this.updateMuteUI();
          if (!this.isMuted) {
            this.initContext();
            this.playFlap();
          }
        }

        updateMuteUI() {
          const onIcon = document.getElementById('icon-sound-on');
          const offIcon = document.getElementById('icon-sound-off');
          if (onIcon && offIcon) {
            onIcon.style.display = this.isMuted ? 'none' : 'block';
            offIcon.style.display = this.isMuted ? 'block' : 'none';
          }
        }

        playFlap() {
          if (this.isMuted) return;
          this.initContext();
          if (!this.ctx) return;

          const now = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(290, now);
          osc.frequency.exponentialRampToValueAtTime(640, now + 0.11);

          gain.gain.setValueAtTime(0.01, now);
          gain.gain.linearRampToValueAtTime(0.22, now + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);

          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start(now);
          osc.stop(now + 0.14);
        }

        playScore() {
          if (this.isMuted) return;
          this.initContext();
          if (!this.ctx) return;

          const now = this.ctx.currentTime;
          const notes = [
            { freq: 987.77, start: 0, duration: 0.08 },
            { freq: 1318.51, start: 0.075, duration: 0.26 }
          ];

          notes.forEach(n => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(n.freq, now + n.start);

            gain.gain.setValueAtTime(0.001, now + n.start);
            gain.gain.linearRampToValueAtTime(0.25, now + n.start + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.001, now + n.start + n.duration);

            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now + n.start);
            osc.stop(now + n.start + n.duration + 0.02);
          });
        }

        playCollision() {
          if (this.isMuted) return;
          this.initContext();
          if (!this.ctx) return;

          const now = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const oscGain = this.ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(170, now);
          osc.frequency.exponentialRampToValueAtTime(38, now + 0.28);

          oscGain.gain.setValueAtTime(0.32, now);
          oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

          osc.connect(oscGain);
          oscGain.connect(this.ctx.destination);
          osc.start(now);
          osc.stop(now + 0.31);

          const bufferSize = this.ctx.sampleRate * 0.18;
          const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
          const output = noiseBuffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
          }

          const whiteNoise = this.ctx.createBufferSource();
          whiteNoise.buffer = noiseBuffer;

          const filter = this.ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(900, now);

          const noiseGain = this.ctx.createGain();
          noiseGain.gain.setValueAtTime(0.25, now);
          noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

          whiteNoise.connect(filter);
          filter.connect(noiseGain);
          noiseGain.connect(this.ctx.destination);
          whiteNoise.start(now);
          whiteNoise.stop(now + 0.19);
        }

        playChatChime() {
          if (this.isMuted) return;
          this.initContext();
          if (!this.ctx) return;

          const now = this.ctx.currentTime;
          const osc1 = this.ctx.createOscillator();
          const gain1 = this.ctx.createGain();

          osc1.type = 'sine';
          osc1.frequency.setValueAtTime(587.33, now); // D5
          osc1.frequency.exponentialRampToValueAtTime(880.00, now + 0.08); // A5

          gain1.gain.setValueAtTime(0.001, now);
          gain1.gain.linearRampToValueAtTime(0.12, now + 0.015);
          gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

          osc1.connect(gain1);
          gain1.connect(this.ctx.destination);
          osc1.start(now);
          osc1.stop(now + 0.17);
        }

        playAnnouncementChime() {
          if (this.isMuted) return;
          this.initContext();
          if (!this.ctx) return;

          const now = this.ctx.currentTime;
          // Triumphant 3-note fanfare: C5 -> E5 -> G5
          const notes = [
            { freq: 523.25, time: 0, dur: 0.10 },
            { freq: 659.25, time: 0.09, dur: 0.10 },
            { freq: 783.99, time: 0.18, dur: 0.28 }
          ];

          notes.forEach(n => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(n.freq, now + n.time);

            gain.gain.setValueAtTime(0.001, now + n.time);
            gain.gain.linearRampToValueAtTime(0.20, now + n.time + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.001, now + n.time + n.dur);

            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now + n.time);
            osc.stop(now + n.time + n.dur + 0.02);
          });
        }
      }

window.SoundManager = SoundManager;
