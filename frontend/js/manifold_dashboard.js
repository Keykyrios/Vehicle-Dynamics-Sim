/**
 * ═══════════════════════════════════════════════════════════════
 * NEXUS L5 VCU — Differential Equation Manifold Optimization
 * Renders real-time phase space vector fields (gamma vs gamma_dot).
 * ═══════════════════════════════════════════════════════════════
 */

export class ManifoldDashboard {
    constructor() {
        this.canvas = document.getElementById('manifold-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        
        // Match CSS size
        this.canvas.width = 408;
        this.canvas.height = 360;

        // UI Elements
        this.elDiv = document.getElementById('mf-div');
        this.elCurl = document.getElementById('mf-curl');
        this.elDet = document.getElementById('mf-det');
        this.elRank = document.getElementById('mf-rank');

        // State phase portrait
        this.history = [];
        this.time = 0;
        
        // Grid setup
        this.gridSize = 24; // Vector grid spacing

        this.initialized = true;
    }

    update(state) {
        if (!this.initialized) return;
        this.time += 0.016;

        // Get telemetry or use fallback approximations
        const vx = state.vx || 0;
        const gamma = state.gamma || 0;
        const gamma_ref = state.gamma_ref || 0; 
        const e_gamma = gamma - gamma_ref;
        const e_gamma_dot = (this.history.length > 0) ? (e_gamma - this.history[this.history.length-1].e) / 0.01 : 0;

        // Track trajectory trace
        this.history.push({e: e_gamma, ed: e_gamma_dot});
        if (this.history.length > 150) this.history.shift();

        // Mathematical Field Parameters (pseudo-physics for visuals)
        const lambda = 12.0; // Sliding surface slope
        const k = 50.0;     // Switching gain
        const R = Math.max(0.1, state.ml_roa_radius || 0.8);
        
        this._renderVectorField(e_gamma, e_gamma_dot, lambda, k, R);
        this._updateStats(e_gamma, e_gamma_dot);
    }

    _renderVectorField(eg, egd, lambda, k, R) {
        const w = this.canvas.width;
        const h = this.canvas.height;
        const cx = w / 2;
        const cy = h / 2;
        const scaleX = w / 4; // Display bounds: e_gamma in [-2, 2]
        const scaleY = h / 20; // e_gamma_dot in [-10, 10]

        this.ctx.clearRect(0, 0, w, h);

        // 1. Draw Vector Field (Phase Portrait arrows)
        this.ctx.lineWidth = 1;
        
        // Sliding surface s = e_gamma_dot + lambda * e_gamma = 0
        const S_func = (x, y) => y + lambda * x;

        for (let y = 0; y < h; y += this.gridSize) {
            for (let x = 0; x < w; x += this.gridSize) {
                // Map pixel to phase space
                const px = (x - cx) / scaleX;
                const py = -(y - cy) / scaleY;

                // Field equations (Lyapunov ASMC model)
                // dx/dt = y
                // dy/dt = -f(x) - k * sgn(s) 
                const s = S_func(px, py);
                const sgn = Math.tanh(s * 5); // smooth signum
                
                const vx = py;
                const vy = -lambda * py - k * sgn;

                // Map vector back to screen space lengths
                const sx = vx * scaleX * 0.005; 
                const sy = -vy * scaleY * 0.005;

                // Normalize length for visual arrow
                const len = Math.sqrt(sx*sx + sy*sy);
                const maxLen = this.gridSize * 0.6;
                const mult = len > 0 ? Math.min(len, maxLen) / len : 0;
                
                const fx = x + sx * mult;
                const fy = y + sy * mult;

                // Color based on region (Inside ROA = Blue, Outside = Magenta)
                const dist = Math.sqrt(px*px + py*py);
                if (dist < R) {
                    this.ctx.strokeStyle = `rgba(0, 204, 255, ${0.1 + 0.4*(1-dist/R)})`;
                } else {
                    this.ctx.strokeStyle = `rgba(255, 0, 255, 0.2)`;
                }

                // Draw arrow
                this.ctx.beginPath();
                this.ctx.moveTo(x, y);
                this.ctx.lineTo(fx, fy);
                this.ctx.stroke();
                
                // Arrow head
                this.ctx.fillStyle = this.ctx.strokeStyle;
                this.ctx.beginPath();
                this.ctx.arc(x, y, 1, 0, Math.PI*2);
                this.ctx.fill();
            }
        }

        // 2. Draw Sliding Surface Line (s=0)
        this.ctx.beginPath();
        this.ctx.strokeStyle = 'rgba(0, 255, 204, 0.5)';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]);
        // y = -lambda * x
        const x1 = -2, y1 = -lambda * x1;
        const x2 = 2, y2 = -lambda * x2;
        this.ctx.moveTo(cx + x1*scaleX, cy - y1*scaleY);
        this.ctx.lineTo(cx + x2*scaleX, cy - y2*scaleY);
        this.ctx.stroke();
        this.ctx.setLineDash([]);

        // 3. Draw Actual Trajectory Trace
        if (this.history.length > 1) {
            this.ctx.beginPath();
            this.ctx.strokeStyle = '#00ffcc';
            this.ctx.lineWidth = 3;
            // Add a neon glow
            this.ctx.shadowColor = '#00ffcc';
            this.ctx.shadowBlur = 10;

            for (let i = 0; i < this.history.length; i++) {
                const pt = this.history[i];
                const nx = cx + pt.e * scaleX;
                const ny = cy - pt.ed * scaleY;
                if (i === 0) this.ctx.moveTo(nx, ny);
                else this.ctx.lineTo(nx, ny);
            }
            this.ctx.stroke();
            this.ctx.shadowBlur = 0; // reset
        }

        // 4. Draw Current State Point
        const curX = cx + eg * scaleX;
        const curY = cy - egd * scaleY;
        this.ctx.fillStyle = '#ffffff';
        this.ctx.beginPath();
        this.ctx.arc(curX, curY, 5, 0, Math.PI*2);
        this.ctx.fill();
        this.ctx.strokeStyle = '#00ffcc';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(curX, curY, 9, 0, Math.PI*2);
        this.ctx.stroke();
    }

    _updateStats(e, ed) {
        // Pseudo-math divergence and curl of the ASMC vector field
        const s = ed + 12.0 * e;
        // div V = dU/dx + dV/dy  where U=y, V = -lambda*y - K*tanh(s)
        const div = -12.0 - 50.0 * 5.0 * (1 - Math.pow(Math.tanh(s*5), 2));
        
        // curl V = dV/dx - dU/dy
        const curl = -12.0 * 50.0 * 5.0 * (1 - Math.pow(Math.tanh(s*5), 2)) - 1.0;
        
        // Jacobian Det = (dU/dx)(dV/dy) - (dU/dy)(dV/dx)
        const det = 0 * div - (1) * (-12.0 * 50.0 * 5 * (1 - Math.pow(Math.tanh(s*5), 2)));

        if (this.elDiv) this.elDiv.textContent = div.toFixed(2);
        if (this.elCurl) this.elCurl.textContent = curl.toFixed(2);
        if (this.elDet) this.elDet.textContent = (det/1000).toFixed(2); // scaled down for display

        if (this.elRank) {
            if (Math.abs(s) < 0.5) {
                this.elRank.textContent = 'Stable (s≈0)';
                this.elRank.style.color = '#00ffcc';
            } else {
                this.elRank.textContent = 'Converging';
                this.elRank.style.color = '#ffaa00';
            }
        }
    }
}

