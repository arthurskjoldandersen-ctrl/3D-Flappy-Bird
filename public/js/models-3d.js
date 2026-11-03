/**
 * ============================================================================
 * THREE.JS 3D SCENE, BIRD/POKÉMON MODELS, WINGS, PIPES & PARTICLES (models-3d.js)
 * ============================================================================
 */
'use strict';

class FlappyBird3DModels {
        // ------------------------------------------------------------------------
        // THREE.JS SCENE, ENVIRONMENT REFLECTIONS & SHARED GEOMETRIES
        // ------------------------------------------------------------------------
        initThree() {
          this.scene = new THREE.Scene();
          this.scene.fog = new THREE.FogExp2(0x93e1fa, 0.014);

          // Procedural HDR-like studio/sky reflection map makes metallic & crystal skins ultra-realistic!
          this.envMap = createSkyStudioEnvMap();
          this.scene.environment = this.envMap;

          const aspect = window.innerWidth / window.innerHeight;
          this.camera = new THREE.PerspectiveCamera(46, aspect, 0.1, 150);
          this.baseCameraPos = new THREE.Vector3(-0.8, 6.2, 16.5);
          this.cameraLookTarget = new THREE.Vector3(1.2, 5.5, 0);
          this.adjustCameraForAspect(aspect);

          // Dedicated close-up 3D camera for the Locker Spotlight Turntable Canvas
          this.spotlightCamera = new THREE.PerspectiveCamera(36, 1, 0.1, 60);

          this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance'
          });
          this.renderer.setClearColor(0x7dd3fc, 1);
          this.renderer.setSize(window.innerWidth, window.innerHeight);
          this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
          this.renderer.shadowMap.enabled = true;
          this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
          this.renderer.outputEncoding = THREE.sRGBEncoding;

          this.container.appendChild(this.renderer.domElement);

          // Automatically recover from any browser/GPU WebGL context loss (prevents permanent black screen)
          this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            console.warn('WebGL context lost — attempting automatic recovery...');
          }, false);
          this.renderer.domElement.addEventListener('webglcontextrestored', () => {
            console.info('WebGL context restored — reinitializing 3D scene visuals.');
            if (typeof this.resetVisualSceneAndRecover === 'function') {
              this.resetVisualSceneAndRecover(false);
            }
          }, false);
        }

        adjustCameraForAspect(aspect) {
          if (aspect < 0.75) {
            this.baseCameraPos.set(0.2, 6.2, 22.0);
            this.cameraLookTarget.set(0.8, 5.5, 0);
          } else if (aspect < 1.1) {
            this.baseCameraPos.set(-0.3, 6.2, 18.8);
            this.cameraLookTarget.set(1.0, 5.5, 0);
          } else {
            this.baseCameraPos.set(-0.8, 6.2, 16.2);
            this.cameraLookTarget.set(1.3, 5.5, 0);
          }
          this.camera.position.copy(this.baseCameraPos);
          this.camera.lookAt(this.cameraLookTarget);
        }

        initLights() {
          const hemiLight = new THREE.HemisphereLight(0xe0f7ff, 0x6ab04c, 0.8);
          hemiLight.position.set(0, 25, 0);
          this.scene.add(hemiLight);

          this.dirLight = new THREE.DirectionalLight(0xfffbeb, 1.0);
          this.dirLight.position.set(10, 24, 14);
          this.dirLight.castShadow = true;
          this.dirLight.shadow.mapSize.width = 1024;
          this.dirLight.shadow.mapSize.height = 1024;
          this.dirLight.shadow.camera.near = 2;
          this.dirLight.shadow.camera.far = 60;

          const d = 18;
          this.dirLight.shadow.camera.left = -d;
          this.dirLight.shadow.camera.right = d;
          this.dirLight.shadow.camera.top = d;
          this.dirLight.shadow.camera.bottom = -d;
          this.dirLight.shadow.bias = -0.0005;
          this.scene.add(this.dirLight);

          const fillLight = new THREE.DirectionalLight(0xbae6fd, 0.42);
          fillLight.position.set(-8, 5, 12);
          this.scene.add(fillLight);
        }

        initMaterials() {
          this.bumpTextures = createProceduralBumpTextures();
          this.groundTexture = createGroundCheckerTexture();

          this.materials = {
            pipeInside: new THREE.MeshStandardMaterial({
              color: 0x090d16,
              roughness: 0.92
            }),
            pipeAO: new THREE.MeshBasicMaterial({
              color: 0x0f172a,
              transparent: true,
              opacity: 0.42
            }),
            groundTop: new THREE.MeshStandardMaterial({
              map: this.groundTexture,
              roughness: 0.85,
              metalness: 0.0
            }),
            groundDirt: new THREE.MeshStandardMaterial({
              color: 0xd99b52,
              roughness: 0.95
            }),
            cloud: new THREE.MeshStandardMaterial({
              color: 0xffffff,
              roughness: 0.9,
              metalness: 0.0
            }),
            hillFar: new THREE.MeshStandardMaterial({
              color: 0x68d391,
              roughness: 0.88
            }),
            hillNear: new THREE.MeshStandardMaterial({
              color: 0x48bb78,
              roughness: 0.82
            }),
            treeTrunk: new THREE.MeshStandardMaterial({
              color: 0x8b5a2b,
              roughness: 0.9
            }),
            treeLeaves: new THREE.MeshStandardMaterial({
              color: 0x38a169,
              roughness: 0.75
            })
          };

          // Shared Pipe & Trim Geometries (Zero per-spawn geometry allocations!)
          this.sharedGeo = {
            pipeUnitCylinder: new THREE.CylinderGeometry(CONFIG.pipeRadius, CONFIG.pipeRadius, 1, 24),
            pipeCapCylinder: new THREE.CylinderGeometry(CONFIG.pipeCapRadius, CONFIG.pipeCapRadius, CONFIG.pipeCapHeight, 24),
            pipeHoleCylinder: new THREE.CylinderGeometry(CONFIG.pipeRadius * 0.88, CONFIG.pipeRadius * 0.88, 0.12, 20),
            pipeAOCylinder: new THREE.CylinderGeometry(CONFIG.pipeRadius * 1.03, CONFIG.pipeRadius * 1.03, 0.24, 20),
            pipeCollarTorus: new THREE.TorusGeometry(CONFIG.pipeCapRadius * 1.02, 0.075, 10, 24),
            pipeShaftBandTorus: new THREE.TorusGeometry(CONFIG.pipeRadius * 1.03, 0.055, 8, 22),
            pipeHaloTorus: new THREE.TorusGeometry(CONFIG.pipeCapRadius * 1.22, 0.048, 10, 28),
            pipeOuterOrbitTorus: new THREE.TorusGeometry(CONFIG.pipeCapRadius * 1.38, 0.036, 8, 28),
            pipeSpikeCone: new THREE.ConeGeometry(0.12, 0.42, 6),
            pipeCrystalShard: new THREE.ConeGeometry(0.14, 0.54, 5),
            pipeRivetSphere: new THREE.SphereGeometry(0.08, 8, 8),
            pipeStrutBar: new THREE.BoxGeometry(0.09, 1, 0.09),
            particleBox: new THREE.OctahedronGeometry(0.15, 0)
          };
          this.sharedGeo.pipeCollarTorus.rotateX(Math.PI / 2);
          this.sharedGeo.pipeShaftBandTorus.rotateX(Math.PI / 2);
          this.sharedGeo.pipeHaloTorus.rotateX(Math.PI / 2);
          this.sharedGeo.pipeOuterOrbitTorus.rotateX(Math.PI / 2);
        }

        createEnvironment() {
          const sunGroup = new THREE.Group();
          const sunCore = new THREE.Mesh(
            new THREE.SphereGeometry(3.2, 20, 20),
            new THREE.MeshBasicMaterial({ color: 0xfff3b0 })
          );
          const sunHalo = new THREE.Mesh(
            new THREE.SphereGeometry(4.4, 20, 20),
            new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.28 })
          );
          sunGroup.add(sunCore, sunHalo);
          sunGroup.position.set(22, 16, -34);
          this.scene.add(sunGroup);

          const groundGeo = new THREE.BoxGeometry(120, 0.6, 32);
          const groundMesh = new THREE.Mesh(groundGeo, this.materials.groundTop);
          groundMesh.position.set(0, CONFIG.groundY - 0.3, -2);
          groundMesh.receiveShadow = true;
          this.scene.add(groundMesh);

          const dirtGeo = new THREE.BoxGeometry(120, 6.0, 32);
          const dirtMesh = new THREE.Mesh(dirtGeo, this.materials.groundDirt);
          dirtMesh.position.set(0, CONFIG.groundY - 3.6, -2);
          this.scene.add(dirtMesh);

          for (let i = 0; i < 12; i++) {
            const cloud = this.createFluffyCloud();
            const x = -35 + i * 7.2 + (Math.random() * 2 - 1);
            const y = 8.5 + Math.random() * 6.5;
            const z = -7 - Math.random() * 18;
            cloud.position.set(x, y, z);
            cloud.scale.setScalar(0.7 + Math.random() * 0.75);
            this.scene.add(cloud);
            this.clouds.push({
              mesh: cloud,
              speedFactor: 0.16 + (18 + z) * 0.012
            });
          }

          for (let i = 0; i < 16; i++) {
            const hillGroup = new THREE.Group();
            const isFar = i % 2 === 0;
            const radius = isFar ? 4.5 + Math.random() * 2.5 : 2.6 + Math.random() * 1.6;
            const hillGeo = new THREE.ConeGeometry(radius, radius * 1.45, 7);
            const hillMat = isFar ? this.materials.hillFar : this.materials.hillNear;
            const hill = new THREE.Mesh(hillGeo, hillMat);
            hill.position.y = (radius * 1.45) * 0.42;
            hill.rotation.y = Math.random() * Math.PI;
            hillGroup.add(hill);

            if (!isFar && Math.random() > 0.25) {
              const tree = this.createCartoonTree();
              tree.position.set(radius * 0.65, 0, 1.2);
              hillGroup.add(tree);
            }

            const x = -40 + i * 5.6 + Math.random() * 1.5;
            const z = isFar ? -15 - Math.random() * 5 : -8 - Math.random() * 3.5;
            hillGroup.position.set(x, CONFIG.groundY, z);

            this.scene.add(hillGroup);
            this.sceneryItems.push({
              mesh: hillGroup,
              speedFactor: isFar ? 0.28 : 0.48
            });
          }
        }

        createFluffyCloud() {
          const group = new THREE.Group();
          const sphereGeo = new THREE.SphereGeometry(1, 12, 12);
          const puffs = [
            { x: 0, y: 0, z: 0, s: 1.15 },
            { x: -1.0, y: -0.15, z: 0.1, s: 0.85 },
            { x: 1.05, y: -0.1, z: -0.1, s: 0.9 },
            { x: -0.4, y: 0.45, z: -0.15, s: 0.8 },
            { x: 0.45, y: 0.4, z: 0.15, s: 0.75 }
          ];
          puffs.forEach(p => {
            const puff = new THREE.Mesh(sphereGeo, this.materials.cloud);
            puff.position.set(p.x, p.y, p.z);
            puff.scale.setScalar(p.s);
            group.add(puff);
          });
          return group;
        }

        createCartoonTree() {
          const tree = new THREE.Group();
          const trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(0.16, 0.22, 0.9, 7),
            this.materials.treeTrunk
          );
          trunk.position.y = 0.45;

          const crown1 = new THREE.Mesh(
            new THREE.DodecahedronGeometry(0.65, 1),
            this.materials.treeLeaves
          );
          crown1.position.y = 1.15;

          const crown2 = new THREE.Mesh(
            new THREE.DodecahedronGeometry(0.48, 1),
            this.materials.treeLeaves
          );
          crown2.position.set(0.25, 1.55, 0.1);

          tree.add(trunk, crown1, crown2);
          tree.scale.setScalar(0.85 + Math.random() * 0.45);
          return tree;
        }

        // ------------------------------------------------------------------------
        // 3D BIRD MODEL + REALISTIC ENDGAME SKIN OVERHAULS
        // ------------------------------------------------------------------------
        createBird() {
          this.birdGroup = new THREE.Group();
          this.birdMeshGroup = new THREE.Group();
          this.birdGroup.add(this.birdMeshGroup);

          // Dedicated group for default avian features (hidden when playing as a Pokémon!)
          this.standardBirdBodyGroup = new THREE.Group();
          this.birdMeshGroup.add(this.standardBirdBodyGroup);

          this.birdMats = {
            body: new THREE.MeshStandardMaterial({ color: 0xffd13b, roughness: 0.25, metalness: 0.14 }),
            belly: new THREE.MeshStandardMaterial({ color: 0xfff3b0, roughness: 0.32 }),
            wing: new THREE.MeshStandardMaterial({ color: 0xffaa00, roughness: 0.25, metalness: 0.16 }),
            beak: new THREE.MeshStandardMaterial({ color: 0xff6b1a, roughness: 0.20, metalness: 0.18 }),
            white: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.08 }),
            iris: new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.12, metalness: 0.3 }),
            pupil: new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.04 }),
            cheek: new THREE.MeshBasicMaterial({ color: 0xff758f, transparent: true, opacity: 0.58 })
          };

          // Sculpted aerodynamic avian torso
          const bodyGeo = new THREE.SphereGeometry(0.66, 30, 30);
          bodyGeo.scale(1.18, 0.96, 0.94);
          const body = new THREE.Mesh(bodyGeo, this.birdMats.body);
          body.castShadow = true;
          body.receiveShadow = true;
          this.standardBirdBodyGroup.add(body);

          // Layered breast/belly plumage + sculpted chest plumage plates
          const bellyGeo = new THREE.SphereGeometry(0.56, 24, 24);
          bellyGeo.scale(1.13, 0.84, 0.87);
          const belly = new THREE.Mesh(bellyGeo, this.birdMats.belly);
          belly.position.set(0.14, -0.14, 0);
          this.standardBirdBodyGroup.add(belly);

          // Sculpted neck/collar ruff plumage so all birds have rich 3D silhouette
          for (let n = 0; n < 8; n++) {
            const a = (n / 8) * Math.PI * 2;
            const ruff = new THREE.Mesh(new THREE.ConeGeometry(0.10, 0.28, 7), n % 2 === 0 ? this.birdMats.wing : this.birdMats.belly);
            ruff.position.set(0.26 + Math.cos(a) * 0.18, -0.22 + Math.sin(a) * 0.16, Math.sin(a) * 0.42);
            ruff.rotation.z = Math.PI * 0.65;
            this.standardBirdBodyGroup.add(ruff);
          }

          // Swept 3-plume head crest feathers
          const crestGeo = new THREE.ConeGeometry(0.13, 0.42, 10);
          const crest1 = new THREE.Mesh(crestGeo, this.birdMats.wing);
          crest1.position.set(-0.06, 0.70, 0);
          crest1.rotation.z = 0.46;
          const crest2 = new THREE.Mesh(crestGeo, this.birdMats.body);
          crest2.position.set(-0.20, 0.64, 0);
          crest2.rotation.z = 0.76;
          crest2.scale.setScalar(0.86);
          const crest3 = new THREE.Mesh(crestGeo, this.birdMats.belly);
          crest3.position.set(-0.32, 0.56, 0);
          crest3.rotation.z = 0.98;
          crest3.scale.setScalar(0.72);
          this.standardBirdBodyGroup.add(crest1, crest2, crest3);

          // Realistic multi-layered 3D eyes (Sclera + Colored Iris + Pupil + Dual Corneal Glints)
          const eyeGeo = new THREE.SphereGeometry(0.21, 18, 18);
          const irisGeo = new THREE.SphereGeometry(0.145, 14, 14);
          const pupilGeo = new THREE.SphereGeometry(0.095, 12, 12);
          const glintGeo = new THREE.SphereGeometry(0.038, 8, 8);

          this.fierceBrowGroup = new THREE.Group();
          const browMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.25, metalness: 0.65 });

          [-1, 1].forEach(side => {
            const eyeWhite = new THREE.Mesh(eyeGeo, this.birdMats.white);
            eyeWhite.position.set(0.38, 0.2, side * 0.44);

            const iris = new THREE.Mesh(irisGeo, this.birdMats.iris);
            iris.position.set(0.49, 0.205, side * 0.485);

            const pupil = new THREE.Mesh(pupilGeo, this.birdMats.pupil);
            pupil.position.set(0.545, 0.21, side * 0.505);

            const glint1 = new THREE.Mesh(glintGeo, this.birdMats.white);
            glint1.position.set(0.615, 0.265, side * 0.525 + 0.02);

            const glint2 = new THREE.Mesh(glintGeo, this.birdMats.white);
            glint2.scale.setScalar(0.55);
            glint2.position.set(0.59, 0.16, side * 0.52 - 0.02);

            const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 10), this.birdMats.cheek);
            cheek.scale.set(1, 0.65, 0.4);
            cheek.position.set(0.32, -0.02, side * 0.55);

            // Sculpted fierce predator brow ridge for Dragon / Shinobi / Cyber / Valkyrie / Reaper skins
            const brow = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.08, 0.19), browMat);
            brow.position.set(0.47, 0.36, side * 0.47);
            brow.rotation.z = -0.28;
            brow.rotation.y = side * -0.25;
            this.fierceBrowGroup.add(brow);

            this.standardBirdBodyGroup.add(eyeWhite, iris, pupil, glint1, glint2, cheek);
          });
          this.fierceBrowGroup.visible = false;
          this.standardBirdBodyGroup.add(this.fierceBrowGroup);

          // Sculpted Raptor/Songbird Upper & Lower Beak + Nares
          const upperBeakGeo = new THREE.ConeGeometry(0.25, 0.60, 18);
          upperBeakGeo.rotateZ(-Math.PI / 2);
          const upperBeak = new THREE.Mesh(upperBeakGeo, this.birdMats.beak);
          upperBeak.position.set(0.90, 0.04, 0);
          upperBeak.castShadow = true;

          const lowerBeakGeo = new THREE.ConeGeometry(0.19, 0.45, 16);
          lowerBeakGeo.rotateZ(-Math.PI / 2);
          const lowerBeak = new THREE.Mesh(lowerBeakGeo, this.birdMats.beak);
          lowerBeak.position.set(0.82, -0.1, 0);
          lowerBeak.rotation.z = -0.14;
          this.standardBirdBodyGroup.add(upperBeak, lowerBeak);

          // 7-Feather Dual-Layer Fan Tail (Automatically hidden when a skin provides a custom 3D Dragon/Phoenix/Leviathan/Reaper tail!)
          this.defaultTailGroup = new THREE.Group();
          this.defaultTailGroup.position.set(-0.74, 0.04, 0);
          for (let i = -3; i <= 3; i++) {
            const feather = new THREE.Mesh(new THREE.ConeGeometry(0.125, 0.54, 10), i % 2 === 0 ? this.birdMats.wing : this.birdMats.body);
            feather.rotation.z = Math.PI / 2 + i * 0.14;
            feather.rotation.y = i * 0.11;
            feather.position.y = i * 0.05;
            feather.position.z = i * 0.065;
            this.defaultTailGroup.add(feather);
          }
          this.birdMeshGroup.add(this.defaultTailGroup);

          // Articulated Wing Pivots with Custom Wing Style Attachments
          this.leftWingPivot = new THREE.Group();
          this.leftWingPivot.position.set(-0.05, 0.02, 0.52);
          this.rightWingPivot = new THREE.Group();
          this.rightWingPivot.position.set(-0.05, 0.02, -0.52);
          this.birdMeshGroup.add(this.leftWingPivot, this.rightWingPivot);

          this.createCustomWingStyles();
          this.createRealisticEndgameModels();

          // Exact 0.60m Competitive Hitbox Visualizer Ring (Identical Across All 53 Skins)
          const hitboxGeo = new THREE.RingGeometry(CONFIG.birdRadius - 0.025, CONFIG.birdRadius + 0.015, 44);
          const hitboxMat = new THREE.MeshBasicMaterial({
            color: 0x22d3ee,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85,
            depthTest: false
          });
          this.hitboxRingMesh = new THREE.Mesh(hitboxGeo, hitboxMat);
          this.hitboxRingMesh.renderOrder = 999;
          this.hitboxRingMesh.visible = Boolean(this.settings && this.settings.showHitbox);
          this.birdGroup.add(this.hitboxRingMesh);

          this.birdGroup.position.set(CONFIG.birdX, CONFIG.birdStartY, 0);
          this.scene.add(this.birdGroup);
        }

        /**
         * Builds 16 distinct 3D wing architectures across standard, Easy-Only, Medium-Only, and Hard-Only skins!
         */
        createCustomWingStyles() {
          this.wingStyleGroups = {};

          const registerWingStyle = (key, buildOneSideFn) => {
            const left = buildOneSideFn(1);
            const right = buildOneSideFn(-1);
            left.visible = false;
            right.visible = false;
            this.leftWingPivot.add(left);
            this.rightWingPivot.add(right);
            this.wingStyleGroups[key] = { left, right };
          };

          // 1. Upgraded 3-Layer Sculpted Feathered Wings (Primary Pinions + Secondary Coverts + Shoulder Alula)
          registerWingStyle('feathered', (side) => {
            const g = new THREE.Group();
            const baseGeo = new THREE.SphereGeometry(0.38, 16, 14);
            baseGeo.scale(1.22, 0.26, 0.92);
            const base = new THREE.Mesh(baseGeo, this.birdMats.wing);
            base.position.set(-0.04, 0, side * 0.26);
            base.castShadow = true;
            g.add(base);

            const covertGeo = new THREE.SphereGeometry(0.28, 14, 12);
            covertGeo.scale(1.10, 0.24, 0.78);
            const covert = new THREE.Mesh(covertGeo, this.birdMats.belly);
            covert.position.set(0.02, 0.035, side * 0.22);
            g.add(covert);

            for (let i = 0; i < 6; i++) {
              const pinion = new THREE.Mesh(new THREE.ConeGeometry(0.115, 0.64 - i * 0.04, 9), i % 2 === 0 ? this.birdMats.wing : this.birdMats.body);
              pinion.position.set(-0.08 - i * 0.095, -0.02, side * (0.46 + i * 0.075));
              pinion.rotation.x = side * (Math.PI / 2 - 0.14);
              pinion.rotation.z = 0.28 + i * 0.13;
              g.add(pinion);

              if (i < 4) {
                const sec = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.44 - i * 0.03, 8), this.birdMats.belly);
                sec.position.set(-0.04 - i * 0.09, 0.025, side * (0.36 + i * 0.06));
                sec.rotation.copy(pinion.rotation);
                g.add(sec);
              }
            }
            return g;
          });

          // 2. Shinobi Steel Katana-Blade Wings
          const steelMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.92, roughness: 0.1 });
          const darkSteelMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.85, roughness: 0.18 });
          const crimsonTrimMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0x7f1d1d, metalness: 0.7, roughness: 0.2 });
          registerWingStyle('blade', (side) => {
            const g = new THREE.Group();
            const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.15, 0.46), darkSteelMat);
            shoulder.position.set(0.02, 0.03, side * 0.24);
            const trim = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.48), crimsonTrimMat);
            trim.position.set(0.02, 0.08, side * 0.24);
            g.add(shoulder, trim);
            for (let i = 0; i < 5; i++) {
              const blade = new THREE.Mesh(new THREE.ConeGeometry(0.095, 0.82 - i * 0.07, 4), steelMat);
              blade.position.set(-0.04 - i * 0.11, 0, side * (0.52 + i * 0.11));
              blade.rotation.x = side * (Math.PI / 2);
              blade.rotation.z = 0.24 + i * 0.14;
              g.add(blade);
            }
            return g;
          });

          // 3. Cyber-Valkyrie & Apex Mecha-Bahamut Neon Laser Pinion Wings
          const makeCyberWing = (neonHex) => (side) => {
            const g = new THREE.Group();
            const frameMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.9, roughness: 0.14 });
            const neonMat = new THREE.MeshBasicMaterial({ color: neonHex });
            const arm = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.14, 0.62), frameMat);
            arm.position.set(0.04, 0.04, side * 0.30);
            const jointCore = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.18, 12), neonMat);
            jointCore.position.set(0.12, 0.05, side * 0.28);
            g.add(arm, jointCore);
            for (let i = 0; i < 6; i++) {
              const feather = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.045, 0.78 - i * 0.06), neonMat);
              feather.position.set(0.16 - i * 0.13, -0.01, side * (0.60 + i * 0.08));
              feather.rotation.y = side * (-0.18 - i * 0.08);
              g.add(feather);
            }
            return g;
          };
          registerWingStyle('cyber', makeCyberWing(0x22d3ee));
          registerWingStyle('cyber_emerald', makeCyberWing(0x10b981));

          // 4. Solar Phoenix 3-Layer Blazing Flame Wings
          const flameOuterMat = new THREE.MeshStandardMaterial({ color: 0xd00000, emissive: 0x990000, roughness: 0.16 });
          const flameMidMat = new THREE.MeshStandardMaterial({ color: 0xff6d00, emissive: 0xc2410c, roughness: 0.14 });
          const flameCoreMat = new THREE.MeshBasicMaterial({ color: 0xfff36b });
          registerWingStyle('phoenix', (side) => {
            const g = new THREE.Group();
            for (let i = 0; i < 7; i++) {
              const outer = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.98 - i * 0.06, 8), flameOuterMat);
              outer.position.set(0.16 - i * 0.13, 0, side * (0.56 + i * 0.08));
              outer.rotation.x = side * (Math.PI / 2 - 0.1);
              outer.rotation.z = 0.18 + i * 0.13;

              const mid = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.72 - i * 0.04, 8), flameMidMat);
              mid.position.set(0.15 - i * 0.12, 0.035, side * (0.44 + i * 0.06));
              mid.rotation.copy(outer.rotation);

              const core = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.48, 6), flameCoreMat);
              core.position.set(0.12 - i * 0.1, 0.06, side * 0.30);
              core.rotation.copy(outer.rotation);

              g.add(outer, mid, core);
            }
            return g;
          });

          // 5. Golden / Pegasus Archangel Wings
          const goldFeatherMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.95, roughness: 0.07 });
          const pearlFeatherMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x1e293b, metalness: 0.45, roughness: 0.12 });
          registerWingStyle('golden', (side) => {
            const g = new THREE.Group();
            for (let i = 0; i < 7; i++) {
              const p1 = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.95 - i * 0.06, 10), goldFeatherMat);
              p1.position.set(0.16 - i * 0.13, 0, side * (0.54 + i * 0.08));
              p1.rotation.x = side * (Math.PI / 2 - 0.08);
              p1.rotation.z = 0.16 + i * 0.13;

              const p2 = new THREE.Mesh(new THREE.ConeGeometry(0.105, 0.65 - i * 0.04, 10), pearlFeatherMat);
              p2.position.set(0.14 - i * 0.12, 0.045, side * (0.38 + i * 0.05));
              p2.rotation.copy(p1.rotation);
              g.add(p1, p2);
            }
            return g;
          });

          // 6. Celestial Astral Wings
          const astralMat = new THREE.MeshStandardMaterial({ color: 0xc084fc, emissive: 0x4c1d95, metalness: 0.8, roughness: 0.1 });
          registerWingStyle('celestial', (side) => {
            const g = new THREE.Group();
            for (let i = 0; i < 6; i++) {
              const shard = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.88 - i * 0.06, 6), astralMat);
              shard.position.set(0.12 - i * 0.13, 0, side * (0.52 + i * 0.08));
              shard.rotation.x = side * (Math.PI / 2);
              shard.rotation.z = 0.2 + i * 0.14;
              const starTip = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), goldFeatherMat);
              starTip.position.set(0.12 - i * 0.13, 0.04, side * (0.34 + i * 0.05));
              g.add(shard, starTip);
            }
            return g;
          });

          // 7. Faceted Ice / Crystal Shard Wings
          const crystalMat = new THREE.MeshStandardMaterial({
            color: 0x7dd3fc,
            emissive: 0x0284c7,
            metalness: 0.88,
            roughness: 0.05,
            flatShading: true
          });
          registerWingStyle('crystal', (side) => {
            const g = new THREE.Group();
            for (let i = 0; i < 6; i++) {
              const crystal = new THREE.Mesh(new THREE.ConeGeometry(0.145, 0.92 - i * 0.06, 5), crystalMat);
              crystal.position.set(0.12 - i * 0.13, 0, side * (0.52 + i * 0.08));
              crystal.rotation.x = side * (Math.PI / 2);
              crystal.rotation.z = 0.2 + i * 0.14;
              g.add(crystal);
            }
            return g;
          });

          // 8. 6-Winged Biblical / Prismatic Seraphim Crystal Wing Array (3 Pairs of Wings!)
          registerWingStyle('seraph', (side) => {
            const g = new THREE.Group();
            const offsets = [
              { y: 0.0, pitch: 0.0, scale: 1.05 },
              { y: 0.30, pitch: 0.42, scale: 0.88 },
              { y: -0.26, pitch: -0.38, scale: 0.82 }
            ];
            offsets.forEach((off, idx) => {
              const subWing = new THREE.Group();
              subWing.position.y = off.y;
              subWing.rotation.x = side * off.pitch;
              subWing.scale.setScalar(off.scale);
              const mat = idx === 1 ? goldFeatherMat : crystalMat;
              for (let i = 0; i < 5; i++) {
                const crystal = new THREE.Mesh(new THREE.ConeGeometry(0.125, 0.90 - i * 0.06, 5), mat);
                crystal.position.set(0.14 - i * 0.13, 0, side * (0.52 + i * 0.08));
                crystal.rotation.x = side * (Math.PI / 2);
                crystal.rotation.z = 0.18 + i * 0.14;
                subWing.add(crystal);
              }
              g.add(subWing);
            });
            return g;
          });

          // 9. Realistic Dragon Bat-Wings (Bone Struts + Wing-Thumb Claw + Glowing Magma Membrane)
          const dragonBoneMat = new THREE.MeshStandardMaterial({ color: 0x18181b, metalness: 0.65, roughness: 0.25 });
          const dragonMembraneMat = new THREE.MeshStandardMaterial({
            color: 0xb91c1c,
            emissive: 0x7f1d1d,
            roughness: 0.28,
            metalness: 0.25
          });
          registerWingStyle('dragon', (side) => {
            const g = new THREE.Group();
            const mainBone = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.045, 1.08, 8), dragonBoneMat);
            mainBone.position.set(0.18, 0.08, side * 0.54);
            mainBone.rotation.x = side * (Math.PI / 2 - 0.15);
            g.add(mainBone);

            const claw = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.30, 6), goldFeatherMat);
            claw.position.set(0.36, 0.18, side * 0.98);
            claw.rotation.z = -Math.PI / 2;
            g.add(claw);

            for (let i = 0; i < 4; i++) {
              const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.015, 0.94 - i * 0.1, 6), dragonBoneMat);
              strut.position.set(-0.02 - i * 0.17, 0.02, side * (0.62 - i * 0.06));
              strut.rotation.x = side * (Math.PI / 2);
              strut.rotation.z = 0.32 + i * 0.22;

              const web = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.80 - i * 0.08), dragonMembraneMat);
              web.position.set(0.0 - i * 0.17, 0, side * (0.52 - i * 0.05));
              web.rotation.y = side * (-0.22 - i * 0.14);
              g.add(strut, web);
            }
            return g;
          });

          // 10. Blood-Moon Reaper Wings with Twin Giant 3D Crescent War-Scythes
          const obsidianMat = new THREE.MeshStandardMaterial({ color: 0x09090b, metalness: 0.88, roughness: 0.15 });
          const crimsonEdgeMat = new THREE.MeshStandardMaterial({ color: 0xff0033, emissive: 0xb91c1c, metalness: 0.92, roughness: 0.08 });
          registerWingStyle('reaper_scythe', (side) => {
            const g = new THREE.Group();
            for (let i = 0; i < 6; i++) {
              const darkFeather = new THREE.Mesh(new THREE.ConeGeometry(0.125, 0.92 - i * 0.07, 6), obsidianMat);
              darkFeather.position.set(0.10 - i * 0.13, 0, side * (0.52 + i * 0.07));
              darkFeather.rotation.x = side * (Math.PI / 2);
              darkFeather.rotation.z = 0.22 + i * 0.14;
              g.add(darkFeather);
            }
            const scytheBlade = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.055, 8, 22, Math.PI * 0.72), crimsonEdgeMat);
            scytheBlade.rotation.x = Math.PI / 2;
            scytheBlade.rotation.z = side > 0 ? -0.42 : Math.PI + 0.42;
            scytheBlade.position.set(0.22, 0.06, side * 0.60);
            g.add(scytheBlade);
            return g;
          });

          // 11. EASY-ONLY: Sylvan Forest Guardian Leaf-Blade Wings ('sylvan_leaf')
          const leafBladeMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x065f46, metalness: 0.35, roughness: 0.2 });
          const blossomMat = new THREE.MeshBasicMaterial({ color: 0xfde047 });
          registerWingStyle('sylvan_leaf', (side) => {
            const g = new THREE.Group();
            for (let i = 0; i < 6; i++) {
              const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.88 - i * 0.06, 6), leafBladeMat);
              leaf.scale.set(1.2, 0.35, 1.0);
              leaf.position.set(0.14 - i * 0.13, 0, side * (0.50 + i * 0.07));
              leaf.rotation.x = side * (Math.PI / 2 - 0.08);
              leaf.rotation.z = 0.20 + i * 0.13;

              const vein = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.01, 0.72 - i * 0.05, 6), goldFeatherMat);
              vein.position.copy(leaf.position);
              vein.position.y += 0.03;
              vein.rotation.copy(leaf.rotation);
              g.add(leaf, vein);
            }
            const jewel = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), blossomMat);
            jewel.position.set(0.16, 0.06, side * 0.32);
            g.add(jewel);
            return g;
          });

          // 12. EASY-ONLY: Helios Sun-God Sovereign Solar Wings ('solar_god')
          const solarPlasmaMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
          registerWingStyle('solar_god', (side) => {
            const g = new THREE.Group();
            const wingRing = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 8, 20), goldFeatherMat);
            wingRing.rotation.x = Math.PI / 2;
            wingRing.position.set(0.08, 0.05, side * 0.42);
            g.add(wingRing);

            for (let i = 0; i < 7; i++) {
              const ray = new THREE.Mesh(new THREE.ConeGeometry(0.12, 1.02 - i * 0.06, 6), i % 2 === 0 ? goldFeatherMat : solarPlasmaMat);
              ray.position.set(0.18 - i * 0.13, 0, side * (0.56 + i * 0.08));
              ray.rotation.x = side * (Math.PI / 2 - 0.05);
              ray.rotation.z = 0.14 + i * 0.13;
              g.add(ray);
            }
            return g;
          });

          // 13. HARD-ONLY: Void-Rift Leviathan Bioluminescent Abyssal Fins ('void_fin')
          const voidFinMat = new THREE.MeshStandardMaterial({ color: 0x3b0764, emissive: 0x1e1b4b, metalness: 0.7, roughness: 0.15 });
          const neonSpineMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
          registerWingStyle('void_fin', (side) => {
            const g = new THREE.Group();
            for (let i = 0; i < 5; i++) {
              const spine = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.96 - i * 0.07, 8), neonSpineMat);
              spine.position.set(0.14 - i * 0.15, 0.02, side * (0.56 + i * 0.07));
              spine.rotation.x = side * (Math.PI / 2);
              spine.rotation.z = 0.25 + i * 0.16;

              const membrane = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.03, 0.82 - i * 0.07), voidFinMat);
              membrane.position.set(0.06 - i * 0.15, 0, side * (0.50 + i * 0.06));
              membrane.rotation.y = side * (-0.24 - i * 0.12);
              g.add(spine, membrane);
            }
            return g;
          });

          // 14. HARD-ONLY: Thunder God Valkyrie Storm-Wing Array ('valkyrie_storm')
          const stormBoltMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
          registerWingStyle('valkyrie_storm', (side) => {
            const g = new THREE.Group();
            const armorPlate = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.14, 0.50), goldFeatherMat);
            armorPlate.position.set(0.06, 0.04, side * 0.28);
            g.add(armorPlate);
            for (let i = 0; i < 7; i++) {
              const goldPinion = new THREE.Mesh(new THREE.ConeGeometry(0.13, 1.0 - i * 0.06, 8), goldFeatherMat);
              goldPinion.position.set(0.18 - i * 0.13, 0, side * (0.58 + i * 0.08));
              goldPinion.rotation.x = side * (Math.PI / 2 - 0.08);
              goldPinion.rotation.z = 0.15 + i * 0.13;

              const boltBlade = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.68 - i * 0.04, 4), stormBoltMat);
              boltBlade.position.set(0.14 - i * 0.12, 0.05, side * (0.44 + i * 0.06));
              boltBlade.rotation.copy(goldPinion.rotation);
              g.add(goldPinion, boltBlade);
            }
            return g;
          });

          // 15. HARD-ONLY: Omega Chaos Seraph 6-Winged Crimson/Gold/Obsidian Wing Array ('chaos_seraph')
          registerWingStyle('chaos_seraph', (side) => {
            const g = new THREE.Group();
            const tiers = [
              { y: 0.0, pitch: 0.0, scale: 1.1, mat: crimsonEdgeMat },
              { y: 0.32, pitch: 0.44, scale: 0.92, mat: goldFeatherMat },
              { y: -0.28, pitch: -0.40, scale: 0.86, mat: obsidianMat }
            ];
            tiers.forEach(tier => {
              const sub = new THREE.Group();
              sub.position.y = tier.y;
              sub.rotation.x = side * tier.pitch;
              sub.scale.setScalar(tier.scale);
              for (let i = 0; i < 6; i++) {
                const blade = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.96 - i * 0.06, 5), tier.mat);
                blade.position.set(0.16 - i * 0.13, 0, side * (0.56 + i * 0.08));
                blade.rotation.x = side * (Math.PI / 2);
                blade.rotation.z = 0.18 + i * 0.13;
                sub.add(blade);
              }
              g.add(sub);
            });
            return g;
          });

          // 16. PINNACLE HARD-ONLY: Ragnarok World-Ender 6-Winged Volcanic Apocalypse Array ('ragnarok_wings')
          registerWingStyle('ragnarok_wings', (side) => {
            const g = new THREE.Group();
            const magmaWingMat = new THREE.MeshStandardMaterial({ color: 0xff3300, emissive: 0xdc2626, emissiveIntensity: 0.75, metalness: 0.85, roughness: 0.08 });
            const tiers = [
              { y: 0.0, pitch: 0.0, scale: 1.18, mat: magmaWingMat },
              { y: 0.36, pitch: 0.48, scale: 0.98, mat: flameCoreMat },
              { y: -0.32, pitch: -0.44, scale: 0.90, mat: obsidianMat }
            ];
            tiers.forEach(tier => {
              const sub = new THREE.Group();
              sub.position.y = tier.y;
              sub.rotation.x = side * tier.pitch;
              sub.scale.setScalar(tier.scale);
              for (let i = 0; i < 7; i++) {
                const blade = new THREE.Mesh(new THREE.ConeGeometry(0.14, 1.06 - i * 0.06, 5), tier.mat);
                blade.position.set(0.18 - i * 0.13, 0, side * (0.58 + i * 0.09));
                blade.rotation.x = side * (Math.PI / 2);
                blade.rotation.z = 0.16 + i * 0.13;
                sub.add(blade);
              }
              g.add(sub);
            });
            const hellScythe = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.06, 8, 24, Math.PI * 0.78), flameCoreMat);
            hellScythe.rotation.x = Math.PI / 2;
            hellScythe.rotation.z = side > 0 ? -0.38 : Math.PI + 0.38;
            hellScythe.position.set(0.24, 0.08, side * 0.65);
            g.add(hellScythe);
            return g;
          });

          // 17. EASY-ONLY (100+): Oceanic Nautilus Hydro-Fins ('hydro_fins')
          const hydroAquaMat = new THREE.MeshStandardMaterial({ color: 0x06b6d4, emissive: 0x0891b2, emissiveIntensity: 0.5, metalness: 0.75, roughness: 0.12 });
          const coralPinkMat = new THREE.MeshBasicMaterial({ color: 0xf472b6 });
          registerWingStyle('hydro_fins', (side) => {
            const g = new THREE.Group();
            const turbineRing = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.045, 10, 22), goldFeatherMat);
            turbineRing.rotation.x = Math.PI / 2;
            turbineRing.position.set(0.10, 0.04, side * 0.44);
            g.add(turbineRing);
            for (let i = 0; i < 6; i++) {
              const finRay = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.98 - i * 0.07, 8), i % 2 === 0 ? hydroAquaMat : coralPinkMat);
              finRay.scale.set(1.3, 0.4, 1.0);
              finRay.position.set(0.18 - i * 0.14, 0, side * (0.56 + i * 0.08));
              finRay.rotation.x = side * (Math.PI / 2 - 0.12);
              finRay.rotation.z = 0.22 + i * 0.14;
              g.add(finRay);
            }
            return g;
          });

          // 18. EASY-ONLY (125+): Stained-Glass Morpho Butterfly Wings ('butterfly_stained')
          const morphoBlueMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x2563eb, emissiveIntensity: 0.65, metalness: 0.85, roughness: 0.08 });
          const monarchMagentaMat = new THREE.MeshStandardMaterial({ color: 0xe879f9, emissive: 0x9333ea, emissiveIntensity: 0.60, metalness: 0.85, roughness: 0.08 });
          registerWingStyle('butterfly_stained', (side) => {
            const g = new THREE.Group();
            // Upper Forewing (Large Morpho Lobe + Gold Filigree Frame)
            const foreLobe = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.34, 0.05, 16), morphoBlueMat);
            foreLobe.scale.set(1.15, 1.0, 1.45);
            foreLobe.position.set(0.18, 0.12, side * 0.68);
            const foreRim = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.038, 8, 22), goldFeatherMat);
            foreRim.rotation.x = Math.PI / 2;
            foreRim.scale.set(1.15, 1.45, 1.0);
            foreRim.position.copy(foreLobe.position);

            // Lower Hindwing (Iridescent Magenta Lobe + Swallowtail Spur)
            const hindLobe = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.26, 0.045, 14), monarchMagentaMat);
            hindLobe.scale.set(1.1, 1.0, 1.3);
            hindLobe.position.set(-0.34, -0.06, side * 0.54);
            const hindRim = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.032, 8, 18), goldFeatherMat);
            hindRim.rotation.x = Math.PI / 2;
            hindRim.scale.set(1.1, 1.3, 1.0);
            hindRim.position.copy(hindLobe.position);

            const swallowSpur = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.55, 6), goldFeatherMat);
            swallowSpur.rotation.z = Math.PI / 2 + 0.25;
            swallowSpur.position.set(-0.74, -0.10, side * 0.68);
            g.add(foreLobe, foreRim, hindLobe, hindRim, swallowSpur);
            return g;
          });

          // 19. EASY-ONLY (150+): Ancient Bonsai Sanctuary Root & Sakura Canopy Wings ('ancient_roots')
          const amberWoodMat = new THREE.MeshStandardMaterial({ color: 0xb45309, emissive: 0x451a03, roughness: 0.25, metalness: 0.45 });
          const sakuraBlossomMat = new THREE.MeshBasicMaterial({ color: 0xf472b6 });
          registerWingStyle('ancient_roots', (side) => {
            const g = new THREE.Group();
            const rootBranch = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.04, 1.15, 8), amberWoodMat);
            rootBranch.position.set(0.14, 0.05, side * 0.58);
            rootBranch.rotation.x = side * (Math.PI / 2);
            g.add(rootBranch);
            for (let i = 0; i < 6; i++) {
              const jadeLeaf = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.94 - i * 0.06, 6), i % 2 === 0 ? leafBladeMat : goldFeatherMat);
              jadeLeaf.position.set(0.18 - i * 0.14, 0, side * (0.56 + i * 0.08));
              jadeLeaf.rotation.x = side * (Math.PI / 2 - 0.06);
              jadeLeaf.rotation.z = 0.18 + i * 0.13;
              const sakura = new THREE.Mesh(new THREE.OctahedronGeometry(0.10, 0), sakuraBlossomMat);
              sakura.position.set(0.16 - i * 0.14, 0.06, side * (0.48 + i * 0.07));
              g.add(jadeLeaf, sakura);
            }
            return g;
          });

          // --- 10 TROLL / MEME QUEST WING STYLES ---
          // T1. 6-7 Basketball Hoop Wings ('troll_bball')
          const bballOrangeMat = new THREE.MeshStandardMaterial({ color: 0xff5500, emissive: 0x9a3412, roughness: 0.2, metalness: 0.5 });
          const netWhiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true });
          registerWingStyle('troll_bball', (side) => {
            const g = new THREE.Group();
            const rim = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.045, 10, 22), bballOrangeMat);
            rim.rotation.x = Math.PI / 2;
            rim.position.set(0.0, 0.04, side * 0.66);
            const net = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.22, 0.42, 12, 2, true), netWhiteMat);
            net.position.set(0.0, -0.18, side * 0.66);
            g.add(rim, net);
            return g;
          });

          // T2. 9+10=21 Wooden School Ruler Wings ('troll_rulers')
          const rulerYellowMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.25, metalness: 0.2 });
          registerWingStyle('troll_rulers', (side) => {
            const g = new THREE.Group();
            for (let i = 0; i < 3; i++) {
              const ruler = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.04, 0.96 - i * 0.12), rulerYellowMat);
              ruler.position.set(0.14 - i * 0.18, 0.02, side * (0.56 + i * 0.06));
              ruler.rotation.y = side * (-0.15 - i * 0.12);
              g.add(ruler);
            }
            return g;
          });

          // T3. Wall Inspector Band-Aid Plaster Wings ('troll_bandaid')
          const bandaidTanMat = new THREE.MeshStandardMaterial({ color: 0xfdba74, roughness: 0.4 });
          const gauzeWhiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
          registerWingStyle('troll_bandaid', (side) => {
            const g = new THREE.Group();
            const strip = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.92), bandaidTanMat);
            strip.position.set(0.04, 0.02, side * 0.56);
            const pad = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.07, 0.32), gauzeWhiteMat);
            pad.position.set(0.04, 0.02, side * 0.56);
            g.add(strip, pad);
            return g;
          });

          // T4. 7-7-7 Vegas Gold Coin Stack Wings ('troll_coins')
          registerWingStyle('troll_coins', (side) => {
            const g = new THREE.Group();
            for (let i = 0; i < 6; i++) {
              const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 16), goldFeatherMat);
              coin.position.set(0.18 - i * 0.12, 0.02 + (i % 2) * 0.05, side * (0.46 + i * 0.10));
              g.add(coin);
            }
            return g;
          });

          // T5. MLG 69 Nacho Cheese Dorito Triangle Wings ('troll_dorito')
          const doritoMat = new THREE.MeshStandardMaterial({ color: 0xff5500, emissive: 0xc2410c, roughness: 0.25, metalness: 0.3 });
          registerWingStyle('troll_dorito', (side) => {
            const g = new THREE.Group();
            for (let i = 0; i < 3; i++) {
              const chip = new THREE.Mesh(new THREE.ConeGeometry(0.34 - i * 0.04, 0.06, 3), doritoMat);
              chip.position.set(0.14 - i * 0.20, 0.02, side * (0.54 + i * 0.14));
              chip.rotation.y = side * (0.4 + i * 0.3);
              g.add(chip);
            }
            return g;
          });

          // T6. AFK Sleepy Fluffy Pillow Wings ('troll_pillow')
          registerWingStyle('troll_pillow', (side) => {
            const g = new THREE.Group();
            const pillow = new THREE.Mesh(new THREE.SphereGeometry(0.38, 14, 12), gauzeWhiteMat);
            pillow.scale.set(1.15, 0.38, 1.35);
            pillow.position.set(0.04, 0.02, side * 0.58);
            g.add(pillow);
            return g;
          });

          // T7. Carpal Tunnel Caffeine Lightning-Bolt Wings ('troll_lightning')
          const caffeineGreenMat = new THREE.MeshBasicMaterial({ color: 0x00ff66 });
          registerWingStyle('troll_lightning', (side) => {
            const g = new THREE.Group();
            for (let i = 0; i < 6; i++) {
              const bolt = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.98 - i * 0.07, 4), i % 2 === 0 ? caffeineGreenMat : flameCoreMat);
              bolt.position.set(0.16 - i * 0.13, (i % 2 === 0 ? 0.05 : -0.04), side * (0.54 + i * 0.08));
              bolt.rotation.x = side * (Math.PI / 2);
              bolt.rotation.z = 0.15 + i * 0.15;
              g.add(bolt);
            }
            return g;
          });

          // T8. Fibonacci Golden Protractor Wings ('troll_protractor')
          registerWingStyle('troll_protractor', (side) => {
            const g = new THREE.Group();
            const arc = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.045, 8, 20, Math.PI), goldFeatherMat);
            arc.rotation.x = Math.PI / 2;
            arc.rotation.z = side > 0 ? 0 : Math.PI;
            arc.position.set(0.04, 0.02, side * 0.36);
            const baseBar = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.05, 0.07), goldFeatherMat);
            baseBar.position.set(0.04, 0.02, side * 0.36);
            g.add(arc, baseBar);
            return g;
          });

          // T9. 99% Choke Artist Circus Balloon-Animal Wings ('troll_balloon')
          const balloonPinkMat = new THREE.MeshStandardMaterial({ color: 0xff0077, emissive: 0x831843, roughness: 0.08, metalness: 0.3 });
          const balloonCyanMat = new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x0c4a6e, roughness: 0.08, metalness: 0.3 });
          registerWingStyle('troll_balloon', (side) => {
            const g = new THREE.Group();
            for (let i = 0; i < 4; i++) {
              const sausage = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), i % 2 === 0 ? balloonPinkMat : balloonCyanMat);
              sausage.scale.set(0.8, 0.7, 2.2);
              sausage.position.set(0.14 - i * 0.16, 0.02, side * (0.56 + i * 0.06));
              g.add(sausage);
            }
            return g;
          });

          // T10. Traffic-Light Mismatched Easy/Med/Hard Wings ('troll_mismatch')
          const trafficGreenMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
          const trafficYellowMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
          const trafficRedMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
          registerWingStyle('troll_mismatch', (side) => {
            const g = new THREE.Group();
            const mats = [trafficGreenMat, trafficYellowMat, trafficRedMat];
            for (let i = 0; i < 6; i++) {
              const blade = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.92 - i * 0.06, 6), mats[i % 3]);
              blade.position.set(0.16 - i * 0.13, 0, side * (0.54 + i * 0.07));
              blade.rotation.x = side * (Math.PI / 2);
              blade.rotation.z = 0.20 + i * 0.13;
              g.add(blade);
            }
            return g;
          });
        }

        /**
         * Builds the 20 bespoke, animated 3D model assemblies for the harder-to-get skins!
         */
        createRealisticEndgameModels() {
          this.skinModelGroups = {};
          this.animatedSkinParts = {};

          const addPreset = (key, group) => {
            group.visible = false;
            // Calibrate 3D model scale & center offset so every skin matches the exact 0.60m collision sphere at (0,0,0)
            let baseScale = 1.0;
            let basePos = { x: 0, y: 0, z: 0 };
            if (key.startsWith('poke_')) {
              if (key === 'poke_jigglypuff' || key === 'poke_magikarp' || key === 'poke_gengar' || key === 'poke_snorlax') {
                baseScale = 0.78;
                basePos = { x: 0, y: 0, z: 0 };
              } else if (key === 'poke_charizard' || key === 'poke_mewtwo') {
                baseScale = 0.74;
                basePos = { x: -0.06, y: -0.08, z: 0 };
              } else if (key === 'poke_rayquaza') {
                baseScale = 1.08;
                basePos = { x: 0.02, y: -0.04, z: 0 };
              } else {
                baseScale = 0.78;
                basePos = { x: -0.08, y: -0.10, z: 0 };
              }
            } else if (
              key === 'bonsai_island' ||
              key === 'troll_traffic' ||
              key === 'troll_jackpot' ||
              key === 'eternity_sovereign' ||
              key === 'ragnarok' ||
              key === 'singularity' ||
              key === 'nebula_god'
            ) {
              baseScale = 0.88;
            }
            group.userData.baseScale = baseScale;
            group.userData.basePos = basePos;
            group.scale.set(baseScale, baseScale, baseScale);
            group.position.set(basePos.x, basePos.y, basePos.z);
            this.birdMeshGroup.add(group);
            this.skinModelGroups[key] = group;
          };

          // Shared High-Realism PBR Materials
          const goldMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.95, roughness: 0.07 });
          const rubyMat = new THREE.MeshStandardMaterial({ color: 0xff0033, emissive: 0x7f0019, metalness: 0.65, roughness: 0.08 });
          const emeraldMat = new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x064e3b, metalness: 0.65, roughness: 0.08 });
          const chromeMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, metalness: 0.96, roughness: 0.06 });
          const darkMetalMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.88, roughness: 0.16 });
          const boneMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3, metalness: 0.12 });
          const fireGoldMat = new THREE.MeshBasicMaterial({ color: 0xfff04d });
          const fireOrangeMat = new THREE.MeshStandardMaterial({ color: 0xff4800, emissive: 0x9a1b00, roughness: 0.14 });

          // 0A. Sunny Canary ('canary_crest': Golden Sun-Plume Crown + Sunny Medallion)
          const canaryGroup = new THREE.Group();
          const canaryMedal = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), goldMat);
          canaryMedal.position.set(0.68, -0.18, 0);
          const canaryRing = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.03, 8, 18), chromeMat);
          canaryRing.rotation.y = Math.PI / 2;
          canaryRing.position.set(0.66, -0.18, 0);
          for (let c = 0; c < 3; c++) {
            const plume = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.48 - c * 0.06, 8), c === 0 ? goldMat : fireGoldMat);
            plume.position.set(0.06 - c * 0.12, 0.78 - c * 0.04, 0);
            plume.rotation.z = 0.35 + c * 0.18;
            canaryGroup.add(plume);
          }
          canaryGroup.add(canaryMedal, canaryRing);
          addPreset('canary_crest', canaryGroup);

          // 0B. Azure Bluejay ('jay_aviator': Chrome Aviator Goggles on Forehead + Cobalt Wingtip/Tail Fins)
          const jayGroup = new THREE.Group();
          const goggleStrap = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.59, 0.11, 20), darkMetalMat);
          goggleStrap.position.set(0.05, 0.44, 0);
          jayGroup.add(goggleStrap);
          [-1, 1].forEach(side => {
            const rim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.032, 10, 18), goldMat);
            rim.rotation.y = Math.PI / 2 - side * 0.25;
            rim.position.set(0.56, 0.46, side * 0.24);
            const lens = new THREE.Mesh(
              new THREE.CylinderGeometry(0.145, 0.145, 0.04, 14),
              new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
            );
            lens.rotation.z = Math.PI / 2;
            lens.rotation.y = -side * 0.25;
            lens.position.set(0.57, 0.46, side * 0.24);
            jayGroup.add(rim, lens);
          });
          addPreset('jay_aviator', jayGroup);

          // 0C. Crimson Cardinal ('cardinal_crest': Tall Sculpted Cardinal Crown + Ruby Collar Medallion)
          const cardinalGroup = new THREE.Group();
          for (let k = 0; k < 5; k++) {
            const spike = new THREE.Mesh(new THREE.ConeGeometry(0.11 - k * 0.012, 0.62 - k * 0.06, 8), k % 2 === 0 ? rubyMat : goldMat);
            spike.position.set(0.08 - k * 0.09, 0.82 - k * 0.04, 0);
            spike.rotation.z = 0.28 + k * 0.14;
            cardinalGroup.add(spike);
          }
          const cardinalGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.15, 0), rubyMat);
          cardinalGem.position.set(0.68, -0.18, 0);
          const cardinalFrame = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.032, 8, 18), goldMat);
          cardinalFrame.rotation.y = Math.PI / 2;
          cardinalFrame.position.set(0.66, -0.18, 0);
          cardinalGroup.add(cardinalGem, cardinalFrame);
          addPreset('cardinal_crest', cardinalGroup);

          // 0D. Emerald Macaw ('macaw_crown': Tropical Golden Sun-Diadem + Tri-Color Macaw Tail Streamers)
          const macawGroup = new THREE.Group();
          const diadem = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.038, 10, 22), goldMat);
          diadem.rotation.x = Math.PI / 2 - 0.15;
          diadem.position.set(0.05, 0.72, 0);
          const diademEmerald = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), emeraldMat);
          diademEmerald.position.set(0.38, 0.78, 0);
          macawGroup.add(diadem, diademEmerald);
          for (let t = -1; t <= 1; t++) {
            const tailPlume = new THREE.Mesh(
              new THREE.ConeGeometry(0.11, 1.32, 8),
              t === 0 ? emeraldMat : goldMat
            );
            tailPlume.rotation.z = Math.PI / 2 + t * 0.12;
            tailPlume.position.set(-1.26, 0.04 + t * 0.08, t * 0.14);
            macawGroup.add(tailPlume);
          }
          addPreset('macaw_crown', macawGroup);

          // 1. Rose-Gold / Angel Halo ('halo': Dual Radiant Halo + Rose-Gold Heart Brooch + Winglet Pearls)
          const haloGroup = new THREE.Group();
          const haloRing = new THREE.Mesh(
            new THREE.TorusGeometry(0.42, 0.058, 12, 28),
            new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xfbbf24, emissiveIntensity: 0.6, metalness: 0.9, roughness: 0.06 })
          );
          haloRing.rotation.x = Math.PI / 2 - 0.15;
          haloRing.position.set(0.05, 0.96, 0);
          const innerRoseHalo = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.032, 10, 24), rubyMat);
          innerRoseHalo.rotation.x = Math.PI / 2 - 0.15;
          innerRoseHalo.position.set(0.05, 0.96, 0);
          const heartGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.15, 0), rubyMat);
          heartGem.position.set(0.68, -0.18, 0);
          haloGroup.add(haloRing, innerRoseHalo, heartGem);
          addPreset('halo', haloGroup);

          // 2. Lord Penguin ('tophat' + Gold Monocle + Red Bowtie + Golden Pocket-Watch Chain)
          const topHatGroup = new THREE.Group();
          const hatBlackMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.18, metalness: 0.45 });
          const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.50, 0.50, 0.065, 22), hatBlackMat);
          brim.position.set(0.05, 0.66, 0);
          const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.29, 0.54, 22), hatBlackMat);
          cylinder.position.set(0.05, 0.93, 0);
          const ribbon = new THREE.Mesh(new THREE.CylinderGeometry(0.325, 0.312, 0.11, 22), rubyMat);
          ribbon.position.set(0.05, 0.74, 0);
          const hatBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.13, 0.16), goldMat);
          hatBuckle.position.set(0.36, 0.74, 0);
          const monocle = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.028, 8, 20), goldMat);
          monocle.rotation.y = Math.PI / 2;
          monocle.position.set(0.55, 0.2, 0.48);
          const bowLeft = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.24, 6), rubyMat);
          bowLeft.rotation.x = Math.PI / 2;
          bowLeft.position.set(0.63, -0.32, 0.11);
          const bowRight = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.24, 6), rubyMat);
          bowRight.rotation.x = -Math.PI / 2;
          bowRight.position.set(0.63, -0.32, -0.11);
          const bowKnot = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 10), goldMat);
          bowKnot.position.set(0.65, -0.32, 0);
          topHatGroup.add(brim, cylinder, ribbon, hatBuckle, monocle, bowLeft, bowRight, bowKnot);
          addPreset('tophat', topHatGroup);

          // 3. Shadow Shinobi ('shinobi': Forehead Hitai-ate + Twin Back Katanas + 3 Orbiting Shurikens)
          const shinobiGroup = new THREE.Group();
          const bandMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.3 });
          const headband = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.61, 0.16, 20), bandMat);
          headband.position.set(0.05, 0.38, 0);
          const metalPlate = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.46), chromeMat);
          metalPlate.position.set(0.62, 0.39, 0);
          const clothTail1 = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.09, 0.12), bandMat);
          clothTail1.position.set(-0.76, 0.42, 0.14);
          clothTail1.rotation.z = 0.25;
          const clothTail2 = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.09, 0.12), bandMat);
          clothTail2.position.set(-0.72, 0.31, -0.14);
          clothTail2.rotation.z = -0.15;

          [-1, 1].forEach(side => {
            const katana = new THREE.Group();
            const scabbard = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.035, 1.24, 8), darkMetalMat);
            const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.36, 8), bandMat);
            hilt.position.y = 0.72;
            const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.035, 12), goldMat);
            guard.position.y = 0.55;
            katana.add(scabbard, hilt, guard);
            katana.position.set(-0.55, 0.20, side * 0.20);
            katana.rotation.x = side * 0.52;
            katana.rotation.z = 0.35;
            shinobiGroup.add(katana);
          });

          const shurikenOrbit = new THREE.Group();
          for (let s = 0; s < 3; s++) {
            const star = new THREE.Group();
            for (let b = 0; b < 4; b++) {
              const blade = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.26, 4), chromeMat);
              blade.rotation.z = (b * Math.PI) / 2;
              blade.position.set(Math.cos((b * Math.PI) / 2) * 0.11, Math.sin((b * Math.PI) / 2) * 0.11, 0);
              star.add(blade);
            }
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.016, 6, 12), rubyMat);
            star.add(ring);
            const angle = (s / 3) * Math.PI * 2;
            star.position.set(Math.cos(angle) * 1.22, 0.1, Math.sin(angle) * 1.22);
            shurikenOrbit.add(star);
          }
          shinobiGroup.add(headband, metalPlate, clothTail1, clothTail2, shurikenOrbit);
          this.animatedSkinParts.shurikenOrbit = shurikenOrbit;
          this.animatedSkinParts.shinobiTail1 = clothTail1;
          addPreset('shinobi', shinobiGroup);

          // 4. Cyber-Valkyrie MK-IX ('cyber_jet': Holographic HUD Visor + Twin Dorsal Jet Thrusters + Plasma Cones)
          const cyberGroup = new THREE.Group();
          const visorMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
          const visorFrame = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.22, 1.20), darkMetalMat);
          visorFrame.position.set(0.44, 0.22, 0);
          const visorLens = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.15, 1.16), visorMat);
          visorLens.position.set(0.46, 0.22, 0);
          const crestFin = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.28, 0.06), visorMat);
          crestFin.position.set(-0.05, 0.76, 0);
          crestFin.rotation.z = 0.35;

          const jetpack = new THREE.Group();
          this.animatedSkinParts.jetFlames = [];
          [-1, 1].forEach(side => {
            const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.21, 0.74, 14), chromeMat);
            pod.rotation.z = Math.PI / 2 - 0.22;
            pod.position.set(-0.55, 0.20, side * 0.36);

            const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.19, 0.18, 12), darkMetalMat);
            nozzle.rotation.z = Math.PI / 2 - 0.22;
            nozzle.position.set(-0.90, 0.11, side * 0.36);

            const plasmaFlame = new THREE.Mesh(
              new THREE.ConeGeometry(0.15, 0.72, 10),
              new THREE.MeshBasicMaterial({ color: 0x22d3ee })
            );
            plasmaFlame.rotation.z = Math.PI / 2 - 0.22;
            plasmaFlame.position.set(-1.28, 0.02, side * 0.36);
            this.animatedSkinParts.jetFlames.push(plasmaFlame);

            jetpack.add(pod, nozzle, plasmaFlame);
          });
          cyberGroup.add(visorFrame, visorLens, crestFin, jetpack);
          addPreset('cyber_jet', cyberGroup);

          // 5. Solar Phoenix ('phoenix': 7-Plume Solar Fire Crown + Golden Chest Crest + 5 Long Undulating Flame Tail Ribbons)
          const phoenixGroup = new THREE.Group();
          for (let i = 0; i < 7; i++) {
            const plume = new THREE.Mesh(new THREE.ConeGeometry(0.095, 0.68 - i * 0.05, 8), i % 2 === 0 ? fireGoldMat : fireOrangeMat);
            plume.position.set(0.12 - i * 0.09, 0.86 - i * 0.03, (i - 3) * 0.06);
            plume.rotation.z = 0.32 + i * 0.12;
            phoenixGroup.add(plume);
          }
          const phoenixChestGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), fireGoldMat);
          phoenixChestGem.position.set(0.68, -0.18, 0);
          phoenixGroup.add(phoenixChestGem);

          this.animatedSkinParts.phoenixRibbons = [];
          for (let r = -2; r <= 2; r++) {
            const ribbon = new THREE.Mesh(
              new THREE.ConeGeometry(0.14 - Math.abs(r) * 0.015, 1.75 - Math.abs(r) * 0.12, 10),
              r % 2 === 0 ? fireGoldMat : fireOrangeMat
            );
            ribbon.rotation.z = Math.PI / 2 + r * 0.08;
            ribbon.position.set(-1.42, 0.05 + r * 0.08, r * 0.18);
            phoenixGroup.add(ribbon);
            this.animatedSkinParts.phoenixRibbons.push(ribbon);
          }
          addPreset('phoenix', phoenixGroup);

          // 6. 24K Sovereign Emperor ('emperor': Tall Jeweled Imperial Crown + Royal Velvet Cape + Golden Shoulder Pauldrons)
          const empGroup = new THREE.Group();
          const crownBase = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.32, 0.28, 18), goldMat);
          crownBase.position.set(0.05, 0.74, 0);
          const velvetCap = new THREE.Mesh(new THREE.SphereGeometry(0.33, 14, 12), rubyMat);
          velvetCap.position.set(0.05, 0.82, 0);
          empGroup.add(crownBase, velvetCap);
          for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const spike = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.28, 8), goldMat);
            spike.position.set(0.05 + Math.cos(angle) * 0.30, 0.95, Math.sin(angle) * 0.30);
            const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.065, 0), i % 2 === 0 ? rubyMat : emeraldMat);
            gem.position.set(0.05 + Math.cos(angle) * 0.35, 0.74, Math.sin(angle) * 0.35);
            empGroup.add(spike, gem);
          }
          [-1, 1].forEach(side => {
            const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), goldMat);
            pauldron.scale.set(1.2, 0.7, 1.0);
            pauldron.position.set(0.15, 0.18, side * 0.56);
            empGroup.add(pauldron);
          });
          const cape = new THREE.Mesh(
            new THREE.CylinderGeometry(0.36, 0.76, 1.22, 16, 1, true, -Math.PI * 0.48, Math.PI * 0.96),
            rubyMat
          );
          cape.rotation.z = Math.PI / 2 - 0.32;
          cape.rotation.y = -Math.PI / 2;
          cape.position.set(-0.66, -0.04, 0);
          this.animatedSkinParts.emperorCape = cape;
          empGroup.add(cape);
          addPreset('emperor', empGroup);

          // 7. Cosmic Singularity ('singularity': Active 3D Black Hole + Dual Accretion Disks + 4 Orbiting Exoplanets)
          const cosmicGroup = new THREE.Group();
          const bhCore = new THREE.Mesh(
            new THREE.SphereGeometry(0.25, 18, 18),
            new THREE.MeshBasicMaterial({ color: 0x000000 })
          );
          bhCore.position.set(0, 1.08, 0);
          const accretionDisk = new THREE.Mesh(
            new THREE.TorusGeometry(0.48, 0.065, 10, 32),
            new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
          );
          accretionDisk.rotation.x = Math.PI / 2 - 0.32;
          accretionDisk.position.copy(bhCore.position);

          const innerDisk = new THREE.Mesh(
            new THREE.TorusGeometry(0.34, 0.04, 8, 28),
            new THREE.MeshBasicMaterial({ color: 0xf472b6 })
          );
          innerDisk.rotation.x = Math.PI / 2 + 0.28;
          innerDisk.position.copy(bhCore.position);

          const planetOrbit = new THREE.Group();
          const planetColors = [0xf472b6, 0x38bdf8, 0xfacc15, 0xa855f7];
          for (let p = 0; p < 4; p++) {
            const angle = (p / 4) * Math.PI * 2;
            const planet = new THREE.Mesh(
              new THREE.SphereGeometry(0.135, 14, 14),
              new THREE.MeshStandardMaterial({ color: planetColors[p], emissive: planetColors[p], emissiveIntensity: 0.45 })
            );
            planet.position.set(Math.cos(angle) * 1.32, Math.sin(angle * 2) * 0.26, Math.sin(angle) * 1.32);
            if (p % 2 === 0) {
              const pRing = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.022, 6, 18), goldMat);
              pRing.rotation.x = 1.1;
              planet.add(pRing);
            }
            planetOrbit.add(planet);
          }
          cosmicGroup.add(bhCore, accretionDisk, innerDisk, planetOrbit);
          this.animatedSkinParts.planetOrbit = planetOrbit;
          this.animatedSkinParts.accretionDisk = accretionDisk;
          addPreset('singularity', cosmicGroup);

          // 8. Prismatic Seraphim ('seraphim': 3 Interlocking Ophanim Halos + Floating Diamond Crest + Crystal Tail)
          const seraphGroup = new THREE.Group();
          const outerHalo = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.042, 10, 32), goldMat);
          outerHalo.position.set(0, 1.05, 0);
          const innerHalo = new THREE.Mesh(
            new THREE.TorusGeometry(0.40, 0.036, 10, 28),
            new THREE.MeshBasicMaterial({ color: 0x7dd3fc })
          );
          innerHalo.position.set(0, 1.05, 0);
          const centerDiamond = new THREE.Mesh(
            new THREE.OctahedronGeometry(0.16, 0),
            new THREE.MeshBasicMaterial({ color: 0xfef08a })
          );
          centerDiamond.position.set(0, 1.05, 0);
          this.animatedSkinParts.seraphHalo1 = outerHalo;
          this.animatedSkinParts.seraphHalo2 = innerHalo;
          seraphGroup.add(outerHalo, innerHalo, centerDiamond);
          addPreset('seraphim', seraphGroup);

          // 9. Glacier Ice Wyvern ('wyvern_ice': Jagged Frost Horns + Dorsal Ice Spikes + Articulated Ice Tail)
          const wyvernGroup = new THREE.Group();
          const iceSpikeMat = new THREE.MeshStandardMaterial({
            color: 0xe0f2fe,
            emissive: 0x0284c7,
            metalness: 0.88,
            roughness: 0.05,
            flatShading: true
          });
          [-1, 1].forEach(side => {
            const horn = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.68, 5), iceSpikeMat);
            horn.position.set(-0.08, 0.82, side * 0.30);
            horn.rotation.z = 0.58;
            horn.rotation.x = side * -0.36;
            wyvernGroup.add(horn);
          });
          for (let s = 0; s < 6; s++) {
            const spine = new THREE.Mesh(new THREE.ConeGeometry(0.10, 0.42 - s * 0.04, 5), iceSpikeMat);
            spine.position.set(-0.32 - s * 0.24, 0.52 - s * 0.09, 0);
            spine.rotation.z = 0.85 + s * 0.12;
            wyvernGroup.add(spine);
          }
          const iceTailSpear = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), iceSpikeMat);
          iceTailSpear.scale.set(1.8, 0.7, 0.7);
          iceTailSpear.position.set(-1.68, -0.02, 0);
          wyvernGroup.add(iceTailSpear);
          addPreset('wyvern_ice', wyvernGroup);

          // 10. Astral Grand Archmage ('archmage': Ornate Wizard Hat + 6 Orbiting 3D Runestones + Arcane Halo)
          const mageGroup = new THREE.Group();
          const wizMat = new THREE.MeshStandardMaterial({ color: 0x4c1d95, roughness: 0.3, metalness: 0.35 });
          const wizBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.05, 22), wizMat);
          wizBrim.position.set(0.02, 0.65, 0);
          const wizBand = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.35, 0.11, 18), goldMat);
          wizBand.position.set(0.0, 0.71, 0);
          const wizCone = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.86, 18), wizMat);
          wizCone.position.set(-0.05, 1.08, 0);
          wizCone.rotation.z = 0.26;

          const runeOrbit = new THREE.Group();
          for (let r = 0; r < 6; r++) {
            const angle = (r / 6) * Math.PI * 2;
            const rune = new THREE.Mesh(
              new THREE.OctahedronGeometry(0.145, 0),
              new THREE.MeshBasicMaterial({ color: r % 2 === 0 ? 0xc084fc : 0xfacc15 })
            );
            rune.position.set(Math.cos(angle) * 1.24, 0.15, Math.sin(angle) * 1.24);
            runeOrbit.add(rune);
          }
          this.animatedSkinParts.runeOrbit = runeOrbit;
          mageGroup.add(wizBrim, wizBand, wizCone, runeOrbit);
          addPreset('archmage', mageGroup);

          // 11. HARD-ONLY: Abyssal Magma Dragon ('dragon': Dual Ribbed Dragon Horns + Glowing Magma Chest Core + 6-Segment Spiked Tail)
          const dragonGroup = new THREE.Group();
          const hornDarkMat = new THREE.MeshStandardMaterial({ color: 0x18181b, metalness: 0.65, roughness: 0.22 });
          [-1, 1].forEach(side => {
            const hornBase = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.76, 10), hornDarkMat);
            hornBase.position.set(-0.06, 0.82, side * 0.34);
            hornBase.rotation.z = 0.60;
            hornBase.rotation.x = side * -0.42;
            const hornTip = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.38, 8), fireGoldMat);
            hornTip.position.set(-0.32, 1.08, side * 0.48);
            hornTip.rotation.z = 0.85;
            dragonGroup.add(hornBase, hornTip);
          });
          const dragonTail = new THREE.Group();
          for (let t = 0; t < 6; t++) {
            const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.13 - t * 0.016, 0.11 - t * 0.014, 0.32, 8), rubyMat);
            seg.rotation.z = Math.PI / 2;
            seg.position.set(-0.78 - t * 0.25, -0.04 + Math.sin(t) * 0.06, 0);
            const dorsalSpike = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.22, 6), fireGoldMat);
            dorsalSpike.position.set(-0.78 - t * 0.25, 0.13, 0);
            dragonTail.add(seg, dorsalSpike);
          }
          const spadeTip = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), fireGoldMat);
          spadeTip.position.set(-2.22, 0, 0);
          dragonTail.add(spadeTip);
          this.animatedSkinParts.dragonTail = dragonTail;
          dragonGroup.add(dragonTail);
          addPreset('dragon', dragonGroup);

          // 12. HARD-ONLY: Thunder God Valkyrie ('valkyrie': Winged War-Helm + Back Lightning Spear + 6 Orbiting Lightning Bolts)
          const valkGroup = new THREE.Group();
          const helmDome = new THREE.Mesh(new THREE.SphereGeometry(0.54, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), goldMat);
          helmDome.position.set(0.06, 0.38, 0);
          valkGroup.add(helmDome);
          [-1, 1].forEach(side => {
            const helmWing = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.82, 8), chromeMat);
            helmWing.position.set(-0.12, 0.84, side * 0.54);
            helmWing.rotation.z = 0.54;
            helmWing.rotation.x = side * -0.38;
            valkGroup.add(helmWing);
          });
          const lightningOrbit = new THREE.Group();
          const boltMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
          for (let b = 0; b < 6; b++) {
            const angle = (b / 6) * Math.PI * 2;
            const bolt = new THREE.Mesh(new THREE.OctahedronGeometry(0.15, 0), b % 2 === 0 ? boltMat : fireGoldMat);
            bolt.scale.set(0.48, 2.4, 0.48);
            bolt.position.set(Math.cos(angle) * 1.24, (b % 2 === 0 ? 0.26 : -0.22), Math.sin(angle) * 1.24);
            bolt.rotation.z = 0.6;
            lightningOrbit.add(bolt);
          }
          this.animatedSkinParts.lightningOrbit = lightningOrbit;
          valkGroup.add(lightningOrbit);
          addPreset('valkyrie', valkGroup);

          // 13. HARD-ONLY: Apex Mecha-Bahamut ('mecha_bahamut': Spinning Chest Reactor + Dual Shoulder Plasma Cannons + Cyber Tail)
          const bahamutGroup = new THREE.Group();
          const reactorRing = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.05, 10, 22), chromeMat);
          reactorRing.rotation.y = Math.PI / 2;
          reactorRing.position.set(0.68, -0.20, 0);
          const reactorCore = new THREE.Mesh(
            new THREE.OctahedronGeometry(0.18, 1),
            new THREE.MeshBasicMaterial({ color: 0x10b981 })
          );
          reactorCore.position.set(0.71, -0.20, 0);
          this.animatedSkinParts.reactorCore = reactorCore;
          bahamutGroup.add(reactorRing, reactorCore);

          [-1, 1].forEach(side => {
            const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.72, 12), darkMetalMat);
            cannon.rotation.z = Math.PI / 2;
            cannon.position.set(0.16, 0.60, side * 0.46);
            const muzzle = new THREE.Mesh(
              new THREE.SphereGeometry(0.095, 10, 10),
              new THREE.MeshBasicMaterial({ color: 0x10b981 })
            );
            muzzle.position.set(0.54, 0.60, side * 0.46);
            const laserHorn = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.72, 6), emeraldMat);
            laserHorn.position.set(-0.14, 0.88, side * 0.30);
            laserHorn.rotation.z = 0.62;
            bahamutGroup.add(cannon, muzzle, laserHorn);
          });
          // Articulated Mecha Tail with Glowing Emerald Plasma Blade
          for (let m = 0; m < 4; m++) {
            const seg = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16 - m * 0.02, 0.18), darkMetalMat);
            seg.position.set(-0.82 - m * 0.28, -0.02, 0);
            bahamutGroup.add(seg);
          }
          const mechaTailBlade = new THREE.Mesh(
            new THREE.ConeGeometry(0.16, 0.55, 4),
            new THREE.MeshBasicMaterial({ color: 0x10b981 })
          );
          mechaTailBlade.rotation.z = Math.PI / 2;
          mechaTailBlade.position.set(-2.05, -0.02, 0);
          bahamutGroup.add(mechaTailBlade);
          addPreset('mecha_bahamut', bahamutGroup);

          // 14. HARD-ONLY: Blood Moon Arch-Fiend ('reaper': 3D Bone Skull Mask + Crimson Eclipse Halo + Bone Spine Tail)
          const reaperGroup = new THREE.Group();
          const skullHelm = new THREE.Mesh(new THREE.SphereGeometry(0.54, 18, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), boneMat);
          skullHelm.position.set(0.18, 0.32, 0);
          const noseBridge = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.46, 6), boneMat);
          noseBridge.rotation.z = -Math.PI / 2;
          noseBridge.position.set(0.78, 0.16, 0);

          const eclipseGroup = new THREE.Group();
          const darkMoon = new THREE.Mesh(
            new THREE.SphereGeometry(0.30, 16, 16),
            new THREE.MeshBasicMaterial({ color: 0x050505 })
          );
          const bloodCorona = new THREE.Mesh(
            new THREE.TorusGeometry(0.42, 0.06, 10, 28),
            new THREE.MeshBasicMaterial({ color: 0xff0033 })
          );
          eclipseGroup.add(darkMoon, bloodCorona);
          eclipseGroup.position.set(-0.15, 1.08, 0);
          this.animatedSkinParts.eclipseHalo = bloodCorona;

          [-1, 1].forEach(side => {
            const fiendHorn = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.72, 8), rubyMat);
            fiendHorn.position.set(-0.02, 0.84, side * 0.35);
            fiendHorn.rotation.z = 0.48;
            fiendHorn.rotation.x = side * -0.45;
            reaperGroup.add(fiendHorn);
          });
          for (let b = 0; b < 5; b++) {
            const vertebra = new THREE.Mesh(new THREE.OctahedronGeometry(0.11 - b * 0.012, 0), boneMat);
            vertebra.position.set(-0.82 - b * 0.24, -0.02, 0);
            reaperGroup.add(vertebra);
          }
          const tailScythe = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.48, 4), rubyMat);
          tailScythe.rotation.z = Math.PI / 2;
          tailScythe.position.set(-2.05, -0.02, 0);
          reaperGroup.add(skullHelm, noseBridge, eclipseGroup, tailScythe);
          addPreset('reaper', reaperGroup);

          // 15. EASY-ONLY: Nimbus Cloud Spirit ('cloud_spirit': Fluffy Cloud Crown + Rainbow Arch + Cloud Puff Tail)
          const cloudSpiritGroup = new THREE.Group();
          const puffMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x1e3a8a, emissiveIntensity: 0.15, roughness: 0.4 });
          const crownPuffs = [
            { x: 0.08, y: 0.76, z: 0, s: 0.24 },
            { x: -0.12, y: 0.72, z: 0.18, s: 0.19 },
            { x: -0.12, y: 0.72, z: -0.18, s: 0.19 },
            { x: -0.92, y: 0.04, z: 0, s: 0.30 },
            { x: -1.18, y: 0.08, z: 0.12, s: 0.22 },
            { x: -1.18, y: 0.02, z: -0.12, s: 0.22 }
          ];
          crownPuffs.forEach(cp => {
            const puff = new THREE.Mesh(new THREE.SphereGeometry(cp.s, 14, 14), puffMat);
            puff.position.set(cp.x, cp.y, cp.z);
            cloudSpiritGroup.add(puff);
          });
          const rainbowArch = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.05, 10, 24, Math.PI), goldMat);
          rainbowArch.position.set(-0.05, 0.68, 0);
          cloudSpiritGroup.add(rainbowArch);
          addPreset('cloud_spirit', cloudSpiritGroup);

          // 16. EASY-ONLY: Sylvan Forest Guardian ('sylvan_stag': Majestic Branched Golden Antlers + Orbiting Forest Wisps)
          const sylvanGroup = new THREE.Group();
          [-1, 1].forEach(side => {
            const mainBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.06, 0.78, 8), goldMat);
            mainBeam.position.set(-0.04, 0.92, side * 0.28);
            mainBeam.rotation.z = 0.35;
            mainBeam.rotation.x = side * -0.38;

            const tine1 = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.36, 6), goldMat);
            tine1.position.set(0.08, 0.96, side * 0.36);
            tine1.rotation.z = -0.25;

            const tine2 = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.42, 6), emeraldMat);
            tine2.position.set(-0.18, 1.15, side * 0.46);
            tine2.rotation.z = 0.55;
            sylvanGroup.add(mainBeam, tine1, tine2);
          });
          const wispOrbit = new THREE.Group();
          for (let w = 0; w < 4; w++) {
            const a = (w / 4) * Math.PI * 2;
            const wisp = new THREE.Mesh(
              new THREE.SphereGeometry(0.11, 12, 12),
              new THREE.MeshBasicMaterial({ color: w % 2 === 0 ? 0x4ade80 : 0xfde047 })
            );
            wisp.position.set(Math.cos(a) * 1.18, 0.12, Math.sin(a) * 1.18);
            wispOrbit.add(wisp);
          }
          this.animatedSkinParts.wispOrbit = wispOrbit;
          sylvanGroup.add(wispOrbit);
          addPreset('sylvan_stag', sylvanGroup);

          // 17. EASY-ONLY: Starlight Astral Pegasus ('pegasus': Spiraling Diamond Unicorn Horn + Flowing Starlight Mane & Tail)
          const pegasusGroup = new THREE.Group();
          const unicornHorn = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.78, 12), goldMat);
          unicornHorn.position.set(0.52, 0.78, 0);
          unicornHorn.rotation.z = -0.58;
          const hornSpiral = new THREE.Mesh(
            new THREE.TorusGeometry(0.12, 0.025, 8, 18),
            new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
          );
          hornSpiral.position.set(0.34, 0.62, 0);
          hornSpiral.rotation.y = Math.PI / 2;
          pegasusGroup.add(unicornHorn, hornSpiral);

          const maneMat = new THREE.MeshStandardMaterial({ color: 0x93c5fd, emissive: 0x3b82f6, emissiveIntensity: 0.4, roughness: 0.15 });
          for (let m = 0; m < 4; m++) {
            const maneCrest = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.52, 8), m % 2 === 0 ? maneMat : goldMat);
            maneCrest.position.set(-0.05 - m * 0.15, 0.74 - m * 0.08, 0);
            maneCrest.rotation.z = 0.65 + m * 0.12;
            pegasusGroup.add(maneCrest);
          }
          for (let t = -1; t <= 1; t++) {
            const starTail = new THREE.Mesh(new THREE.ConeGeometry(0.14, 1.55, 10), t === 0 ? goldMat : maneMat);
            starTail.rotation.z = Math.PI / 2 + t * 0.12;
            starTail.position.set(-1.35, 0.04 + t * 0.1, t * 0.16);
            pegasusGroup.add(starTail);
          }
          addPreset('pegasus', pegasusGroup);

          // 18. EASY-ONLY: Helios Sun-God Sovereign ('helios': 10-Ray Sunburst Crown + Spinning Astrolabe Ring + 4 Mini Suns + Solar Tail)
          const heliosGroup = new THREE.Group();
          const sunCrown = new THREE.Group();
          sunCrown.position.set(-0.08, 0.98, 0);
          const crownRing = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.045, 10, 28), goldMat);
          sunCrown.add(crownRing);
          for (let r = 0; r < 10; r++) {
            const angle = (r / 10) * Math.PI * 2;
            const ray = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.32, 6), r % 2 === 0 ? fireGoldMat : goldMat);
            ray.position.set(Math.cos(angle) * 0.58, Math.sin(angle) * 0.58, 0);
            ray.rotation.z = angle - Math.PI / 2;
            sunCrown.add(ray);
          }
          this.animatedSkinParts.heliosAstrolabe = sunCrown;
          heliosGroup.add(sunCrown);

          for (let t = -1; t <= 1; t++) {
            const solarTail = new THREE.Mesh(new THREE.ConeGeometry(0.15, 1.65, 10), t === 0 ? fireGoldMat : goldMat);
            solarTail.rotation.z = Math.PI / 2 + t * 0.1;
            solarTail.position.set(-1.42, 0.04 + t * 0.09, t * 0.16);
            heliosGroup.add(solarTail);
          }
          addPreset('helios', heliosGroup);

          // 19. HARD-ONLY: Void-Rift Leviathan ('leviathan': Bioluminescent Angler Lure + Abyssal Crest + 4 Writhing Void Tentacles)
          const leviathanGroup = new THREE.Group();
          const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.68, 8), darkMetalMat);
          stalk.position.set(0.38, 0.84, 0);
          stalk.rotation.z = -0.48;
          const lureOrb = new THREE.Mesh(
            new THREE.SphereGeometry(0.14, 14, 14),
            new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
          );
          lureOrb.position.set(0.56, 1.12, 0);
          leviathanGroup.add(stalk, lureOrb);

          this.animatedSkinParts.leviathanTentacles = [];
          const tentacleMat = new THREE.MeshStandardMaterial({ color: 0x4c1d95, emissive: 0x2e1065, roughness: 0.2, metalness: 0.5 });
          for (let k = 0; k < 4; k++) {
            const tentacle = new THREE.Mesh(new THREE.ConeGeometry(0.12, 1.68, 10), tentacleMat);
            tentacle.rotation.z = Math.PI / 2;
            tentacle.position.set(-1.38, (k < 2 ? 0.14 : -0.14), (k % 2 === 0 ? 0.18 : -0.18));
            leviathanGroup.add(tentacle);
            this.animatedSkinParts.leviathanTentacles.push(tentacle);
          }
          addPreset('leviathan', leviathanGroup);

          // 20. HARD-ONLY: Omega Chaos Seraph ('chaos_overlord': 4-Horned Demon-God Crown + Shattered Rift Halo + 6 Orbiting Chaos Swords + Spiked Tail)
          const chaosGroup = new THREE.Group();
          [-1, 1].forEach(side => {
            const greatHorn = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.88, 8), rubyMat);
            greatHorn.position.set(-0.08, 0.88, side * 0.36);
            greatHorn.rotation.z = 0.56;
            greatHorn.rotation.x = side * -0.44;

            const crownHorn = new THREE.Mesh(new THREE.ConeGeometry(0.10, 0.58, 6), goldMat);
            crownHorn.position.set(0.12, 0.84, side * 0.22);
            crownHorn.rotation.z = 0.22;
            crownHorn.rotation.x = side * -0.25;
            chaosGroup.add(greatHorn, crownHorn);
          });

          const chaosChestCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.19, 0), fireGoldMat);
          chaosChestCore.position.set(0.69, -0.18, 0);
          chaosGroup.add(chaosChestCore);

          const chaosHalo = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.055, 8, 24), rubyMat);
          chaosHalo.position.set(-0.08, 1.10, 0);
          const chaosInnerHalo = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.04, 8, 20), goldMat);
          chaosInnerHalo.position.set(-0.08, 1.10, 0);
          this.animatedSkinParts.chaosHalo1 = chaosHalo;
          this.animatedSkinParts.chaosHalo2 = chaosInnerHalo;
          chaosGroup.add(chaosHalo, chaosInnerHalo);

          // 6 Floating 3D Chaos Swords Orbiting the Bird!
          const swordOrbit = new THREE.Group();
          for (let s = 0; s < 6; s++) {
            const angle = (s / 6) * Math.PI * 2;
            const sword = new THREE.Group();
            const blade = new THREE.Mesh(
              new THREE.ConeGeometry(0.075, 0.68, 4),
              s % 2 === 0 ? rubyMat : fireGoldMat
            );
            const crossguard = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.06), goldMat);
            crossguard.position.y = -0.28;
            sword.add(blade, crossguard);
            sword.position.set(Math.cos(angle) * 1.38, 0.1, Math.sin(angle) * 1.38);
            sword.rotation.z = -Math.PI / 4;
            swordOrbit.add(sword);
          }
          this.animatedSkinParts.chaosSwordOrbit = swordOrbit;
          chaosGroup.add(swordOrbit);

          const chaosTailSpear = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), rubyMat);
          chaosTailSpear.scale.set(2.2, 0.7, 0.7);
          chaosTailSpear.position.set(-1.72, 0, 0);
          chaosGroup.add(chaosTailSpear);
          addPreset('chaos_overlord', chaosGroup);

          // 21. MEDIUM-ONLY: Ronin Shogun Warlord ('shogun': Horned Kabuto Samurai Helm + Golden Crescent Kuwagata + Shoulder Sode Armor + Orbiting Sakura Blades)
          const shogunGroup = new THREE.Group();
          const kabutoDome = new THREE.Mesh(new THREE.SphereGeometry(0.56, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.56), darkMetalMat);
          kabutoDome.position.set(0.04, 0.36, 0);
          const shikoroNeckGuard = new THREE.Mesh(
            new THREE.CylinderGeometry(0.56, 0.68, 0.24, 18, 1, true, Math.PI * 0.25, Math.PI * 1.5),
            rubyMat
          );
          shikoroNeckGuard.position.set(-0.08, 0.28, 0);
          const kuwagataCenter = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), rubyMat);
          kuwagataCenter.position.set(0.56, 0.62, 0);
          const crescentHorns = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.048, 8, 22, Math.PI * 1.15), goldMat);
          crescentHorns.rotation.y = Math.PI / 2;
          crescentHorns.rotation.x = -Math.PI * 0.58;
          crescentHorns.position.set(0.46, 0.84, 0);
          shogunGroup.add(kabutoDome, shikoroNeckGuard, kuwagataCenter, crescentHorns);

          [-1, 1].forEach(side => {
            const sodePlate = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.26, 0.10), rubyMat);
            sodePlate.position.set(0.06, 0.16, side * 0.60);
            sodePlate.rotation.x = side * 0.28;
            const sodeGoldTrim = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.05, 0.12), goldMat);
            sodeGoldTrim.position.set(0.06, 0.28, side * 0.60);
            shogunGroup.add(sodePlate, sodeGoldTrim);
          });

          const sakuraOrbit = new THREE.Group();
          const sakuraMat = new THREE.MeshBasicMaterial({ color: 0xf472b6 });
          for (let p = 0; p < 5; p++) {
            const angle = (p / 5) * Math.PI * 2;
            const petalBlade = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), p % 2 === 0 ? sakuraMat : goldMat);
            petalBlade.scale.set(1.6, 0.4, 0.8);
            petalBlade.position.set(Math.cos(angle) * 1.24, 0.12, Math.sin(angle) * 1.24);
            sakuraOrbit.add(petalBlade);
          }
          this.animatedSkinParts.sakuraPetals = sakuraOrbit;
          shogunGroup.add(sakuraOrbit);
          addPreset('shogun', shogunGroup);

          // 22. MEDIUM-ONLY: Tempest Raijin Sovereign ('raijin': Back Ring of 8 Taiko Thunder-Drums + Golden Storm-God Horns + Crackling Plasma Arc)
          const raijinGroup = new THREE.Group();
          const drumRingGroup = new THREE.Group();
          drumRingGroup.position.set(-0.32, 0.36, 0);
          drumRingGroup.rotation.y = Math.PI / 2;
          const drumHoop = new THREE.Mesh(new THREE.TorusGeometry(0.96, 0.032, 8, 32), goldMat);
          drumRingGroup.add(drumHoop);

          const cyanBoltMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
          for (let d = 0; d < 8; d++) {
            const a = (d / 8) * Math.PI * 2;
            const drum = new THREE.Group();
            const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.14, 14), rubyMat);
            barrel.rotation.x = Math.PI / 2;
            const face = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.145, 0.15, 14), boneMat);
            face.rotation.x = Math.PI / 2;
            const tomoeCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0), d % 2 === 0 ? cyanBoltMat : fireGoldMat);
            tomoeCore.position.z = 0.08;
            drum.add(barrel, face, tomoeCore);
            drum.position.set(Math.cos(a) * 0.96, Math.sin(a) * 0.96, 0);
            drumRingGroup.add(drum);
          }
          this.animatedSkinParts.raijinDrums = drumRingGroup;
          raijinGroup.add(drumRingGroup);

          [-1, 1].forEach(side => {
            const stormHorn = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.72, 6), goldMat);
            stormHorn.position.set(0.08, 0.84, side * 0.28);
            stormHorn.rotation.z = 0.32;
            stormHorn.rotation.x = side * -0.35;
            raijinGroup.add(stormHorn);
          });
          addPreset('raijin', raijinGroup);

          // 23. MEDIUM-ONLY: Chronos Time-Weaver ('chronos': 3 Interlocking Clockwork Gear Halos + Hourglass Chest Core + Golden Pendulum Tail)
          const chronosGroup = new THREE.Group();
          const makeClockworkGear = (radius, tube, teethCount, mat) => {
            const g = new THREE.Group();
            const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 28), mat);
            g.add(ring);
            for (let t = 0; t < teethCount; t++) {
              const a = (t / teethCount) * Math.PI * 2;
              const tooth = new THREE.Mesh(new THREE.BoxGeometry(tube * 2.2, tube * 2.6, tube * 1.8), mat);
              tooth.position.set(Math.cos(a) * (radius + tube * 1.1), Math.sin(a) * (radius + tube * 1.1), 0);
              tooth.rotation.z = a;
              g.add(tooth);
            }
            return g;
          };

          const gear1 = makeClockworkGear(0.62, 0.042, 12, goldMat);
          gear1.position.set(-0.04, 1.02, 0);
          gear1.rotation.x = Math.PI / 2 - 0.22;
          const gear2 = makeClockworkGear(0.44, 0.034, 8, cyanBoltMat);
          gear2.position.set(-0.04, 1.02, 0);
          gear2.rotation.x = Math.PI / 2 + 0.28;
          const gear3 = makeClockworkGear(0.84, 0.030, 14, goldMat);
          gear3.position.set(-0.10, 0.22, 0);
          gear3.rotation.y = Math.PI / 2;
          this.animatedSkinParts.chronosGears = [gear1, gear2, gear3];
          chronosGroup.add(gear1, gear2, gear3);

          const hourglassCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), cyanBoltMat);
          hourglassCore.position.set(0.69, -0.18, 0);
          chronosGroup.add(hourglassCore);

          for (let t = -1; t <= 1; t++) {
            const clockHandTail = new THREE.Mesh(new THREE.ConeGeometry(0.13, 1.55, 6), t === 0 ? cyanBoltMat : goldMat);
            clockHandTail.rotation.z = Math.PI / 2 + t * 0.11;
            clockHandTail.position.set(-1.38, 0.04 + t * 0.09, t * 0.15);
            chronosGroup.add(clockHandTail);
          }
          addPreset('chronos', chronosGroup);

          // 24. PINNACLE ANY-MODE (130+): Astral Nebula Overlord ('nebula_god': Swirling 3D Spiral Galaxy Crown + 6 Orbiting Pulsars + Cosmic Nebula Tail)
          const nebulaGodGroup = new THREE.Group();
          const galaxyCrown = new THREE.Group();
          galaxyCrown.position.set(-0.04, 1.12, 0);
          const quasarCore = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 18), fireGoldMat);
          const nebulaDisk1 = new THREE.Mesh(
            new THREE.TorusGeometry(0.56, 0.055, 10, 32),
            new THREE.MeshBasicMaterial({ color: 0xe879f9 })
          );
          nebulaDisk1.rotation.x = Math.PI / 2 - 0.25;
          const nebulaDisk2 = new THREE.Mesh(
            new THREE.TorusGeometry(0.76, 0.038, 10, 36),
            new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
          );
          nebulaDisk2.rotation.x = Math.PI / 2 + 0.20;
          galaxyCrown.add(quasarCore, nebulaDisk1, nebulaDisk2);

          for (let s = 0; s < 8; s++) {
            const a = (s / 8) * Math.PI * 2;
            const star = new THREE.Mesh(
              new THREE.OctahedronGeometry(0.12, 0),
              new THREE.MeshBasicMaterial({ color: s % 2 === 0 ? 0xfef08a : 0x38bdf8 })
            );
            star.position.set(Math.cos(a) * 0.92, Math.sin(a * 2) * 0.14, Math.sin(a) * 0.92);
            galaxyCrown.add(star);
          }
          this.animatedSkinParts.nebulaGalaxy = galaxyCrown;
          nebulaGodGroup.add(galaxyCrown);

          [-1, 1].forEach(side => {
            const cosmicHorn = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.88, 8), goldMat);
            cosmicHorn.position.set(-0.08, 0.86, side * 0.34);
            cosmicHorn.rotation.z = 0.52;
            cosmicHorn.rotation.x = side * -0.40;
            nebulaGodGroup.add(cosmicHorn);
          });

          for (let t = -2; t <= 2; t++) {
            const cometStream = new THREE.Mesh(
              new THREE.ConeGeometry(0.14 - Math.abs(t) * 0.015, 1.88 - Math.abs(t) * 0.12, 10),
              t % 2 === 0 ? cyanBoltMat : new THREE.MeshBasicMaterial({ color: 0xe879f9 })
            );
            cometStream.rotation.z = Math.PI / 2 + t * 0.09;
            cometStream.position.set(-1.52, 0.04 + t * 0.09, t * 0.17);
            nebulaGodGroup.add(cometStream);
          }
          addPreset('nebula_god', nebulaGodGroup);

          // 25. PINNACLE ANY-MODE (175+): Sovereign of Eternity ('eternity_sovereign': 4 Gyroscope Armillary Rings + Sovereign Diamond Crown + 5-Lance Eternity Tail)
          const eternityGroup = new THREE.Group();
          const armillaryGroup = new THREE.Group();
          armillaryGroup.position.set(0.0, 0.18, 0);
          const eRing1 = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.042, 10, 36), goldMat);
          const eRing2 = new THREE.Mesh(new THREE.TorusGeometry(1.26, 0.034, 10, 36), cyanBoltMat);
          eRing2.rotation.x = Math.PI / 3;
          const eRing3 = new THREE.Mesh(new THREE.TorusGeometry(0.96, 0.036, 10, 32), fireGoldMat);
          eRing3.rotation.y = Math.PI / 3;
          armillaryGroup.add(eRing1, eRing2, eRing3);
          this.animatedSkinParts.eternityRings = [eRing1, eRing2, eRing3];
          eternityGroup.add(armillaryGroup);

          const sovCrownBase = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.34, 0.30, 20), goldMat);
          sovCrownBase.position.set(0.04, 0.78, 0);
          const sovDiamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), cyanBoltMat);
          sovDiamond.position.set(0.04, 1.18, 0);
          eternityGroup.add(sovCrownBase, sovDiamond);
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const spire = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.36, 8), i % 2 === 0 ? goldMat : chromeMat);
            spire.position.set(0.04 + Math.cos(a) * 0.34, 1.02, Math.sin(a) * 0.34);
            eternityGroup.add(spire);
          }

          for (let l = -2; l <= 2; l++) {
            const lance = new THREE.Mesh(
              new THREE.ConeGeometry(0.13, 1.92 - Math.abs(l) * 0.12, 8),
              l === 0 ? cyanBoltMat : goldMat
            );
            lance.rotation.z = Math.PI / 2 + l * 0.08;
            lance.position.set(-1.56, 0.04 + l * 0.09, l * 0.18);
            eternityGroup.add(lance);
          }
          addPreset('eternity_sovereign', eternityGroup);

          // 26. PINNACLE HARD-ONLY (75+): Ragnarok World-Ender ('ragnarok': 6-Horned Molten Crown + Supernova Chest Core + 8 Orbiting Flaming Meteors & Blades + World-Ender Tail)
          const ragnarokGroup = new THREE.Group();
          const moltenMat = new THREE.MeshBasicMaterial({ color: 0xff4500 });
          [-1, 1].forEach(side => {
            const mainHorn = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.98, 8), rubyMat);
            mainHorn.position.set(-0.10, 0.92, side * 0.38);
            mainHorn.rotation.z = 0.58;
            mainHorn.rotation.x = side * -0.46;

            const midHorn = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.68, 6), fireGoldMat);
            midHorn.position.set(0.10, 0.88, side * 0.24);
            midHorn.rotation.z = 0.26;
            midHorn.rotation.x = side * -0.28;

            const jawTusk = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.42, 6), goldMat);
            jawTusk.position.set(0.62, -0.08, side * 0.36);
            jawTusk.rotation.z = -0.75;
            ragnarokGroup.add(mainHorn, midHorn, jawTusk);
          });

          const supernovaCore = new THREE.Group();
          supernovaCore.position.set(-0.08, 1.18, 0);
          const ragSun = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 1), fireGoldMat);
          const ragRing1 = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.055, 8, 28), moltenMat);
          ragRing1.rotation.x = Math.PI / 2 - 0.3;
          const ragRing2 = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.042, 8, 24), rubyMat);
          ragRing2.rotation.x = Math.PI / 2 + 0.3;
          supernovaCore.add(ragSun, ragRing1, ragRing2);
          this.animatedSkinParts.ragnarokCore = supernovaCore;
          ragnarokGroup.add(supernovaCore);

          const meteorOrbit = new THREE.Group();
          for (let m = 0; m < 8; m++) {
            const a = (m / 8) * Math.PI * 2;
            const meteor = new THREE.Mesh(
              new THREE.OctahedronGeometry(0.16, 0),
              m % 2 === 0 ? fireGoldMat : moltenMat
            );
            meteor.scale.set(0.7, 1.9, 0.7);
            meteor.position.set(Math.cos(a) * 1.44, (m % 2 === 0 ? 0.22 : -0.22), Math.sin(a) * 1.44);
            meteor.rotation.z = -Math.PI / 5;
            meteorOrbit.add(meteor);
          }
          this.animatedSkinParts.ragnarokMeteors = meteorOrbit;
          ragnarokGroup.add(meteorOrbit);

          for (let s = 0; s < 6; s++) {
            const tailSeg = new THREE.Mesh(new THREE.OctahedronGeometry(0.16 - s * 0.015, 0), s % 2 === 0 ? rubyMat : fireGoldMat);
            tailSeg.position.set(-0.82 - s * 0.26, -0.02 + Math.sin(s) * 0.05, 0);
            ragnarokGroup.add(tailSeg);
          }
          const worldEnderHalberd = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.72, 4), fireGoldMat);
          worldEnderHalberd.rotation.z = Math.PI / 2;
          worldEnderHalberd.position.set(-2.35, 0, 0);
          ragnarokGroup.add(worldEnderHalberd);
          addPreset('ragnarok', ragnarokGroup);

          // ========================================================================
          // 3 ORIGINAL EASY-MODE ENDGAME 3D MODELS (SCORE 100, 125, 150)
          // ========================================================================

          // 25. EASY-ONLY (100): Nautilus Tide-Weaver ('nautilus_leviathan': Spiral Pearlescent Nautilus Shell + Dual Hydro-Vortex Turbines + Trident Crest)
          const nautilusGroup = new THREE.Group();
          const pearlShellMat = new THREE.MeshStandardMaterial({ color: 0xfdf2f8, emissive: 0x0284c7, emissiveIntensity: 0.25, metalness: 0.55, roughness: 0.15 });
          const aquaGlowMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
          const coralPinkMat = new THREE.MeshStandardMaterial({ color: 0xf43f5e, emissive: 0xbe123c, emissiveIntensity: 0.35, roughness: 0.2 });

          // Golden Poseidon Trident Brow Crest
          for (let p = -1; p <= 1; p++) {
            const prong = new THREE.Mesh(new THREE.ConeGeometry(0.055, p === 0 ? 0.52 : 0.38, 6), goldMat);
            prong.position.set(0.32, 0.76 + (p === 0 ? 0.08 : 0), p * 0.16);
            prong.rotation.z = -0.25;
            prong.rotation.x = p * 0.22;
            nautilusGroup.add(prong);
          }
          // Coiled Fibonacci Nautilus Shell on Back
          const shellGroup = new THREE.Group();
          shellGroup.position.set(-0.28, 0.38, 0);
          for (let c = 0; c < 10; c++) {
            const t = c * 0.55;
            const r = 0.08 + c * 0.042;
            const chamber = new THREE.Mesh(
              new THREE.SphereGeometry(0.11 + c * 0.022, 12, 10),
              c % 2 === 0 ? pearlShellMat : coralPinkMat
            );
            chamber.position.set(Math.cos(t) * r, Math.sin(t) * r, 0);
            chamber.scale.set(1.1, 1.1, 1.35);
            shellGroup.add(chamber);
          }
          const shellAperture = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.05, 10, 24), goldMat);
          shellAperture.rotation.y = Math.PI / 2;
          shellAperture.position.set(0.12, 0.05, 0);
          shellGroup.add(shellAperture);
          nautilusGroup.add(shellGroup);

          // Dual Rotating Hydro-Vortex Water Turbines on flanks
          const nautilusTurbines = [];
          [-1, 1].forEach(side => {
            const turb = new THREE.Group();
            turb.position.set(-0.18, 0.02, side * 0.64);
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.032, 8, 20), goldMat);
            const vortex = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), aquaGlowMat);
            turb.add(ring, vortex);
            for (let b = 0; b < 4; b++) {
              const ba = (b / 4) * Math.PI * 2;
              const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), aquaGlowMat);
              bubble.position.set(Math.cos(ba) * 0.28, Math.sin(ba) * 0.28, 0);
              turb.add(bubble);
            }
            nautilusTurbines.push(turb);
            nautilusGroup.add(turb);
          });
          this.animatedSkinParts.nautilusTurbines = nautilusTurbines;

          // Sea-Serpent Tail Fin
          const seaTail = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.85, 5), aquaGlowMat);
          seaTail.rotation.z = Math.PI / 2;
          seaTail.position.set(-1.15, 0.05, 0);
          nautilusGroup.add(seaTail);
          addPreset('nautilus_leviathan', nautilusGroup);

          // 26. EASY-ONLY (125): Aurora Glass Monarch ('dreamcatcher_monarch': Woven Golden Dreamcatcher + Lunar Antennae + Floating Prism Crown)
          const monarchGroup = new THREE.Group();
          const prismCyanMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
          const prismPinkMat = new THREE.MeshBasicMaterial({ color: 0xf472b6 });
          const prismMintMat = new THREE.MeshBasicMaterial({ color: 0x34d399 });

          // Curled Bioluminescent Butterfly Antennae
          [-1, 1].forEach(side => {
            const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.035, 0.72, 8), goldMat);
            stalk.position.set(0.32, 0.86, side * 0.22);
            stalk.rotation.z = -0.42;
            stalk.rotation.x = side * 0.35;
            const tipOrb = new THREE.Mesh(new THREE.OctahedronGeometry(0.11, 0), side < 0 ? prismCyanMat : prismPinkMat);
            tipOrb.position.set(0.48, 1.18, side * 0.36);
            monarchGroup.add(stalk, tipOrb);
          });

          // Woven 3D Sacred-Geometry Dreamcatcher Hoop behind back
          const dreamcatcherWeb = new THREE.Group();
          dreamcatcherWeb.position.set(-0.35, 0.45, 0);
          dreamcatcherWeb.rotation.y = Math.PI / 2;
          const dcOuterRing = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.042, 10, 32), goldMat);
          const dcInnerRing = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.024, 8, 24), prismCyanMat);
          const dcCenterGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), prismPinkMat);
          dreamcatcherWeb.add(dcOuterRing, dcInnerRing, dcCenterGem);
          for (let w = 0; w < 8; w++) {
            const wa = (w / 8) * Math.PI * 2;
            const thread = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.32, 6), goldMat);
            thread.rotation.z = wa;
            dreamcatcherWeb.add(thread);
          }
          // 3 Dangling Crystal Feathers below Dreamcatcher
          [-0.36, 0, 0.36].forEach((offsetX, idx) => {
            const feather = new THREE.Mesh(
              new THREE.OctahedronGeometry(0.14, 0),
              idx === 0 ? prismCyanMat : (idx === 1 ? prismPinkMat : prismMintMat)
            );
            feather.scale.set(0.65, 2.2, 0.35);
            feather.position.set(offsetX, -0.88 - (idx === 1 ? 0.14 : 0), 0);
            dreamcatcherWeb.add(feather);
          });
          this.animatedSkinParts.dreamcatcherWeb = dreamcatcherWeb;
          monarchGroup.add(dreamcatcherWeb);
          addPreset('dreamcatcher_monarch', monarchGroup);

          // 27. EASY-ONLY (150): Celestial Bonsai World-Turtle ('bonsai_island': Floating Sakura Bonsai Sanctuary + Torii Gate + Waterfall Tail + 6 Lotus Lanterns)
          const bonsaiGroup = new THREE.Group();
          const mossIslandMat = new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x065f46, roughness: 0.4, metalness: 0.2 });
          const stoneCliffMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.7, metalness: 0.2, flatShading: true });
          const woodTrunkMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.65, metalness: 0.15 });
          const sakuraCanopyMat = new THREE.MeshStandardMaterial({ color: 0xf472b6, emissive: 0xdb2777, emissiveIntensity: 0.45, roughness: 0.25 });
          const toriiRedMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0x991b1b, roughness: 0.2, metalness: 0.3 });

          // Floating Sanctuary Island Base on Back
          const cliffBase = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.55, 7), stoneCliffMat);
          cliffBase.rotation.x = Math.PI;
          cliffBase.position.set(-0.08, 0.48, 0);
          const mossTop = new THREE.Mesh(new THREE.CylinderGeometry(0.64, 0.58, 0.16, 12), mossIslandMat);
          mossTop.position.set(-0.08, 0.78, 0);
          bonsaiGroup.add(cliffBase, mossTop);

          // Miniature Golden & Vermilion Torii Gate on Front of Island
          [-0.22, 0.22].forEach(zPos => {
            const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.44, 8), toriiRedMat);
            pillar.position.set(0.24, 1.02, zPos);
            bonsaiGroup.add(pillar);
          });
          const kasagiTop = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.06, 0.66), goldMat);
          kasagiTop.position.set(0.24, 1.25, 0);
          const nukiBeam = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.54), toriiRedMat);
          nukiBeam.position.set(0.24, 1.14, 0);
          bonsaiGroup.add(kasagiTop, nukiBeam);

          // Sculpted Ancient Bonsai Tree + Pink Cherry Blossom Canopy
          const trunk1 = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 0.55, 8), woodTrunkMat);
          trunk1.position.set(-0.22, 1.05, 0);
          trunk1.rotation.z = 0.28;
          const trunk2 = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.07, 0.42, 7), woodTrunkMat);
          trunk2.position.set(-0.36, 1.32, 0.08);
          trunk2.rotation.z = -0.35;
          bonsaiGroup.add(trunk1, trunk2);

          [
            [-0.22, 1.42, 0, 0.34],
            [-0.45, 1.52, 0.14, 0.28],
            [-0.08, 1.50, -0.16, 0.26],
            [-0.32, 1.62, -0.05, 0.24]
          ].forEach(([cx, cy, cz, cr]) => {
            const blossomCluster = new THREE.Mesh(new THREE.DodecahedronGeometry(cr, 0), sakuraCanopyMat);
            blossomCluster.scale.set(1.25, 0.72, 1.15);
            blossomCluster.position.set(cx, cy, cz);
            bonsaiGroup.add(blossomCluster);
          });

          // Cascading Glowing Crystal Waterfall Tail
          const edenWaterfall = new THREE.Group();
          for (let w = 0; w < 5; w++) {
            const stream = new THREE.Mesh(
              new THREE.BoxGeometry(0.28, 0.08, 0.34 - w * 0.04),
              w % 2 === 0 ? aquaGlowMat : prismMintMat
            );
            stream.position.set(-0.68 - w * 0.22, 0.72 - w * 0.18, 0);
            stream.rotation.z = 0.62;
            edenWaterfall.add(stream);
          }
          this.animatedSkinParts.edenWaterfall = edenWaterfall;
          bonsaiGroup.add(edenWaterfall);

          // 6 Orbiting Golden Lotus Lanterns
          const edenLanterns = new THREE.Group();
          for (let l = 0; l < 6; l++) {
            const la = (l / 6) * Math.PI * 2;
            const lantern = new THREE.Group();
            const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), fireGoldMat);
            const roof = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.10, 6), goldMat);
            roof.position.y = 0.10;
            lantern.add(core, roof);
            lantern.position.set(Math.cos(la) * 1.38, 0.22 + (l % 2) * 0.25, Math.sin(la) * 1.38);
            edenLanterns.add(lantern);
          }
          this.animatedSkinParts.edenLanterns = edenLanterns;
          bonsaiGroup.add(edenLanterns);
          addPreset('bonsai_island', bonsaiGroup);

          // ========================================================================
          // 10 TROLL / MEME QUEST 3D MODELS
          // ========================================================================

          // T1. The 6-7 Mason Legend ('troll_67': Fluffy Ice-Cream Hair + Shutter Shades + Orbiting 3D "6" and "7")
          const troll67Group = new THREE.Group();
          const hairBlondeMat = new THREE.MeshStandardMaterial({ color: 0xfef08a, roughness: 0.45 });
          // Fluffy Ice-Cream Scoop Hair on forehead
          for (let h = 0; h < 5; h++) {
            const puff = new THREE.Mesh(new THREE.SphereGeometry(0.22 - h * 0.015, 12, 12), hairBlondeMat);
            puff.position.set(0.28 - h * 0.08, 0.72 + (h % 2) * 0.08, (h - 2) * 0.14);
            troll67Group.add(puff);
          }
          // Neon Cyan Shutter Shades
          const shadesBar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.92), aquaGlowMat);
          shadesBar.position.set(0.55, 0.24, 0);
          troll67Group.add(shadesBar);

          // Orbiting 3D "6" and "7" Numbers
          const troll67Orbit = new THREE.Group();
          // Sculpted "6" (Torus loop + top stem)
          const num6 = new THREE.Group();
          const loop6 = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.055, 8, 18), fireGoldMat);
          const stem6 = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.34, 8), fireGoldMat);
          stem6.position.set(-0.11, 0.16, 0);
          stem6.rotation.z = -0.35;
          num6.add(loop6, stem6);
          num6.position.set(0, 0.25, 1.25);

          // Sculpted "7" (Top bar + diagonal stem)
          const num7 = new THREE.Group();
          const top7 = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.11, 0.11), aquaGlowMat);
          top7.position.set(0, 0.22, 0);
          const diag7 = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.46, 8), aquaGlowMat);
          diag7.rotation.z = -0.38;
          num7.add(top7, diag7);
          num7.position.set(0, 0.25, -1.25);

          troll67Orbit.add(num6, num7);
          this.animatedSkinParts.troll67Orbit = troll67Orbit;
          troll67Group.add(troll67Orbit);
          addPreset('troll_67', troll67Group);

          // T2. 9 + 10 = 21 Kid ('troll_21': Spinning Rainbow Propeller Beanie + 3D Chalkboard Back Sign)
          const troll21Group = new THREE.Group();
          const beanieDome = new THREE.Mesh(
            new THREE.SphereGeometry(0.48, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
            new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.3 })
          );
          beanieDome.position.set(0.04, 0.44, 0);
          const propPin = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.24, 8), goldMat);
          propPin.position.set(0.04, 0.96, 0);
          const propBlades = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.035, 0.12), fireGoldMat);
          propBlades.position.set(0.04, 1.08, 0);
          this.animatedSkinParts.troll21Propeller = propBlades;
          troll21Group.add(beanieDome, propPin, propBlades);

          // Floating 3D Chalkboard on Back
          const boardFrame = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.68, 0.96), woodTrunkMat);
          boardFrame.position.set(-0.68, 0.35, 0);
          const boardGreen = new THREE.Mesh(
            new THREE.BoxGeometry(0.14, 0.56, 0.84),
            new THREE.MeshStandardMaterial({ color: 0x064e3b, roughness: 0.7 })
          );
          boardGreen.position.set(-0.68, 0.35, 0);
          troll21Group.add(boardFrame, boardGreen);
          addPreset('troll_21', troll21Group);

          // T3. Wall Inspector 0-Pipe ('troll_wall_bonk': Crash Helmet + Giant Red Head Bump + 5 Spinning Dizzy Stars)
          const bonkGroup = new THREE.Group();
          const bumpRedMat = new THREE.MeshStandardMaterial({ color: 0xf43f5e, emissive: 0xbe123c, roughness: 0.25 });
          const headBump = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.48, 12), bumpRedMat);
          headBump.position.set(0.12, 0.88, 0);
          headBump.rotation.z = -0.18;
          const bumpTop = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), bumpRedMat);
          bumpTop.position.set(0.16, 1.10, 0);
          bonkGroup.add(headBump, bumpTop);

          const bonkStars = new THREE.Group();
          bonkStars.position.set(0.12, 1.18, 0);
          for (let s = 0; s < 5; s++) {
            const sa = (s / 5) * Math.PI * 2;
            const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), fireGoldMat);
            star.position.set(Math.cos(sa) * 0.58, 0, Math.sin(sa) * 0.58);
            bonkStars.add(star);
          }
          this.animatedSkinParts.trollBonkStars = bonkStars;
          bonkGroup.add(bonkStars);
          addPreset('troll_wall_bonk', bonkGroup);

          // T4. 7-7-7 Vegas Jackpot ('troll_jackpot': 3D Slot Machine Backpack + Pull Lever + Spinning Reels + Coin Crown)
          const jackpotGroup = new THREE.Group();
          const slotBox = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.78, 0.72), rubyMat);
          slotBox.position.set(-0.52, 0.22, 0);
          const slotTrim = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.82, 0.76), goldMat);
          slotTrim.scale.set(0.92, 1.02, 1.02);
          slotTrim.position.set(-0.54, 0.22, 0);
          const leverRod = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.58, 8), chromeMat);
          leverRod.position.set(-0.52, 0.45, 0.46);
          leverRod.rotation.z = -0.35;
          const leverBall = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), rubyMat);
          leverBall.position.set(-0.42, 0.72, 0.46);
          jackpotGroup.add(slotBox, slotTrim, leverRod, leverBall);

          const slotReels = new THREE.Group();
          slotReels.position.set(-0.52, 0.68, 0);
          for (let r = -1; r <= 1; r++) {
            const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.16, 12), fireGoldMat);
            reel.rotation.x = Math.PI / 2;
            reel.position.z = r * 0.20;
            slotReels.add(reel);
          }
          this.animatedSkinParts.trollSlotReels = slotReels;
          jackpotGroup.add(slotReels);
          addPreset('troll_jackpot', jackpotGroup);

          // T5. 360 No-Scope MLG 69 ('troll_mlg': Pixel Deal-With-It Shades + Spinning Red Crosshair Halo + Dual Airhorns)
          const mlgGroup = new THREE.Group();
          const pixelBlackMat = new THREE.MeshBasicMaterial({ color: 0x09090b });
          const pixelWhiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
          const shadesBridge = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.10, 0.98), pixelBlackMat);
          shadesBridge.position.set(0.58, 0.28, 0);
          mlgGroup.add(shadesBridge);
          [-1, 1].forEach(side => {
            const lens = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.34), pixelBlackMat);
            lens.position.set(0.58, 0.20, side * 0.26);
            const glint = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.06, 0.12), pixelWhiteMat);
            glint.position.set(0.59, 0.23, side * 0.22);
            const airhorn = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.62, 12, 1, true), rubyMat);
            airhorn.position.set(-0.15, 0.45, side * 0.62);
            airhorn.rotation.z = -Math.PI / 2 + 0.35;
            mlgGroup.add(lens, glint, airhorn);
          });

          const crosshairHalo = new THREE.Group();
          crosshairHalo.position.set(0, 1.08, 0);
          const chRing = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.038, 8, 24), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
          chRing.rotation.x = Math.PI / 2;
          const chBar1 = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.035, 0.035), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
          const chBar2 = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 1.12), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
          crosshairHalo.add(chRing, chBar1, chBar2);
          this.animatedSkinParts.trollMlgCrosshair = crosshairHalo;
          mlgGroup.add(crosshairHalo);
          addPreset('troll_mlg', mlgGroup);

          // T6. AFK Gravity Stone ('troll_sleepy': Droopy Nightcap + Pom-Pom + Floating Zzz Sleep Bubbles)
          const sleepyGroup = new THREE.Group();
          const nightcapMat = new THREE.MeshStandardMaterial({ color: 0x6366f1, roughness: 0.4 });
          const capCone = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.92, 14), nightcapMat);
          capCone.position.set(-0.18, 0.88, 0);
          capCone.rotation.z = 0.78;
          const pomPom = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), pixelWhiteMat);
          pomPom.position.set(-0.56, 1.14, 0);
          sleepyGroup.add(capCone, pomPom);

          const sleepBubbles = new THREE.Group();
          for (let b = 0; b < 4; b++) {
            const bub = new THREE.Mesh(
              new THREE.SphereGeometry(0.08 + b * 0.035, 10, 10),
              new THREE.MeshBasicMaterial({ color: 0xe0e7ff, transparent: true, opacity: 0.85 })
            );
            bub.position.set(0.35 + b * 0.18, 0.75 + b * 0.26, 0.25);
            sleepBubbles.add(bub);
          }
          this.animatedSkinParts.trollSleepBubbles = sleepBubbles;
          sleepyGroup.add(sleepBubbles);
          addPreset('troll_sleepy', sleepyGroup);

          // T7. Carpal Tunnel Masher ('troll_caffeine': Giant Espresso Coffee Mug Jetpack + Vibrating Bug Eyes)
          const caffeineGroup = new THREE.Group();
          const mugWhiteMat = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.2, metalness: 0.1 });
          const coffeeDarkMat = new THREE.MeshBasicMaterial({ color: 0x451a03 });
          const mugBody = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.32, 0.68, 16), mugWhiteMat);
          mugBody.position.set(-0.62, 0.22, 0);
          mugBody.rotation.z = 0.25;
          const mugLiquid = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.05, 14), coffeeDarkMat);
          mugLiquid.position.set(-0.54, 0.54, 0);
          mugLiquid.rotation.z = 0.25;
          const mugHandle = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.045, 8, 16), mugWhiteMat);
          mugHandle.position.set(-0.88, 0.22, 0);
          caffeineGroup.add(mugBody, mugLiquid, mugHandle);

          // Oversized Caffeinated Bug Eyes
          [-1, 1].forEach(side => {
            const bugEye = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 12), pixelWhiteMat);
            bugEye.position.set(0.45, 0.26, side * 0.36);
            const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
            pupil.position.set(0.62, 0.26, side * 0.40);
            caffeineGroup.add(bugEye, pupil);
          });

          const coffeeSteam = new THREE.Group();
          coffeeSteam.position.set(-0.55, 0.72, 0);
          for (let s = 0; s < 4; s++) {
            const puff = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), fireGoldMat);
            puff.position.set((s - 1.5) * 0.12, s * 0.18, 0);
            coffeeSteam.add(puff);
          }
          this.animatedSkinParts.trollCoffeeSteam = coffeeSteam;
          caffeineGroup.add(coffeeSteam);
          addPreset('troll_caffeine', caffeineGroup);

          // T8. "Umm Actually" Fibonacci ('troll_nerd': Thick Taped Glasses + Buck Teeth + Bow Tie + Golden Ratio Spiral)
          const nerdGroup = new THREE.Group();
          [-1, 1].forEach(side => {
            const rim = new THREE.Mesh(new THREE.TorusGeometry(0.20, 0.042, 8, 18), pixelBlackMat);
            rim.rotation.y = Math.PI / 2;
            rim.position.set(0.56, 0.24, side * 0.28);
            nerdGroup.add(rim);
          });
          const tapeBridge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.10, 0.18), pixelWhiteMat);
          tapeBridge.position.set(0.58, 0.26, 0);
          // Giant Buck Teeth under Beak
          const buckTeeth = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.24, 0.28), pixelWhiteMat);
          buckTeeth.position.set(0.68, -0.18, 0);
          // Red Bow Tie on Chest
          const bowTie = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), rubyMat);
          bowTie.scale.set(0.6, 0.8, 1.8);
          bowTie.position.set(0.52, -0.42, 0);
          nerdGroup.add(tapeBridge, buckTeeth, bowTie);

          const nerdSpiral = new THREE.Group();
          nerdSpiral.position.set(-0.48, 0.35, 0);
          for (let f = 0; f < 7; f++) {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12 + f * 0.055, 0.025, 6, 18), fireGoldMat);
            ring.position.set(Math.cos(f) * 0.12, Math.sin(f) * 0.12, 0);
            nerdSpiral.add(ring);
          }
          this.animatedSkinParts.trollNerdSpiral = nerdSpiral;
          nerdGroup.add(nerdSpiral);
          addPreset('troll_nerd', nerdGroup);

          // T9. Certified Choke Artist ('troll_clown': Rainbow Afro Clown Wig + Giant Red Clown Nose + Ruffled Collar)
          const clownGroup = new THREE.Group();
          const wigColors = [0xef4444, 0xf97316, 0xfacc15, 0x22c55e, 0x38bdf8, 0xa855f7, 0xec4899];
          wigColors.forEach((col, idx) => {
            const wa = (idx / wigColors.length) * Math.PI * 2;
            const puff = new THREE.Mesh(
              new THREE.SphereGeometry(0.28, 12, 12),
              new THREE.MeshStandardMaterial({ color: col, roughness: 0.35 })
            );
            puff.position.set(-0.05 + Math.cos(wa) * 0.32, 0.68 + (idx % 2) * 0.12, Math.sin(wa) * 0.36);
            clownGroup.add(puff);
          });
          // Giant Shiny Red Honking Clown Nose on Beak Tip
          const clownNose = new THREE.Mesh(
            new THREE.SphereGeometry(0.22, 16, 16),
            new THREE.MeshStandardMaterial({ color: 0xff0033, emissive: 0x990011, roughness: 0.08, metalness: 0.3 })
          );
          clownNose.position.set(1.05, 0.08, 0);
          const clownCollar = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.11, 10, 20), pixelWhiteMat);
          clownCollar.rotation.x = Math.PI / 2;
          clownCollar.position.set(0.05, -0.38, 0);
          clownGroup.add(clownNose, clownCollar);

          const clownTail = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), fireGoldMat);
          clownTail.position.set(-0.92, 0.05, 0);
          this.animatedSkinParts.trollClownTail = clownTail;
          clownGroup.add(clownTail);
          addPreset('troll_clown', clownGroup);

          // T10. Mr. Worldwide Speedrunner ('troll_traffic': 3-Color Traffic Light Tower on Head + Spinning Roundabout Tail)
          const trafficGroup = new THREE.Group();
          const trafficBox = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.86, 0.32), hornDarkMat);
          trafficBox.position.set(0.05, 1.02, 0);
          const redLens = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 10), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
          redLens.position.set(0.18, 1.26, 0);
          const yellowLens = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 10), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
          yellowLens.position.set(0.18, 1.02, 0);
          const greenLens = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 10), new THREE.MeshBasicMaterial({ color: 0x22c55e }));
          greenLens.position.set(0.18, 0.78, 0);
          const trafficTower = new THREE.Group();
          trafficTower.add(trafficBox, redLens, yellowLens, greenLens);
          this.animatedSkinParts.trollTrafficTower = trafficTower;
          trafficGroup.add(trafficTower);
          addPreset('troll_traffic', trafficGroup);

