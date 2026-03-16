/**
 * ═══════════════════════════════════════════════════════════════
 * NEXUS L5 VCU — Main Application Orchestrator
 * Connects Python physics backend (WebSocket) to Three.js
 * visual engine. Handles state interpolation at 60 FPS.
 * ═══════════════════════════════════════════════════════════════
 */

import { SceneManager } from './scene.js';
import { VehicleModel } from './vehicle.js';
import { Dashboard } from './dashboard.js';
import { Controls } from './controls.js';
import { MLDashboard } from './ml_dashboard.js';
import { ManifoldDashboard } from './manifold_dashboard.js';
import { PQCClient } from './pqc.js';
import { PQCDashboard } from './pqc_dashboard.js';

// ── Configuration ──
const WS_URL = `ws://${window.location.hostname || 'localhost'}:8000/ws`;
const INPUT_SEND_INTERVAL = 16; // ~60 Hz input sending

class App {
    constructor() {
        this.scene = new SceneManager();
        this.vehicle = new VehicleModel(this.scene.scene);
        this.dashboard = new Dashboard();
        this.controls = new Controls();
        this.mlDashboard = new MLDashboard();
        this.manifoldDashboard = new ManifoldDashboard();

        // PQC Security Layer
        this.pqc = new PQCClient();
        this.pqcDashboard = new PQCDashboard();
        this.pqcHandshakeDone = false;

        // PQC toggle callback
        this.pqcDashboard.onToggle(async (enabled) => {
            const wasEnabled = this.pqc.enabled;
            this.pqc.setEnabled(enabled);
            // Notify server of toggle
            if (this.wsConnected && this.ws && this.pqcHandshakeDone) {
                try {
                    const msg = { pqc_toggle: enabled };
                    // If we *were* enabled, we must encrypt the "turn off" message 
                    // so the server (which is currently expecting encrypted data) can read it.
                    // If we *are* enabling, we send it as plaintext so the server knows to switch ON.
                    if (wasEnabled) {
                        // Temporarily bypass the new 'enabled' state to encrypt this one last message
                        this.pqc.enabled = true;
                        const encrypted = await this.pqc.encrypt(msg);
                        this.ws.send(JSON.stringify(encrypted));
                        this.pqc.enabled = enabled; // restore correct state
                    } else {
                        this.ws.send(JSON.stringify(msg));
                    }
                } catch (e) { console.error("Toggle send error", e); }
            }
        });

        // WebSocket
        this.ws = null;
        this.wsConnected = false;

        // State interpolation
        this.currentState = null;
        this.previousState = null;
        this.stateTimestamp = 0;

        // Timing
        this.lastFrameTime = performance.now();
        this.lastInputSend = 0;
        this.frameCount = 0;

        // Reset handler
        this.controls.onReset(() => this._sendReset());

        // Boot
        this._connectWebSocket();
        this._animate();
    }

    // ═══════════════════════════════════════════
    //  WebSocket Connection
    // ═══════════════════════════════════════════

    _connectWebSocket() {
        this._setConnectionStatus('connecting');

        this.ws = new WebSocket(WS_URL);

        this.ws.onopen = () => {
            console.log('✅ WebSocket connected to physics engine');
            this.wsConnected = true;
            this._setConnectionStatus('connected');
        };

        this.ws.onmessage = async (event) => {
            try {
                const rawMsg = JSON.parse(event.data);

                // ── PQC: Handle handshake messages ──
                if (!this.pqcHandshakeDone) {
                    const consumed = await this.pqc.handleMessage(this.ws, event.data);
                    if (consumed) {
                        if (this.pqc.handshakeComplete) {
                            this.pqcHandshakeDone = true;
                            console.log('[App] PQC handshake complete, switching to encrypted mode');
                        }
                        return;
                    }
                }

                // ── PQC: Decrypt incoming frame if encrypted ──
                let state;
                if (rawMsg.pqc === true && this.pqc.handshakeComplete) {
                    state = await this.pqc.decrypt(rawMsg);
                } else {
                    state = rawMsg;
                }

                this.previousState = this.currentState;
                this.currentState = state;
                this.stateTimestamp = performance.now();

                // Pass split_mu flag for status display
                if (this.controls.splitMu) {
                    this.currentState.split_mu = true;
                }
            } catch (e) {
                console.warn('Failed to parse physics state:', e);
            }
        };

        this.ws.onclose = () => {
            console.warn('⚠️ WebSocket disconnected');
            this.wsConnected = false;
            this._setConnectionStatus('disconnected');

            // Auto-reconnect after 2s
            setTimeout(() => this._connectWebSocket(), 2000);
        };

        this.ws.onerror = (err) => {
            console.error('WebSocket error:', err);
            this.ws.close();
        };
    }

