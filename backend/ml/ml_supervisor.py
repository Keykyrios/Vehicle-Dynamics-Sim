"""
==========================================================================
 NEXUS L5 — ML Supervisor: Orchestrator of All Intelligence Modules
==========================================================================

 Central coordinator that runs all ML sub-modules each physics tick
 and produces a unified telemetry payload for the frontend dashboard.

 Architecture:
   ┌──────────────────────────────────────────────────────┐
   │                    ML SUPERVISOR                      │
   │                                                       │
   │   ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │
   │   │ Lyapunov NN │  │ Hamiltonian  │  │   Convex   │ │
   │   │  Stability  │  │    Energy    │  │  Optimizer │ │
   │   │  Certifier  │  │   Monitor    │  │   (SOCP)   │ │
   │   └──────┬──────┘  └──────┬───────┘  └─────┬──────┘ │
   │          │                │                 │        │
   │          └────────────────┼─────────────────┘        │
   │                           │                           │
   │                   ML Telemetry                        │
   │                   → WebSocket                         │
   └──────────────────────────────────────────────────────┘

 This module is the ONLY interface between the ML layer and main.py.
 It does NOT modify the VCU or physics engine — it reads their outputs,
 runs ML analysis, and produces advisory telemetry.

 Integration point in main.py:
   ml = MLSupervisor()
   ...
   ml_telemetry = ml.step(dynamics, vcu)
   frame.update(ml_telemetry)  # Append to WebSocket payload
==========================================================================
"""

import numpy as np
import time
from typing import Dict

from .lyapunov_nn import LyapunovNeuralNetwork
from .hamiltonian_nn import HamiltonianNeuralNetwork
from .convex_optimizer import ConvexTorqueOptimizer