// ====================================================================
          // 10 BESPOKE 3D TRUE CHARACTER POKÉMON MODELS (NOT BIRDS!)
          // ====================================================================

          // P1. Pikachu ('poke_pikachu': Chubby Pear Mouse Body + Black-Tipped Ears + Red Cheek Pouches + Brown Back Stripes + 3D Jagged Lightning Tail)
          const pikachuGroup = new THREE.Group();
          const pikaYellow = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.28, metalness: 0.12 });
          const pikaBrown = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.42 });
          const pikaRedCheek = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xdc2626, emissiveIntensity: 0.65, roughness: 0.2 });
          const pikaEyeBlack = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.05 });
          const pikaEyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.02 });

          const pikaBodyGeo = new THREE.SphereGeometry(0.70, 24, 24);
          pikaBodyGeo.scale(0.96, 1.06, 0.88);
          const pikaBody = new THREE.Mesh(pikaBodyGeo, pikaYellow);
          pikaBody.position.set(-0.06, -0.06, 0);
          pikaBody.castShadow = true;
          pikachuGroup.add(pikaBody);

          const pikaHeadGeo = new THREE.SphereGeometry(0.56, 24, 24);
          pikaHeadGeo.scale(1.04, 0.96, 0.92);
          const pikaHead = new THREE.Mesh(pikaHeadGeo, pikaYellow);
          pikaHead.position.set(0.26, 0.36, 0);
          pikaHead.castShadow = true;
          pikachuGroup.add(pikaHead);

          const pikaArms = new THREE.Group();
          pikaArms.position.set(0.24, 0.08, 0);
          [-1, 1].forEach(side => {
            const armGeo = new THREE.CylinderGeometry(0.09, 0.12, 0.32, 10);
            armGeo.rotateZ(Math.PI / 3);
            const arm = new THREE.Mesh(armGeo, pikaYellow);
            arm.position.set(0.12, -0.02, side * 0.36);
            arm.rotation.y = side * 0.35;
            pikaArms.add(arm);

            const footGeo = new THREE.SphereGeometry(0.14, 12, 12);
            footGeo.scale(1.4, 0.6, 0.85);
            const foot = new THREE.Mesh(footGeo, pikaYellow);
            foot.position.set(0.04, -0.66, side * 0.32);
            pikachuGroup.add(foot);

            const earGroup = new THREE.Group();
            earGroup.position.set(0.22, 0.82, side * 0.28);
            earGroup.rotation.x = side * 0.42;
            earGroup.rotation.z = -0.22;

            const earBase = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.44, 12), pikaYellow);
            earBase.position.y = 0.22;
            const earTip = new THREE.Mesh(new THREE.ConeGeometry(0.095, 0.28, 12), pixelBlackMat);
            earTip.position.y = 0.50;
            earGroup.add(earBase, earTip);
            pikachuGroup.add(earGroup);

            const cheekGeo = new THREE.SphereGeometry(0.17, 14, 14);
            cheekGeo.scale(0.45, 1.0, 1.0);
            const cheek = new THREE.Mesh(cheekGeo, pikaRedCheek);
            cheek.position.set(0.55, 0.28, side * 0.44);
            pikachuGroup.add(cheek);

            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 14), pikaEyeBlack);
            eye.position.set(0.66, 0.46, side * 0.34);
            const eyeGlint = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), pikaEyeWhite);
            eyeGlint.position.set(0.74, 0.50, side * 0.34 + 0.02);
            pikachuGroup.add(eye, eyeGlint);
          });
          this.animatedSkinParts.pikachuArms = pikaArms;
          pikachuGroup.add(pikaArms);

          const pikaNose = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 8), pixelBlackMat);
          pikaNose.position.set(0.79, 0.40, 0);
          const pikaSmile = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.022, 6, 12, Math.PI * 0.9), pixelBlackMat);
          pikaSmile.position.set(0.74, 0.30, 0);
          pikaSmile.rotation.y = Math.PI / 2;
          pikaSmile.rotation.z = Math.PI;
          pikachuGroup.add(pikaNose, pikaSmile);

          [-0.04, 0.16].forEach(yPos => {
            const stripeGeo = new THREE.TorusGeometry(0.60, 0.045, 6, 18, Math.PI * 0.75);
            const stripe = new THREE.Mesh(stripeGeo, pikaBrown);
            stripe.position.set(-0.16, yPos, 0);
            stripe.rotation.y = Math.PI / 2;
            stripe.rotation.x = -Math.PI / 8;
            pikachuGroup.add(stripe);
          });

          const pikaTail = new THREE.Group();
          pikaTail.position.set(-0.65, -0.05, 0);
          const tailBase = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.10, 0.06), pikaBrown);
          tailBase.position.set(-0.12, 0.05, 0);
          tailBase.rotation.z = 0.55;
          const seg1 = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.13, 0.06), pikaYellow);
          seg1.position.set(-0.25, 0.22, 0);
          seg1.rotation.z = -0.55;
          const seg2 = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.06), pikaYellow);
          seg2.position.set(-0.40, 0.40, 0);
          seg2.rotation.z = 0.58;
          const seg3 = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.28, 0.06), pikaYellow);
          seg3.position.set(-0.60, 0.68, 0);
          seg3.rotation.z = -0.42;
          pikaTail.add(tailBase, seg1, seg2, seg3);
          this.animatedSkinParts.pikachuTail = pikaTail;
          pikachuGroup.add(pikaTail);
          addPreset('poke_pikachu', pikachuGroup);

          // P2. Charmander ('poke_charmander': Bipedal Orange Lizard + Cream Belly + Teal Eyes + 3D Flickering Roaring Tail Flame)
          const charGroup = new THREE.Group();
          const charOrange = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.28, metalness: 0.12 });
          const charCream = new THREE.MeshStandardMaterial({ color: 0xfef08a, roughness: 0.32 });
          const charTealEye = new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.08 });
          const charFlameCore = new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xfacc15, emissiveIntensity: 1.2 });
          const charFlameMid = new THREE.MeshStandardMaterial({ color: 0xf97316, emissive: 0xea580c, emissiveIntensity: 0.85 });
          const charFlameOuter = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xdc2626, emissiveIntensity: 0.75, transparent: true, opacity: 0.85 });

          const charBodyGeo = new THREE.SphereGeometry(0.68, 24, 24);
          charBodyGeo.scale(0.94, 1.08, 0.86);
          const charBody = new THREE.Mesh(charBodyGeo, charOrange);
          charBody.position.set(-0.06, -0.06, 0);
          charBody.castShadow = true;
          charGroup.add(charBody);

          const charBellyGeo = new THREE.SphereGeometry(0.58, 20, 20);
          charBellyGeo.scale(0.85, 0.98, 0.74);
          const charBelly = new THREE.Mesh(charBellyGeo, charCream);
          charBelly.position.set(0.12, -0.10, 0);
          charGroup.add(charBelly);

          const charHeadGeo = new THREE.SphereGeometry(0.54, 22, 22);
          charHeadGeo.scale(1.12, 0.94, 0.88);
          const charHead = new THREE.Mesh(charHeadGeo, charOrange);
          charHead.position.set(0.28, 0.34, 0);
          charHead.castShadow = true;
          charGroup.add(charHead);

          const charArms = new THREE.Group();
          charArms.position.set(0.26, 0.06, 0);
          [-1, 1].forEach(side => {
            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.125, 14, 14), charTealEye);
            eye.position.set(0.64, 0.44, side * 0.35);
            const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), pixelBlackMat);
            pupil.position.set(0.72, 0.44, side * 0.35);
            const glint = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), pixelWhiteMat);
            glint.position.set(0.74, 0.48, side * 0.35 + 0.02);
            charGroup.add(eye, pupil, glint);

            const armGeo = new THREE.CylinderGeometry(0.08, 0.11, 0.32, 8);
            armGeo.rotateZ(Math.PI / 3);
            const arm = new THREE.Mesh(armGeo, charOrange);
            arm.position.set(0.06, -0.02, side * 0.36);
            arm.rotation.y = side * 0.3;
            charArms.add(arm);

            const footGeo = new THREE.SphereGeometry(0.14, 10, 10);
            footGeo.scale(1.3, 0.55, 0.85);
            const foot = new THREE.Mesh(footGeo, charOrange);
            foot.position.set(0.02, -0.65, side * 0.32);
            charGroup.add(foot);
          });
          this.animatedSkinParts.charmanderArms = charArms;
          charGroup.add(charArms);

          const charSmile = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.024, 6, 12, Math.PI * 0.8), pixelBlackMat);
          charSmile.position.set(0.76, 0.28, 0);
          charSmile.rotation.y = Math.PI / 2;
          charSmile.rotation.z = Math.PI;
          const charFangL = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.07, 6), pixelWhiteMat);
          charFangL.position.set(0.78, 0.28, 0.07);
          charFangL.rotation.z = Math.PI;
          const charFangR = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.07, 6), pixelWhiteMat);
          charFangR.position.set(0.78, 0.28, -0.07);
          charFangR.rotation.z = Math.PI;
          charGroup.add(charSmile, charFangL, charFangR);

          const charTail = new THREE.Group();
          charTail.position.set(-0.64, -0.10, 0);
          const charTailGeo = new THREE.CylinderGeometry(0.12, 0.26, 0.78, 12);
          charTailGeo.rotateZ(Math.PI / 2.8);
          const charTailMesh = new THREE.Mesh(charTailGeo, charOrange);
          charTailMesh.position.set(-0.30, 0.16, 0);
          charTail.add(charTailMesh);

          const flameTip = new THREE.Group();
          flameTip.position.set(-0.65, 0.40, 0);
          const flameCore = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.36, 10), charFlameCore);
          flameCore.rotation.z = -0.45;
          const flameMid = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.48, 10), charFlameMid);
          flameMid.rotation.z = -0.45;
          const flameOuter = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.58, 10), charFlameOuter);
          flameOuter.rotation.z = -0.45;
          flameTip.add(flameOuter, flameMid, flameCore);
          charTail.add(flameTip);
          this.animatedSkinParts.charmanderFlame = flameTip;
          this.animatedSkinParts.charmanderTail = charTail;
          charGroup.add(charTail);
          addPreset('poke_charmander', charGroup);

          // P3. Squirtle ('poke_squirtle': Tiny Turtle Carapace Shell + Cream Rim + Yellow Plastron + Squirtle-Squad Sunglasses + Hind Feet + Curled Wave Tail)
          const squirtleGroup = new THREE.Group();
          const squirBlue = new THREE.MeshStandardMaterial({ color: 0x7dd3fc, roughness: 0.28, metalness: 0.15 });
          const squirShellBrown = new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.45 });
          const squirShellRim = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.35 });
          const squirBellyYellow = new THREE.MeshStandardMaterial({ color: 0xfde047, roughness: 0.32 });
          const squirEye = new THREE.MeshStandardMaterial({ color: 0x881337, roughness: 0.1 });
          const squadGlassMat = new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.08, metalness: 0.92 });

          const squirShellGroup = new THREE.Group();
          squirShellGroup.position.set(-0.24, 0.02, 0);
          const squirDomeGeo = new THREE.SphereGeometry(0.65, 20, 20);
          squirDomeGeo.scale(0.85, 1.15, 0.65);
          const squirDome = new THREE.Mesh(squirDomeGeo, squirShellBrown);
          squirDome.rotation.y = Math.PI / 2;
          squirDome.rotation.x = 0.25;

          const squirRimGeo = new THREE.TorusGeometry(0.68, 0.085, 10, 24);
          const squirRim = new THREE.Mesh(squirRimGeo, squirShellRim);
          squirRim.rotation.y = Math.PI / 2;
          squirRim.rotation.x = 0.25;
          squirShellGroup.add(squirDome, squirRim);
          squirtleGroup.add(squirShellGroup);

          const squirPlastronGeo = new THREE.SphereGeometry(0.58, 18, 18);
          squirPlastronGeo.scale(0.88, 1.02, 0.72);
          const squirPlastron = new THREE.Mesh(squirPlastronGeo, squirBellyYellow);
          squirPlastron.position.set(0.12, -0.06, 0);
          squirtleGroup.add(squirPlastron);

          const squirHead = new THREE.Mesh(new THREE.SphereGeometry(0.54, 22, 22), squirBlue);
          squirHead.position.set(0.28, 0.34, 0);
          squirtleGroup.add(squirHead);

          // Pointed Black Squirtle-Squad Sunglasses + Smile
          const squadShades = new THREE.Group();
          const shadeBridge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.56), squadGlassMat);
          shadeBridge.position.set(0.76, 0.48, 0);
          squadShades.add(shadeBridge);

          const squirFlippers = new THREE.Group();
          [-1, 1].forEach(side => {
            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), squirEye);
            eye.position.set(0.64, 0.44, side * 0.35);
            const glint = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), pixelWhiteMat);
            glint.position.set(0.72, 0.48, side * 0.35 + 0.02);
            squirtleGroup.add(eye, glint);

            // Pointed triangular sunglasses lens
            const lens = new THREE.Mesh(new THREE.ConeGeometry(0.20, 0.44, 3), squadGlassMat);
            lens.scale.set(0.32, 1.0, 0.78);
            lens.position.set(0.76, 0.46, side * 0.34);
            lens.rotation.x = side * (Math.PI / 2 - 0.25);
            lens.rotation.z = -0.15;
            squadShades.add(lens);

            const flipperGeo = new THREE.CylinderGeometry(0.08, 0.16, 0.40, 8);
            flipperGeo.rotateZ(Math.PI / 2.5);
            const flipper = new THREE.Mesh(flipperGeo, squirBlue);
            flipper.position.set(0.24, 0.02, side * 0.48);
            flipper.rotation.y = side * 0.4;
            squirFlippers.add(flipper);

            // Missing Hind Legs & Feet
            const hindFootGeo = new THREE.SphereGeometry(0.15, 12, 12);
            hindFootGeo.scale(1.35, 0.65, 0.90);
            const hindFoot = new THREE.Mesh(hindFootGeo, squirBlue);
            hindFoot.position.set(-0.04, -0.62, side * 0.34);
            squirtleGroup.add(hindFoot);
          });
          squirtleGroup.add(squadShades);
          const squirSmile = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.022, 6, 12, Math.PI * 0.85), pixelBlackMat);
          squirSmile.position.set(0.78, 0.26, 0);
          squirSmile.rotation.y = Math.PI / 2;
          squirSmile.rotation.z = Math.PI;
          squirtleGroup.add(squirSmile);

          this.animatedSkinParts.squirtleFlippers = squirFlippers;
          squirtleGroup.add(squirFlippers);

          const squirTail = new THREE.Group();
          squirTail.position.set(-0.72, -0.05, 0);
          const squirCurl = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.12, 10, 20), squirBlue);
          squirCurl.position.set(-0.16, 0.14, 0);
          const squirCurlPuff = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), squirBlue);
          squirCurlPuff.position.set(-0.16, 0.14, 0);
          squirTail.add(squirCurl, squirCurlPuff);
          this.animatedSkinParts.squirtleTail = squirTail;
          squirtleGroup.add(squirTail);
          addPreset('poke_squirtle', squirtleGroup);

          // P4. Bulbasaur ('poke_bulbasaur': Quadrupedal Dino-Frog + Garlic Bulb on Back + Unfurling Leaves + Fangs & Smile + Animated Twin Vine Whips)
          const bulbaGroup = new THREE.Group();
          const bulbaTeal = new THREE.MeshStandardMaterial({ color: 0x2dd4bf, roughness: 0.32, metalness: 0.1 });
          const bulbaDarkSpot = new THREE.MeshStandardMaterial({ color: 0x0f766e, roughness: 0.4 });
          const bulbaBulbMat = new THREE.MeshStandardMaterial({ color: 0x16a34a, emissive: 0x14532d, emissiveIntensity: 0.3, roughness: 0.28 });
          const bulbaLeafMat = new THREE.MeshStandardMaterial({ color: 0x4ade80, emissive: 0x16a34a, emissiveIntensity: 0.35, roughness: 0.25 });
          const bulbaRedEye = new THREE.MeshStandardMaterial({ color: 0xe11d48, roughness: 0.1 });

          const bulbaBodyGeo = new THREE.SphereGeometry(0.72, 22, 22);
          bulbaBodyGeo.scale(1.15, 0.88, 0.98);
          const bulbaBody = new THREE.Mesh(bulbaBodyGeo, bulbaTeal);
          bulbaBody.position.set(-0.04, -0.10, 0);
          bulbaBody.castShadow = true;
          bulbaGroup.add(bulbaBody);

          const bulbaHeadGeo = new THREE.SphereGeometry(0.58, 22, 22);
          bulbaHeadGeo.scale(1.18, 0.92, 1.05);
          const bulbaHead = new THREE.Mesh(bulbaHeadGeo, bulbaTeal);
          bulbaHead.position.set(0.32, 0.22, 0);
          bulbaHead.castShadow = true;
          bulbaGroup.add(bulbaHead);

          const bulbaSpots = [
            { pos: [0.55, 0.44, 0], scale: [0.18, 0.12, 0.18] },
            { pos: [0.42, 0.46, 0.30], scale: [0.14, 0.10, 0.14] },
            { pos: [0.42, 0.46, -0.30], scale: [0.14, 0.10, 0.14] },
            { pos: [-0.18, 0.16, 0.48], scale: [0.22, 0.14, 0.16] },
            { pos: [-0.18, 0.16, -0.48], scale: [0.22, 0.14, 0.16] }
          ];
          for (const s of bulbaSpots) {
            const spot = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 10), bulbaDarkSpot);
            spot.scale.set(s.scale[0], s.scale[1], s.scale[2]);
            spot.position.set(s.pos[0], s.pos[1], s.pos[2]);
            bulbaGroup.add(spot);
          }

          [-1, 1].forEach(side => {
            const ear = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.38, 8), bulbaTeal);
            ear.position.set(0.24, 0.68, side * 0.36);
            ear.rotation.x = side * 0.38;
            ear.rotation.z = -0.18;
            bulbaGroup.add(ear);

            const eye = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.20, 6), bulbaRedEye);
            eye.position.set(0.64, 0.32, side * 0.42);
            eye.rotation.y = side * Math.PI / 2;
            eye.rotation.z = -Math.PI / 4;
            const glint = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), pixelWhiteMat);
            glint.position.set(0.72, 0.36, side * 0.44);
            bulbaGroup.add(eye, glint);

            // Nostrils & Fangs
            const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), pixelBlackMat);
            nostril.position.set(0.95, 0.26, side * 0.10);
            const fang = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 6), pixelWhiteMat);
            fang.position.set(0.90, 0.10, side * 0.16);
            fang.rotation.z = Math.PI;
            bulbaGroup.add(nostril, fang);

            const fLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.38, 8), bulbaTeal);
            fLeg.position.set(0.24, -0.48, side * 0.44);
            const bLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.38, 8), bulbaTeal);
            bLeg.position.set(-0.32, -0.48, side * 0.44);
            const fClaw = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 6), pixelWhiteMat);
            fClaw.rotation.z = -Math.PI / 2;
            fClaw.position.set(0.38, -0.62, side * 0.44);
            const bClaw = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 6), pixelWhiteMat);
            bClaw.rotation.z = -Math.PI / 2;
            bClaw.position.set(-0.18, -0.62, side * 0.44);
            bulbaGroup.add(fLeg, bLeg, fClaw, bClaw);
          });

          const bulbaSmile = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.024, 6, 14, Math.PI * 0.85), pixelBlackMat);
          bulbaSmile.position.set(0.88, 0.12, 0);
          bulbaSmile.rotation.y = Math.PI / 2;
          bulbaSmile.rotation.z = Math.PI;
          bulbaGroup.add(bulbaSmile);

          const plantBulb = new THREE.Group();
          plantBulb.position.set(-0.24, 0.38, 0);
          const bulbBase = new THREE.Mesh(new THREE.SphereGeometry(0.52, 16, 14), bulbaBulbMat);
          bulbBase.scale.set(1.08, 0.95, 1.08);
          const bulbTop = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.55, 12), bulbaBulbMat);
          bulbTop.position.y = 0.40;
          for (let lf = 0; lf < 4; lf++) {
            const la = (lf / 4) * Math.PI * 2;
            const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.34, 6), bulbaLeafMat);
            leaf.position.set(Math.cos(la) * 0.24, 0.56, Math.sin(la) * 0.24);
            leaf.rotation.z = Math.cos(la) * -0.55;
            leaf.rotation.x = Math.sin(la) * 0.55;
            plantBulb.add(leaf);
          }
          plantBulb.add(bulbBase, bulbTop);
          bulbaGroup.add(plantBulb);

          const vineGroup = new THREE.Group();
          vineGroup.position.set(-0.24, 0.42, 0);
          [-1, 1].forEach(side => {
            const vine = new THREE.Mesh(new THREE.TorusGeometry(0.54, 0.05, 8, 20, Math.PI * 1.15), bulbaLeafMat);
            vine.position.set(-0.26, 0.18, side * 0.40);
            vine.rotation.y = side * 0.45;
            vineGroup.add(vine);
          });
          this.animatedSkinParts.bulbasaurVines = vineGroup;
          bulbaGroup.add(vineGroup);
          addPreset('poke_bulbasaur', bulbaGroup);

          // P5. Bidoof ('poke_bidoof': Plump Beaver Cheeks + Giant Buck Incisor Teeth + 4 Paws + 5-Puff Tail + Floating Golden God Crown)
          const bidoofGroup = new THREE.Group();
          const bidoofBrown = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.42 });
          const bidoofDarkBrown = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.46 });
          const bidoofCream = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.35 });
          const bidoofRedNose = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.2 });
          const bidoofCrownGold = new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xd97706, emissiveIntensity: 0.85, metalness: 0.85, roughness: 0.15 });

          const bidoofBodyGeo = new THREE.SphereGeometry(0.74, 22, 22);
          bidoofBodyGeo.scale(1.06, 0.98, 0.94);
          const bidoofBody = new THREE.Mesh(bidoofBodyGeo, bidoofBrown);
          bidoofBody.position.set(-0.06, -0.06, 0);
          bidoofBody.castShadow = true;
          bidoofGroup.add(bidoofBody);

          const bidoofHeadGeo = new THREE.SphereGeometry(0.56, 22, 22);
          bidoofHeadGeo.scale(1.06, 0.96, 0.96);
          const bidoofHead = new THREE.Mesh(bidoofHeadGeo, bidoofBrown);
          bidoofHead.position.set(0.28, 0.30, 0);
          bidoofHead.castShadow = true;
          bidoofGroup.add(bidoofHead);

          [-1, 1].forEach(side => {
            const bEar = new THREE.Mesh(new THREE.SphereGeometry(0.20, 12, 12), bidoofDarkBrown);
            bEar.scale.set(0.65, 1.1, 0.9);
            bEar.position.set(0.22, 0.72, side * 0.38);
            bidoofGroup.add(bEar);

            const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 14), bidoofCream);
            muzzle.position.set(0.62, 0.18, side * 0.22);
            bidoofGroup.add(muzzle);

            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.10, 10, 10), pixelBlackMat);
            eye.position.set(0.66, 0.44, side * 0.32);
            const glint = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), pixelWhiteMat);
            glint.position.set(0.73, 0.47, side * 0.32 + 0.02);
            bidoofGroup.add(eye, glint);

            const paw = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), bidoofDarkBrown);
            paw.scale.set(1.2, 0.7, 0.9);
            paw.position.set(0.36, -0.34, side * 0.38);
            const hindPaw = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), bidoofDarkBrown);
            hindPaw.scale.set(1.3, 0.7, 0.95);
            hindPaw.position.set(-0.32, -0.58, side * 0.38);
            bidoofGroup.add(paw, hindPaw);
          });

          const bidoofRedNoseMesh = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 12), bidoofRedNose);
          bidoofRedNoseMesh.position.set(0.80, 0.32, 0);
          const beaverTeeth = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.32, 0.32), pixelWhiteMat);
          beaverTeeth.position.set(0.72, 0.02, 0);
          const toothLine = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.32, 0.02), pixelBlackMat);
          toothLine.position.set(0.73, 0.02, 0);
          bidoofGroup.add(bidoofRedNoseMesh, beaverTeeth, toothLine);

          const beaverTail = new THREE.Group();
          beaverTail.position.set(-0.78, -0.04, 0);
          for (let p = 0; p < 5; p++) {
            const pa = (p / 5) * Math.PI * 2;
            const puff = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 10), bidoofDarkBrown);
            puff.position.set(-0.16 + Math.cos(pa) * 0.15, Math.sin(pa) * 0.16, (p % 2 === 0 ? 0.08 : -0.08));
            beaverTail.add(puff);
          }
          this.animatedSkinParts.bidoofTail = beaverTail;
          bidoofGroup.add(beaverTail);

          const hmCrown = new THREE.Group();
          hmCrown.position.set(0.24, 1.05, 0);
          const crownCirclet = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.30, 0.16, 16, 1, true), bidoofCrownGold);
          const crownHalo = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.04, 8, 24), bidoofCrownGold);
          crownHalo.rotation.x = Math.PI / 2;
          for (let sp = 0; sp < 5; sp++) {
            const sa = (sp / 5) * Math.PI * 2;
            const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.24, 6), bidoofCrownGold);
            spike.position.set(Math.cos(sa) * 0.34, 0.16, Math.sin(sa) * 0.34);
            hmCrown.add(spike);
          }
          hmCrown.add(crownCirclet, crownHalo);
          this.animatedSkinParts.bidoofCrown = hmCrown;
          bidoofGroup.add(hmCrown);
          addPreset('poke_bidoof', bidoofGroup);

          // P6. Mew ('poke_mew': Slender Pastel Pink Feline Body + Big Sapphire Anime Eyes + Whipping Long Ribbon Tail + Psychic Levitation Ring)
          const mewGroup = new THREE.Group();
          const mewPink = new THREE.MeshStandardMaterial({ color: 0xfbcfe8, roughness: 0.22, metalness: 0.08 });
          const mewBelly = new THREE.MeshStandardMaterial({ color: 0xfdf2f8, roughness: 0.28 });
          const mewBlueEye = new THREE.MeshStandardMaterial({ color: 0x0ea5e9, roughness: 0.05, emissive: 0x0284c7, emissiveIntensity: 0.35 });
          const mewAuraRing = new THREE.MeshStandardMaterial({ color: 0xe879f9, emissive: 0xc084fc, emissiveIntensity: 0.75, transparent: true, opacity: 0.65 });

          const mewBodyGeo = new THREE.SphereGeometry(0.58, 22, 22);
          mewBodyGeo.scale(0.88, 1.15, 0.80);
          const mewBody = new THREE.Mesh(mewBodyGeo, mewPink);
          mewBody.position.set(-0.04, -0.05, 0);
          mewBody.castShadow = true;
          mewGroup.add(mewBody);

          const mewBellyGeo = new THREE.SphereGeometry(0.48, 18, 18);
          mewBellyGeo.scale(0.78, 1.05, 0.70);
          const mewBellyMesh = new THREE.Mesh(mewBellyGeo, mewBelly);
          mewBellyMesh.position.set(0.12, -0.06, 0);
          mewGroup.add(mewBellyMesh);

          const mewHeadGeo = new THREE.SphereGeometry(0.50, 22, 22);
          mewHeadGeo.scale(1.05, 0.98, 0.94);
          const mewHead = new THREE.Mesh(mewHeadGeo, mewPink);
          mewHead.position.set(0.24, 0.42, 0);
          mewHead.castShadow = true;
          mewGroup.add(mewHead);

          [-1, 1].forEach(side => {
            const ear = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.32, 8), mewPink);
            ear.position.set(0.22, 0.82, side * 0.28);
            ear.rotation.x = side * 0.40;
            ear.rotation.z = -0.15;
            mewGroup.add(ear);

            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 16), mewBlueEye);
            eye.position.set(0.58, 0.50, side * 0.28);
            const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), pixelBlackMat);
            pupil.position.set(0.68, 0.50, side * 0.28);
            const glint1 = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), pixelWhiteMat);
            glint1.position.set(0.70, 0.54, side * 0.28 + 0.02);
            mewGroup.add(eye, pupil, glint1);

            const paw = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), mewPink);
            paw.position.set(0.26, 0.08, side * 0.20);
            mewGroup.add(paw);

            const footGeo = new THREE.SphereGeometry(0.12, 10, 10);
            footGeo.scale(1.8, 0.55, 0.75);
            const foot = new THREE.Mesh(footGeo, mewPink);
            foot.position.set(-0.02, -0.62, side * 0.28);
            mewGroup.add(foot);
          });

          const mewTail = new THREE.Group();
          mewTail.position.set(-0.55, -0.12, 0);
          let prevSeg = mewTail;
          for (let s = 0; s < 7; s++) {
            const segGroup = new THREE.Group();
            segGroup.position.set(-0.16, Math.sin(s * 0.8) * 0.08, 0);
            const segMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06 - s * 0.005, 0.07 - s * 0.005, 0.20, 8), mewPink);
            segMesh.rotation.z = Math.PI / 2.2;
            segGroup.add(segMesh);
            prevSeg.add(segGroup);
            prevSeg = segGroup;
          }
          const mewTailTip = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 12), mewPink);
          mewTailTip.scale.set(1.5, 1.0, 0.8);
          prevSeg.add(mewTailTip);
          this.animatedSkinParts.mewTail = mewTail;
          mewGroup.add(mewTail);

          const mewAura = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.04, 8, 28), mewAuraRing);
          mewAura.rotation.x = Math.PI / 2.5;
          this.animatedSkinParts.mewAura = mewAura;
          mewGroup.add(mewAura);
          addPreset('poke_mew', mewGroup);

          // P7. Eevee ('poke_eevee': Caramel Fox Body + Fluffy Cream Neck Mane + Tall Fox Ears + 4 Paws + Bushy Tail + 3 Orbiting Evolution Stones)
          const eeveeGroup = new THREE.Group();
          const eeveeBrown = new THREE.MeshStandardMaterial({ color: 0xa16207, roughness: 0.38 });
          const eeveeDarkBrown = new THREE.MeshStandardMaterial({ color: 0x593206, roughness: 0.44 });
          const eeveeCream = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.40 });
          const eeveeEye = new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.1 });

          const eeveeBodyGeo = new THREE.SphereGeometry(0.64, 22, 22);
          eeveeBodyGeo.scale(0.94, 1.05, 0.86);
          const eeveeBody = new THREE.Mesh(eeveeBodyGeo, eeveeBrown);
          eeveeBody.position.set(-0.06, -0.06, 0);
          eeveeBody.castShadow = true;
          eeveeGroup.add(eeveeBody);

          const eeveeHeadGeo = new THREE.SphereGeometry(0.52, 22, 22);
          eeveeHeadGeo.scale(1.08, 0.95, 0.92);
          const eeveeHead = new THREE.Mesh(eeveeHeadGeo, eeveeBrown);
          eeveeHead.position.set(0.26, 0.34, 0);
          eeveeHead.castShadow = true;
          eeveeGroup.add(eeveeHead);

          const eeveeMane = new THREE.Group();
          eeveeMane.position.set(0.12, 0.10, 0);
          for (let f = 0; f < 10; f++) {
            const fa = (f / 10) * Math.PI * 2;
            const fluff = new THREE.Mesh(new THREE.SphereGeometry(0.20, 10, 10), eeveeCream);
            fluff.scale.set(1.2, 0.9, 0.9);
            fluff.position.set(Math.cos(fa) * 0.34, Math.sin(fa) * 0.22, Math.sin(fa) * 0.42);
            eeveeMane.add(fluff);
          }
          eeveeGroup.add(eeveeMane);

          [-1, 1].forEach(side => {
            const earGroup = new THREE.Group();
            earGroup.position.set(0.20, 0.78, side * 0.30);
            earGroup.rotation.x = side * 0.44;
            earGroup.rotation.z = -0.25;

            const earOuter = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.65, 10), eeveeBrown);
            earOuter.position.y = 0.32;
            const earInner = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.50, 8), eeveeDarkBrown);
            earInner.position.set(0.04, 0.26, 0);
            earGroup.add(earOuter, earInner);
            eeveeGroup.add(earGroup);

            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), eeveeEye);
            eye.position.set(0.64, 0.44, side * 0.32);
            const glint = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), pixelWhiteMat);
            glint.position.set(0.72, 0.48, side * 0.32 + 0.02);
            eeveeGroup.add(eye, glint);

            const paw = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 10), eeveeBrown);
            paw.position.set(0.28, -0.34, side * 0.36);
            const hindPaw = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), eeveeBrown);
            hindPaw.scale.set(1.25, 0.75, 0.9);
            hindPaw.position.set(-0.28, -0.56, side * 0.34);
            eeveeGroup.add(paw, hindPaw);
          });

          const eeveeNose = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), pixelBlackMat);
          eeveeNose.position.set(0.80, 0.36, 0);
          const eeveeSmile = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 6, 12, Math.PI * 0.8), pixelBlackMat);
          eeveeSmile.position.set(0.74, 0.28, 0);
          eeveeSmile.rotation.y = Math.PI / 2;
          eeveeSmile.rotation.z = Math.PI;
          eeveeGroup.add(eeveeNose, eeveeSmile);

          const eeveeTail = new THREE.Group();
          eeveeTail.position.set(-0.66, -0.06, 0);
          const eeveeTailBase = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.62, 12), eeveeBrown);
          eeveeTailBase.position.set(-0.28, 0.20, 0);
          eeveeTailBase.rotation.z = -Math.PI / 3;
          const eeveeTailTip = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.46, 12), eeveeCream);
          eeveeTailTip.position.set(-0.52, 0.44, 0);
          eeveeTailTip.rotation.z = -Math.PI / 3;
          eeveeTail.add(eeveeTailBase, eeveeTailTip);
          this.animatedSkinParts.eeveeTail = eeveeTail;
          eeveeGroup.add(eeveeTail);

          // 3 Orbiting Evolution Stones (Water Blue, Thunder Yellow, Fire Orange)
          const eeveeStones = new THREE.Group();
          const stoneColors = [
            new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.75, roughness: 0.1, metalness: 0.7 }),
            new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xd97706, emissiveIntensity: 0.75, roughness: 0.1, metalness: 0.7 }),
            new THREE.MeshStandardMaterial({ color: 0xf97316, emissive: 0xdc2626, emissiveIntensity: 0.75, roughness: 0.1, metalness: 0.7 })
          ];
          stoneColors.forEach((mat, idx) => {
            const sa = (idx / 3) * Math.PI * 2;
            const stone = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), mat);
            stone.position.set(Math.cos(sa) * 1.05, 0.15, Math.sin(sa) * 1.05);
            eeveeStones.add(stone);
          });
          this.animatedSkinParts.eeveeStones = eeveeStones;
          eeveeGroup.add(eeveeStones);
          addPreset('poke_eevee', eeveeGroup);

          // P8. Jigglypuff ('poke_jigglypuff': Spherical Pink Balloon Body + Forehead Swirl Tuft + Huge Sparkling Teal Eyes + Green Marker Mic + Sleep Notes)
          const jigglyGroup = new THREE.Group();
          const jigglyPink = new THREE.MeshStandardMaterial({ color: 0xf472b6, roughness: 0.26 });
          const jigglyTealEye = new THREE.MeshStandardMaterial({ color: 0x14b8a6, roughness: 0.06 });
          const jigglyInnerEar = new THREE.MeshStandardMaterial({ color: 0x1e1b4b, roughness: 0.35 });
          const micSilver = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.2, metalness: 0.8 });
          const markerGreen = new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x059669, emissiveIntensity: 0.45, roughness: 0.2 });

          const jigglyBody = new THREE.Mesh(new THREE.SphereGeometry(0.74, 26, 26), jigglyPink);
          jigglyBody.castShadow = true;
          jigglyGroup.add(jigglyBody);

          const jigglyCurl = new THREE.Mesh(new THREE.TorusGeometry(0.20, 0.08, 10, 18, Math.PI * 1.6), jigglyPink);
          jigglyCurl.position.set(0.54, 0.58, 0);
          jigglyCurl.rotation.y = Math.PI / 2;
          jigglyCurl.rotation.z = 0.35;
          jigglyGroup.add(jigglyCurl);

          [-1, 1].forEach(side => {
            const earGroup = new THREE.Group();
            earGroup.position.set(0.16, 0.68, side * 0.44);
            earGroup.rotation.x = side * 0.38;
            earGroup.rotation.z = -0.15;

            const earOuter = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.38, 8), jigglyPink);
            const earInner = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.28, 6), jigglyInnerEar);
            earInner.position.set(0.04, -0.02, 0);
            earGroup.add(earOuter, earInner);
            jigglyGroup.add(earGroup);

            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.19, 18, 18), jigglyTealEye);
            eye.position.set(0.60, 0.20, side * 0.36);
            const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.10, 10, 10), pixelBlackMat);
            pupil.position.set(0.72, 0.20, side * 0.36);
            const glint1 = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), pixelWhiteMat);
            glint1.position.set(0.75, 0.26, side * 0.36 + 0.03);
            jigglyGroup.add(eye, pupil, glint1);

            const footGeo = new THREE.SphereGeometry(0.16, 10, 10);
            footGeo.scale(1.4, 0.6, 0.9);
            const foot = new THREE.Mesh(footGeo, jigglyPink);
            foot.position.set(0.18, -0.68, side * 0.34);
            jigglyGroup.add(foot);
          });

          const jigglyMouth = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), new THREE.MeshBasicMaterial({ color: 0x9f1239 }));
          jigglyMouth.scale.set(0.5, 1.1, 1.0);
          jigglyMouth.position.set(0.73, 0.02, 0);
          jigglyGroup.add(jigglyMouth);

          const jigglyArmL = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), jigglyPink);
          jigglyArmL.position.set(0.48, -0.18, -0.42);
          const jigglyArmR = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), jigglyPink);
          jigglyArmR.position.set(0.54, -0.12, 0.40);

          const micHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.26, 10), markerGreen);
          micHandle.position.set(0.65, -0.08, 0.44);
          micHandle.rotation.z = Math.PI / 4;
          const micBand = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.06, 10), pixelBlackMat);
          micBand.position.set(0.69, -0.04, 0.44);
          micBand.rotation.z = Math.PI / 4;
          const micHead = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 12), micSilver);
          micHead.position.set(0.75, 0.03, 0.44);
          jigglyGroup.add(jigglyArmL, jigglyArmR, micHandle, micBand, micHead);

          // Orbiting Lullaby Music Notes
          const jigglyNotes = new THREE.Group();
          for (let n = 0; n < 3; n++) {
            const na = (n / 3) * Math.PI * 2;
            const note = new THREE.Group();
            const noteOrb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), markerGreen);
            const noteStem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.22, 6), markerGreen);
            noteStem.position.set(0.06, 0.11, 0);
            note.add(noteOrb, noteStem);
            note.position.set(Math.cos(na) * 1.02, 0.25 + n * 0.12, Math.sin(na) * 1.02);
            jigglyNotes.add(note);
          }
          this.animatedSkinParts.jigglyNotes = jigglyNotes;
          jigglyGroup.add(jigglyNotes);
          addPreset('poke_jigglypuff', jigglyGroup);

          // P9. Magikarp ('poke_magikarp': Flattened Orange-Red Fish Body + 3-Peaked Crown Fin + Gaping Lips + Golden Splash Tail + Flopping Water Splash Rings)
          const karpGroup = new THREE.Group();
          const karpRed = new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.26, metalness: 0.15 });
          const karpGold = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.20, metalness: 0.3 });
          const karpLipPink = new THREE.MeshStandardMaterial({ color: 0xfbcfe8, roughness: 0.3 });
          const splashBlueMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.65, transparent: true, opacity: 0.78 });

          const karpBodyGeo = new THREE.SphereGeometry(0.76, 24, 24);
          karpBodyGeo.scale(1.24, 0.96, 0.52);
          const karpBody = new THREE.Mesh(karpBodyGeo, karpRed);
          karpBody.castShadow = true;
          karpGroup.add(karpBody);

          const karpLips = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.08, 10, 18), karpLipPink);
          karpLips.position.set(0.88, -0.04, 0);
          karpLips.rotation.y = Math.PI / 2;
          karpGroup.add(karpLips);

          [-1, 1].forEach(side => {
            const eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 14), pixelWhiteMat);
            eyeWhite.position.set(0.52, 0.24, side * 0.38);
            const eyePupil = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), pixelBlackMat);
            eyePupil.position.set(0.66, 0.24, side * 0.39);
            karpGroup.add(eyeWhite, eyePupil);

            const whisker = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.032, 6, 16, Math.PI * 0.8), karpGold);
            whisker.position.set(0.58, -0.16, side * 0.38);
            whisker.rotation.y = side * 0.45;
            whisker.rotation.z = Math.PI * 0.75;
            karpGroup.add(whisker);

            const fin = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.44, 4), pixelWhiteMat);
            fin.position.set(0.12, -0.14, side * 0.36);
            fin.rotation.z = -Math.PI / 3;
            fin.rotation.x = side * (Math.PI / 2 - 0.2);
            karpGroup.add(fin);
          });

          const dorsalCrown = new THREE.Group();
          dorsalCrown.position.set(-0.05, 0.72, 0);
          const ventralCrown = new THREE.Group();
          ventralCrown.position.set(-0.05, -0.72, 0);
          [-0.22, 0, 0.22].forEach((xOff, idx) => {
            const h = idx === 1 ? 0.48 : 0.36;
            const spike = new THREE.Mesh(new THREE.ConeGeometry(0.14, h, 6), karpGold);
            spike.position.x = xOff;
            spike.scale.set(1, 1, 0.25);
            dorsalCrown.add(spike);

            const vSpike = new THREE.Mesh(new THREE.ConeGeometry(0.12, h * 0.78, 6), karpGold);
            vSpike.position.x = xOff;
            vSpike.rotation.z = Math.PI;
            vSpike.scale.set(1, 1, 0.25);
            ventralCrown.add(vSpike);
          });
          karpGroup.add(dorsalCrown, ventralCrown);

          const karpTail = new THREE.Group();
          karpTail.position.set(-0.84, 0, 0);
          const tailFin = new THREE.Mesh(new THREE.ConeGeometry(0.48, 0.75, 4), karpGold);
          tailFin.rotation.z = Math.PI / 2;
          tailFin.scale.set(1.1, 1.0, 0.2);
          karpTail.add(tailFin);
          this.animatedSkinParts.magikarpTail = karpTail;
          karpGroup.add(karpTail);

          // Flopping Water Splash Rings & Droplets
          const karpSplash = new THREE.Group();
          const splashRing = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.04, 8, 24), splashBlueMat);
          splashRing.rotation.x = Math.PI / 2;
          splashRing.position.y = -0.35;
          karpSplash.add(splashRing);
          for (let d = 0; d < 6; d++) {
            const da = (d / 6) * Math.PI * 2;
            const drop = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.20, 8), splashBlueMat);
            drop.position.set(Math.cos(da) * 0.92, -0.22 + (d % 2) * 0.18, Math.sin(da) * 0.92);
            karpSplash.add(drop);
          }
          this.animatedSkinParts.magikarpSplash = karpSplash;
          karpGroup.add(karpSplash);
          addPreset('poke_magikarp', karpGroup);

          // P10. Meowth ('poke_meowth': Sleek Cream Cat Body + Radiant Golden Koban Forehead Coin + Whisker Cheeks + Cat Grin & Hind Feet + Orbiting Pay Day Coins)
          const meowthGroup = new THREE.Group();
          const meowthCream = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.35 });
          const meowthBrown = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.42 });
          const meowthKobanGold = new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xd97706, emissiveIntensity: 0.75, metalness: 0.85, roughness: 0.15 });

          const meowthBodyGeo = new THREE.SphereGeometry(0.62, 22, 22);
          meowthBodyGeo.scale(0.90, 1.08, 0.82);
          const meowthBody = new THREE.Mesh(meowthBodyGeo, meowthCream);
          meowthBody.position.set(-0.06, -0.06, 0);
          meowthBody.castShadow = true;
          meowthGroup.add(meowthBody);

          const meowthHeadGeo = new THREE.SphereGeometry(0.54, 22, 22);
          meowthHeadGeo.scale(1.08, 0.94, 0.94);
          const meowthHead = new THREE.Mesh(meowthHeadGeo, meowthCream);
          meowthHead.position.set(0.26, 0.34, 0);
          meowthHead.castShadow = true;
          meowthGroup.add(meowthHead);

          const kobanCoin = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.07, 16), meowthKobanGold);
          kobanCoin.scale.set(0.72, 1.0, 1.35);
          kobanCoin.rotation.z = -Math.PI / 2 + 0.35;
          kobanCoin.position.set(0.50, 0.58, 0);
          meowthGroup.add(kobanCoin);

          [-1, 1].forEach(side => {
            const earGroup = new THREE.Group();
            earGroup.position.set(0.18, 0.76, side * 0.32);
            earGroup.rotation.x = side * 0.42;
            earGroup.rotation.z = -0.22;

            const ear = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.45, 8), pixelBlackMat);
            const earInner = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.32, 6), meowthBrown);
            earInner.position.set(0.04, -0.04, 0);
            earGroup.add(ear, earInner);
            meowthGroup.add(earGroup);

            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 14), pixelWhiteMat);
            eye.position.set(0.64, 0.44, side * 0.32);
            const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), pixelBlackMat);
            pupil.position.set(0.74, 0.44, side * 0.32);
            meowthGroup.add(eye, pupil);

            for (let w = -1; w <= 1; w += 2) {
              const whisker = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.015, 0.42, 6), meowthCream);
              whisker.position.set(0.54, 0.26 + w * 0.07, side * 0.52);
              whisker.rotation.x = side * (Math.PI / 2 - w * 0.22);
              meowthGroup.add(whisker);
            }

            const paw = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 10), meowthCream);
            paw.position.set(0.32, -0.16, side * 0.36);
            const hindFoot = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 10), meowthBrown);
            hindFoot.scale.set(1.5, 0.6, 0.85);
            hindFoot.position.set(-0.02, -0.64, side * 0.30);
            const fang = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 6), pixelWhiteMat);
            fang.position.set(0.78, 0.22, side * 0.12);
            fang.rotation.z = Math.PI;
            meowthGroup.add(paw, hindFoot, fang);
          });

          const meowthMouth = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.022, 6, 12, Math.PI * 0.85), pixelBlackMat);
          meowthMouth.position.set(0.78, 0.26, 0);
          meowthMouth.rotation.y = Math.PI / 2;
          meowthMouth.rotation.z = Math.PI;
          meowthGroup.add(meowthMouth);

          const meowthTail = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.08, 10, 18, Math.PI * 1.4), meowthBrown);
          meowthTail.position.set(-0.76, 0.12, 0);
          meowthGroup.add(meowthTail);

          const payDayOrbit = new THREE.Group();
          for (let c = 0; c < 5; c++) {
            const ca = (c / 5) * Math.PI * 2;
            const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.04, 14), meowthKobanGold);
            coin.rotation.x = Math.PI / 2;
            coin.position.set(Math.cos(ca) * 1.08, 0.12 + (c % 2) * 0.18, Math.sin(ca) * 1.08);
            payDayOrbit.add(coin);
          }
          this.animatedSkinParts.meowthCoins = payDayOrbit;
          meowthGroup.add(payDayOrbit);
          addPreset('poke_meowth', meowthGroup);

          // P11. Charizard ('poke_charizard': Flame Dragon Body + Dual Teal/Orange Dragon Wings + Twin Horns + Roaring Inferno Tail Flame)
          const charizardGroup = new THREE.Group();
          const zardOrange = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.26, metalness: 0.16 });
          const zardCream = new THREE.MeshStandardMaterial({ color: 0xfef08a, roughness: 0.30 });
          const zardTealWing = new THREE.MeshStandardMaterial({ color: 0x0d9488, emissive: 0x115e59, emissiveIntensity: 0.35, roughness: 0.28, side: THREE.DoubleSide });

          const zardBodyGeo = new THREE.SphereGeometry(0.68, 24, 24);
          zardBodyGeo.scale(0.96, 1.14, 0.88);
          const zardBody = new THREE.Mesh(zardBodyGeo, zardOrange);
          zardBody.position.set(-0.08, -0.06, 0);
          zardBody.castShadow = true;
          charizardGroup.add(zardBody);

          const zardBellyGeo = new THREE.SphereGeometry(0.58, 20, 20);
          zardBellyGeo.scale(0.86, 1.04, 0.74);
          const zardBelly = new THREE.Mesh(zardBellyGeo, zardCream);
          zardBelly.position.set(0.10, -0.08, 0);
          charizardGroup.add(zardBelly);

          const zardNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.45, 12), zardOrange);
          zardNeck.position.set(0.16, 0.34, 0);
          zardNeck.rotation.z = -0.35;
          charizardGroup.add(zardNeck);

          const zardHeadGeo = new THREE.SphereGeometry(0.46, 22, 22);
          zardHeadGeo.scale(1.26, 0.90, 0.86);
          const zardHead = new THREE.Mesh(zardHeadGeo, zardOrange);
          zardHead.position.set(0.38, 0.56, 0);
          charizardGroup.add(zardHead);

          // Articulated Dual Teal/Orange Dragon Bat-Wings
          const zardWings = new THREE.Group();
          [-1, 1].forEach(side => {
            const horn = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.42, 8), zardOrange);
            horn.position.set(0.10, 0.82, side * 0.22);
            horn.rotation.z = 0.65;
            horn.rotation.x = side * 0.24;
            charizardGroup.add(horn);

            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.10, 12, 12), pixelWhiteMat);
            eye.position.set(0.68, 0.62, side * 0.28);
            const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), charTealEye);
            pupil.position.set(0.76, 0.62, side * 0.28);
            const brow = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.12), zardOrange);
            brow.position.set(0.68, 0.70, side * 0.28);
            brow.rotation.z = -0.28;
            const fang = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 6), pixelWhiteMat);
            fang.position.set(0.84, 0.44, side * 0.14);
            fang.rotation.z = Math.PI;
            charizardGroup.add(eye, pupil, brow, fang);

            const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.10, 0.36, 8), zardOrange);
            arm.position.set(0.24, 0.10, side * 0.38);
            arm.rotation.z = -Math.PI / 3;
            const leg = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), zardOrange);
            leg.scale.set(1.1, 1.2, 0.9);
            leg.position.set(-0.04, -0.52, side * 0.36);
            const foot = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), zardOrange);
            foot.scale.set(1.5, 0.55, 0.9);
            foot.position.set(0.08, -0.74, side * 0.36);
            charizardGroup.add(arm, leg, foot);

            // Dragon Wing Membrane & Struts
            const wingPivot = new THREE.Group();
            wingPivot.position.set(-0.10, 0.22, side * 0.36);
            const mainBone = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.04, 0.96, 8), zardOrange);
            mainBone.position.set(-0.06, 0.28, side * 0.42);
            mainBone.rotation.x = side * (Math.PI / 3);
            const wingThumb = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 6), pixelWhiteMat);
            wingThumb.position.set(0.06, 0.58, side * 0.72);
            const membrane = new THREE.Mesh(new THREE.ConeGeometry(0.58, 0.95, 5), zardTealWing);
            membrane.scale.set(0.85, 1.0, 0.18);
            membrane.position.set(-0.24, 0.18, side * 0.54);
            membrane.rotation.x = side * (Math.PI / 2.4);
            membrane.rotation.z = 0.42;
            wingPivot.add(mainBone, wingThumb, membrane);
            zardWings.add(wingPivot);
          });
          this.animatedSkinParts.charizardWings = zardWings;
          charizardGroup.add(zardWings);

          const zardTail = new THREE.Group();
          zardTail.position.set(-0.68, -0.18, 0);
          const zardTailShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.26, 0.92, 12), zardOrange);
          zardTailShaft.rotation.z = Math.PI / 2.6;
          zardTailShaft.position.set(-0.38, 0.18, 0);
          const zardFlame = new THREE.Group();
          zardFlame.position.set(-0.82, 0.48, 0);
          const zfOuter = new THREE.Mesh(new THREE.ConeGeometry(0.30, 0.68, 10), charFlameOuter);
          const zfMid = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.54, 10), charFlameMid);
          const zfCore = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.40, 10), charFlameCore);
          zardFlame.add(zfOuter, zfMid, zfCore);
          zardTail.add(zardTailShaft, zardFlame);
          this.animatedSkinParts.charizardFlame = zardFlame;
          this.animatedSkinParts.charizardTail = zardTail;
          charizardGroup.add(zardTail);
          addPreset('poke_charizard', charizardGroup);

          // P12. Gengar ('poke_gengar': Deep-Violet Shadow Body + Back Crown Spikes + Glowing Crimson Eyes + Wide Cheshire Tooth Grin + 3 Ghost Will-O-Wisps)
          const gengarGroup = new THREE.Group();
          const gengarPurple = new THREE.MeshStandardMaterial({ color: 0x4c1d95, emissive: 0x2e1065, emissiveIntensity: 0.40, roughness: 0.28, metalness: 0.22 });
          const gengarRedEye = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xdc2626, emissiveIntensity: 0.95, roughness: 0.08 });
          const ghostWispMat = new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: 0x9333ea, emissiveIntensity: 0.95, transparent: true, opacity: 0.82 });

          const gengarBodyGeo = new THREE.SphereGeometry(0.76, 26, 26);
          gengarBodyGeo.scale(1.06, 1.02, 0.98);
          const gengarBody = new THREE.Mesh(gengarBodyGeo, gengarPurple);
          gengarBody.castShadow = true;
          gengarGroup.add(gengarBody);

          // Jagged Crown & Back Spikes
          for (let sp = 0; sp < 5; sp++) {
            const spike = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.38 - sp * 0.03, 6), gengarPurple);
            spike.position.set(0.18 - sp * 0.18, 0.72 - sp * 0.10, 0);
            spike.rotation.z = 0.25 + sp * 0.20;
            gengarGroup.add(spike);
          }

          const gengarArms = new THREE.Group();
          [-1, 1].forEach(side => {
            const ear = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.56, 8), gengarPurple);
            ear.position.set(0.16, 0.68, side * 0.46);
            ear.rotation.x = side * 0.52;
            ear.rotation.z = -0.18;
            gengarGroup.add(ear);

            const eye = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.30, 6), gengarRedEye);
            eye.position.set(0.62, 0.26, side * 0.34);
            eye.rotation.y = side * Math.PI / 2;
            eye.rotation.z = -Math.PI / 3;
            const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 0.04), pixelBlackMat);
            pupil.position.set(0.74, 0.26, side * 0.34);
            gengarGroup.add(eye, pupil);

            const arm = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.46, 10), gengarPurple);
            arm.position.set(0.28, -0.06, side * 0.68);
            arm.rotation.x = side * (Math.PI / 2.3);
            gengarArms.add(arm);

            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.15, 0.34, 10), gengarPurple);
            leg.position.set(0.04, -0.68, side * 0.36);
            gengarGroup.add(leg);
          });
          this.animatedSkinParts.gengarArms = gengarArms;
          gengarGroup.add(gengarArms);

          // Wide Curved Cheshire Grin with Teeth Dividers
          const gengarGrin = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.09, 10, 20, Math.PI * 0.85), pixelWhiteMat);
          gengarGrin.position.set(0.56, -0.02, 0);
          gengarGrin.rotation.y = Math.PI / 2;
          gengarGrin.rotation.z = Math.PI;
          gengarGroup.add(gengarGrin);
          for (let t = -2; t <= 2; t++) {
            const toothLine = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.20, 0.025), pixelBlackMat);
            toothLine.position.set(0.74, -0.12 + Math.abs(t) * 0.03, t * 0.11);
            gengarGroup.add(toothLine);
          }

          const gengarTail = new THREE.Mesh(new THREE.ConeGeometry(0.20, 0.44, 8), gengarPurple);
          gengarTail.position.set(-0.78, -0.26, 0);
          gengarTail.rotation.z = Math.PI / 2.2;
          gengarGroup.add(gengarTail);

          // 3 Orbiting Will-O-Wisp Ghost Orbs
          const gengarWisps = new THREE.Group();
          for (let w = 0; w < 3; w++) {
            const wa = (w / 3) * Math.PI * 2;
            const wisp = new THREE.Group();
            const wCore = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 10), ghostWispMat);
            const wTail = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.28, 8), ghostWispMat);
            wTail.position.y = 0.16;
            wisp.add(wCore, wTail);
            wisp.position.set(Math.cos(wa) * 1.12, 0.10, Math.sin(wa) * 1.12);
            gengarWisps.add(wisp);
          }
          this.animatedSkinParts.gengarWisps = gengarWisps;
          gengarGroup.add(gengarWisps);
          addPreset('poke_gengar', gengarGroup);

          // P13. Lucario ('poke_lucario': Cobalt-Blue & Black Martial Jackal + Golden Furry Torso + Steel Chest Spike + 4 Aura Dreadlocks + Dual Aura Spheres)
          const lucarioGroup = new THREE.Group();
          const lucBlue = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.25, metalness: 0.30 });
          const lucYellow = new THREE.MeshStandardMaterial({ color: 0xfef08a, roughness: 0.35 });
          const lucBlack = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.30 });
          const lucSpikeSteel = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.12, metalness: 0.92 });
          const auraSphereMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 1.1, transparent: true, opacity: 0.85 });

          const lucTorso = new THREE.Mesh(new THREE.SphereGeometry(0.56, 22, 22), lucYellow);
          lucTorso.scale.set(0.88, 1.12, 0.84);
          lucTorso.position.set(-0.04, -0.02, 0);
          const chestSpike = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.32, 10), lucSpikeSteel);
          chestSpike.rotation.z = -Math.PI / 2;
          chestSpike.position.set(0.52, 0.04, 0);
          lucarioGroup.add(lucTorso, chestSpike);

          const lucHead = new THREE.Mesh(new THREE.SphereGeometry(0.46, 22, 22), lucBlue);
          lucHead.position.set(0.22, 0.48, 0);
          const lucSnout = new THREE.Mesh(new THREE.ConeGeometry(0.20, 0.44, 12), lucBlue);
          lucSnout.rotation.z = -Math.PI / 2 + 0.12;
          lucSnout.position.set(0.62, 0.42, 0);
          const lucMask = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.18, 0.72), lucBlack);
          lucMask.position.set(0.42, 0.50, 0);
          lucarioGroup.add(lucHead, lucSnout, lucMask);

          const lucSensors = new THREE.Group();
          lucSensors.position.set(-0.08, 0.44, 0);
          const lucAuraSpheres = new THREE.Group();

          [-1, 1].forEach(side => {
            const ear = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.52, 10), lucBlue);
            ear.position.set(0.16, 0.92, side * 0.24);
            ear.rotation.x = side * 0.22;
            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), gengarRedEye);
            eye.position.set(0.56, 0.52, side * 0.26);
            lucarioGroup.add(ear, eye);

            // 2 Black Dreadlock Aura Sensors per side
            for (let d = 0; d < 2; d++) {
              const dread = new THREE.Mesh(new THREE.CapsuleGeometry ? new THREE.CylinderGeometry(0.07, 0.11, 0.46, 8) : new THREE.CylinderGeometry(0.07, 0.11, 0.46, 8), lucBlack);
              dread.position.set(-0.22 - d * 0.10, -0.10 - d * 0.08, side * (0.18 + d * 0.12));
              dread.rotation.z = 0.65 + d * 0.20;
              lucSensors.add(dread);
            }

            const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.10, 0.44, 8), lucBlue);
            arm.position.set(0.24, 0.04, side * 0.44);
            arm.rotation.z = -Math.PI / 3;
            const pawSpike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 8), lucSpikeSteel);
            pawSpike.rotation.z = -Math.PI / 2;
            pawSpike.position.set(0.44, -0.04, side * 0.48);

            const auraOrb = new THREE.Mesh(new THREE.SphereGeometry(0.20, 14, 14), auraSphereMat);
            auraOrb.position.set(0.64, -0.04, side * 0.54);
            const auraRing = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.025, 8, 18), auraSphereMat);
            auraRing.position.copy(auraOrb.position);
            lucAuraSpheres.add(auraOrb, auraRing);

            const thigh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), lucBlue);
            thigh.position.set(-0.08, -0.44, side * 0.28);
            const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 0.34, 8), lucBlack);
            foot.position.set(-0.04, -0.68, side * 0.28);
            lucarioGroup.add(arm, pawSpike, thigh, foot);
          });
          const lucTail = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.62, 8), lucBlue);
          lucTail.rotation.z = Math.PI / 2.4;
          lucTail.position.set(-0.62, -0.22, 0);
          lucarioGroup.add(lucSensors, lucAuraSpheres, lucTail);
          this.animatedSkinParts.lucarioSensors = lucSensors;
          this.animatedSkinParts.lucarioAuraSpheres = lucAuraSpheres;
          addPreset('poke_lucario', lucarioGroup);

          // P14. Greninja ('poke_greninja': Stealth Navy Ninja Frog + 3-Pronged Head Fin + Pink Tongue Scarf + Spinning Hydro Water Shuriken)
          const greninjaGroup = new THREE.Group();
          const grenNavy = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.24, metalness: 0.28 });
          const grenYellow = new THREE.MeshStandardMaterial({ color: 0xfef08a, roughness: 0.32 });
          const grenTonguePink = new THREE.MeshStandardMaterial({ color: 0xf472b6, roughness: 0.28 });
          const waterShurikenMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.95, roughness: 0.08, metalness: 0.75, transparent: true, opacity: 0.90 });

          const grenBody = new THREE.Mesh(new THREE.SphereGeometry(0.58, 22, 22), grenNavy);
          grenBody.scale.set(1.08, 0.92, 0.88);
          grenBody.position.set(-0.06, -0.06, 0);
          const grenBelly = new THREE.Mesh(new THREE.SphereGeometry(0.48, 18, 18), grenYellow);
          grenBelly.scale.set(0.95, 0.82, 0.76);
          grenBelly.position.set(0.10, -0.10, 0);
          greninjaGroup.add(grenBody, grenBelly);

          const grenHead = new THREE.Mesh(new THREE.SphereGeometry(0.48, 20, 20), grenNavy);
          grenHead.scale.set(1.22, 0.84, 0.94);
          grenHead.position.set(0.32, 0.34, 0);
          const centerFin = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.62, 6), grenNavy);
          centerFin.rotation.z = 0.78;
          centerFin.position.set(0.08, 0.66, 0);
          greninjaGroup.add(grenHead, centerFin);

          // Pink Tongue Scarf wrapped around neck & billowing behind
          const scarfRing = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.13, 12, 22), grenTonguePink);
          scarfRing.rotation.x = Math.PI / 2.2;
          scarfRing.position.set(0.20, 0.18, 0);
          const scarfTail = new THREE.Group();
          scarfTail.position.set(-0.18, 0.22, 0);
          const scarfBlade1 = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.10, 0.28), grenTonguePink);
          scarfBlade1.position.set(-0.38, 0.08, 0);
          scarfBlade1.rotation.z = -0.22;
          const scarfBlade2 = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.09, 0.24), grenTonguePink);
          scarfBlade2.position.set(-0.78, 0.18, 0);
          scarfBlade2.rotation.z = 0.15;
          scarfTail.add(scarfBlade1, scarfBlade2);
          this.animatedSkinParts.greninjaScarf = scarfTail;
          greninjaGroup.add(scarfRing, scarfTail);

          [-1, 1].forEach(side => {
            const sideFin = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.56, 6), grenNavy);
            sideFin.position.set(0.12, 0.58, side * 0.34);
            sideFin.rotation.z = 0.68;
            sideFin.rotation.x = side * 0.35;
            const eyePatch = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), pixelWhiteMat);
            eyePatch.scale.set(1.2, 0.6, 0.5);
            eyePatch.position.set(0.48, 0.44, side * 0.34);
            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), gengarRedEye);
            eye.position.set(0.64, 0.42, side * 0.32);

            const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.42, 8), grenNavy);
            arm.position.set(0.32, -0.10, side * 0.42);
            arm.rotation.z = -Math.PI / 2.8;
            const handPad = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), pixelWhiteMat);
            handPad.position.set(0.52, -0.18, side * 0.46);

            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.44, 8), grenNavy);
            leg.position.set(-0.22, -0.48, side * 0.36);
            greninjaGroup.add(sideFin, eyePatch, eye, arm, handPad, leg);
          });

          // Giant Spinning Hydro Water Shuriken on Back
          const waterShuriken = new THREE.Group();
          waterShuriken.position.set(-0.42, 0.36, 0);
          waterShuriken.rotation.y = Math.PI / 2;
          const shurikenHub = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.045, 8, 18), waterShurikenMat);
          waterShuriken.add(shurikenHub);
          for (let b = 0; b < 4; b++) {
            const ba = (b / 4) * Math.PI * 2;
            const blade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.58, 4), waterShurikenMat);
            blade.scale.set(1.0, 1.0, 0.25);
            blade.position.set(Math.cos(ba) * 0.36, Math.sin(ba) * 0.36, 0);
            blade.rotation.z = ba - Math.PI / 2;
            waterShuriken.add(blade);
          }
          this.animatedSkinParts.greninjaShuriken = waterShuriken;
          greninjaGroup.add(waterShuriken);
          addPreset('poke_greninja', greninjaGroup);

          // P15. Snorlax ('poke_snorlax': Colossal Dark-Teal Sleeping Titan + Cream Belly & Face + Closed Sleeping Eyes + Big Paw Pads + Floating Zzz Rings)
          const snorlaxGroup = new THREE.Group();
          const snorlaxTeal = new THREE.MeshStandardMaterial({ color: 0x0f766e, roughness: 0.36, metalness: 0.10 });
          const snorlaxCream = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.38 });
          const snorlaxPawPink = new THREE.MeshStandardMaterial({ color: 0xfda4af, roughness: 0.35 });

          const snorBody = new THREE.Mesh(new THREE.SphereGeometry(0.80, 26, 26), snorlaxTeal);
          snorBody.scale.set(1.02, 0.98, 1.04);
          snorBody.position.set(-0.06, -0.10, 0);
          const snorBelly = new THREE.Mesh(new THREE.SphereGeometry(0.72, 24, 24), snorlaxCream);
          snorBelly.scale.set(0.92, 0.90, 0.92);
          snorBelly.position.set(0.14, -0.10, 0);
          snorlaxGroup.add(snorBody, snorBelly);

          const snorHead = new THREE.Mesh(new THREE.SphereGeometry(0.50, 22, 22), snorlaxTeal);
          snorHead.position.set(0.18, 0.48, 0);
          const snorFace = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 20), snorlaxCream);
          snorFace.position.set(0.32, 0.46, 0);
          snorlaxGroup.add(snorHead, snorFace);

          const snorArms = new THREE.Group();
          [-1, 1].forEach(side => {
            const ear = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.36, 8), snorlaxTeal);
            ear.position.set(0.14, 0.86, side * 0.34);
            ear.rotation.x = side * 0.32;

            // Closed Peaceful Sleeping Arc Eye
            const closedEye = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.20), pixelBlackMat);
            closedEye.position.set(0.70, 0.54, side * 0.22);
            const fang = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 6), pixelWhiteMat);
            fang.position.set(0.71, 0.38, side * 0.14);

            const arm = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 14), snorlaxTeal);
            arm.scale.set(1.3, 0.75, 0.85);
            arm.position.set(0.24, 0.04, side * 0.68);
            snorArms.add(arm);

            const foot = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 16), snorlaxCream);
            foot.scale.set(0.65, 1.0, 1.0);
            foot.position.set(0.46, -0.52, side * 0.44);
            const pad = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), snorlaxPawPink);
            pad.scale.set(0.45, 0.85, 0.85);
            pad.position.set(0.58, -0.52, side * 0.44);
            snorlaxGroup.add(ear, closedEye, fang, foot, pad);
          });
          const snorMouth = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.32), pixelBlackMat);
          snorMouth.position.set(0.71, 0.35, 0);
          this.animatedSkinParts.snorlaxArms = snorArms;
          snorlaxGroup.add(snorMouth, snorArms);

          // Floating Sleep Bubbles above Snorlax
          const snorZzz = new THREE.Group();
          snorZzz.position.set(0.42, 0.90, 0);
          for (let b = 0; b < 3; b++) {
            const bub = new THREE.Mesh(new THREE.SphereGeometry(0.08 + b * 0.04, 12, 12), auraSphereMat);
            bub.position.set(b * 0.14, b * 0.18, b * 0.08);
            snorZzz.add(bub);
          }
          this.animatedSkinParts.snorlaxZzz = snorZzz;
          snorlaxGroup.add(snorZzz);
          addPreset('poke_snorlax', snorlaxGroup);

          // P16. Mewtwo ('poke_mewtwo': Silver-Lavender Genetic Psychic Body + Secondary Brain-Stem Neck Tube + Purple Whip Tail + Dual Psystrike Rings)
          const mewtwoGroup = new THREE.Group();
          const m2Silver = new THREE.MeshStandardMaterial({ color: 0xe9d5ff, roughness: 0.22, metalness: 0.28 });
          const m2Purple = new THREE.MeshStandardMaterial({ color: 0x9333ea, emissive: 0x6b21a8, emissiveIntensity: 0.45, roughness: 0.25 });
          const psystrikeMat = new THREE.MeshStandardMaterial({ color: 0xd946ef, emissive: 0xc026d3, emissiveIntensity: 1.1, transparent: true, opacity: 0.82 });

          const m2Torso = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.22, 0.68, 16), m2Silver);
          m2Torso.position.set(0.02, 0.08, 0);
          const m2Pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.38, 18, 18), m2Purple);
          m2Pelvis.scale.set(0.95, 1.05, 0.92);
          m2Pelvis.position.set(-0.04, -0.34, 0);
          mewtwoGroup.add(m2Torso, m2Pelvis);

          const m2Head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 20), m2Silver);
          m2Head.scale.set(1.12, 0.96, 0.92);
          m2Head.position.set(0.18, 0.62, 0);
          // Iconic Secondary Brain-Stem Neck Tube
          const brainTube = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.065, 10, 18, Math.PI * 1.1), m2Silver);
          brainTube.position.set(-0.14, 0.44, 0);
          brainTube.rotation.z = Math.PI / 2;
          mewtwoGroup.add(m2Head, brainTube);

          [-1, 1].forEach(side => {
            const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.28, 8), m2Silver);
            horn.position.set(0.10, 0.94, side * 0.22);
            horn.rotation.x = side * 0.25;
            const eye = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.22, 6), psystrikeMat);
            eye.position.set(0.52, 0.62, side * 0.24);
            eye.rotation.y = side * Math.PI / 2;
            eye.rotation.z = -Math.PI / 3;

            const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.46, 8), m2Silver);
            arm.position.set(0.22, 0.14, side * 0.42);
            arm.rotation.z = -Math.PI / 3;
            const fingerSphere = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), m2Silver);
            fingerSphere.position.set(0.44, 0.04, side * 0.48);

            const thigh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 14), m2Purple);
            thigh.scale.set(0.9, 1.3, 0.9);
            thigh.position.set(-0.04, -0.58, side * 0.28);
            mewtwoGroup.add(horn, eye, arm, fingerSphere, thigh);
          });

          const m2Tail = new THREE.Group();
          m2Tail.position.set(-0.34, -0.34, 0);
          const m2TailCurve = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.11, 12, 24, Math.PI * 1.15), m2Purple);
          m2TailCurve.position.set(-0.38, 0.42, 0);
          m2TailCurve.rotation.z = Math.PI * 0.65;
          const m2TailBulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), m2Purple);
          m2TailBulb.position.set(-0.62, 0.92, 0);
          m2Tail.add(m2TailCurve, m2TailBulb);
          this.animatedSkinParts.mewtwoTail = m2Tail;
          mewtwoGroup.add(m2Tail);

          const psystrikeRings = new THREE.Group();
          const psyRing1 = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.038, 8, 28), psystrikeMat);
          psyRing1.rotation.x = Math.PI / 3;
          const psyRing2 = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.032, 8, 28), psystrikeMat);
          psyRing2.rotation.y = Math.PI / 3;
          psystrikeRings.add(psyRing1, psyRing2);
          this.animatedSkinParts.mewtwoPsystrike = psystrikeRings;
          mewtwoGroup.add(psystrikeRings);
          addPreset('poke_mewtwo', mewtwoGroup);

          // P17. Rayquaza ('poke_rayquaza': Majestic Legendary Emerald Sky Dragon)
          const rayquazaGroup = new THREE.Group();
          const rayEmerald = new THREE.MeshStandardMaterial({ color: 0x059669, emissive: 0x044d37, emissiveIntensity: 0.42, roughness: 0.22, metalness: 0.45 });
          const rayGold = new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xb45309, emissiveIntensity: 0.85, roughness: 0.14, metalness: 0.88 });
          const rayCrimson = new THREE.MeshStandardMaterial({ color: 0xdc2626, emissive: 0x7f1d1d, emissiveIntensity: 0.55, roughness: 0.24, metalness: 0.35 });
          const rayDark = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.35, metalness: 0.7 });
          const rayFangs = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.18, metalness: 0.2 });

          // 1. Dragon Head Assembly (Streamlined Snout, Menacing Jaw, Fangs & Swept Horns)
          const rayHeadGroup = new THREE.Group();
          rayHeadGroup.position.set(0.52, 0.16, 0);

          // Upper Snout & Cranial Helmet
          const snoutMesh = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.78, 8), rayEmerald);
          snoutMesh.rotation.z = -Math.PI / 2;
          snoutMesh.position.set(0.18, 0.04, 0);

          const craniumCap = new THREE.Mesh(new THREE.SphereGeometry(0.30, 16, 16), rayEmerald);
          craniumCap.scale.set(1.2, 0.85, 0.95);
          craniumCap.position.set(-0.06, 0.08, 0);

          // Forehead Ancient Delta Crest
          const foreheadCrest = new THREE.Mesh(new THREE.OctahedronGeometry(0.10, 0), rayGold);
          foreheadCrest.scale.set(1.4, 0.6, 0.8);
          foreheadCrest.position.set(0.12, 0.18, 0);

          // Articulated Lower Jaw with Crimson Mouth Lining
          const jawMesh = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.64, 8), rayEmerald);
          jawMesh.rotation.z = -Math.PI / 2 + 0.14;
          jawMesh.position.set(0.16, -0.10, 0);

          const mouthLining = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.42, 6), rayCrimson);
          mouthLining.rotation.z = -Math.PI / 2;
          mouthLining.position.set(0.14, -0.04, 0);

          // Sharp White Dragon Fangs (3 on each side)
          [-1, 1].forEach(side => {
            for (let f = 0; f < 3; f++) {
              const fang = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.11, 4), rayFangs);
              fang.position.set(0.12 + f * 0.10, -0.02, side * 0.13);
              fang.rotation.z = Math.PI;
              rayHeadGroup.add(fang);
            }

            // Piercing Yellow Dragon Eyes with Black Ocular Sockets
            const eyeSocket = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.05), rayDark);
            eyeSocket.position.set(0.08, 0.12, side * 0.22);
            eyeSocket.rotation.y = side * 0.28;

            const eyeIris = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 10), rayGold);
            eyeIris.position.set(0.09, 0.12, side * 0.23);

            const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.07, 0.03), rayDark);
            pupil.position.set(0.11, 0.12, side * 0.24);

            // Upper Swept Cranial Horns (Majestic Emerald Horns with Golden Runic Ring Bands)
            const upperHorn = new THREE.Mesh(new THREE.ConeGeometry(0.10, 0.82, 8), rayEmerald);
            upperHorn.position.set(-0.18, 0.45, side * 0.24);
            upperHorn.rotation.z = 0.96;
            upperHorn.rotation.x = side * 0.32;

            const hornRing1 = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.024, 6, 16), rayGold);
            hornRing1.position.copy(upperHorn.position);
            hornRing1.rotation.copy(upperHorn.rotation);

            const hornRing2 = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.020, 6, 16), rayGold);
            hornRing2.position.set(-0.28, 0.60, side * 0.32);
            hornRing2.rotation.copy(upperHorn.rotation);

            // Lower Cheek Horns with Crimson Aerodynamic Trim
            const cheekHorn = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.52, 8), rayEmerald);
            cheekHorn.position.set(-0.16, -0.06, side * 0.28);
            cheekHorn.rotation.z = 1.15;
            cheekHorn.rotation.x = side * 0.45;

            const cheekFinTrim = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.16, 4), rayCrimson);
            cheekFinTrim.position.set(-0.28, -0.12, side * 0.38);
            cheekFinTrim.rotation.copy(cheekHorn.rotation);

            rayHeadGroup.add(eyeSocket, eyeIris, pupil, upperHorn, hornRing1, hornRing2, cheekHorn, cheekFinTrim);
          });

          rayHeadGroup.add(snoutMesh, craniumCap, foreheadCrest, jawMesh, mouthLining);
          this.animatedSkinParts.rayquazaHead = rayHeadGroup;
          rayquazaGroup.add(rayHeadGroup);

          // 2. Articulated Serpentine Dragon Spine (7 Interlocking Smooth Undulating Segments)
          const rayquazaSegments = [];
          const segConfigs = [
            { x: 0.26, y: 0.12, z: 0, r: 0.32, hasFin: false },
            { x: -0.02, y: 0.04, z: 0.06, r: 0.35, hasFin: true, finDorsal: true },
            { x: -0.30, y: -0.02, z: -0.05, r: 0.33, hasFin: true, finLateral: true },
            { x: -0.58, y: 0.03, z: 0.04, r: 0.29, hasFin: true, finDorsal: true },
            { x: -0.84, y: -0.04, z: -0.04, r: 0.25, hasFin: true, finLateral: true },
            { x: -1.08, y: 0.02, z: 0.02, r: 0.20, hasFin: false },
            { x: -1.30, y: -0.02, z: 0, r: 0.15, isTailTip: true }
          ];

          segConfigs.forEach((sc, idx) => {
            const segGroup = new THREE.Group();
            segGroup.position.set(sc.x, sc.y, sc.z);
            segGroup.userData = { origX: sc.x, origY: sc.y, origZ: sc.z, idx };

            // Segmented Torso Shell
            const bodyMesh = new THREE.Mesh(new THREE.SphereGeometry(sc.r, 16, 16), rayEmerald);
            bodyMesh.scale.set(1.35, 0.95, 0.95);
            segGroup.add(bodyMesh);

            // Ancient Glowing Golden Runic Ring
            const goldRing = new THREE.Mesh(new THREE.TorusGeometry(sc.r * 0.96, 0.036, 8, 24), rayGold);
            goldRing.rotation.y = Math.PI / 2;
            segGroup.add(goldRing);

            // Dorsal Fin with Crimson Red Border
            if (sc.finDorsal) {
              const fin = new THREE.Mesh(new THREE.ConeGeometry(sc.r * 0.45, sc.r * 1.25, 4), rayEmerald);
              fin.position.set(0, sc.r + sc.r * 0.4, 0);
              fin.rotation.z = -0.35;

              const finTrim = new THREE.Mesh(new THREE.ConeGeometry(sc.r * 0.48, sc.r * 0.45, 4), rayCrimson);
              finTrim.position.set(0, sc.r + sc.r * 0.85, 0);
              finTrim.rotation.z = -0.35;

              segGroup.add(fin, finTrim);
            }

            // Lateral Aerodynamic Rudder Fins
            if (sc.finLateral) {
              [-1, 1].forEach(side => {
                const latFin = new THREE.Mesh(new THREE.ConeGeometry(sc.r * 0.35, sc.r * 1.05, 4), rayEmerald);
                latFin.position.set(0, 0, side * (sc.r + sc.r * 0.35));
                latFin.rotation.x = side * Math.PI / 2.3;
                latFin.rotation.z = -0.4;

                const latTrim = new THREE.Mesh(new THREE.ConeGeometry(sc.r * 0.38, sc.r * 0.35, 4), rayCrimson);
                latTrim.position.set(0, 0, side * (sc.r + sc.r * 0.72));
                latTrim.rotation.copy(latFin.rotation);

                segGroup.add(latFin, latTrim);
              });
            }

            // Tail Delta Double Rudder Fins
            if (sc.isTailTip) {
              [-1, 1].forEach(side => {
                const tailFin = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.55, 4), rayEmerald);
                tailFin.position.set(-0.14, side * 0.16, 0);
                tailFin.rotation.z = Math.PI / 2 + side * 0.45;

                const tailTrim = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.20, 4), rayCrimson);
                tailTrim.position.set(-0.32, side * 0.26, 0);
                tailTrim.rotation.copy(tailFin.rotation);

                segGroup.add(tailFin, tailTrim);
              });
            }

            rayquazaSegments.push(segGroup);
            rayquazaGroup.add(segGroup);
          });
          this.animatedSkinParts.rayquazaSegments = rayquazaSegments;

          // 3. Articulated Dragon Arms & Triple Ivory Claws
          [-1, 1].forEach(side => {
            const armGroup = new THREE.Group();
            armGroup.position.set(0.15, -0.06, side * 0.32);

            const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.08, 0.36, 8), rayEmerald);
            upperArm.rotation.z = -Math.PI / 3.2;
            upperArm.rotation.x = side * 0.35;

            const elbowJoint = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 8), rayGold);
            elbowJoint.position.set(0.15, -0.16, side * 0.08);

            // Three White Dragon Claws
            for (let c = -1; c <= 1; c++) {
              const claw = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.14, 4), rayFangs);
              claw.position.set(0.24, -0.22, side * 0.08 + c * 0.05);
              claw.rotation.z = -Math.PI / 2 + c * 0.25;
              armGroup.add(claw);
            }

            armGroup.add(upperArm, elbowJoint);
            rayquazaGroup.add(armGroup);
          });

          // 4. Delta-Stream / Dragon Ascent Celestial Halo Rings & Star Shards
          const rayDelta = new THREE.Group();
          const outerDeltaRing = new THREE.Mesh(new THREE.TorusGeometry(1.22, 0.040, 8, 32), rayGold);
          outerDeltaRing.rotation.x = Math.PI / 2.3;

          const innerDeltaRing = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.026, 8, 28), rayCrimson);
          innerDeltaRing.rotation.x = -Math.PI / 2.6;
          innerDeltaRing.rotation.y = 0.25;

          rayDelta.add(outerDeltaRing, innerDeltaRing);

          for (let m = 0; m < 6; m++) {
            const ma = (m / 6) * Math.PI * 2;
            const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), m % 2 === 0 ? rayEmerald : rayGold);
            shard.position.set(Math.cos(ma) * 1.22, Math.sin(ma * 2) * 0.15, Math.sin(ma) * 1.22);
            rayDelta.add(shard);
          }
          this.animatedSkinParts.rayquazaDelta = rayDelta;
          rayquazaGroup.add(rayDelta);

          addPreset('poke_rayquaza', rayquazaGroup);
        }

        // ------------------------------------------------------------------------
        // ZERO-ALLOCATION PARTICLE POOL (SCORE BURSTS, CRASHES & SKIN AURAS)
        // ------------------------------------------------------------------------
        initParticlePool() {
          for (let i = 0; i < 85; i++) {
            const mat = new THREE.MeshBasicMaterial({
              color: 0xffd13b,
              transparent: true,
              opacity: 1
            });
            const mesh = new THREE.Mesh(this.sharedGeo.particleBox, mat);
            mesh.visible = false;
            this.scene.add(mesh);
            this.particlePool.push({
              mesh,
              mat,
              active: false,
              vx: 0,
              vy: 0,
              vz: 0,
              gravityScale: 1.0,
              life: 0,
              maxLife: 0.6
            });
          }
        }

        spawnBurstFromPool(x, y, count, palette, isAura = false) {
          let spawned = 0;
          for (let i = 0; i < this.particlePool.length && spawned < count; i++) {
            const p = this.particlePool[i];
            if (p.active) continue;
            p.active = true;
            p.life = 0;
            p.maxLife = isAura ? (0.35 + Math.random() * 0.25) : (0.5 + Math.random() * 0.32);
            p.mat.color.setHex(palette[Math.floor(Math.random() * palette.length)]);
            p.mat.opacity = 1;

            if (isAura) {
              p.mesh.position.set(
                x - 0.55 + (Math.random() - 0.5) * 0.5,
                y + (Math.random() - 0.5) * 0.7,
                (Math.random() - 0.5) * 0.7
              );
              p.mesh.scale.setScalar(0.75);
              p.vx = -3.8 - Math.random() * 2.5;
              p.vy = (Math.random() - 0.4) * 2.2;
              p.vz = (Math.random() - 0.5) * 1.8;
              p.gravityScale = 0.15;
            } else {
              p.mesh.position.set(x, y + (Math.random() - 0.5) * 1.1, (Math.random() - 0.5) * 1.1);
              p.mesh.scale.setScalar(1.05);
              const angle = Math.random() * Math.PI * 2;
              const speed = 2.6 + Math.random() * 5.2;
              p.vx = Math.cos(angle) * speed;
              p.vy = Math.sin(angle) * speed + 2.2;
              p.vz = (Math.random() - 0.5) * 4.2;
              p.gravityScale = 1.0;
            }
            p.mesh.visible = true;
            spawned++;
          }
        }

        spawnScoreParticles(x, y) {
          const palette = (this.currentSkin && this.currentSkin.trail) || [0xffd13b, 0x4cd137, 0x38bdf8];
          this.spawnBurstFromPool(x, y, 16, palette, false);
        }

        spawnCrashParticles(x, y) {
          const palette = (this.currentSkin && this.currentSkin.trail) || [0xffd13b, 0xff8c1a, 0xffffff];
          this.spawnBurstFromPool(x, y, 18, palette, false);
        }

        // ------------------------------------------------------------------------
        // DETERMINISTIC PIPE SPAWNING & 3D PIPE SKIN TRIM BUILDER
        // ------------------------------------------------------------------------
        getDifficultyParams() {
          const diff = CONFIG.difficulties[this.selectedDifficulty] || CONFIG.difficulties.medium;
          const speedProgress = Math.min(this.score / (diff.speedRampScore || 45), 1.0);
          const gapProgress = Math.min(this.score / 40, 1.0);
          const targetMaxSpeed = Math.min(diff.maxSpeed || CONFIG.maxSpeed, CONFIG.baseSpeed * 2.0);

          const speed = Math.min(
            CONFIG.baseSpeed * 2.0,
            CONFIG.baseSpeed + speedProgress * (targetMaxSpeed - CONFIG.baseSpeed)
          );
          const pipeGap = diff.baseGap - gapProgress * (diff.baseGap - diff.minGap);

          // Scale vertical physics with horizontal speed (capped at 2.0x), with 20% slower fall at 1.8x-2.0x speed!
          const speedRatio = Math.min(2.0, speed / CONFIG.baseSpeed);
          const highSpeedFactor = Math.max(0, Math.min(1, (speedRatio - 1.55) / 0.25));
          const fallSlowdown = 1.0 - 0.20 * highSpeedFactor;

          const gravity = CONFIG.gravity * (speedRatio * speedRatio) * fallSlowdown;
          const flapImpulse = CONFIG.flapImpulse * speedRatio;
          const maxFallSpeed = CONFIG.maxFallSpeed * speedRatio * fallSlowdown;
          const speedMult = speedRatio.toFixed(1);

          return { speed, pipeGap, speedRatio, gravity, flapImpulse, maxFallSpeed, speedMult, label: diff.label };
        }

        spawnLobbyPreviewPipes() {
          this.clearPipes();
          const previewXs = [3.5, 11.5, 19.5];
          const previewCenters = [5.8, 7.2, 5.2];
          previewXs.forEach((x, idx) => {
            const gapSize = 5.0;
            const gapCenterY = previewCenters[idx];
            const bottomTopY = gapCenterY - gapSize * 0.5;
            const topBottomY = gapCenterY + gapSize * 0.5;
            const pipeGroup = new THREE.Group();
            pipeGroup.position.set(x, 0, 0);
            this.scene.add(pipeGroup);

            const pipeObj = {
              group: pipeGroup,
              x,
              prevX: x,
              gapCenterY,
              gapSize,
              bottomTopY,
              topBottomY,
              passed: true
            };
            this.rebuildPipePairVisuals(pipeObj);
            this.pipes.push(pipeObj);
          });
        }

        spawnPipePair(spawnX = CONFIG.pipeSpawnX) {
          const { pipeGap } = this.getDifficultyParams();
          const minCenterY = 2.9 + pipeGap * 0.5;
          const maxCenterY = CONFIG.ceilingY - 2.6 - pipeGap * 0.5;
          const gapCenterY = minCenterY + this.prng() * (maxCenterY - minCenterY);

          const bottomTopY = gapCenterY - pipeGap * 0.5;
          const topBottomY = gapCenterY + pipeGap * 0.5;

          const pipeGroup = new THREE.Group();
          pipeGroup.position.set(spawnX, 0, 0);
          this.scene.add(pipeGroup);

          const pipeObj = {
            group: pipeGroup,
            x: spawnX,
            prevX: spawnX,
            gapCenterY,
            gapSize: pipeGap,
            bottomTopY,
            topBottomY,
            passed: false
          };
          this.rebuildPipePairVisuals(pipeObj);
          this.pipes.push(pipeObj);
        }

        rebuildPipePairVisuals(pipeObj) {
          const group = pipeObj.group;
          while (group.children.length > 0) {
            group.remove(group.children[0]);
          }
          pipeObj.animatedRings = [];

          const bottomHeight = Math.max(0.8, pipeObj.bottomTopY - CONFIG.groundY);
          const bottomPipe = this.buildSinglePipeColumn(bottomHeight, true, pipeObj.animatedRings);
          bottomPipe.position.y = CONFIG.groundY;
          group.add(bottomPipe);

          const topMaxY = 24.0;
          const topHeight = Math.max(1.0, topMaxY - pipeObj.topBottomY);
          const topPipe = this.buildSinglePipeColumn(topHeight, false, pipeObj.animatedRings);
          topPipe.position.y = pipeObj.topBottomY;
          group.add(topPipe);
        }

        buildSinglePipeColumn(totalHeight, isBottom, animatedRingsOut) {
          const container = new THREE.Group();
          const capH = CONFIG.pipeCapHeight;
          const shaftH = Math.max(0.2, totalHeight - capH);

          const assets = this.activePipeAssets || this.getOrCreatePipeSkinAssets(PIPE_SKINS[0]);
          const bodyMat = assets.bodyMat;
          const trimMat = assets.trimMat;
          const coreMat = assets.coreMat || this.materials.pipeInside;
          const trimStyle = assets.pipeSkin.trimStyle;

          const shaft = new THREE.Mesh(this.sharedGeo.pipeUnitCylinder, bodyMat);
          shaft.scale.set(1, shaftH, 1);
          shaft.castShadow = true;
          shaft.receiveShadow = true;

          const cap = new THREE.Mesh(this.sharedGeo.pipeCapCylinder, bodyMat);
          cap.castShadow = true;
          cap.receiveShadow = true;

          const hole = new THREE.Mesh(this.sharedGeo.pipeHoleCylinder, coreMat);
          const aoRing = new THREE.Mesh(this.sharedGeo.pipeAOCylinder, this.materials.pipeAO);

          const capCenterY = isBottom ? (totalHeight - capH * 0.5) : (capH * 0.5);
          const shaftCenterY = isBottom ? (shaftH * 0.5) : (capH + shaftH * 0.5);

          if (isBottom) {
            shaft.position.y = shaftCenterY;
            cap.position.y = capCenterY;
            hole.position.y = totalHeight - 0.02;
            aoRing.position.y = totalHeight - capH - 0.1;
          } else {
            cap.position.y = capCenterY;
            shaft.position.y = shaftCenterY;
            hole.position.y = 0.02;
            aoRing.position.y = capH + 0.1;
          }

          container.add(shaft, cap, hole, aoRing);

          // Full-shaft 3D structural bands & vertical energy rails for non-basic pipe skins!
          if (trimStyle !== 'none' && shaftH > 1.6) {
            const bandCount = Math.min(6, Math.floor(shaftH / 1.8));
            for (let b = 1; b <= bandCount; b++) {
              const bandY = isBottom
                ? (totalHeight - capH - b * 1.75)
                : (capH + b * 1.75);
              if (bandY > 0.3 && bandY < totalHeight - 0.3) {
                const shaftBand = new THREE.Mesh(this.sharedGeo.pipeShaftBandTorus, trimMat);
                shaftBand.position.y = bandY;
                container.add(shaftBand);
              }
            }
          }

          const hasVerticalRails = (
            trimStyle === 'neon_rings' ||
            trimStyle === 'halos' ||
            trimStyle === 'laser_matrix' ||
            trimStyle === 'imperial_crown' ||
            trimStyle === 'nature_vines' ||
            trimStyle === 'clockwork_gears'
          );
          if (hasVerticalRails && shaftH > 0.6) {
            for (let r = 0; r < 4; r++) {
              const a = (r / 4) * Math.PI * 2 + Math.PI / 4;
              const rail = new THREE.Mesh(this.sharedGeo.pipeStrutBar, trimMat);
              rail.scale.set(1, shaftH, 1);
              rail.position.set(
                Math.cos(a) * (CONFIG.pipeRadius + 0.03),
                shaftCenterY,
                Math.sin(a) * (CONFIG.pipeRadius + 0.03)
              );
              container.add(rail);
            }
          }

          // Add 3D Structural Pipe Cap Trim based on the equipped Pipe Skin!
          if (trimStyle === 'classic_rim') {
            const topRing = new THREE.Mesh(this.sharedGeo.pipeCollarTorus, trimMat);
            topRing.position.y = capCenterY + capH * 0.38;
            const botRing = new THREE.Mesh(this.sharedGeo.pipeCollarTorus, trimMat);
            botRing.position.y = capCenterY - capH * 0.38;
            container.add(topRing, botRing);
          } else if (trimStyle === 'rivets') {
            const collar = new THREE.Mesh(this.sharedGeo.pipeCollarTorus, trimMat);
            collar.position.y = capCenterY;
            container.add(collar);
            for (let i = 0; i < 8; i++) {
              const a = (i / 8) * Math.PI * 2;
              const bolt = new THREE.Mesh(this.sharedGeo.pipeRivetSphere, trimMat);
              bolt.position.set(
                Math.cos(a) * (CONFIG.pipeCapRadius + 0.04),
                capCenterY,
                Math.sin(a) * (CONFIG.pipeCapRadius + 0.04)
              );
              container.add(bolt);
            }
          } else if (trimStyle === 'temple') {
            const topRing = new THREE.Mesh(this.sharedGeo.pipeCollarTorus, trimMat);
            topRing.position.y = capCenterY + capH * 0.42;
            const botRing = new THREE.Mesh(this.sharedGeo.pipeCollarTorus, trimMat);
            botRing.position.y = capCenterY - capH * 0.42;
            container.add(topRing, botRing);
          } else if (trimStyle === 'imperial_crown') {
            const topRing = new THREE.Mesh(this.sharedGeo.pipeCollarTorus, trimMat);
            topRing.position.y = capCenterY + capH * 0.40;
            const botRing = new THREE.Mesh(this.sharedGeo.pipeCollarTorus, trimMat);
            botRing.position.y = capCenterY - capH * 0.40;
            container.add(topRing, botRing);
            for (let i = 0; i < 8; i++) {
              const a = (i / 8) * Math.PI * 2;
              const spire = new THREE.Mesh(this.sharedGeo.pipeSpikeCone, trimMat);
              spire.position.set(
                Math.cos(a) * (CONFIG.pipeCapRadius + 0.04),
                capCenterY,
                Math.sin(a) * (CONFIG.pipeCapRadius + 0.04)
              );
              spire.rotation.z = isBottom ? 0 : Math.PI;
              container.add(spire);
            }
          } else if (trimStyle === 'nature_vines') {
            const vineRing = new THREE.Mesh(this.sharedGeo.pipeHaloTorus, trimMat);
            vineRing.position.y = isBottom ? (capCenterY - 0.16) : (capCenterY + 0.16);
            vineRing.rotation.x = 0.12;
            container.add(vineRing);
            if (animatedRingsOut) animatedRingsOut.push(vineRing);
            for (let i = 0; i < 6; i++) {
              const a = (i / 6) * Math.PI * 2;
              const bud = new THREE.Mesh(this.sharedGeo.pipeCrystalShard, trimMat);
              bud.position.set(
                Math.cos(a) * (CONFIG.pipeCapRadius + 0.06),
                capCenterY,
                Math.sin(a) * (CONFIG.pipeCapRadius + 0.06)
              );
              bud.rotation.z = -Math.PI / 2;
              bud.rotation.y = -a;
              container.add(bud);
            }
          } else if (trimStyle === 'clockwork_gears') {
            const gearRing = new THREE.Group();
            gearRing.position.y = isBottom ? (capCenterY - 0.14) : (capCenterY + 0.14);
            const torus = new THREE.Mesh(this.sharedGeo.pipeHaloTorus, trimMat);
            gearRing.add(torus);
            for (let i = 0; i < 12; i++) {
              const a = (i / 12) * Math.PI * 2;
              const tooth = new THREE.Mesh(this.sharedGeo.pipeRivetSphere, trimMat);
              tooth.scale.set(1.4, 0.9, 1.4);
              tooth.position.set(
                Math.cos(a) * (CONFIG.pipeCapRadius * 1.24),
                0,
                Math.sin(a) * (CONFIG.pipeCapRadius * 1.24)
              );
              gearRing.add(tooth);
            }
            const outerOrbit = new THREE.Mesh(this.sharedGeo.pipeOuterOrbitTorus, trimMat);
            outerOrbit.position.y = isBottom ? (capCenterY - 0.22) : (capCenterY + 0.22);
            outerOrbit.rotation.x = 0.14;
            container.add(gearRing, outerOrbit);
            if (animatedRingsOut) animatedRingsOut.push(gearRing, outerOrbit);
          } else if (trimStyle === 'neon_rings') {
            const ring1 = new THREE.Mesh(this.sharedGeo.pipeCollarTorus, trimMat);
            ring1.position.y = capCenterY;
            const ring2 = new THREE.Mesh(this.sharedGeo.pipeHaloTorus, trimMat);
            ring2.position.y = isBottom ? (capCenterY - 0.75) : (capCenterY + 0.75);
            container.add(ring1, ring2);
            if (animatedRingsOut) animatedRingsOut.push(ring2);
          } else if (trimStyle === 'crystals') {
            const collar = new THREE.Mesh(this.sharedGeo.pipeCollarTorus, trimMat);
            collar.position.y = capCenterY;
            container.add(collar);
            for (let i = 0; i < 8; i++) {
              const a = (i / 8) * Math.PI * 2;
              const shard = new THREE.Mesh(this.sharedGeo.pipeCrystalShard, trimMat);
              shard.position.set(
                Math.cos(a) * (CONFIG.pipeCapRadius + 0.04),
                capCenterY + (isBottom ? -0.22 : 0.22),
                Math.sin(a) * (CONFIG.pipeCapRadius + 0.04)
              );
              shard.rotation.z = isBottom ? Math.PI - 0.38 : 0.38;
              shard.rotation.y = -a;
              container.add(shard);
            }
          } else if (trimStyle === 'spikes') {
            const collar = new THREE.Mesh(this.sharedGeo.pipeCollarTorus, trimMat);
            collar.position.y = capCenterY;
            container.add(collar);
            for (let i = 0; i < 10; i++) {
              const a = (i / 10) * Math.PI * 2;
              const spike = new THREE.Mesh(this.sharedGeo.pipeSpikeCone, trimMat);
              spike.position.set(
                Math.cos(a) * (CONFIG.pipeCapRadius + 0.16),
                capCenterY,
                Math.sin(a) * (CONFIG.pipeCapRadius + 0.16)
              );
              spike.rotation.z = -Math.PI / 2;
              spike.rotation.y = -a;
              container.add(spike);
            }
          } else if (trimStyle === 'halos') {
            const halo1 = new THREE.Mesh(this.sharedGeo.pipeHaloTorus, trimMat);
            halo1.position.y = isBottom ? (capCenterY - 0.18) : (capCenterY + 0.18);
            halo1.rotation.x = 0.14;
            const halo2 = new THREE.Mesh(this.sharedGeo.pipeOuterOrbitTorus, trimMat);
            halo2.position.y = isBottom ? (capCenterY - 0.24) : (capCenterY + 0.24);
            halo2.rotation.y = 0.25;
            const collar = new THREE.Mesh(this.sharedGeo.pipeCollarTorus, trimMat);
            collar.position.y = isBottom ? (capCenterY + capH * 0.45) : (capCenterY - capH * 0.45);
            container.add(halo1, halo2, collar);
            if (animatedRingsOut) animatedRingsOut.push(halo1, halo2);
          } else if (trimStyle === 'laser_matrix') {
            const orbit1 = new THREE.Mesh(this.sharedGeo.pipeHaloTorus, trimMat);
            orbit1.position.y = isBottom ? (capCenterY - 0.18) : (capCenterY + 0.18);
            orbit1.rotation.x = 0.14;
            const orbit2 = new THREE.Mesh(this.sharedGeo.pipeOuterOrbitTorus, trimMat);
            orbit2.position.y = isBottom ? (capCenterY - 0.65) : (capCenterY + 0.65);
            orbit2.rotation.z = -0.20;
            container.add(orbit1, orbit2);
            if (animatedRingsOut) animatedRingsOut.push(orbit1, orbit2);
            for (let i = 0; i < 8; i++) {
              const a = (i / 8) * Math.PI * 2;
              const spike = new THREE.Mesh(this.sharedGeo.pipeSpikeCone, trimMat);
              spike.position.set(
                Math.cos(a) * (CONFIG.pipeCapRadius + 0.16),
                capCenterY,
                Math.sin(a) * (CONFIG.pipeCapRadius + 0.16)
              );
              spike.rotation.z = -Math.PI / 2;
              spike.rotation.y = -a;
              container.add(spike);
            }
          } else if (trimStyle === 'bball_hoop') {
            const rim = new THREE.Mesh(this.sharedGeo.pipeCollarTorus, trimMat);
            rim.position.y = capCenterY;
            const netGeo = new THREE.CylinderGeometry(CONFIG.pipeCapRadius * 1.02, CONFIG.pipeCapRadius * 0.72, 0.85, 14, 3, true);
            const netMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true });
            const net = new THREE.Mesh(netGeo, netMat);
            net.position.y = isBottom ? (capCenterY - 0.42) : (capCenterY + 0.42);
            container.add(rim, net);
          }

          return container;
        }

        // ------------------------------------------------------------------------
        // ANIMATE 3D SKIN ACCESSORIES, ORBITS & CONTINUOUS AURA TRAILS
        // ------------------------------------------------------------------------
        updateAnimatedSkinEffects(frameDt) {
          const t = this.elapsedTime || 0;
          const parts = this.animatedSkinParts;
          if (!parts) return;

          const flapAngle = this.leftWingPivot
            ? this.leftWingPivot.rotation.x
            : Math.sin(this.wingPhase || 0) * 0.65;

          if (parts.shurikenOrbit && this.skinModelGroups.shinobi && this.skinModelGroups.shinobi.visible) {
            parts.shurikenOrbit.rotation.y += frameDt * 4.5;
            parts.shurikenOrbit.children.forEach(s => { s.rotation.z += frameDt * 12; });
            if (parts.shinobiTail1) {
              parts.shinobiTail1.rotation.z = 0.25 + Math.sin(t * 14) * 0.18;
            }
          }

          if (parts.jetFlames && this.skinModelGroups.cyber_jet && this.skinModelGroups.cyber_jet.visible) {
            const scaleBoost = 0.85 + this.wingFlapBoost * 0.65 + Math.sin(t * 28) * 0.15;
            parts.jetFlames.forEach(f => { f.scale.set(1, scaleBoost, 1); });
          }

          if (parts.phoenixRibbons && this.skinModelGroups.phoenix && this.skinModelGroups.phoenix.visible) {
            parts.phoenixRibbons.forEach((r, idx) => {
              r.rotation.y = Math.sin(t * 10 + idx * 1.4) * 0.24;
              r.rotation.x = Math.cos(t * 8 + idx) * 0.16;
            });
          }

          if (parts.emperorCape && this.skinModelGroups.emperor && this.skinModelGroups.emperor.visible) {
            parts.emperorCape.rotation.z = (Math.PI / 2 - 0.32) + Math.sin(t * 9) * 0.12;
          }

          if (parts.planetOrbit && this.skinModelGroups.singularity && this.skinModelGroups.singularity.visible) {
            parts.planetOrbit.rotation.y += frameDt * 2.8;
            parts.planetOrbit.rotation.z = Math.sin(t * 2) * 0.22;
            if (parts.accretionDisk) {
              parts.accretionDisk.rotation.z += frameDt * 5.5;
            }
          }

          if (parts.seraphHalo1 && this.skinModelGroups.seraphim && this.skinModelGroups.seraphim.visible) {
            parts.seraphHalo1.rotation.x = Math.PI / 2 + Math.sin(t * 3.5) * 0.35;
            parts.seraphHalo1.rotation.y += frameDt * 2.8;
            parts.seraphHalo2.rotation.x = Math.PI / 2 - Math.cos(t * 3.5) * 0.45;
            parts.seraphHalo2.rotation.z -= frameDt * 3.4;
          }

          if (parts.runeOrbit && this.skinModelGroups.archmage && this.skinModelGroups.archmage.visible) {
            parts.runeOrbit.rotation.y -= frameDt * 3.2;
            parts.runeOrbit.children.forEach((rune, idx) => {
              rune.position.y = 0.15 + Math.sin(t * 5 + idx * 1.5) * 0.18;
              rune.rotation.x += frameDt * 4;
              rune.rotation.y += frameDt * 4;
            });
          }

          if (parts.dragonTail && this.skinModelGroups.dragon && this.skinModelGroups.dragon.visible) {
            parts.dragonTail.rotation.y = Math.sin(t * 9) * 0.24;
            parts.dragonTail.rotation.z = Math.cos(t * 7) * 0.12;
          }

          if (parts.lightningOrbit && this.skinModelGroups.valkyrie && this.skinModelGroups.valkyrie.visible) {
            parts.lightningOrbit.rotation.y += frameDt * 6.5;
            parts.lightningOrbit.rotation.x = Math.sin(t * 12) * 0.25;
          }

          if (parts.reactorCore && this.skinModelGroups.mecha_bahamut && this.skinModelGroups.mecha_bahamut.visible) {
            parts.reactorCore.rotation.x += frameDt * 8;
            parts.reactorCore.rotation.y += frameDt * 6;
          }

          if (parts.eclipseHalo && this.skinModelGroups.reaper && this.skinModelGroups.reaper.visible) {
            const pulse = 1 + Math.sin(t * 7) * 0.12;
            parts.eclipseHalo.scale.setScalar(pulse);
          }

          if (parts.wispOrbit && this.skinModelGroups.sylvan_stag && this.skinModelGroups.sylvan_stag.visible) {
            parts.wispOrbit.rotation.y += frameDt * 3.0;
            parts.wispOrbit.children.forEach((w, idx) => {
              w.position.y = 0.12 + Math.sin(t * 6 + idx * 1.6) * 0.20;
            });
          }

          if (parts.heliosAstrolabe && this.skinModelGroups.helios && this.skinModelGroups.helios.visible) {
            parts.heliosAstrolabe.rotation.z += frameDt * 2.5;
          }

          if (parts.leviathanTentacles && this.skinModelGroups.leviathan && this.skinModelGroups.leviathan.visible) {
            parts.leviathanTentacles.forEach((tent, idx) => {
              tent.rotation.y = Math.sin(t * 9 + idx * 1.5) * 0.26;
              tent.rotation.x = Math.cos(t * 7 + idx) * 0.18;
            });
          }

          if (parts.chaosSwordOrbit && this.skinModelGroups.chaos_overlord && this.skinModelGroups.chaos_overlord.visible) {
            parts.chaosSwordOrbit.rotation.y += frameDt * 4.2;
            parts.chaosSwordOrbit.children.forEach((sw, idx) => {
              sw.position.y = 0.1 + Math.sin(t * 7 + idx) * 0.18;
            });
            if (parts.chaosHalo1 && parts.chaosHalo2) {
              parts.chaosHalo1.rotation.x = Math.PI / 2 + Math.sin(t * 4) * 0.35;
              parts.chaosHalo2.rotation.y += frameDt * 5.0;
            }
          }

          if (parts.sakuraPetals && this.skinModelGroups.shogun && this.skinModelGroups.shogun.visible) {
            parts.sakuraPetals.rotation.y += frameDt * 3.8;
            parts.sakuraPetals.children.forEach((pet, idx) => {
              pet.position.y = 0.12 + Math.sin(t * 6 + idx * 1.3) * 0.16;
              pet.rotation.x += frameDt * 5.0;
            });
          }

          if (parts.raijinDrums && this.skinModelGroups.raijin && this.skinModelGroups.raijin.visible) {
            parts.raijinDrums.rotation.z += frameDt * 2.8;
          }

          if (parts.chronosGears && this.skinModelGroups.chronos && this.skinModelGroups.chronos.visible) {
            parts.chronosGears[0].rotation.z += frameDt * 2.2;
            parts.chronosGears[1].rotation.z -= frameDt * 3.6;
            parts.chronosGears[2].rotation.z += frameDt * 1.8;
          }

          if (parts.nebulaGalaxy && this.skinModelGroups.nebula_god && this.skinModelGroups.nebula_god.visible) {
            parts.nebulaGalaxy.rotation.y += frameDt * 3.2;
            parts.nebulaGalaxy.rotation.z = Math.sin(t * 2.5) * 0.18;
          }

          if (parts.eternityRings && this.skinModelGroups.eternity_sovereign && this.skinModelGroups.eternity_sovereign.visible) {
            parts.eternityRings[0].rotation.x += frameDt * 2.4;
            parts.eternityRings[0].rotation.y += frameDt * 1.8;
            parts.eternityRings[1].rotation.y -= frameDt * 3.0;
            parts.eternityRings[1].rotation.z += frameDt * 2.1;
            parts.eternityRings[2].rotation.x -= frameDt * 2.8;
            parts.eternityRings[2].rotation.z -= frameDt * 2.4;
          }

          if (parts.ragnarokMeteors && this.skinModelGroups.ragnarok && this.skinModelGroups.ragnarok.visible) {
            parts.ragnarokMeteors.rotation.y += frameDt * 4.8;
            parts.ragnarokMeteors.children.forEach((m, idx) => {
              m.position.y = (idx % 2 === 0 ? 0.22 : -0.22) + Math.sin(t * 8 + idx) * 0.18;
              m.rotation.x += frameDt * 6.0;
            });
            if (parts.ragnarokCore) {
              parts.ragnarokCore.rotation.y -= frameDt * 4.5;
              parts.ragnarokCore.rotation.z = Math.sin(t * 5) * 0.25;
            }
          }

          // Animate the 3 Original Easy-Only Endgame Models (100, 125, 150)
          if (parts.nautilusTurbines && this.skinModelGroups.nautilus_leviathan && this.skinModelGroups.nautilus_leviathan.visible) {
            parts.nautilusTurbines.forEach((turb, idx) => {
              turb.rotation.z += frameDt * (idx === 0 ? 6.5 : -6.5);
            });
          }

          if (parts.dreamcatcherWeb && this.skinModelGroups.dreamcatcher_monarch && this.skinModelGroups.dreamcatcher_monarch.visible) {
            parts.dreamcatcherWeb.rotation.z = Math.sin(t * 2.5) * 0.14;
            parts.dreamcatcherWeb.position.y = 0.45 + Math.sin(t * 4.0) * 0.06;
          }

          if (parts.edenLanterns && this.skinModelGroups.bonsai_island && this.skinModelGroups.bonsai_island.visible) {
            parts.edenLanterns.rotation.y += frameDt * 2.4;
            parts.edenLanterns.children.forEach((lan, idx) => {
              lan.position.y = 0.22 + Math.sin(t * 4.5 + idx * 1.2) * 0.18;
            });
            if (parts.edenWaterfall) {
              parts.edenWaterfall.children.forEach((st, idx) => {
                st.scale.x = 0.9 + Math.sin(t * 14 + idx) * 0.22;
              });
            }
          }

          // Animate the 10 Meme Quest 3D Models
          if (parts.troll67Orbit && this.skinModelGroups.troll_67 && this.skinModelGroups.troll_67.visible) {
            parts.troll67Orbit.rotation.y += frameDt * 3.8;
            parts.troll67Orbit.children.forEach((num, idx) => {
              num.position.y = 0.25 + Math.sin(t * 7 + idx * 3.14) * 0.22;
              num.rotation.y = -parts.troll67Orbit.rotation.y;
            });
          }

          if (parts.troll21Propeller && this.skinModelGroups.troll_21 && this.skinModelGroups.troll_21.visible) {
            parts.troll21Propeller.rotation.y += frameDt * 18.0;
          }

          if (parts.trollBonkStars && this.skinModelGroups.troll_wall_bonk && this.skinModelGroups.troll_wall_bonk.visible) {
            parts.trollBonkStars.rotation.y += frameDt * 5.2;
            parts.trollBonkStars.rotation.z = Math.sin(t * 4.5) * 0.20;
          }

          if (parts.trollSlotReels && this.skinModelGroups.troll_jackpot && this.skinModelGroups.troll_jackpot.visible) {
            parts.trollSlotReels.children.forEach((reel, idx) => {
              reel.rotation.z += frameDt * (8.0 + idx * 2.5);
            });
          }

          if (parts.trollMlgCrosshair && this.skinModelGroups.troll_mlg && this.skinModelGroups.troll_mlg.visible) {
            parts.trollMlgCrosshair.rotation.y += frameDt * 4.5;
          }

          if (parts.trollSleepBubbles && this.skinModelGroups.troll_sleepy && this.skinModelGroups.troll_sleepy.visible) {
            parts.trollSleepBubbles.children.forEach((bub, idx) => {
              const s = 0.85 + Math.sin(t * 4 + idx * 1.1) * 0.25;
              bub.scale.setScalar(s);
            });
          }

          if (parts.trollCoffeeSteam && this.skinModelGroups.troll_caffeine && this.skinModelGroups.troll_caffeine.visible) {
            parts.trollCoffeeSteam.children.forEach((puff, idx) => {
              puff.position.y = ((t * 1.4 + idx * 0.25) % 0.8);
              puff.rotation.y += frameDt * 8.0;
            });
          }

          if (parts.trollNerdSpiral && this.skinModelGroups.troll_nerd && this.skinModelGroups.troll_nerd.visible) {
            parts.trollNerdSpiral.rotation.z -= frameDt * 3.5;
          }

          if (parts.trollClownTail && this.skinModelGroups.troll_clown && this.skinModelGroups.troll_clown.visible) {
            parts.trollClownTail.rotation.x += frameDt * 9.0;
          }

          if (parts.trollTrafficTower && this.skinModelGroups.troll_traffic && this.skinModelGroups.troll_traffic.visible) {
            parts.trollTrafficTower.rotation.y = Math.sin(t * 3.5) * 0.35;
          }

          // Dynamic Animations for True Pokémon Characters (Strictly locked to calibrated 0.60m hitbox center!)
          if (this.currentSkin && (this.currentSkin.category === 'pokemon' || (this.currentSkin.modelPreset && this.currentSkin.modelPreset.startsWith('poke_')))) {
            const presetKey = this.currentSkin.modelPreset;
            const activePokeGroup = presetKey && this.skinModelGroups ? this.skinModelGroups[presetKey] : null;
            if (activePokeGroup && presetKey !== 'poke_jigglypuff') {
              const baseScale = activePokeGroup.userData.baseScale || 0.78;
              const basePos = activePokeGroup.userData.basePos || { x: -0.08, y: -0.10, z: 0 };
              const hopBoost = (this.wingFlapBoost || 0) * 0.08;
              activePokeGroup.position.set(basePos.x, basePos.y, basePos.z);
              const stretch = 1.0 + hopBoost * 0.55 + Math.sin(t * 11) * 0.02;
              const squash = 1.0 / Math.sqrt(Math.max(0.88, stretch));
              activePokeGroup.scale.set(baseScale * squash, baseScale * stretch, baseScale * squash);
            }
            if (parts.pikachuArms) parts.pikachuArms.rotation.x = flapAngle * 0.65;
            if (parts.pikachuTail) parts.pikachuTail.rotation.z = Math.sin(t * 9) * 0.24 + (this.wingFlapBoost || 0) * 0.25;
            if (parts.charmanderArms) parts.charmanderArms.rotation.x = flapAngle * 0.6;
            if (parts.charmanderFlame) {
              const fScale = 0.88 + Math.sin(t * 18) * 0.18 + Math.cos(t * 26) * 0.10 + (this.wingFlapBoost || 0) * 0.22;
              parts.charmanderFlame.scale.set(fScale, fScale * 1.08, fScale);
              parts.charmanderFlame.rotation.z = -0.45 + Math.sin(t * 12) * 0.16;
            }
            if (parts.charmanderTail) parts.charmanderTail.rotation.z = Math.sin(t * 4.5) * 0.15;
            if (parts.squirtleFlippers) parts.squirtleFlippers.rotation.x = flapAngle * 0.75;
            if (parts.squirtleTail) parts.squirtleTail.rotation.z = Math.sin(t * 5) * 0.22;
            if (parts.bulbasaurVines) {
              parts.bulbasaurVines.rotation.z = Math.sin(t * 6) * 0.28;
              parts.bulbasaurVines.rotation.x = flapAngle * 0.45;
            }
            if (parts.bidoofTail) parts.bidoofTail.rotation.z = Math.sin(t * 7.5) * 0.28;
            if (parts.bidoofCrown) {
              parts.bidoofCrown.rotation.y += frameDt * 2.5;
              parts.bidoofCrown.position.y = 1.05 + Math.sin(t * 4) * 0.08;
            }
            if (parts.mewTail) parts.mewTail.rotation.z = Math.sin(t * 4) * 0.32;
            if (parts.mewAura) {
              parts.mewAura.rotation.z += frameDt * 1.6;
              parts.mewAura.scale.setScalar(0.95 + Math.sin(t * 4.5) * 0.07);
            }
            if (parts.eeveeTail) parts.eeveeTail.rotation.z = -Math.PI / 3 + Math.sin(t * 5.5) * 0.28;
            if (parts.eeveeStones) {
              parts.eeveeStones.rotation.y += frameDt * 3.2;
              parts.eeveeStones.children.forEach((st, idx) => {
                st.rotation.x += frameDt * 5.0;
                st.position.y = 0.15 + Math.sin(t * 5 + idx * 2.1) * 0.15;
              });
            }
            if (this.skinModelGroups.poke_jigglypuff && this.skinModelGroups.poke_jigglypuff.visible) {
              const jGroup = this.skinModelGroups.poke_jigglypuff;
              const jScale = jGroup.userData.baseScale || 0.78;
              const jPos = jGroup.userData.basePos || { x: 0, y: 0, z: 0 };
              jGroup.position.set(jPos.x, jPos.y, jPos.z);
              const squish = 1.0 + Math.sin(t * 9) * 0.05 + (this.wingFlapBoost || 0) * 0.06;
              jGroup.scale.set(jScale * squish, jScale * (2.0 - squish), jScale * squish);
            }
            if (parts.jigglyNotes) {
              parts.jigglyNotes.rotation.y += frameDt * 2.8;
              parts.jigglyNotes.children.forEach((nt, idx) => {
                nt.position.y = 0.20 + Math.sin(t * 5.5 + idx * 2.0) * 0.18;
              });
            }
            if (parts.magikarpTail) parts.magikarpTail.rotation.y = Math.sin(t * 16) * 0.58;
            if (parts.magikarpSplash) {
              parts.magikarpSplash.rotation.y += frameDt * 3.0;
              parts.magikarpSplash.scale.setScalar(0.92 + Math.sin(t * 12) * 0.12);
            }
            if (parts.meowthCoins) {
              parts.meowthCoins.rotation.y += frameDt * 3.6;
              parts.meowthCoins.children.forEach((c, idx) => {
                c.rotation.z += frameDt * 7.0;
                c.position.y = 0.12 + Math.sin(t * 6 + idx) * 0.16;
              });
            }
            if (parts.charizardWings) {
              parts.charizardWings.children.forEach((wp, idx) => {
                const side = idx === 0 ? -1 : 1;
                wp.rotation.x = side * flapAngle * 0.85;
              });
            }
            if (parts.charizardFlame) {
              const zScale = 0.90 + Math.sin(t * 20) * 0.20 + (this.wingFlapBoost || 0) * 0.25;
              parts.charizardFlame.scale.set(zScale, zScale * 1.12, zScale);
            }
            if (parts.charizardTail) parts.charizardTail.rotation.z = Math.sin(t * 5.0) * 0.16;
            if (parts.gengarArms) parts.gengarArms.rotation.x = flapAngle * 0.55;
            if (parts.gengarWisps) {
              parts.gengarWisps.rotation.y -= frameDt * 3.8;
              parts.gengarWisps.children.forEach((w, idx) => {
                w.position.y = 0.10 + Math.sin(t * 6.5 + idx * 2.1) * 0.20;
              });
            }
            if (parts.lucarioSensors) parts.lucarioSensors.rotation.z = Math.sin(t * 7) * 0.18;
            if (parts.lucarioAuraSpheres) {
              parts.lucarioAuraSpheres.children.forEach((orb, idx) => {
                orb.rotation.y += frameDt * 6.0;
                orb.rotation.z -= frameDt * 4.5;
                const s = 0.90 + Math.sin(t * 10 + idx) * 0.15 + (this.wingFlapBoost || 0) * 0.15;
                orb.scale.setScalar(s);
              });
            }
            if (parts.greninjaScarf) {
              parts.greninjaScarf.rotation.z = Math.sin(t * 12) * 0.22;
              parts.greninjaScarf.rotation.y = Math.cos(t * 9) * 0.16;
            }
            if (parts.greninjaShuriken) {
              parts.greninjaShuriken.rotation.z -= frameDt * 14.0;
            }
            if (parts.snorlaxArms) parts.snorlaxArms.rotation.x = flapAngle * 0.45;
            if (parts.snorlaxZzz) {
              parts.snorlaxZzz.children.forEach((bub, idx) => {
                const s = 0.85 + Math.sin(t * 4.5 + idx * 1.3) * 0.22;
                bub.scale.setScalar(s);
              });
            }
            if (parts.mewtwoTail) parts.mewtwoTail.rotation.z = Math.sin(t * 4.5) * 0.20;
            if (parts.mewtwoPsystrike) {
              parts.mewtwoPsystrike.children[0].rotation.z += frameDt * 3.5;
              parts.mewtwoPsystrike.children[1].rotation.x -= frameDt * 4.2;
            }
            if (parts.rayquazaSegments && Array.isArray(parts.rayquazaSegments)) {
              parts.rayquazaSegments.forEach((seg, sIdx) => {
                const origY = (seg.userData && seg.userData.origY) || 0;
                const origZ = (seg.userData && seg.userData.origZ) || 0;
                seg.position.y = origY + Math.sin(t * 6.5 - sIdx * 0.48) * 0.08;
                seg.position.z = origZ + Math.cos(t * 5.5 - sIdx * 0.42) * 0.06;
                seg.rotation.z = Math.cos(t * 6.5 - sIdx * 0.48) * 0.14;
                seg.rotation.y = Math.sin(t * 4.5 - sIdx * 0.35) * 0.08;
              });
            }
            if (parts.rayquazaHead) {
              parts.rayquazaHead.rotation.z = Math.sin(t * 6.5) * 0.08 - (this.wingFlapBoost || 0) * 0.18;
              parts.rayquazaHead.position.y = 0.16 + Math.sin(t * 6.5) * 0.05;
            }
            if (parts.rayquazaDelta) {
              parts.rayquazaDelta.rotation.y += frameDt * 4.5;
              parts.rayquazaDelta.rotation.z = Math.sin(t * 3.5) * 0.22;
            }
          }

          // Animate 3D Orbital Halos & Laser Containment Rings on High-Tier Pipes!
          for (let i = 0; i < this.pipes.length; i++) {
            const rings = this.pipes[i].animatedRings;
            if (!rings || rings.length === 0) continue;
            for (let r = 0; r < rings.length; r++) {
              rings[r].rotation.y += frameDt * (r % 2 === 0 ? 1.8 : -2.4);
              rings[r].rotation.z += frameDt * (r % 2 === 0 ? 2.4 : -3.2);
            }
          }

          // Continuous passive flight trail particles for EPIC / MYTHIC / GODLIKE skins
          if (this.currentSkin && this.currentSkin.auraRate > 0 && (this.state === GAME_STATE.PLAYING || this.state === GAME_STATE.START)) {
            this.auraSpawnAccum += frameDt * this.currentSkin.auraRate * 18;
            if (this.auraSpawnAccum >= 1) {
              const count = Math.min(2, Math.floor(this.auraSpawnAccum));
              this.auraSpawnAccum -= count;
              this.spawnBurstFromPool(
                this.birdGroup.position.x,
                this.birdGroup.position.y,
                count,
                this.currentSkin.trail,
                true
              );
            }
          }
        }

        /**
         * Renders a live 60FPS 360-degree 3D turntable close-up into the Locker Spotlight Canvas
         * using a single WebGL context before the main full-window render pass!
         */
        renderSpotlight3DTurntable() {
          if (this.state !== GAME_STATE.START || !this.spotlightCamera || !this.renderer) return;
          if (this.currentAppView !== 'skins') return;

          const birdView = document.getElementById('panel-view-bird-skins');
          const pipeView = document.getElementById('panel-view-pipe-skins');
          const isBirdTab = birdView && birdView.style.display !== 'none';
          const isPipeTab = pipeView && pipeView.style.display !== 'none';
          if (!isBirdTab && !isPipeTab) return;

          const targetCanvas = document.getElementById(isBirdTab ? 'bird-spotlight-canvas' : 'pipe-spotlight-canvas');
          if (!targetCanvas) return;

          const size = 160;
          const savedRotY = this.birdMeshGroup ? this.birdMeshGroup.rotation.y : 0;
          const savedRotZ = this.birdGroup ? this.birdGroup.rotation.z : 0;

          try {
            if (isBirdTab && this.birdMeshGroup && this.birdGroup) {
              // Smooth 360-degree turntable rotation so the player sees horns, wings, back katanas, jetpacks & tails!
              this.birdMeshGroup.rotation.y = this.elapsedTime * 1.35;
              this.birdGroup.rotation.z = 0.06;
              const bx = this.birdGroup.position.x;
              const by = this.birdGroup.position.y + 0.12;
              this.spotlightCamera.position.set(bx + 0.45, by + 0.42, 4.15);
              this.spotlightCamera.lookAt(bx - 0.15, by + 0.08, 0);
            } else if (isPipeTab) {
              if (this.pipes.length === 0 && typeof this.spawnLobbyPreviewPipes === 'function') {
                this.spawnLobbyPreviewPipes();
              }
              if (this.pipes.length > 0) {
                const p0 = this.pipes[0];
                const px = p0.x;
                const py = p0.bottomTopY - 0.45;
                const angle = Math.sin(this.elapsedTime * 1.1) * 0.55;
                this.spotlightCamera.position.set(
                  px + Math.sin(angle) * 5.2,
                  py + 0.65,
                  Math.cos(angle) * 5.2
                );
                this.spotlightCamera.lookAt(px, py, 0);
              }
            }

            const w = Math.max(1, window.innerWidth);
            const h = Math.max(1, window.innerHeight);
            const safeSize = Math.min(size, w, h);

            this.renderer.setViewport(0, 0, safeSize, safeSize);
            this.renderer.setScissor(0, 0, safeSize, safeSize);
            this.renderer.setScissorTest(true);
            this.renderer.render(this.scene, this.spotlightCamera);
            this.renderer.setScissorTest(false);

            const ctx = targetCanvas.getContext('2d');
            const glCanvas = this.renderer.domElement;
            if (ctx && glCanvas && glCanvas.width > 0 && glCanvas.height > 0) {
              const dpr = this.renderer.getPixelRatio();
              const srcSize = Math.min(Math.round(safeSize * dpr), glCanvas.width, glCanvas.height);
              if (srcSize > 0) {
                ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
                ctx.drawImage(
                  glCanvas,
                  0,
                  Math.max(0, glCanvas.height - srcSize),
                  srcSize,
                  srcSize,
                  0,
                  0,
                  targetCanvas.width,
                  targetCanvas.height
                );
              }
            }
          } catch (err) {
            // Never allow a spotlight thumbnail error to interrupt the main 3D viewport
          } finally {
            this.renderer.setScissorTest(false);
            if (this.birdMeshGroup) this.birdMeshGroup.rotation.y = savedRotY;
            if (this.birdGroup) this.birdGroup.rotation.z = savedRotZ;
            this.renderer.setViewport(0, 0, Math.max(1, window.innerWidth), Math.max(1, window.innerHeight));
          }
        }
}

window.FlappyBird3DModels = FlappyBird3DModels;
