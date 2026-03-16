/**
 * ═══════════════════════════════════════════════════════════════
 * NEXUS L5 VCU — Real-Time Telemetry Dashboard
 * Updates HUD values, status banner, speed display,
 * and real-time strip charts from WebSocket data.
 * ═══════════════════════════════════════════════════════════════
 */

export class RealTimeChart {
    constructor(canvasId, yMin, yMax, color1, color2) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.yMin = yMin;
        this.yMax = yMax;
        this.color1 = color1;
        this.color2 = color2;
        this.ready = false;

        // Defer init until canvas has layout
        requestAnimationFrame(() => {
            this.initSize();
            this.ready = true;
        });
    }

    initSize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.width = Math.max(rect.width, 200);
        this.height = Math.max(rect.height, 60);
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.history1 = new Array(Math.floor(this.width)).fill(0);
        this.history2 = new Array(Math.floor(this.width)).fill(0);
        this.history3 = new Array(Math.floor(this.width)).fill(0);
    }

    push(v1, v2 = 0, v3 = null) {
        if (!this.ready) return;
        this.history1.push(v1);
        this.history1.shift();
        this.history2.push(v2);
        this.history2.shift();
        if (v3 !== null) {
            this.history3.push(v3);
            this.history3.shift();
        }
    }

    draw(drawSecond = true, drawThird = false) {
        if (!this.ready) return;
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        ctx.clearRect(0, 0, w, h);

        // Zero line
        const zeroY = h - ((0 - this.yMin) / (this.yMax - this.yMin)) * h;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, zeroY);
        ctx.lineTo(w, zeroY);
        ctx.stroke();

        const scaleY = v => h - ((v - this.yMin) / (this.yMax - this.yMin)) * h;

        const drawLine = (history, color, lineWidth) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = lineWidth;
            ctx.beginPath();
            for (let i = 0; i < history.length; i++) {
                const y = Math.max(0, Math.min(h, scaleY(history[i])));
                i === 0 ? ctx.moveTo(i, y) : ctx.lineTo(i, y);
            }
            ctx.stroke();
        };

        // Draw threshold lines (for RI chart)
        if (drawThird) {
            // Safety boundary lines at ±0.85
            const threshY1 = scaleY(0.85);
            const threshY2 = scaleY(-0.85);
            ctx.strokeStyle = 'rgba(255, 50, 50, 0.3)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(0, threshY1);
            ctx.lineTo(w, threshY1);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(0, threshY2);
            ctx.lineTo(w, threshY2);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Primary line
        drawLine(this.history1, this.color1, 1.5);

        // Secondary line
        if (drawSecond) {
            drawLine(this.history2, this.color2, 1.5);
        }
    }
}


export class Dashboard {
    constructor() {
        this.chartYaw = null;
        this.chartTorque = null;
        this.chartRI = null;

        // Init charts after DOM layout
        setTimeout(() => {
            this.chartYaw = new RealTimeChart('chart_yaw', -1.5, 1.5, '#00ffcc', '#ffffff');
            this.chartTorque = new RealTimeChart('chart_torque', -100, 100, '#ff00ff', '#00ccff');
            this.chartRI = new RealTimeChart('chart_ri', -1.0, 1.0, '#ff3333', '#555555');
        }, 300);

        // Resize handler
        window.addEventListener('resize', () => {
            if (this.chartYaw) this.chartYaw.initSize();
            if (this.chartTorque) this.chartTorque.initSize();
            if (this.chartRI) this.chartRI.initSize();
        });
    }

    update(state) {
        if (!state) return;

        // ── Kinematic states ──
        this._setText('val_vx', (state.vx || 0).toFixed(2));
        this._setText('val_vy', (state.vy || 0).toFixed(2));
        this._setText('val_yawrate', (state.gamma || 0).toFixed(3));
        const beta = Math.atan2(state.vy || 0, Math.max(0.1, Math.abs(state.vx || 0.1)));
        this._setText('val_beta', beta.toFixed(3));

        // ── Load transfer ──
        this._setText('val_fzf', (state.Fzf || 0).toFixed(0));
        this._setText('val_fzl', (state.FzL || 0).toFixed(0));
        this._setText('val_fzr', (state.FzR || 0).toFixed(0));

        // ── Control objectives ──
        this._setText('val_treq', (state.T_req || 0).toFixed(1));
        this._setText('val_mzreq', (state.Mz_req || 0).toFixed(1));
        this._setText('val_ri', (state.RI || 0).toFixed(3));
        this._setText('val_mu_est', (state.est_mu || 0).toFixed(3));

        // ── Torque bars ──
        const maxT = 80;
        this._setText('val_tl', (state.TL || 0).toFixed(1));
        this._setText('val_tr', (state.TR || 0).toFixed(1));
        this._setWidth('bar_tl', (Math.abs(state.TL || 0) / maxT) * 100);
        this._setWidth('bar_tr', (Math.abs(state.TR || 0) / maxT) * 100);

        // ── Speed display ──
        const speedKmh = Math.abs((state.vx || 0) * 3.6);
        this._setText('speed-number', Math.round(speedKmh).toString());
        const maxSpeed = 60;  // 60 km/h
        this._setWidth('speed-bar-fill', Math.min(100, (speedKmh / maxSpeed) * 100));

        // ── RI value color ──
        const riEl = document.getElementById('val_ri');
        if (riEl) {
            const absRI = Math.abs(state.RI || 0);
            if (absRI > 0.85) riEl.style.color = '#ff3333';
            else if (absRI > 0.5) riEl.style.color = '#ffaa00';
            else riEl.style.color = '#ffffff';
        }

        // ── Status banner ──
        const banner = document.getElementById('status-banner');
        if (banner) {
            const status = state.status || 0;
            if (status === 1) {
                banner.className = 'status-critical';
                banner.textContent = 'OVERRIDE: ACTIVE ROLLOVER PREVENTION';
            } else if (status === 2) {
                banner.className = 'status-warning';
                banner.textContent = 'DEGRADED: STEERING SENSOR FAULT — SYMMETRIC DRIVE';
            } else if (status === 3) {
                banner.className = 'status-warning';
                banner.textContent = 'DEGRADED: IMU FAULT — KINEMATIC MODE';
            } else if (state.split_mu && Math.abs((state.TL || 0) - (state.TR || 0)) > 5) {
                banner.className = 'status-mu-split';
                banner.textContent = 'ACTIVE TORQUE VECTORING: μ-SPLIT COMPENSATION';
            } else {
                banner.className = 'status-nominal';
                banner.textContent = 'SYS: NOMINAL OPERATION';
            }
        }

        // ── Charts ──
        if (this.chartYaw) {
            this.chartYaw.push(state.gamma || 0, state.gamma_ref || 0);
            this.chartYaw.draw(true, false);
        }
        if (this.chartTorque) {
            this.chartTorque.push(state.TL || 0, state.TR || 0);
            this.chartTorque.draw(true, false);
        }
        if (this.chartRI) {
            this.chartRI.push(state.RI || 0);
            this.chartRI.draw(false, true);
        }
    }

    _setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    _setWidth(id, pct) {
        const el = document.getElementById(id);
        if (el) el.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    }
}

