/**
 * ═══════════════════════════════════════════════════════════════
 * NEXUS L5 VCU — 3D Auto-Rickshaw Model
 * Geometrically accurate delta-trike with independent rear wheels,
 * steerable front fork, dynamic pitch/roll, and glowing effects.
 * ═══════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';

export class VehicleModel {
    constructor(scene) {
        this.group = new THREE.Group();
        this.steerGroup = null;
        this.wheelL = null;
        this.wheelR = null;
        this.wheelF = null;
        this.headlightGlow = null;
        this.hubGlowL = null;
        this.hubGlowR = null;

        this._buildChassis();
        this._buildWheels();
        this._buildLights();
        this._buildHubGlow();

        scene.add(this.group);
    }

    _buildChassis() {
        const yellow = new THREE.MeshStandardMaterial({
            color: 0xFFD700,
            roughness: 0.5,
            metalness: 0.15,
        });
        const green = new THREE.MeshStandardMaterial({
            color: 0x006600,
            roughness: 0.4,
            metalness: 0.1,
        });
        const dark = new THREE.MeshStandardMaterial({
            color: 0x111111,
            roughness: 0.8,
            metalness: 0.3,
        });
        const frame = new THREE.MeshStandardMaterial({
            color: 0x333333,
            roughness: 0.6,
            metalness: 0.5,
        });

        // ── Floor pan ──
        const base = new THREE.Mesh(
            new THREE.BoxGeometry(2.4, 0.12, 1.15),
            new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.6, roughness: 0.4 })
        );
        base.position.set(0.35, 0.28, 0);
        base.castShadow = true;
        this.group.add(base);

        // ── Rear passenger compartment ──
        const rearLower = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 1.15), yellow);
        rearLower.position.set(-0.25, 0.6, 0);
        rearLower.castShadow = true;
        this.group.add(rearLower);

        // ── Side panels (green) ──
        const sideL = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 0.04), green);
        sideL.position.set(-0.25, 1.25, -0.56);
        this.group.add(sideL);

        const sideR = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 0.04), green);
        sideR.position.set(-0.25, 1.25, 0.56);
        this.group.add(sideR);

        // ── Back panel ──
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.35, 1.15), green);
        back.position.set(-0.83, 0.975, 0);
        this.group.add(back);

        // ── Front cowl ──
        const cowl = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.85), yellow);
        cowl.position.set(1.15, 0.6, 0);
        cowl.rotation.z = -0.1;
        cowl.castShadow = true;
        this.group.add(cowl);

        // ── Roof ──
        const roof = new THREE.Mesh(
            new THREE.BoxGeometry(2.0, 0.05, 1.3),
            dark
        );
        roof.position.set(0.15, 1.63, 0);
        roof.castShadow = true;
        this.group.add(roof);

        // ── Windshield (transparent) ──
        const glassMat = new THREE.MeshStandardMaterial({
            color: 0x88ccff,
            transparent: true,
            opacity: 0.25,
            roughness: 0.1,
            metalness: 0.5,
        });
        const windshield = new THREE.Mesh(
            new THREE.BoxGeometry(0.03, 0.6, 0.8),
            glassMat
        );
        windshield.position.set(0.85, 1.2, 0);
        windshield.rotation.z = -0.15;
        this.group.add(windshield);

        // ── Support pillars ──
        const pillarGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.85);
        const pillar1 = new THREE.Mesh(pillarGeo, frame);
        pillar1.position.set(1.1, 1.2, 0.38);
        this.group.add(pillar1);
        const pillar2 = new THREE.Mesh(pillarGeo, frame);
        pillar2.position.set(1.1, 1.2, -0.38);
        this.group.add(pillar2);

        // ── Rear bench seats ──
        const seatMat = new THREE.MeshStandardMaterial({ color: 0x442200, roughness: 0.9 });
        const seatL = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.45), seatMat);
        seatL.position.set(-0.4, 0.92, -0.3);
        this.group.add(seatL);
        const seatR = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.45), seatMat);
        seatR.position.set(-0.4, 0.92, 0.3);
        this.group.add(seatR);

        // ── Handlebar ──
        const handlebar = new THREE.Mesh(
            new THREE.CylinderGeometry(0.02, 0.02, 0.5),
            frame
        );
        handlebar.position.set(1.3, 1.0, 0);
        handlebar.rotation.x = Math.PI / 2;
        this.group.add(handlebar);
    }

    _buildWheels() {
        const makeWheel = () => {
            const g = new THREE.Group();

            // Tire
            const tireGeo = new THREE.TorusGeometry(0.203, 0.06, 12, 24);
            const tire = new THREE.Mesh(tireGeo, new THREE.MeshStandardMaterial({
                color: 0x1a1a1a, roughness: 0.95, metalness: 0.0
            }));
            g.add(tire);

            // Rim
            const rimGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 20);
            rimGeo.rotateX(Math.PI / 2);
            const rim = new THREE.Mesh(rimGeo, new THREE.MeshStandardMaterial({
                color: 0xbbbbbb, metalness: 0.85, roughness: 0.2
            }));
            g.add(rim);

            // Spokes
            const spokeMat = new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.7 });
            for (let i = 0; i < 6; i++) {
                const spoke = new THREE.Mesh(
                    new THREE.BoxGeometry(0.18, 0.008, 0.008),
                    spokeMat
                );
                spoke.rotation.z = (i * Math.PI) / 3;
                g.add(spoke);
            }

            return g;
        };

        // Rear wheels
        this.wheelL = makeWheel();
        this.wheelL.position.set(-0.65, 0.203, -0.575);
        this.group.add(this.wheelL);

        this.wheelR = makeWheel();
        this.wheelR.position.set(-0.65, 0.203, 0.575);
        this.group.add(this.wheelR);

        // Front steerable wheel
        this.steerGroup = new THREE.Group();
        this.steerGroup.position.set(1.35, 0.203, 0);

        this.wheelF = makeWheel();
        this.steerGroup.add(this.wheelF);

        // Fork
        const forkMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.5 });
        const fork = new THREE.Mesh(
            new THREE.CylinderGeometry(0.018, 0.018, 0.85),
            forkMat
        );
        fork.position.set(0, 0.42, 0);
        fork.rotation.z = -0.15;
        this.steerGroup.add(fork);

        this.group.add(this.steerGroup);
    }

    _buildLights() {
        // Headlight
        const hlGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.05, 16);
        hlGeo.rotateZ(Math.PI / 2);
        const hlMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xffffcc,
            emissiveIntensity: 0.8,
        });
        this.headlightGlow = new THREE.Mesh(hlGeo, hlMat);
        this.headlightGlow.position.set(1.46, 0.65, 0);
        this.group.add(this.headlightGlow);

        // Headlight beam (cone)
        const beamGeo = new THREE.ConeGeometry(2, 8, 16, 1, true);
        const beamMat = new THREE.MeshBasicMaterial({
            color: 0xffffcc,
            transparent: true,
            opacity: 0.02,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.rotation.z = -Math.PI / 2;
        beam.position.set(5.5, 0.65, 0);
        this.group.add(beam);

        // Tail lights
        const tailMat = new THREE.MeshStandardMaterial({
            color: 0xff0000,
            emissive: 0xff0000,
            emissiveIntensity: 0.5,
        });
        const tailL = new THREE.Mesh(
            new THREE.BoxGeometry(0.03, 0.06, 0.08),
            tailMat
        );
        tailL.position.set(-0.86, 0.65, -0.45);
        this.group.add(tailL);

        const tailR = new THREE.Mesh(
            new THREE.BoxGeometry(0.03, 0.06, 0.08),
            tailMat
        );
        tailR.position.set(-0.86, 0.65, 0.45);
        this.group.add(tailR);
    }

    _buildHubGlow() {
        // Hub motor glow rings (for active torque visualization)
        const glowGeo = new THREE.RingGeometry(0.15, 0.21, 24);
        const glowMatL = new THREE.MeshBasicMaterial({
            color: 0xff00ff,
            transparent: true,
            opacity: 0.0,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const glowMatR = new THREE.MeshBasicMaterial({
            color: 0x00ccff,
            transparent: true,
            opacity: 0.0,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.hubGlowL = new THREE.Mesh(glowGeo, glowMatL);
        this.hubGlowL.position.set(-0.65, 0.203, -0.64);
        this.hubGlowL.rotation.y = Math.PI / 2;
        this.group.add(this.hubGlowL);

        this.hubGlowR = new THREE.Mesh(glowGeo.clone(), glowMatR);
        this.hubGlowR.position.set(-0.65, 0.203, 0.64);
        this.hubGlowR.rotation.y = Math.PI / 2;
        this.group.add(this.hubGlowR);
    }

    /**
     * Update vehicle 3D model from physics state.
     */
    update(state, dt) {
        if (!state) return;

        // Position
        this.group.position.set(state.x, 0, state.z);
        this.group.rotation.y = state.yaw;

        // Dynamic pitch & roll from accelerations
        const G = 9.81;
        const targetPitch = (state.ax / G) * 0.04;
        const targetRoll = (state.ay / G) * 0.08;

        this.group.rotation.z = THREE.MathUtils.lerp(
            this.group.rotation.z, targetPitch, 5.0 * dt
        );
        this.group.rotation.x = THREE.MathUtils.lerp(
            this.group.rotation.x, targetRoll, 5.0 * dt
        );

        // Steering
        this.steerGroup.rotation.y = state.delta || 0;

        // Wheel spin
        const wheelAngularVel = state.vx / 0.203;
        const spinDelta = wheelAngularVel * dt;
        this.wheelL.rotation.z -= spinDelta;
        this.wheelR.rotation.z -= spinDelta;
        this.wheelF.rotation.z -= spinDelta;

        // Hub motor glow intensity (proportional to torque)
        const maxT = 80;
        const tlNorm = Math.abs(state.TL || 0) / maxT;
        const trNorm = Math.abs(state.TR || 0) / maxT;
        this.hubGlowL.material.opacity = tlNorm * 0.6;
        this.hubGlowR.material.opacity = trNorm * 0.6;
    }
}