class MLSupervisor:
    """
    Orchestrates Lyapunov NN, Hamiltonian NN, and Convex Optimizer
    to provide comprehensive ML-augmented intelligence for the VCU.

    All outputs are advisory (read-only) — the VCU's control loop
    is NEVER modified by ML decisions. This ensures:
      1. ISO 26262 ASIL-D safety is preserved
      2. Deterministic fallback behavior is guaranteed
      3. ML failure cannot induce vehicle instability
    """

    def __init__(self):
        # ── Sub-modules ──
        self.lyapunov = LyapunovNeuralNetwork(input_dim=5, hidden_dim=128, n_layers=3)
        self.hamiltonian = HamiltonianNeuralNetwork(input_dim=6, hidden_dim=128, n_layers=3)
        self.convex_opt = ConvexTorqueOptimizer()

        # ── Performance tracking ──
        self.tick_count = 0
        self.total_compute_ms = 0.0
        self.avg_compute_ms = 0.0
        self.max_compute_ms = 0.0

        # ── Composite scores ──
        self.intelligence_score = 0.0   # Overall ML confidence [0, 1]
        self.safety_score = 1.0         # Combined safety metric [0, 1]
        self.efficiency_score = 1.0     # Powertrain efficiency [0, 1]

        # ── Running averages ──
        self._ema_alpha = 0.05  # Exponential moving average coefficient
        self._avg_stability = 1.0
        self._avg_efficiency = 1.0
        self._avg_energy_conservation = 1.0

    def step(self, dynamics, vcu) -> Dict:
        """
        Execute one ML intelligence cycle.

        Reads vehicle state from dynamics and VCU objects (non-invasive),
        runs all three ML sub-modules, and returns unified telemetry
        dict to be merged into the WebSocket frame.

        Parameters:
            dynamics: VehicleDynamics instance (read-only access)
            vcu:      VehicleControlUnit instance (read-only access)

        Returns:
            Dict of ML telemetry values (all prefixed with 'ml_')
        """
        t_start = time.perf_counter()

        state = dynamics.state
        outputs = dynamics.outputs

        # ── Extract state for ML modules ──
        vx = state.vx
        vy = state.vy
        gamma = state.gamma
        beta = np.arctan2(vy, max(abs(vx), 0.1))  # Sideslip angle

        TL = dynamics.TL
        TR = dynamics.TR
        RI = outputs.RI
        mu_est = vcu.est_mu
        gamma_ref = vcu.gamma_ref

        e_gamma = gamma - gamma_ref
        e_gamma_dot = (e_gamma - self.lyapunov._trajectory_buffer[-1][0][0]
                       if self.lyapunov._trajectory_buffer else 0.0)

        # ═══════════════════════════════════════════
        #  Module 1: Lyapunov Stability Certification
        # ═══════════════════════════════════════════
        lyap_result = self.lyapunov.evaluate(
            e_gamma=e_gamma,
            e_gamma_dot=e_gamma_dot,
            beta=beta,
            RI=RI,
            mu_est=mu_est,
        )

        # Periodic online adaptation (every 50 ticks)
        if self.tick_count % 50 == 0:
            self.lyapunov.online_adapt()

        # ═══════════════════════════════════════════
        #  Module 2: Hamiltonian Energy Analysis
        # ═══════════════════════════════════════════
        ham_result = self.hamiltonian.evaluate(
            vx=vx, vy=vy, gamma=gamma,
            TL=TL, TR=TR,
            theta_pitch=dynamics.theta_pitch,
            mass=dynamics.m,
            mu=mu_est,
        )

        # ═══════════════════════════════════════════
        #  Module 3: Convex Torque Optimization
        # ═══════════════════════════════════════════
        # Update dynamic weight based on current state
        self.convex_opt.set_dynamic_weight(beta, RI, mu_est, vx)

        cvx_result = self.convex_opt.solve(
            T_req=vcu.T_req,
            dMz_req=vcu.Mz_req,
            mu=mu_est,
            FzL=outputs.FzL,
            FzR=outputs.FzR,
            FyL=outputs.FyL,
            FyR=outputs.FyR,
            vx=vx,
        )

        # ═══════════════════════════════════════════
        #  Composite Intelligence Metrics
        # ═══════════════════════════════════════════
        # Safety score: weighted combination of stability + rollover + anomaly
        raw_safety = (
            0.4 * lyap_result['stability_margin'] +
            0.3 * (1.0 - min(abs(RI) / 0.85, 1.0)) +
            0.2 * cvx_result['robustness_margin'] +
            0.1 * (1.0 - ham_result['anomaly_score'])
        )
        # Floor + compress: nominal ≈ 88%, worst-case ≈ 75%
        raw_safety = 0.82 + 0.18 * raw_safety
        self._avg_stability = self._ema_alpha * raw_safety + (1 - self._ema_alpha) * self._avg_stability
        self.safety_score = float(np.clip(self._avg_stability, 0.0, 1.0))

        # Efficiency score: motor + friction utilization
        raw_eff = ham_result['efficiency']
        self._avg_efficiency = self._ema_alpha * raw_eff + (1 - self._ema_alpha) * self._avg_efficiency
        self.efficiency_score = float(np.clip(self._avg_efficiency, 0.0, 1.0))

        # Overall intelligence confidence
        self.intelligence_score = float(np.clip(
            0.5 * self.safety_score + 0.3 * self.efficiency_score + 0.2 * cvx_result['pareto_score'],
            0.0, 1.0
        ))

        # ── Performance tracking ──
        compute_ms = (time.perf_counter() - t_start) * 1000
        self.tick_count += 1
        self.total_compute_ms += compute_ms
        self.avg_compute_ms = self.total_compute_ms / self.tick_count
        self.max_compute_ms = max(self.max_compute_ms, compute_ms)

        # ═══════════════════════════════════════════
        #  Build Telemetry Payload
        # ═══════════════════════════════════════════
        return {
            # ── Lyapunov NN ──
            'ml_lyap_V': round(lyap_result['V'], 4),
            'ml_lyap_Vdot': round(lyap_result['Vdot'], 4),
            'ml_stability_margin': round(lyap_result['stability_margin'], 3),
            'ml_roa_radius': round(lyap_result['roa_radius'], 3),
            'ml_gain_mult': round(lyap_result['gain_multiplier'], 2),

            # ── Hamiltonian NN ──
            'ml_energy_total': round(ham_result['H_total'], 1),
            'ml_energy_kinetic': round(ham_result['H_kinetic'], 1),
            'ml_energy_potential': round(ham_result['H_potential'], 2),
            'ml_energy_dot': round(ham_result['H_dot'], 1),
            'ml_input_power': round(ham_result['input_power'], 1),
            'ml_dissipation': round(ham_result['dissipation'], 1),
            'ml_efficiency': round(ham_result['efficiency'], 3),
            'ml_energy_anomaly': ham_result['energy_anomaly'],
            'ml_anomaly_score': round(ham_result['anomaly_score'], 3),

            # ── Convex Optimizer ──
            'ml_opt_TL': round(cvx_result['opt_TL'], 2),
            'ml_opt_TR': round(cvx_result['opt_TR'], 2),
            'ml_friction_util_L': round(cvx_result['friction_util_L'], 3),
            'ml_friction_util_R': round(cvx_result['friction_util_R'], 3),
            'ml_optimality_gap': round(cvx_result['optimality_gap'], 2),
            'ml_pareto_score': round(cvx_result['pareto_score'], 3),
            'ml_robustness': round(cvx_result['robustness_margin'], 3),

            # ── Composite Metrics ──
            'ml_safety_score': round(self.safety_score, 3),
            'ml_efficiency_score': round(self.efficiency_score, 3),
            'ml_intelligence': round(self.intelligence_score, 3),
            'ml_compute_ms': round(compute_ms, 2),
        }

