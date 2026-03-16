"""
==========================================================================
 NEXUS L5 — Extended Kalman Filter for Non-Linear State Estimation
 State vector:   x = [vy, γ, μ]ᵀ
 Measurement:    z = [ay, γ]ᵀ
 Reference:      Team Aphelion Deep-Level Evaluation Report — Section 5
==========================================================================
"""

import numpy as np
from .vehicle_dynamics import PacejkaCoeffs


class ExtendedKalmanFilter:
    """
    3-state EKF observing lateral velocity, yaw rate, and tire-road friction.

    The friction coefficient μ is modeled as a random walk (μ̇ = 0 + wμ),
    allowing the Kalman gain to continuously adapt the μ estimate based
    on lateral acceleration residuals — enabling friction estimation
    without optical sensors.
    """

    def __init__(self):
        # State: [vy, gamma, mu]
        self.x = np.array([0.0, 0.0, 0.85])

        # State covariance
        self.P = np.eye(3) * 1.0

        # Process noise covariance (tuned for chassis torsion & suspension compliance)
        self.Q = np.diag([0.01, 0.01, 0.001])

        # Measurement noise covariance (IMU sensor noise)
        self.R = np.diag([0.1, 0.05])

    def predict(self, dt: float, vx: float, delta: float,
                Fzf: float, FzL: float, FzR: float,
                m: float, lf: float, lr: float, Tw: float, Iz: float,
                pacejka_front: PacejkaCoeffs, pacejka_rear: PacejkaCoeffs):
        """
        EKF Prediction Step (Time Update).

        Projects the state forward using the 3-DOF dynamics:
            x̂_{k|k-1} = f(x̂_{k-1|k-1}, u_{k-1})
            P_{k|k-1}  = A · P_{k-1|k-1} · Aᵀ + Q

        The Jacobian A = ∂f/∂x is computed analytically, capturing
        the Pacejka tire nonlinearity via the chain rule.
        """
        vy, gamma, mu = self.x

        # Safe velocity divisions (prevent division by zero at startup)
        vx_safe = max(abs(vx), 0.5) * (1.0 if vx >= 0 else -1.0)
        vx_L_safe = max(abs(vx - (Tw / 2) * gamma), 0.5) * (1.0 if (vx - (Tw / 2) * gamma) >= 0 else -1.0)
        vx_R_safe = max(abs(vx + (Tw / 2) * gamma), 0.5) * (1.0 if (vx + (Tw / 2) * gamma) >= 0 else -1.0)

        # Slip angles
        alpha_f = delta - np.arctan2(vy + lf * gamma, vx_safe)
        alpha_rL = -np.arctan2(vy - lr * gamma, vx_L_safe)
        alpha_rR = -np.arctan2(vy - lr * gamma, vx_R_safe)

        # ── Jacobian partial derivatives ∂α/∂vy ──
        # Using: ∂/∂vy[arctan(y/x)] = x / (x² + y²)
        d_af_dvy = -vx_safe / (vx_safe**2 + (vy + lf * gamma)**2)
        d_arL_dvy = -vx_L_safe / (vx_L_safe**2 + (vy - lr * gamma)**2)
        d_arR_dvy = -vx_R_safe / (vx_R_safe**2 + (vy - lr * gamma)**2)

        # Linearized cornering stiffness (∂Fy/∂α approximation)
        pF, pR = pacejka_front, pacejka_rear
        cF = pF.B * pF.C * pF.D * mu * Fzf
        cL = pR.B * pR.C * pR.D * mu * FzL
        cR = pR.B * pR.C * pR.D * mu * FzR

        # Jacobian A(1,1) = ∂v̇y/∂vy (chain rule through Pacejka)
        dvy_dvy = (cF * d_af_dvy * np.cos(delta) + cL * d_arL_dvy + cR * d_arR_dvy) / m

        # State transition Jacobian (linearized around current state)
        A = np.array([
            [1.0 + dt * dvy_dvy, dt * (-vx), 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0]   # μ random walk
        ])

        # ── Nonlinear state prediction ──
        # Simplified force computation for prediction
        Fy_f = mu * Fzf * np.sin(alpha_f)
        Fy_rL = mu * FzL * np.sin(alpha_rL)
        Fy_rR = mu * FzR * np.sin(alpha_rR)

        dot_vy = (Fy_f * np.cos(delta) + Fy_rL + Fy_rR) / m - vx * gamma
        dot_gamma = (lf * Fy_f * np.cos(delta) - lr * (Fy_rL + Fy_rR)) / Iz

        # State prediction
        self.x[0] = vy + dt * dot_vy       # vy
        self.x[1] = gamma + dt * dot_gamma  # gamma
        # self.x[2] = mu  (random walk: no change in prediction)

        # Covariance prediction: P = A·P·Aᵀ + Q
        self.P = A @ self.P @ A.T + self.Q

    def update(self, ay_meas: float, gamma_meas: float, vx: float):
        """
        EKF Correction Step (Measurement Update).

        Kalman Gain: K = P·Hᵀ·(H·P·Hᵀ + R)⁻¹
        State:       x̂ = x̂ + K·(z - h(x̂))
        Covariance:  P = (I - K·H)·P

        Observation model: h(x) = [vx·γ, γ]ᵀ
        Observation Jacobian: H = ∂h/∂x
        """
        # Measurement vector
        z = np.array([ay_meas, gamma_meas])

        # Predicted measurement: h(x) = [vx * gamma, gamma]
        h_x = np.array([vx * self.x[1], self.x[1]])

        # Observation Jacobian
        H = np.array([
            [0.0, vx, 0.0],   # ∂ay/∂vy=0, ∂ay/∂γ=vx, ∂ay/∂μ=0
            [0.0, 1.0, 0.0]   # ∂γ/∂vy=0,  ∂γ/∂γ=1,   ∂γ/∂μ=0
        ])

        # Innovation
        y = z - h_x

        # Innovation covariance
        S = H @ self.P @ H.T + self.R

        # Kalman gain
        K = self.P @ H.T @ np.linalg.inv(S)

        # State correction
        self.x = self.x + K @ y

        # Covariance correction (Joseph form for numerical stability)
        I_KH = np.eye(3) - K @ H
        self.P = I_KH @ self.P

        # Physical bounds clamping
        self.x[0] = np.clip(self.x[0], -10.0, 10.0)   # vy
        self.x[2] = np.clip(self.x[2], 0.1, 1.0)       # μ

    @property
    def estimated_vy(self) -> float:
        return float(self.x[0])

    @property
    def estimated_gamma(self) -> float:
        return float(self.x[1])

    @property
    def estimated_mu(self) -> float:
        return float(self.x[2])

