/**
 * ═══════════════════════════════════════════════════════════════
 * NEXUS L5 VCU — 3D Scene Environment
 * Three.js scene with ground, grid, lighting, fog, arena walls,
 * ice patches, and particle effects.
 * ═══════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';

export class SceneManager {
    constructor() {
        this.scene = new THREE.Scene();
        this.camera = null;
        this.renderer = null;
        this.icePatch1 = null;
        this.icePatch2 = null;
        this.particles = null;

        this._initRenderer();
        this._initCamera();
        this._initLighting();
        this._initGround();
        this._initGrid();
        this._initWalls();
        this._initMudPatches();
        this._initParticles();

        this._initCameraControls();

        this.isGradient = false;
        this.dynamicWalls = [];

        window.addEventListener('resize', () => this._onResize());
    }

    _initRenderer() {
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            powerPreference: 'high-performance',
            alpha: false
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.2;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        document.getElementById('webgl-container').appendChild(this.renderer.domElement);
    }

    _initCamera() {
        this.camera = new THREE.PerspectiveCamera(
            55, window.innerWidth / window.innerHeight, 0.1, 1000
        );
        this.camera.position.set(-8, 5, 3);
    }

    _initLighting() {
        // Ambient: soft blue-ish fill
        const ambient = new THREE.AmbientLight(0x334455, 0.6);
        this.scene.add(ambient);

        // Hemisphere: sky/ground distinction
        const hemi = new THREE.HemisphereLight(0x88aacc, 0x222222, 0.4);
        this.scene.add(hemi);

        // Main directional light (sun)
        const dir = new THREE.DirectionalLight(0xffeedd, 1.0);
        dir.position.set(30, 50, 20);
        dir.castShadow = true;
        dir.shadow.mapSize.width = 2048;
        dir.shadow.mapSize.height = 2048;
        dir.shadow.camera.near = 0.5;
        dir.shadow.camera.far = 200;
        dir.shadow.camera.left = -50;
        dir.shadow.camera.right = 50;
        dir.shadow.camera.top = 50;
        dir.shadow.camera.bottom = -50;
        dir.shadow.bias = -0.001;
        this.scene.add(dir);

        // Cyan accent point light
        const accent = new THREE.PointLight(0x00ffcc, 0.3, 100);
        accent.position.set(0, 20, 0);
        this.scene.add(accent);

        // Fog for depth
        this.scene.fog = new THREE.FogExp2(0x0a0f14, 0.004);

        // GTA Camera State
        this.camYawOffset = 0;
        this.camPitch = 0.3; // slightly looking down
        this.camDistance = 10;
        this.isDraggingCam = false;
        this.prevMousePos = { x: 0, y: 0 };
    }

    _initGround() {
        // Procedural asphalt texture
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        // Base color
        ctx.fillStyle = '#1a1a20';
        ctx.fillRect(0, 0, 512, 512);

        // Asphalt noise
        for (let i = 0; i < 8000; i++) {
            const gray = 20 + Math.random() * 25;
            ctx.fillStyle = `rgb(${gray}, ${gray}, ${gray + 5})`;
            ctx.beginPath();
            ctx.arc(
                Math.random() * 512, Math.random() * 512,
                Math.random() * 1.5 + 0.3, 0, Math.PI * 2
            );
            ctx.fill();
        }

        // Subtle lane markings (dashed lines)
        ctx.strokeStyle = 'rgba(100, 100, 120, 0.2)';
        ctx.lineWidth = 2;
        ctx.setLineDash([20, 30]);
        ctx.beginPath();
        ctx.moveTo(256, 0);
        ctx.lineTo(256, 512);
        ctx.stroke();

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(200, 200);
        this.asphaltTexture = texture;

        const geom = new THREE.PlaneGeometry(800, 800, 100, 100); // More segments for mountain warp
        const ground = new THREE.Mesh(
            geom,
            new THREE.MeshStandardMaterial({
                map: texture,
                roughness: 0.85,
                metalness: 0.0,
            })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.groundMesh = ground;
        this.baseGroundPositions = geom.attributes.position.clone();
        this.scene.add(ground);
    }

    _initGrid() {
        const grid = new THREE.GridHelper(400, 40, 0x00ffcc, 0x222233);
        grid.position.y = 0.02;
        grid.material.opacity = 0.12;
        grid.material.transparent = true;
        this.scene.add(grid);
    }

    _initWalls() {
        const wallMat = new THREE.MeshStandardMaterial({
            color: 0x00ffcc,
            transparent: true,
            opacity: 0.08,
            emissive: 0x00ffcc,
            emissiveIntensity: 0.1,
        });

        const positions = [
            { pos: [0, 5, -200], size: [400, 10, 1] },
            { pos: [0, 5, 200], size: [400, 10, 1] },
            { pos: [-200, 5, 0], size: [1, 10, 400] },
            { pos: [200, 5, 0], size: [1, 10, 400] },
        ];

        positions.forEach(({ pos, size }) => {
            const wall = new THREE.Mesh(
                new THREE.BoxGeometry(...size),
                wallMat
            );
            wall.position.set(...pos);
            this.scene.add(wall);
        });

        // Glowing floor edge lines
        const edgeMat = new THREE.MeshBasicMaterial({
            color: 0x00ffcc,
            transparent: true,
            opacity: 0.3,
        });

        const edges = [
            { pos: [0, 0.05, -200], size: [400, 0.1, 0.5] },
            { pos: [0, 0.05, 200], size: [400, 0.1, 0.5] },
            { pos: [-200, 0.05, 0], size: [0.5, 0.1, 400] },
            { pos: [200, 0.05, 0], size: [0.5, 0.1, 400] },
        ];

        edges.forEach(({ pos, size }) => {
            const edge = new THREE.Mesh(
                new THREE.BoxGeometry(...size),
                edgeMat
            );
            edge.position.set(...pos);
            this.scene.add(edge);
        });
    }

    _initMudPatches() {
        // High-fidelity Procedural Mud texture
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');
        // Very dark wet mud base
        ctx.fillStyle = '#1A1108';
        ctx.fillRect(0, 0, 1024, 1024);

        // Draw globs of thick mud
        for (let i = 0; i < 40000; i++) {
            const r = 30 + Math.random() * 20;
            const g = 20 + Math.random() * 15;
            const b = 10 + Math.random() * 10;
            ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
            ctx.beginPath();
            ctx.ellipse(Math.random() * 1024, Math.random() * 1024, Math.random() * 10 + 2, Math.random() * 5 + 1, Math.random() * Math.PI, 0, 2 * Math.PI);
            ctx.fill();
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(200, 200);
        this.mudTexture = texture;

        const bumpTexture = new THREE.CanvasTexture(canvas);
        bumpTexture.wrapS = THREE.RepeatWrapping;
        bumpTexture.wrapT = THREE.RepeatWrapping;
        bumpTexture.repeat.set(200, 200);
        this.mudBumpTexture = bumpTexture;

        // Legacy split patch removed since user wants FULL ground mud
        this.isMudSplit = false;
    }

    _initParticles() {
        const count = 200;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const velocities = new Float32Array(count * 3);

        for (let i = 0; i < count * 3; i++) {
            positions[i] = 0;
            velocities[i] = 0;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color: 0xcccccc, // Base color, changed dynamically
            size: 0.1,
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
        });

        this.particles = new THREE.Points(geometry, material);
        this.particleVelocities = velocities;
        this.particleLifetimes = new Float32Array(count).fill(0);
        this.scene.add(this.particles);
    }

    setMudVisible(visible) {
        if (this.isMudSplit === visible) return;
        this.isMudSplit = visible;

        if (visible) {
            this.groundMesh.material.map = this.mudTexture;
            this.groundMesh.material.bumpMap = this.mudBumpTexture;
            this.groundMesh.material.bumpScale = 0.5;
            this.groundMesh.material.roughness = 0.35; // wet look
            this.groundMesh.material.color.setHex(0xaaaaaa);
            this.scene.fog.color.setHex(0x0a0503); // muddy fog
        } else {
            this.groundMesh.material.map = this.asphaltTexture;
            this.groundMesh.material.bumpMap = null;
            this.groundMesh.material.roughness = 0.85;
            this.groundMesh.material.color.setHex(0xffffff);
            this.scene.fog.color.setHex(0x0a0f14); // cyber fog
        }
        this.groundMesh.material.needsUpdate = true;
    }

    setGradientMode(enabled, vehicleX = 0, vehicleYaw = 0, vehicleZ = 0) {
        if (this.isGradient === enabled) return;
        this.isGradient = enabled;

        // Show loading overlay
        this._showLoadingOverlay(enabled ? 'Loading Gradient Terrain...' : 'Loading Road...');

        if (enabled) {
            // ── Create right-angled triangle ramp ──
            if (!this.rampGroup) {
                this.rampGroup = new THREE.Group();

                const rampLength = 120;  // horizontal run
                const rampHeight = rampLength * Math.tan(15 * Math.PI / 180);  // 15° slope
                const rampWidth = 14;    // road width

                // Build triangular prism from BufferGeometry
                // Cross-section: right-angled triangle at x=0
                //   (0,0) -- (rampLength, 0) -- (rampLength, rampHeight)
                const shape = new THREE.Shape();
                shape.moveTo(0, 0);
                shape.lineTo(rampLength, 0);
                shape.lineTo(rampLength, rampHeight);
                shape.closePath();

                const extrudeSettings = {
                    steps: 1,
                    depth: rampWidth,
                    bevelEnabled: false,
                };
                const rampGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);

                // Procedural rocky surface texture
                const rampCanvas = document.createElement('canvas');
                rampCanvas.width = 512;
                rampCanvas.height = 512;
                const rctx = rampCanvas.getContext('2d');
                rctx.fillStyle = '#2a1f15';
                rctx.fillRect(0, 0, 512, 512);
                for (let i = 0; i < 5000; i++) {
                    const g = 30 + Math.random() * 30;
                    rctx.fillStyle = `rgb(${g + 10}, ${g}, ${g - 5})`;
                    rctx.beginPath();
                    rctx.arc(Math.random() * 512, Math.random() * 512, Math.random() * 3, 0, Math.PI * 2);
                    rctx.fill();
                }
                const rampTex = new THREE.CanvasTexture(rampCanvas);
                rampTex.wrapS = THREE.RepeatWrapping;
                rampTex.wrapT = THREE.RepeatWrapping;
                rampTex.repeat.set(4, 4);

                const rampMat = new THREE.MeshStandardMaterial({
                    map: rampTex,
                    roughness: 0.95,
                    metalness: 0.0,
                    side: THREE.DoubleSide,
                });

                const rampMesh = new THREE.Mesh(rampGeo, rampMat);
                rampMesh.castShadow = true;
                rampMesh.receiveShadow = true;
                // Orient: shape is in XY plane, extruded along Z
                // We need to shift so the ramp is centered on z=0
                rampMesh.position.set(0, 0.01, -rampWidth / 2);

                this.rampGroup.add(rampMesh);

                // ── Glowing cyan border edges around the triangle ──
                const edgeMat = new THREE.LineBasicMaterial({
                    color: 0x00ffcc,
                    linewidth: 2,
                    transparent: true,
                    opacity: 0.6,
                });

                // Front triangle face edges (z = -rampWidth/2)
                const frontEdges = new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(0, 0.02, -rampWidth / 2),
                    new THREE.Vector3(rampLength, 0.02, -rampWidth / 2),
                    new THREE.Vector3(rampLength, rampHeight, -rampWidth / 2),
                    new THREE.Vector3(0, 0.02, -rampWidth / 2),
                ]);
                this.rampGroup.add(new THREE.Line(frontEdges, edgeMat));

                // Back triangle face edges (z = +rampWidth/2)
                const backEdges = new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(0, 0.02, rampWidth / 2),
                    new THREE.Vector3(rampLength, 0.02, rampWidth / 2),
                    new THREE.Vector3(rampLength, rampHeight, rampWidth / 2),
                    new THREE.Vector3(0, 0.02, rampWidth / 2),
                ]);
                this.rampGroup.add(new THREE.Line(backEdges, edgeMat));

                // Connecting edges between front and back
                const connEdges = [
                    [new THREE.Vector3(0, 0.02, -rampWidth / 2), new THREE.Vector3(0, 0.02, rampWidth / 2)],
                    [new THREE.Vector3(rampLength, 0.02, -rampWidth / 2), new THREE.Vector3(rampLength, 0.02, rampWidth / 2)],
                    [new THREE.Vector3(rampLength, rampHeight, -rampWidth / 2), new THREE.Vector3(rampLength, rampHeight, rampWidth / 2)],
                ];
                connEdges.forEach(pts => {
                    const geo = new THREE.BufferGeometry().setFromPoints(pts);
                    this.rampGroup.add(new THREE.Line(geo, edgeMat));
                });

                // Store dimensions for coordinate calculations
                this.rampLength = rampLength;
                this.rampHeight = rampHeight;

                this.scene.add(this.rampGroup);
            }

            // Position ramp ahead of vehicle
            this.rampGroup.visible = true;
            this.rampGroup.position.set(
                vehicleX + 5 * Math.cos(vehicleYaw),
                0,
                vehicleZ - 5 * Math.sin(vehicleYaw)
            );
            this.rampGroup.rotation.y = -vehicleYaw;

            // Darken fog for mountain feel
            this.scene.fog.color.setHex(0x1a1210);
            this.groundMesh.material.color.setHex(0x554444);

        } else {
            if (this.rampGroup) {
                this.rampGroup.visible = false;
            }
            // Restore normal road appearance
            if (!this.isMudSplit) {
                this.groundMesh.material.color.setHex(0xffffff);
                this.scene.fog.color.setHex(0x0a0f14);
            }
        }

        // Hide loading after a short delay
        setTimeout(() => this._hideLoadingOverlay(), 300);
    }

    /**
     * Get the Y elevation at a given X position along the ramp slope.
     * Used by app.js to elevate the vehicle along the ramp.
     */
    getRampElevation(worldX, worldZ) {
        if (!this.isGradient || !this.rampGroup || !this.rampGroup.visible) return 0;

        // Transform world position into ramp-local coordinates
        const dx = worldX - this.rampGroup.position.x;
        const dz = worldZ - this.rampGroup.position.z;
        const yaw = -this.rampGroup.rotation.y;
        const localX = dx * Math.cos(yaw) + dz * Math.sin(yaw);

        if (localX < 0 || localX > this.rampLength) return 0;

        // Linear slope: height = localX * tan(15°)
        return localX * (this.rampHeight / this.rampLength);
    }

    _showLoadingOverlay(text) {
        let overlay = document.getElementById('terrain-loading-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'terrain-loading-overlay';
            overlay.style.cssText = `
                position: fixed; inset: 0; z-index: 100;
                background: rgba(0,0,0,0.7);
                display: flex; align-items: center; justify-content: center;
                flex-direction: column; gap: 12px;
                font-family: 'Rajdhani', sans-serif;
                color: #00ffcc; font-size: 18px;
                letter-spacing: 3px; text-transform: uppercase;
                transition: opacity 0.3s ease;
            `;
            document.body.appendChild(overlay);
        }
        overlay.textContent = text;
        overlay.style.opacity = '1';
        overlay.style.display = 'flex';
    }

    _hideLoadingOverlay() {
        const overlay = document.getElementById('terrain-loading-overlay');
        if (overlay) {
            overlay.style.opacity = '0';
            setTimeout(() => { overlay.style.display = 'none'; }, 300);
        }
    }

    updateParticles(vehicleX, vehicleZ, vehicleYaw, speed, dt) {
        if (!this.particles) return;
        const positions = this.particles.geometry.attributes.position.array;
        const count = positions.length / 3;

        for (let i = 0; i < count; i++) {
            this.particleLifetimes[i] -= dt;

            if (this.particleLifetimes[i] <= 0 && Math.abs(speed) > 2) {
                // Spawn at rear wheels
                const side = Math.random() > 0.5 ? 0.575 : -0.575;
                const localX = -0.65 + (Math.random() - 0.5) * 0.3;
                const localZ = side + (Math.random() - 0.5) * 0.2;

                const cos = Math.cos(vehicleYaw);
                const sin = Math.sin(vehicleYaw);
                positions[i * 3] = vehicleX + localX * cos - localZ * sin;
                positions[i * 3 + 1] = 0.1 + Math.random() * 0.3;
                positions[i * 3 + 2] = vehicleZ + localX * sin + localZ * cos;

                this.particleVelocities[i * 3] = (Math.random() - 0.5) * 0.5;
                this.particleVelocities[i * 3 + 1] = Math.random() * 1.0;
                this.particleVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.5;

                this.particleLifetimes[i] = 0.5 + Math.random() * 1.0;

                // Color based on mud or asphalt
                if (this.isMudSplit && localZ > 0) { // left wheel in mud
                    this.particles.material.color.setHex(0x3a2512); // Mud splatter
                } else {
                    this.particles.material.color.setHex(0xcccccc); // Dust
                }
            }

            positions[i * 3] += this.particleVelocities[i * 3] * dt;
            positions[i * 3 + 1] += this.particleVelocities[i * 3 + 1] * dt;
            positions[i * 3 + 2] += this.particleVelocities[i * 3 + 2] * dt;
            this.particleVelocities[i * 3 + 1] -= 1.5 * dt; // gravity
        }

        this.particles.geometry.attributes.position.needsUpdate = true;
    }

    updateCamera(vehicleX, vehicleZ, vehicleYaw, vehicleY, dt, speed) {
        // GTA Style: Auto-center camera back behind the car when driving forward + not dragging
        if (!this.isDraggingCam && Math.abs(speed) > 1.0) {
            // Exponential decay back to 0 offset
            this.camYawOffset -= this.camYawOffset * 2.0 * dt;
        }

        // Determine absolute spherical coordinates
        // vehicleYaw is 0 when pointing +X. So to place camera behind it, we add PI.
        const totalYaw = vehicleYaw + this.camYawOffset + Math.PI;

        const horizontalDist = this.camDistance * Math.cos(this.camPitch);
        const verticalDist = this.camDistance * Math.sin(this.camPitch);

        // Calculate offset relative to vehicle
        const offsetX = horizontalDist * Math.cos(totalYaw);
        const offsetZ = -horizontalDist * Math.sin(totalYaw);

        const lookTarget = new THREE.Vector3(vehicleX, vehicleY + 1.2, vehicleZ);
        const targetCamPos = new THREE.Vector3(vehicleX + offsetX, vehicleY + verticalDist, vehicleZ + offsetZ);

        // Smoothly interpolate camera position (rubber-banding effect)
        this.camera.position.lerp(targetCamPos, 8.0 * dt);
        this.camera.lookAt(lookTarget);
    }

    updateWalls(wallData) {
        if (!this.brickMat) {
            const canvas = document.createElement('canvas');
            canvas.width = 512;
            canvas.height = 512;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#8B4513'; // Base mortar
            ctx.fillRect(0, 0, 512, 512);

            ctx.fillStyle = '#B22222'; // Brutalist Red Bricks
            for (let y = 0; y < 512; y += 64) {
                const offset = (y / 64) % 2 === 0 ? 0 : 64;
                for (let x = -128; x < 512; x += 128) {
                    ctx.fillRect(x + offset + 4, y + 4, 120, 56);
                }
            }
            const texture = new THREE.CanvasTexture(canvas);
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(4, 2);

            const bumpTexture = new THREE.CanvasTexture(canvas);
            bumpTexture.wrapS = THREE.RepeatWrapping;
            bumpTexture.wrapT = THREE.RepeatWrapping;
            bumpTexture.repeat.set(4, 2);

            this.brickMat = new THREE.MeshStandardMaterial({
                map: texture,
                bumpMap: bumpTexture,
                bumpScale: 0.15,
                roughness: 0.9,
            });
        }

        if (!this.wallMeshes) this.wallMeshes = [];

        // Prune extra meshes
        while (this.wallMeshes.length > wallData.length) {
            const mesh = this.wallMeshes.pop();
            this.scene.remove(mesh);
        }

        // Add or update walls
        wallData.forEach((data, i) => {
            if (i >= this.wallMeshes.length) {
                const geo = new THREE.BoxGeometry(data.width, 3, data.thick);
                const mesh = new THREE.Mesh(geo, this.brickMat);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                this.scene.add(mesh);
                this.wallMeshes.push(mesh);
            }

            const mesh = this.wallMeshes[i];
            let elev = 0;
            if (this.isMountain) {
                elev = data.x * Math.tan(15 * Math.PI / 180);
            }
            mesh.position.set(data.x, elev + 1.5, data.z);
            mesh.rotation.y = -data.yaw;
            mesh.rotation.z = this.isMountain ? 15 * Math.PI / 180 : 0;
        });
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }

    _initCameraControls() {
        const dom = this.renderer.domElement;

        dom.addEventListener('mousedown', (e) => {
            if (e.button === 0 || e.button === 2) {
                this.isDraggingCam = true;
                this.prevMousePos = { x: e.clientX, y: e.clientY };
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (this.isDraggingCam) {
                const dx = e.clientX - this.prevMousePos.x;
                const dy = e.clientY - this.prevMousePos.y;

                this.camYawOffset -= dx * 0.005;
                this.camPitch -= dy * 0.005;

                // Clamp pitch so we don't go under ground or flip over
                this.camPitch = Math.max(0.05, Math.min(Math.PI / 2 - 0.05, this.camPitch));

                this.prevMousePos = { x: e.clientX, y: e.clientY };
            }
        });

        window.addEventListener('mouseup', () => {
            this.isDraggingCam = false;
        });

        dom.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.camDistance += e.deltaY * 0.01;
            this.camDistance = Math.max(4, Math.min(30, this.camDistance));
        }, { passive: false });

        // Prevent context menu on right click
        dom.addEventListener('contextmenu', e => e.preventDefault());
    }

    _onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

