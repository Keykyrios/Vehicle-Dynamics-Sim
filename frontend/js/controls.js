/**
 * ═══════════════════════════════════════════════════════════════
 * NEXUS L5 VCU — Input Controls Manager
 * Handles keyboard input (WASD/Arrows), parameter sliders,
 * fault injection buttons, and smooth input interpolation.
 * ═══════════════════════════════════════════════════════════════
 */

export class Controls {
    constructor() {
        // Raw input targets
        this.targetThrottle = 0;
        this.targetSteer = 0;

        // Smoothed outputs (sent to server)
        this.throttle = 0;
        this.steer = 0;

        // Parameters
        this.mass = 766;
        this.gradient = 0;
        this.mu = 0.85;
        this.splitMu = false;
        this.faultSteer = false;
        this.gradientMode = false;
        this.wheelInAir = false;
        this.asymSlope = false;

        // Key state
        this._keys = {};
        this._gameKeys = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

        // Bind keyboard on window level for maximum capture
        window.addEventListener('keydown', e => {
            const key = e.key.toLowerCase();
            this._keys[key] = true;
            // Only prevent default for game keys to avoid blocking browser shortcuts like F5
            if (this._gameKeys.has(key)) {
                e.preventDefault();
            }
            this._updateDebugUI();
        });
        window.addEventListener('keyup', e => {
            this._keys[e.key.toLowerCase()] = false;
            this._updateDebugUI();
        });

        // Bind sliders
        this._bindSlider('param_mass', 'val_mass_disp', v => {
            this.mass = parseFloat(v);
            return `${v} kg`;
        });
        this._bindSlider('param_grad', 'val_grad_disp', v => {
            this.gradient = parseFloat(v);
            return `${v}°`;
        });
        this._bindSlider('param_mu', 'val_mu_disp', v => {
            this.mu = parseFloat(v);
            return parseFloat(v).toFixed(2);
        });

        // Fault injection buttons
        this._bindToggle('btn_splitmu', active => {
            this.splitMu = active;
            const btn = document.getElementById('btn_splitmu');
            if (btn) btn.textContent = active ? 'μ-Split (Mud) Active' : 'μ-Split (Mud)';
        });

        this._bindToggle('btn_gradient', active => {
            this.gradientMode = active;
            const btn = document.getElementById('btn_gradient');
            if (btn) btn.textContent = active ? 'Gradient Active (15°)' : 'Gradient Terrain';
        });

        this._bindToggle('btn_wheelair', active => {
            this.wheelInAir = active;
            const btn = document.getElementById('btn_wheelair');
            if (btn) {
                btn.textContent = active ? 'Wheel in Air Active' : 'One Wheel in Air';
                if (active) btn.classList.add('danger');
                else btn.classList.remove('danger');
            }
        });

        this._bindToggle('btn_asymslope', active => {
            this.asymSlope = active;
            const btn = document.getElementById('btn_asymslope');
            if (btn) {
                btn.textContent = active ? 'Asym Slope Active' : 'Asymmetric Slope';
                if (active) btn.classList.add('danger');
                else btn.classList.remove('danger');
            }
        });

        this._bindToggle('btn_steerfault', active => {
            this.faultSteer = active;
            const btn = document.getElementById('btn_steerfault');
            if (btn) {
                btn.textContent = active ? 'Steer Fault Active' : 'Steer Sensor Fault';
                if (active) btn.classList.add('danger');
                else btn.classList.remove('danger');
            }
        });

        this._bindToggle('btn_motorfault', active => {
            this.motorFault = active;
            const btn = document.getElementById('btn_motorfault');
            if (btn) {
                btn.textContent = active ? 'Motor R Dead' : 'Motor Malfunction (R)';
                if (active) btn.classList.add('danger');
                else btn.classList.remove('danger');
            }
        });

        // Reset button
        document.getElementById('btn_reset')?.addEventListener('click', () => {
            this._onReset?.();
        });

        // Focus management
        window.focus();
        document.getElementById('webgl-container')?.addEventListener('click', () => {
            window.focus();
        });
    }

    _updateDebugUI() {
        const hint = document.getElementById('controls-hint');
        if (!hint) return;
        const active = Object.keys(this._keys).filter(k => this._keys[k]).join(',').toUpperCase();
        if (active) {
            hint.innerHTML = `<span style="color:var(--cyan);font-weight:bold;">KEY PRESSED: ${active}</span> | WASD: Drive`;
        } else {
            hint.innerHTML = `<div><span class="key">W</span> <span class="key">S</span> Accel / Brake</div>
                              <div><span class="key">A</span> <span class="key">D</span> Steer</div>
                              <div style="color:var(--cyan);">PHYSICS @ 100Hz &middot; RENDER @ 60FPS</div>`;
        }
    }

    onReset(callback) {
        this._onReset = callback;
    }

    /**
     * Update smoothed inputs (called every frame).
     */
    tick(dt) {
        // Read keyboard
        if (this._keys['w'] || this._keys['arrowup']) {
            this.targetThrottle = 1.0;
        } else if (this._keys['s'] || this._keys['arrowdown']) {
            this.targetThrottle = -0.5;
        } else {
            this.targetThrottle = 0;
        }

        if (this._keys['a'] || this._keys['arrowleft']) {
            this.targetSteer = 0.35;
        } else if (this._keys['d'] || this._keys['arrowright']) {
            this.targetSteer = -0.35;
        } else {
            this.targetSteer = 0;
        }

        // Smooth interpolation
        const lerpRate = dt * 6.0;
        this.throttle += (this.targetThrottle - this.throttle) * Math.min(lerpRate, 0.99);
        this.steer += (this.targetSteer - this.steer) * Math.min(lerpRate * 1.3, 0.99);

        // Deadzone
        if (Math.abs(this.throttle) < 0.005) this.throttle = 0;
        if (Math.abs(this.steer) < 0.005) this.steer = 0;
    }

    /**
     * Get current input state as JSON-serializable object.
     */
    getInputState() {
        const state = {
            throttle: this.throttle,
            steer: this.steer,
            mass: this.mass,
            gradient: this.gradient,
            mu: this.mu,
            split_mu: this.splitMu,
            fault_steer: this.faultSteer,
            gradient_mode: this.gradientMode,
            wheel_in_air: this.wheelInAir,
            asym_slope: this.asymSlope,
            fault_imu: false,
            fault_motor: this.motorFault || false,
        };
        return state;
    }

    _clearTriggerFlags() {
        this.spawnWall = false;
    }

    _bindSlider(sliderId, displayId, formatter) {
        const slider = document.getElementById(sliderId);
        const display = document.getElementById(displayId);
        if (!slider || !display) return;

        const update = () => {
            display.textContent = formatter(slider.value);
        };

        slider.addEventListener('input', update);
        update(); // Initialize
    }

    _bindToggle(buttonId, callback) {
        const btn = document.getElementById(buttonId);
        if (!btn) return;

        btn.addEventListener('click', () => {
            const isActive = btn.classList.toggle('active');
            callback(isActive);
        });
    }

    _bindButton(buttonId, callback) {
        const btn = document.getElementById(buttonId);
        if (!btn) return;

        btn.addEventListener('click', () => {
            // Flash active class quickly
            btn.classList.add('active');
            setTimeout(() => btn.classList.remove('active'), 200);
            callback();
        });
    }
}

