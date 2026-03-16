/**
 * ═══════════════════════════════════════════════════════════════
 * NEXUS L5 VCU — ML Intelligence Dashboard
 * Displays real-time ML telemetry from Lyapunov NN,
 * Hamiltonian NN, and Convex Optimizer with live charts.
 * Integrated into the right-panel tab system (no fixed overlays).
 * ═══════════════════════════════════════════════════════════════
 */

import { RealTimeChart } from './dashboard.js';

export class MLDashboard {
    constructor() {
        this.chartEnergy = null;
        this.chartLyapunov = null;
        this.chartFriction = null;

        // Smoothed display values (EMA)
        this._ema = {};
        this._alpha = 0.15;

        // ── Tab Selector ──
        const selector = document.getElementById('tab-selector');
        if (selector) {
            selector.addEventListener('change', (e) => {
                const targetId = e.target.value; // e.g., 'tab-charts', 'tab-ml', 'tab-manifold'
                const tabs = ['tab-charts', 'tab-ml', 'tab-manifold', 'tab-pqc'];

                tabs.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) {
                        if (id === targetId) {
                            el.style.display = 'block';
                            el.classList.add('active-tab');
                        } else {
                            el.style.display = 'none';
                            el.classList.remove('active-tab');
                        }
                    }
                });

                // Lazy-init ML charts if ML tab is selected
                if (targetId === 'tab-ml') {
                    this._initChartsIfNeeded();
                }
            });
        }
    }

    _initChartsIfNeeded() {
        if (this.chartLyapunov) return; // already initialized
        setTimeout(() => {
            try {
                this.chartLyapunov = new RealTimeChart('chart_ml_lyapunov', -0.2, 1.5, '#bf5af2', '#ff453a');
                this.chartEnergy = new RealTimeChart('chart_ml_energy', 0, 50000, '#00ff88', '#ff8800');
                this.chartFriction = new RealTimeChart('chart_ml_friction', 0, 1.0, '#00ccff', '#ff00ff');
            } catch (e) {
                console.warn('[ML Dashboard] Chart init error:', e);
            }
        }, 100);
    }

    _smooth(key, value) {
        if (!(key in this._ema)) this._ema[key] = value;
        this._ema[key] = this._alpha * value + (1 - this._alpha) * this._ema[key];
        return this._ema[key];
    }

    update(state) {
        if (!state || state.ml_safety_score === undefined) return;

        // ═══════════════════════════════════════
        //  Composite Intelligence Metrics
        // ═══════════════════════════════════════
        const safetyPct = Math.round(this._smooth('safety', state.ml_safety_score) * 100);
        this._setText('ml-safety-value', safetyPct + '%');
        this._setRingProgress('ml-safety-ring', safetyPct);
        this._setRingColor('ml-safety-ring', safetyPct);

        const effPct = Math.round(this._smooth('eff', state.ml_efficiency_score) * 100);
        this._setText('ml-efficiency-value', effPct + '%');
        this._setRingProgress('ml-efficiency-ring', effPct);

        const intPct = Math.round(this._smooth('intel', state.ml_intelligence) * 100);
        this._setText('ml-intelligence-value', intPct + '%');
        this._setBarWidth('ml-intelligence-bar', intPct);

        // ═══════════════════════════════════════
        //  Lyapunov Stability Network
        // ═══════════════════════════════════════
        const V = this._smooth('V', state.ml_lyap_V || 0);
        const Vdot = this._smooth('Vdot', state.ml_lyap_Vdot || 0);
        this._setText('ml-lyap-V', V.toFixed(3));
        this._setText('ml-lyap-Vdot', Vdot.toFixed(3));

        const vdotEl = document.getElementById('ml-lyap-Vdot');
        if (vdotEl) vdotEl.style.color = Vdot <= 0 ? '#30d158' : '#ff453a';

        const margin = this._smooth('margin', state.ml_stability_margin || 0);
        this._setText('ml-stability-margin', (margin * 100).toFixed(1) + '%');
        this._setBarWidth('ml-stability-bar', margin * 100);
        const stabilityBar = document.getElementById('ml-stability-bar');
        if (stabilityBar) {
            if (margin > 0.7) stabilityBar.className = 'ml-bar-fill ml-bar-safe';
            else if (margin > 0.3) stabilityBar.className = 'ml-bar-fill ml-bar-warn';
            else stabilityBar.className = 'ml-bar-fill ml-bar-danger';
        }

        this._setText('ml-roa', (state.ml_roa_radius || 0).toFixed(2));
        this._setText('ml-gain-mult', (state.ml_gain_mult || 1).toFixed(2) + '×');

        if (this.chartLyapunov) {
            this.chartLyapunov.push(V, Math.max(-0.2, Vdot));
            this.chartLyapunov.draw(true, false);
        }

        // ═══════════════════════════════════════
        //  Hamiltonian Energy Network
        // ═══════════════════════════════════════
        const kinetic = this._smooth('KE', state.ml_energy_kinetic || 0);
        const total = this._smooth('TE', state.ml_energy_total || 0);
        const inputPower = this._smooth('Pin', state.ml_input_power || 0);
        const dissipation = this._smooth('Pdiss', state.ml_dissipation || 0);

        this._setText('ml-energy-kinetic', (kinetic / 1000).toFixed(2) + ' kJ');
        this._setText('ml-energy-total', (total / 1000).toFixed(2) + ' kJ');
        this._setText('ml-input-power', inputPower.toFixed(0) + ' W');
        this._setText('ml-dissipation', dissipation.toFixed(0) + ' W');

        const eff = this._smooth('eff2', state.ml_efficiency || 0);
        this._setText('ml-powertrain-eff', (eff * 100).toFixed(1) + '%');
        this._setBarWidth('ml-efficiency-bar', eff * 100);

        const anomalyEl = document.getElementById('ml-anomaly-indicator');
        if (anomalyEl) {
            if (state.ml_energy_anomaly) {
                anomalyEl.className = 'ml-anomaly-active';
                anomalyEl.textContent = '⚠ ENERGY ANOMALY DETECTED';
            } else {
                anomalyEl.className = 'ml-anomaly-clear';
                anomalyEl.textContent = '● NOMINAL';
            }
        }

        if (this.chartEnergy) {
            this.chartEnergy.push(kinetic, dissipation * 10);
            this.chartEnergy.draw(true, false);
        }

        // ═══════════════════════════════════════
        //  Convex Optimizer (SOCP)
        // ═══════════════════════════════════════
        const fricL = this._smooth('fricL', state.ml_friction_util_L || 0);
        const fricR = this._smooth('fricR', state.ml_friction_util_R || 0);
        this._setText('ml-fric-L', (fricL * 100).toFixed(1) + '%');
        this._setText('ml-fric-R', (fricR * 100).toFixed(1) + '%');
        this._setBarWidth('ml-fric-bar-L', fricL * 100);
        this._setBarWidth('ml-fric-bar-R', fricR * 100);
        this._setFrictionBarColor('ml-fric-bar-L', fricL);
        this._setFrictionBarColor('ml-fric-bar-R', fricR);

        this._setText('ml-robustness', (this._smooth('robust', state.ml_robustness || 0) * 100).toFixed(1) + '%');
        this._setText('ml-pareto', (this._smooth('pareto', state.ml_pareto_score || 0) * 100).toFixed(1) + '%');
        this._setText('ml-opt-gap', (state.ml_optimality_gap || 0).toFixed(2) + ' Nm');
        this._setText('ml-opt-TL', (state.ml_opt_TL || 0).toFixed(1));
        this._setText('ml-opt-TR', (state.ml_opt_TR || 0).toFixed(1));

        if (this.chartFriction) {
            this.chartFriction.push(fricL, fricR);
            this.chartFriction.draw(true, false);
        }

        // ═══════════════════════════════════════
        //  Performance
        // ═══════════════════════════════════════
        this._setText('ml-compute-ms', (state.ml_compute_ms || 0).toFixed(2) + ' ms');
    }

    _setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    _setBarWidth(id, pct) {
        const el = document.getElementById(id);
        if (el) el.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    }

    _setRingProgress(id, pct) {
        const el = document.getElementById(id);
        if (el) {
            const circumference = 2 * Math.PI * 36;
            const offset = circumference * (1 - pct / 100);
            el.style.strokeDashoffset = offset;
        }
    }

    _setRingColor(id, pct) {
        const el = document.getElementById(id);
        if (!el) return;
        if (pct >= 70) el.style.stroke = '#30d158';
        else if (pct >= 40) el.style.stroke = '#ffd60a';
        else el.style.stroke = '#ff453a';
    }

    _setFrictionBarColor(id, fraction) {
        const el = document.getElementById(id);
        if (!el) return;
        if (fraction >= 0.9) el.className = 'ml-bar-fill ml-bar-danger';
        else if (fraction >= 0.7) el.className = 'ml-bar-fill ml-bar-warn';
        else el.className = 'ml-bar-fill ml-bar-safe';
    }
}

