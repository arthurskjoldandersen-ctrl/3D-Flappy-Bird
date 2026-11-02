/**
 * ============================================================================
 * PROCEDURAL HDR STUDIO ENVMAP, BUMP MAPS & PIPE TEXTURES (textures.js)
 * ============================================================================
 */
'use strict';

      // --------------------------------------------------------------------------
      // 6. PROCEDURAL HDR-STYLE ENVIRONMENT REFLECTION MAP & PBR BUMP TEXTURES
      // --------------------------------------------------------------------------
      /**
       * Creates a 6-face CubeTexture for `scene.environment` so metallic Gold,
       * Chrome, Titanium, Crystal Diamond, and Dragon Armor reflect realistic
       * sky, horizon, and sun highlights!
       */
      function createSkyStudioEnvMap() {
        const faces = [];
        for (let i = 0; i < 6; i++) {
          const canvas = document.createElement('canvas');
          canvas.width = 128;
          canvas.height = 128;
          const ctx = canvas.getContext('2d');

          if (i === 2) {
            // Top (+Y): bright sky zenith
            const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 90);
            g.addColorStop(0, '#ffffff');
            g.addColorStop(0.4, '#bae6fd');
            g.addColorStop(1, '#38bdf8');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, 128, 128);
          } else if (i === 3) {
            // Bottom (-Y): warm ground bounce
            const g = ctx.createLinearGradient(0, 0, 0, 128);
            g.addColorStop(0, '#4ade80');
            g.addColorStop(1, '#1e293b');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, 128, 128);
          } else {
            // Side faces: sky-to-horizon gradient + bright sun specular studio highlight
            const g = ctx.createLinearGradient(0, 0, 0, 128);
            g.addColorStop(0.0, '#0284c7');
            g.addColorStop(0.48, '#bae6fd');
            g.addColorStop(0.54, '#fffbeb');
            g.addColorStop(0.62, '#86efac');
            g.addColorStop(1.0, '#15803d');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, 128, 128);

            if (i === 0 || i === 4) {
              const sun = ctx.createRadialGradient(42, 36, 2, 42, 36, 36);
              sun.addColorStop(0, '#ffffff');
              sun.addColorStop(0.4, 'rgba(254, 240, 138, 0.85)');
              sun.addColorStop(1, 'rgba(255, 255, 255, 0)');
              ctx.fillStyle = sun;
              ctx.fillRect(0, 0, 128, 128);
            }
          }
          faces.push(canvas);
        }
        const cubeTex = new THREE.CubeTexture(faces);
        cubeTex.needsUpdate = true;
        return cubeTex;
      }

      /**
       * Procedural Bump Maps for Feathers, Dragon Scales, Carbon Armor, and Royal Filigree
       */
      function createProceduralBumpTextures() {
        const makeBump = (drawFn) => {
          const c = document.createElement('canvas');
          c.width = 128;
          c.height = 128;
          const ctx = c.getContext('2d');
          drawFn(ctx, 128, 128);
          const tex = new THREE.CanvasTexture(c);
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          return tex;
        };

        // 1. Fine Feather Barbules
        const feathers = makeBump((ctx, w, h) => {
          ctx.fillStyle = '#808080';
          ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = '#b8b8b8';
          ctx.lineWidth = 2;
          for (let y = 0; y < h; y += 8) {
            for (let x = 0; x < w; x += 16) {
              ctx.beginPath();
              ctx.arc(x + ((y / 8) % 2) * 8, y, 7, 0, Math.PI);
              ctx.stroke();
            }
          }
        });
        feathers.repeat.set(3, 3);

        // 2. Overlapping Dragon / Reptile Scales & Crystal Facets
        const scales = makeBump((ctx, w, h) => {
          ctx.fillStyle = '#505050';
          ctx.fillRect(0, 0, w, h);
          for (let y = 0; y < h + 16; y += 14) {
            for (let x = 0; x < w + 16; x += 16) {
              const ox = x + ((Math.floor(y / 14) % 2) * 8);
              const g = ctx.createRadialGradient(ox, y, 1, ox, y, 10);
              g.addColorStop(0, '#ffffff');
              g.addColorStop(0.7, '#909090');
              g.addColorStop(1, '#202020');
              ctx.fillStyle = g;
              ctx.beginPath();
              ctx.arc(ox, y, 9, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        });
        scales.repeat.set(3, 3);

        // 3. Carbon-Fiber & Hex Mecha Armor Plates
        const carbon = makeBump((ctx, w, h) => {
          ctx.fillStyle = '#606060';
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = '#c8c8c8';
          for (let y = 0; y < h; y += 8) {
            for (let x = 0; x < w; x += 8) {
              if (((x + y) / 8) % 2 === 0) {
                ctx.fillRect(x, y, 7, 3);
              } else {
                ctx.fillRect(x, y, 3, 7);
              }
            }
          }
          ctx.strokeStyle = '#151515';
          ctx.lineWidth = 3;
          ctx.strokeRect(4, 4, w - 8, h - 8);
        });
        carbon.repeat.set(4, 4);

        // 4. Royal Filigree & Engraved Damascus Armor
        const filigree = makeBump((ctx, w, h) => {
          ctx.fillStyle = '#757575';
          ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = '#f0f0f0';
          ctx.lineWidth = 2.2;
          for (let i = 0; i < 8; i++) {
            ctx.beginPath();
            ctx.arc(64, 64, 10 + i * 8, 0, Math.PI * 2);
            ctx.stroke();
          }
        });
        filigree.repeat.set(2, 2);

        return { feathers, scales, carbon, filigree };
      }

      /**
       * Procedural Pipe Skin Texture Generator (Diffuse + Bump)
       */
      function createPipeSkinTextures(pipeSkin) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        const [cDark, cMid, cHighlight, cSecondary] = pipeSkin.colors;

        // Base horizontal cylindrical shading gradient with a luminous specular core
        const baseGrad = ctx.createLinearGradient(0, 0, 256, 0);
        baseGrad.addColorStop(0.00, cDark);
        baseGrad.addColorStop(0.16, cMid);
        baseGrad.addColorStop(0.30, cHighlight);
        baseGrad.addColorStop(0.35, '#ffffff');
        baseGrad.addColorStop(0.42, cHighlight);
        baseGrad.addColorStop(0.55, cMid);
        baseGrad.addColorStop(0.78, cSecondary);
        baseGrad.addColorStop(0.92, cDark);
        baseGrad.addColorStop(1.00, cMid);
        ctx.fillStyle = baseGrad;
        ctx.fillRect(0, 0, 256, 256);

        // Pattern overlays for distinct, glowing 3D pipe skins
        if (pipeSkin.pattern === 'glossy') {
          ctx.strokeStyle = cHighlight;
          ctx.lineWidth = 4;
          ctx.shadowColor = cHighlight;
          ctx.shadowBlur = 10;
          for (let y = 32; y < 256; y += 64) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(256, y);
            ctx.stroke();
          }
          ctx.shadowBlur = 0;
        } else if (pipeSkin.pattern === 'brushed_metal') {
          ctx.fillStyle = 'rgba(255,255,255,0.14)';
          for (let y = 0; y < 256; y += 3) {
            ctx.fillRect(0, y, 256, 1);
          }
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 3.5;
          ctx.shadowColor = '#38bdf8';
          ctx.shadowBlur = 8;
          for (let y = 32; y < 256; y += 64) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(256, y);
            ctx.stroke();
          }
          ctx.shadowBlur = 0;
        } else if (pipeSkin.pattern === 'fluted_stone' || pipeSkin.pattern === 'sanctuary_marble') {
          for (let x = 0; x < 256; x += 16) {
            ctx.fillStyle = pipeSkin.pattern === 'sanctuary_marble' ? 'rgba(2,132,199,0.22)' : 'rgba(180,83,9,0.26)';
            ctx.fillRect(x, 0, 4, 256);
            ctx.fillStyle = 'rgba(255,255,255,0.34)';
            ctx.fillRect(x + 4, 0, 3, 256);
          }
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 4.5;
          ctx.shadowColor = '#f59e0b';
          ctx.shadowBlur = 8;
          for (let y = 40; y < 256; y += 84) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(256, y);
            ctx.stroke();
          }
          ctx.shadowBlur = 0;
        } else if (pipeSkin.pattern === 'candy_stripe') {
          ctx.save();
          ctx.fillStyle = '#ffffff';
          ctx.shadowColor = '#f472b6';
          ctx.shadowBlur = 8;
          for (let i = -256; i < 512; i += 44) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i + 22, 0);
            ctx.lineTo(i + 22 + 140, 256);
            ctx.lineTo(i + 140, 256);
            ctx.closePath();
            ctx.fill();
          }
          ctx.restore();
          const shade = ctx.createLinearGradient(0, 0, 256, 0);
          shade.addColorStop(0, 'rgba(0,0,0,0.28)');
          shade.addColorStop(0.32, 'rgba(255,255,255,0.28)');
          shade.addColorStop(0.85, 'rgba(0,0,0,0.32)');
          shade.addColorStop(1, 'rgba(0,0,0,0.20)');
          ctx.fillStyle = shade;
          ctx.fillRect(0, 0, 256, 256);
        } else if (pipeSkin.pattern === 'bamboo') {
          ctx.shadowColor = '#a3e635';
          ctx.shadowBlur = 8;
          for (let y = 0; y < 256; y += 64) {
            ctx.fillStyle = 'rgba(0,0,0,0.28)';
            ctx.fillRect(0, y, 256, 5);
            ctx.fillStyle = '#d9f99d';
            ctx.fillRect(0, y + 5, 256, 5);
          }
          ctx.shadowBlur = 0;
        } else if (pipeSkin.pattern === 'shogun_lacquer') {
          // Crimson lacquer ribs + glowing golden Shogun crest bands
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 5;
          ctx.shadowColor = '#f59e0b';
          ctx.shadowBlur = 9;
          for (let y = 32; y < 256; y += 64) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(256, y);
            ctx.stroke();
          }
          for (let x = 24; x < 256; x += 64) {
            ctx.beginPath();
            ctx.arc(x, 64, 12, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(x, 192, 12, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.shadowBlur = 0;
        } else if (pipeSkin.pattern === 'arcane_runes') {
          // Glowing violet/cyan spellwork circles & vertical mana conduits
          ctx.strokeStyle = '#e879f9';
          ctx.lineWidth = 3.5;
          ctx.shadowColor = '#c084fc';
          ctx.shadowBlur = 10;
          for (let x = 32; x < 256; x += 64) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, 256);
            ctx.stroke();
          }
          ctx.strokeStyle = '#38bdf8';
          for (let y = 48; y < 256; y += 80) {
            for (let x = 32; x < 256; x += 64) {
              ctx.beginPath();
              ctx.arc(x, y, 16, 0, Math.PI * 2);
              ctx.stroke();
            }
          }
          ctx.shadowBlur = 0;
        } else if (pipeSkin.pattern === 'clockwork_gold') {
          // Celestial brass chronometer rings & glowing cyan time-runes
          ctx.strokeStyle = '#fef08a';
          ctx.lineWidth = 3.5;
          ctx.shadowColor = '#facc15';
          ctx.shadowBlur = 8;
          for (let y = 42; y < 256; y += 84) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(256, y);
            ctx.stroke();
            for (let x = 32; x < 256; x += 64) {
              ctx.beginPath();
              ctx.arc(x, y, 18, 0, Math.PI * 2);
              ctx.stroke();
            }
          }
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2.5;
          for (let x = 16; x < 256; x += 64) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, 256);
            ctx.stroke();
          }
          ctx.shadowBlur = 0;
        } else if (pipeSkin.pattern === 'world_tree') {
          // Ancient vertical bark grooves + glowing emerald sap rivers
          for (let x = 0; x < 256; x += 14) {
            ctx.fillStyle = 'rgba(20, 10, 2, 0.38)';
            ctx.fillRect(x, 0, 5, 256);
          }
          ctx.strokeStyle = '#34d399';
          ctx.lineWidth = 4;
          ctx.shadowColor = '#10b981';
          ctx.shadowBlur = 10;
          for (let i = 0; i < 8; i++) {
            const bx = 18 + i * 32;
            ctx.beginPath();
            ctx.moveTo(bx, 0);
            ctx.bezierCurveTo(bx + 14, 85, bx - 14, 170, bx, 256);
            ctx.stroke();
          }
          ctx.shadowBlur = 0;
        } else if (pipeSkin.pattern === 'bifrost_prism') {
          const rainbow = ['#ff0055', '#ff7700', '#ffdd00', '#00e676', '#00b0ff', '#7c4dff', '#f50057'];
          for (let i = -256; i < 512; i += 24) {
            const idx = Math.abs(Math.floor(i / 24)) % rainbow.length;
            ctx.fillStyle = rainbow[idx];
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i + 24, 0);
            ctx.lineTo(i + 24 + 128, 256);
            ctx.lineTo(i + 128, 256);
            ctx.closePath();
            ctx.fill();
          }
          const prismShade = ctx.createLinearGradient(0, 0, 256, 0);
          prismShade.addColorStop(0, 'rgba(15,23,42,0.40)');
          prismShade.addColorStop(0.32, 'rgba(255,255,255,0.48)');
          prismShade.addColorStop(0.75, 'rgba(15,23,42,0.32)');
          prismShade.addColorStop(1, 'rgba(15,23,42,0.45)');
          ctx.fillStyle = prismShade;
          ctx.fillRect(0, 0, 256, 256);
        } else if (pipeSkin.pattern === 'cyber_grid') {
          ctx.strokeStyle = cHighlight;
          ctx.lineWidth = 3;
          ctx.shadowColor = cHighlight;
          ctx.shadowBlur = 9;
          for (let x = 16; x < 256; x += 32) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, 256);
            ctx.stroke();
          }
          for (let y = 16; y < 256; y += 32) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(256, y);
            ctx.stroke();
          }
          ctx.shadowBlur = 0;
        } else if (pipeSkin.pattern === 'marble_gold') {
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 3.5;
          ctx.shadowColor = '#facc15';
          ctx.shadowBlur = 8;
          for (let i = 0; i < 16; i++) {
            ctx.beginPath();
            ctx.moveTo((i * 37) % 256, 0);
            ctx.bezierCurveTo(
              ((i * 73) % 256), 85,
              ((i * 131) % 256), 170,
              ((i * 53) % 256), 256
            );
            ctx.stroke();
          }
          ctx.shadowBlur = 0;
        } else if (pipeSkin.pattern === 'crystal_facets') {
          for (let y = 0; y < 256; y += 32) {
            for (let x = 0; x < 256; x += 32) {
              ctx.fillStyle = ((x + y) / 32) % 2 === 0 ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.16)';
              ctx.beginPath();
              ctx.moveTo(x, y);
              ctx.lineTo(x + 32, y);
              ctx.lineTo(x + 16, y + 32);
              ctx.closePath();
              ctx.fill();
            }
          }
        } else if (pipeSkin.pattern === 'lava_cracks' || pipeSkin.pattern === 'void_obelisk' || pipeSkin.pattern === 'omega_fortress') {
          // Glowing magma fissures / void rifts / omega plasma conduits over dark armor
          const glowCol = pipeSkin.pattern === 'void_obelisk' ? '#22d3ee' : cHighlight;
          ctx.strokeStyle = glowCol;
          ctx.lineWidth = 4.5;
          ctx.shadowColor = glowCol;
          ctx.shadowBlur = 12;
          for (let i = 0; i < 12; i++) {
            let x = (i * 29) % 256;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            for (let y = 32; y <= 256; y += 32) {
              x += ((i * y) % 2 === 0 ? 15 : -15);
              ctx.lineTo((x + 256) % 256, y);
            }
            ctx.stroke();
          }
          if (pipeSkin.pattern === 'omega_fortress') {
            ctx.strokeStyle = '#ff0033';
            ctx.lineWidth = 4;
            for (let y = 32; y < 256; y += 64) {
              ctx.strokeRect(8, y, 240, 24);
            }
          }
          ctx.shadowBlur = 0;
        } else if (pipeSkin.pattern === 'nebula_stars') {
          ctx.fillStyle = '#ffffff';
          ctx.shadowColor = '#38bdf8';
          ctx.shadowBlur = 6;
          for (let i = 0; i < 95; i++) {
            const sx = (i * 97) % 256;
            const sy = (i * 53) % 256;
            const r = (i % 3 === 0) ? 2.6 : 1.4;
            ctx.beginPath();
            ctx.arc(sx, sy, r, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.shadowBlur = 0;
        } else if (pipeSkin.pattern === 'atlantis_coral') {
          // Bioluminescent coral branches & pearlescent nautilus whorls
          ctx.strokeStyle = '#f472b6';
          ctx.lineWidth = 4;
          ctx.shadowColor = '#f472b6';
          ctx.shadowBlur = 10;
          for (let i = 0; i < 6; i++) {
            const bx = 24 + i * 40;
            ctx.beginPath();
            ctx.moveTo(bx, 256);
            ctx.bezierCurveTo(bx - 16, 170, bx + 18, 85, bx, 0);
            ctx.stroke();
          }
          ctx.fillStyle = '#fef08a';
          for (let y = 28; y < 256; y += 52) {
            for (let x = 28; x < 256; x += 52) {
              ctx.beginPath();
              ctx.arc(x, y, 5, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          ctx.shadowBlur = 0;
        } else if (pipeSkin.pattern === 'stained_glass') {
          // Kaleidoscopic stained-glass mosaic with golden lead lines
          const glassCols = ['#ec4899', '#38bdf8', '#a855f7', '#22c55e', '#f59e0b', '#6366f1'];
          for (let y = 0; y < 256; y += 32) {
            for (let x = 0; x < 256; x += 32) {
              ctx.fillStyle = glassCols[((x / 32) * 3 + (y / 32) * 5) % glassCols.length];
              ctx.globalAlpha = 0.68;
              ctx.fillRect(x + 2, y + 2, 28, 28);
            }
          }
          ctx.globalAlpha = 1.0;
          ctx.strokeStyle = '#fde047';
          ctx.lineWidth = 3.5;
          for (let i = 0; i <= 256; i += 32) {
            ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
          }
        } else if (pipeSkin.pattern === 'eden_waterfall') {
          // Mossy jade cliff + glowing cyan waterfall stream in center + sakura petals
          ctx.fillStyle = 'rgba(56, 189, 248, 0.72)';
          ctx.fillRect(84, 0, 88, 256);
          ctx.strokeStyle = '#e0f2fe';
          ctx.lineWidth = 3;
          for (let x = 94; x <= 162; x += 17) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke();
          }
          ctx.fillStyle = '#f472b6';
          for (let i = 0; i < 28; i++) {
            ctx.beginPath();
            ctx.arc((i * 67) % 256, (i * 43) % 256, 4.5, 0, Math.PI * 2);
            ctx.fill();
          }
        } else if (pipeSkin.pattern === 'troll_67_court') {
          // Basketball court lines + glowing "67" stencil numbers
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 4;
          ctx.strokeRect(12, 12, 232, 232);
          ctx.beginPath(); ctx.arc(128, 128, 48, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = '#fde047';
          ctx.font = '900 42px sans-serif';
          ctx.fillText('6-7', 34, 78);
          ctx.fillText('6-7', 142, 198);
        } else if (pipeSkin.pattern === 'troll_chalkboard_21') {
          // Green school chalkboard covered in 9+10=21 chalk equations
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.font = 'bold 26px monospace';
          ctx.fillText('9 + 10 = 21', 24, 52);
          ctx.fillText('21 !?!', 72, 110);
          ctx.fillText('9 + 10 = 21', 36, 168);
          ctx.fillText('Q.E.D. = 21', 42, 224);
        } else if (pipeSkin.pattern === 'missing_texture') {
          // Iconic CS:Source Magenta & Black Missing Texture Checkerboard
          for (let y = 0; y < 256; y += 32) {
            for (let x = 0; x < 256; x += 32) {
              ctx.fillStyle = ((x / 32 + y / 32) % 2 === 0) ? '#ff00ff' : '#000000';
              ctx.fillRect(x, y, 32, 32);
            }
          }
        } else if (pipeSkin.pattern === 'bsod_screen') {
          // Classic Windows Blue Screen of Death
          ctx.fillStyle = '#0050ef';
          ctx.fillRect(0, 0, 256, 256);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 52px monospace';
          ctx.fillText(':(', 28, 72);
          ctx.font = 'bold 18px monospace';
          ctx.fillText('FLAP_ERROR_404', 24, 125);
          ctx.fillText('PIPE_COLLISION', 24, 158);
          ctx.fillText('0x00000404', 24, 202);
        } else if (pipeSkin.pattern === 'banana_peel') {
          // Cartoon Banana Yellow Ridges & Brown Spots
          ctx.strokeStyle = '#ca8a04';
          ctx.lineWidth = 6;
          for (let x = 32; x < 256; x += 64) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke();
          }
          ctx.fillStyle = '#713f12';
          for (let i = 0; i < 14; i++) {
            ctx.beginPath();
            ctx.ellipse((i * 59) % 256, (i * 47) % 256, 8, 4, 0.4, 0, Math.PI * 2);
            ctx.fill();
          }
        } else if (pipeSkin.pattern === 'hazard_stripes') {
          // Yellow & Black diagonal OSHA hazard stripes
          ctx.fillStyle = '#facc15';
          ctx.fillRect(0, 0, 256, 256);
          ctx.fillStyle = '#18181b';
          for (let i = -256; i < 512; i += 48) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i + 24, 0);
            ctx.lineTo(i + 24 + 128, 256);
            ctx.lineTo(i + 128, 256);
            ctx.closePath();
            ctx.fill();
          }
        } else if (pipeSkin.pattern === 'swiss_cheese') {
          // Golden Swiss cheese with dark craters
          for (let i = 0; i < 18; i++) {
            const cx = (i * 61 + 24) % 230;
            const cy = (i * 43 + 20) % 230;
            const cr = 10 + (i % 4) * 5;
            ctx.fillStyle = '#92400e';
            ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#b45309';
            ctx.beginPath(); ctx.arc(cx + 2, cy + 2, cr * 0.75, 0, Math.PI * 2); ctx.fill();
          }
        } else if (pipeSkin.pattern === 'porcelain_flush') {
          // White bathroom porcelain tile grid + aqua water flush spirals
          ctx.strokeStyle = '#cbd5e1';
          ctx.lineWidth = 2;
          for (let i = 0; i <= 256; i += 32) {
            ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
          }
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 4;
          for (let y = 32; y < 256; y += 64) {
            ctx.beginPath();
            ctx.bezierCurveTo(64, y - 20, 192, y + 20, 256, y);
            ctx.stroke();
          }
        } else if (pipeSkin.pattern === 'stonks_ticker') {
          // Wall Street grid + crashing red candlestick bars
          ctx.fillStyle = '#090d16';
          ctx.fillRect(0, 0, 256, 256);
          ctx.strokeStyle = '#1e293b';
          ctx.lineWidth = 2;
          for (let i = 0; i <= 256; i += 32) {
            ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
          }
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.moveTo(16, 36);
          ctx.lineTo(80, 70);
          ctx.lineTo(130, 52);
          ctx.lineTo(190, 165);
          ctx.lineTo(240, 232);
          ctx.stroke();
        } else if (pipeSkin.pattern === 'rgb_gamer_mesh') {
          // Matte black PC mesh + glowing rainbow RGB strips
          ctx.fillStyle = '#09090b';
          ctx.fillRect(0, 0, 256, 256);
          const rgbCols = ['#ff0055', '#ffdd00', '#00ff88', '#00b0ff', '#aa00ff'];
          for (let i = 0; i < 5; i++) {
            ctx.fillStyle = rgbCols[i];
            ctx.shadowColor = rgbCols[i];
            ctx.shadowBlur = 10;
            ctx.fillRect(20 + i * 48, 0, 10, 256);
          }
          ctx.shadowBlur = 0;
        } else if (pipeSkin.pattern === 'poke_ball_tex') {
          // Classic Red & White Poké Ball bands with black center belt & white catch button
          ctx.fillStyle = '#dc2626';
          ctx.fillRect(0, 0, 256, 114);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 142, 256, 114);
          ctx.fillStyle = '#18181b';
          ctx.fillRect(0, 114, 256, 28);
          [64, 192].forEach(cx => {
            ctx.fillStyle = '#18181b';
            ctx.beginPath(); ctx.arc(cx, 128, 28, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath(); ctx.arc(cx, 128, 19, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(cx, 128, 11, 0, Math.PI * 2); ctx.stroke();
          });
        } else if (pipeSkin.pattern === 'poke_pikachu_tex') {
          // Electric Yellow with black zig-zag thunderbolt stripes & red cheek circles
          ctx.fillStyle = '#18181b';
          for (let y = 32; y < 256; y += 96) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            for (let x = 32; x <= 256; x += 32) {
              ctx.lineTo(x, y + (x % 64 === 0 ? 0 : 18));
            }
            ctx.lineTo(256, y + 30);
            ctx.lineTo(0, y + 30);
            ctx.closePath();
            ctx.fill();
          }
          ctx.fillStyle = '#ef4444';
          [64, 192].forEach(cx => {
            ctx.beginPath(); ctx.arc(cx, 148, 22, 0, Math.PI * 2); ctx.fill();
          });
        } else if (pipeSkin.pattern === 'poke_charmander_tex') {
          // Fire-orange reptile scales + blazing yellow-red flame waves
          ctx.strokeStyle = '#fde047';
          ctx.lineWidth = 5;
          ctx.shadowColor = '#ef4444';
          ctx.shadowBlur = 10;
          for (let i = 0; i < 6; i++) {
            const x = 24 + i * 40;
            ctx.beginPath();
            ctx.moveTo(x, 256);
            ctx.bezierCurveTo(x - 20, 170, x + 20, 85, x, 0);
            ctx.stroke();
          }
          ctx.shadowBlur = 0;
        } else if (pipeSkin.pattern === 'poke_squirtle_tex') {
          // Aqua Hydro-Pump swirls + tortoiseshell hexagonal bands
          ctx.strokeStyle = '#e0f2fe';
          ctx.lineWidth = 4;
          for (let y = 28; y < 256; y += 48) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.bezierCurveTo(85, y - 22, 170, y + 22, 256, y);
            ctx.stroke();
          }
          ctx.fillStyle = '#18181b';
          ctx.fillRect(24, 108, 84, 26);
          ctx.fillRect(148, 108, 84, 26);
        } else if (pipeSkin.pattern === 'poke_bulbasaur_tex') {
          // Teal Bulbasaur skin with dark emerald organic patches & vine whips
          ctx.fillStyle = '#065f46';
          for (let i = 0; i < 12; i++) {
            ctx.beginPath();
            ctx.ellipse((i * 67 + 20) % 230, (i * 53 + 20) % 230, 18, 12, (i % 3) * 0.5, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.strokeStyle = '#4ade80';
          ctx.lineWidth = 5;
          for (let x = 42; x < 256; x += 84) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke();
          }
        } else if (pipeSkin.pattern === 'poke_bidoof_tex') {
          // Beaver dam timber logs + white buck-teeth marks
          ctx.strokeStyle = '#451a03';
          ctx.lineWidth = 5;
          for (let y = 0; y <= 256; y += 42) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke();
          }
          ctx.fillStyle = '#ffffff';
          for (let x = 40; x < 230; x += 80) {
            ctx.fillRect(x, 86, 16, 26);
            ctx.fillRect(x + 18, 86, 16, 26);
          }
        } else if (pipeSkin.pattern === 'poke_mew_tex') {
          // Pastel-pink psychic aura with glowing cyan & white telekinetic bubbles
          for (let i = 0; i < 20; i++) {
            const bx = (i * 59 + 18) % 236;
            const by = (i * 43 + 18) % 236;
            const br = 8 + (i % 4) * 5;
            ctx.strokeStyle = i % 2 === 0 ? '#ffffff' : '#38bdf8';
            ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.stroke();
          }
        } else if (pipeSkin.pattern === 'poke_masterball_tex') {
          // Royal purple Master Ball top, white bottom, magenta nodes & white 'M'
          ctx.fillStyle = '#6b21a8';
          ctx.fillRect(0, 0, 256, 114);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 142, 256, 114);
          ctx.fillStyle = '#18181b';
          ctx.fillRect(0, 114, 256, 28);
          ctx.fillStyle = '#ec4899';
          [42, 128, 214].forEach(cx => {
            ctx.beginPath(); ctx.arc(cx, 44, 22, 0, Math.PI * 2); ctx.fill();
          });
          ctx.fillStyle = '#ffffff';
          ctx.font = '900 38px sans-serif';
          ctx.fillText('M', 110, 96);
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        return tex;
      }

      function createGroundCheckerTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#55d43f';
        ctx.fillRect(0, 0, 128, 128);

        ctx.fillStyle = '#47bd33';
        ctx.fillRect(0, 0, 64, 64);
        ctx.fillRect(64, 64, 64, 64);

        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(30, 8);
        return tex;
      }

window.createSkyStudioEnvMap = createSkyStudioEnvMap;
window.createProceduralBumpTextures = createProceduralBumpTextures;
window.createPipeSkinTextures = createPipeSkinTextures;
window.createGroundCheckerTexture = createGroundCheckerTexture;