    _setConnectionStatus(status) {
        const el = document.getElementById('ws-status');
        if (!el) return;

        switch (status) {
            case 'connected':
                el.className = 'ws-connected';
                el.textContent = '● PHYSICS ENGINE ONLINE';
                // Fade out after 3 seconds
                setTimeout(() => { el.style.opacity = '0'; }, 3000);
                break;
            case 'disconnected':
                el.className = 'ws-disconnected';
                el.textContent = '✕ DISCONNECTED — RECONNECTING...';
                el.style.opacity = '1';
                break;
            case 'connecting':
                el.className = 'ws-connecting';
                el.textContent = '⟳ CONNECTING TO PHYSICS ENGINE...';
                el.style.opacity = '1';
                break;
        }
    }

    async _sendInputs() {
        if (!this.wsConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        // Wait for PQC handshake to finish before sending ANY physics inputs
        if (!this.pqcHandshakeDone) return;

        try {
            const inputState = this.controls.getInputState();

            // ── PQC: Encrypt outgoing inputs if handshake is done ──
            if (this.pqc.enabled && this.pqc.handshakeComplete) {
                const encrypted = await this.pqc.encrypt(inputState);
                this.ws.send(JSON.stringify(encrypted));
            } else {
                this.ws.send(JSON.stringify(inputState));
            }

            this.controls._clearTriggerFlags();
        } catch (e) {
            // Silently ignore send errors
        }
    }

    _sendReset() {
        if (!this.wsConnected || !this.ws) return;
        if (!this.pqcHandshakeDone) return;
        try {
            this.ws.send(JSON.stringify({ reset: true }));
        } catch (e) { /* ignore */ }
    }

    // ═══════════════════════════════════════════
    //  Main Render Loop
    // ═══════════════════════════════════════════

    _animate() {
        requestAnimationFrame(() => this._animate());

        const now = performance.now();
        const dt = Math.min((now - this.lastFrameTime) / 1000, 0.05);
        this.lastFrameTime = now;

        // Update controls (keyboard smoothing)
        this.controls.tick(dt);

        // Send inputs to server at capped rate
        if (now - this.lastInputSend > INPUT_SEND_INTERVAL) {
            this._sendInputs();
            this.lastInputSend = now;
        }

        // Build render state (with client-side delta for smoothing)
        const renderState = this._buildRenderState(dt);

        // Update 3D scene
        if (renderState) {
            // Pass client steering to render state for front wheel visual
            renderState.delta = this.controls.steer;

            // Determine ground Y elevation for mountain ramp
            let groundY = this.scene.getRampElevation(renderState.x, renderState.z);

            this.vehicle.update(renderState, dt);
            this.vehicle.group.position.y = groundY;

            // Tilt vehicle on slope
            if (this.controls.gradientMode && groundY > 0.1) {
                this.vehicle.group.rotation.z = 15 * Math.PI / 180;
            } else {
                this.vehicle.group.rotation.z = 0;
            }

            this.scene.updateCamera(
                renderState.x, renderState.z, renderState.yaw, groundY, dt, renderState.vx
            );
            this.scene.updateParticles(
                renderState.x, renderState.z, renderState.yaw,
                renderState.vx, dt
            );
            this.scene.setMudVisible(this.controls.splitMu);
            this.scene.setGradientMode(
                this.controls.gradientMode,
                renderState.x,
                renderState.yaw,
                renderState.z
            );
            this.scene.updateWalls(this.currentState.walls || []);
        }

        // ── Update Dashboards ──
        this.dashboard.update(this.currentState);
        this.mlDashboard.update(this.currentState);
        this.manifoldDashboard.update(this.currentState);
        this.pqcDashboard.update(this.currentState);

        // ── Update 3D Scene ──
        this.scene.render();
    }

    /**
     * Build a render state by interpolating between server frames.
     * This ensures smooth 60 FPS visuals even though physics
     * updates arrive at 100 Hz.
     */
    _buildRenderState(dt) {
        if (!this.currentState) return null;

        // If we have both current and previous state, lerp
        if (this.previousState) {
            const timeSinceUpdate = (performance.now() - this.stateTimestamp) / 1000;
            const t = Math.min(timeSinceUpdate / 0.01, 1.0); // 10ms between frames

            return {
                vx: this._lerp(this.previousState.vx, this.currentState.vx, t),
                vy: this._lerp(this.previousState.vy, this.currentState.vy, t),
                gamma: this._lerp(this.previousState.gamma, this.currentState.gamma, t),
                x: this._lerp(this.previousState.x, this.currentState.x, t),
                z: this._lerp(this.previousState.z, this.currentState.z, t),
                yaw: this._lerpAngle(this.previousState.yaw, this.currentState.yaw, t),
                ax: this.currentState.ax,
                ay: this.currentState.ay,
                TL: this.currentState.TL,
                TR: this.currentState.TR,
            };
        }

        return this.currentState;
    }

    _lerp(a, b, t) {
        return a + (b - a) * t;
    }

    _lerpAngle(a, b, t) {
        let diff = b - a;
        // Wrap around ±π
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        return a + diff * t;
    }
}

// ── Boot ──
window.addEventListener('DOMContentLoaded', () => {
    new App();
});

