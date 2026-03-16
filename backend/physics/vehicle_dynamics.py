"""
==========================================================================
 NEXUS L5 AUTO-RICKSHAW — 3-DOF Vehicle Dynamics Engine
 Implements: Newton-Euler mechanics, Pacejka Magic Formula tires,
             Dynamic load transfer, RK4 integrator
 Reference:  Team Aphelion Deep-Level Evaluation Report
==========================================================================
"""

import numpy as np
from dataclasses import dataclass, field
from typing import Tuple


@dataclass
class PacejkaCoeffs:
    """Semi-empirical Pacejka Magic Formula tire coefficients."""
    B: float  # Stiffness factor
    C: float  # Shape factor
    D: float  # Peak factor (normalized to 1.0)
    E: float  # Curvature factor


@dataclass
class VehicleState:
    """6-state planar vehicle model: [vx, vy, gamma, x, z, yaw]."""
    vx: float = 0.0       # Longitudinal velocity [m/s]
    vy: float = 0.0       # Lateral velocity [m/s]
    gamma: float = 0.0    # Yaw rate [rad/s]
    x: float = 0.0        # Global X position [m]
    z: float = 0.0        # Global Z position [m]
    yaw: float = 0.0      # Heading angle [rad]

    def as_array(self) -> np.ndarray:
        return np.array([self.vx, self.vy, self.gamma, self.x, self.z, self.yaw])

    @staticmethod
    def from_array(arr: np.ndarray) -> 'VehicleState':
        return VehicleState(
            vx=float(arr[0]), vy=float(arr[1]), gamma=float(arr[2]),
            x=float(arr[3]), z=float(arr[4]), yaw=float(arr[5])
        )


@dataclass
class VehicleOutputs:
    """Computed dynamic outputs from the physics step."""
    ax: float = 0.0
    ay: float = 0.0
    alpha_f: float = 0.0
    alpha_rL: float = 0.0
    alpha_rR: float = 0.0
    Fzf: float = 0.0
    FzL: float = 0.0
    FzR: float = 0.0
    RI: float = 0.0
    Fyf: float = 0.0
    FyL: float = 0.0
    FyR: float = 0.0


class VehicleDynamics:
    """
    3-DOF delta-trike vehicle dynamics with Pacejka tire model.

    Models: longitudinal, lateral, and yaw dynamics for an L5 electric
    auto-rickshaw with independent rear hub motors.
    """

    # ── Table 1: Nominal L5 Vehicle Parameters ──
    G = 9.81  # Gravitational acceleration [m/s²]

    def __init__(self):
        # Geometric & inertial parameters
        self.m: float = 766.0       # Gross vehicle weight [kg]
        self.L: float = 2.000       # Wheelbase [m]
        self.Tw: float = 1.150      # Rear track width [m]
        self.lf: float = 1.350      # CG to front axle [m]
        self.lr: float = 0.650      # CG to rear axle [m]
        self.hcg: float = 0.550     # CG height [m]
        self.Iz: float = 450.0      # Yaw moment of inertia [kg·m²]
        self.rw: float = 0.203      # Dynamic wheel radius [m]
        self.T_max: float = 80.0    # Peak motor torque per hub [Nm]

        # Aerodynamic parameters
        self.rho: float = 1.225     # Air density [kg/m³]
        self.Cd: float = 0.80       # Drag coefficient
        self.A_front: float = 2.5   # Frontal area [m²]
        self.Crr: float = 0.02      # Rolling resistance coefficient

        # Road parameters
        self.theta_pitch: float = 0.0  # Road gradient [rad]
        self.base_mu: float = 0.85     # Base tire-road friction
        self.mu_left: float = 0.85     # Left tire friction (for μ-split)
        self.mu_right: float = 0.85    # Right tire friction

        # ── Table 2: Pacejka coefficients ──
        self.pacejka_front = PacejkaCoeffs(B=6.82, C=1.35, D=1.00, E=-0.45)
        self.pacejka_rear = PacejkaCoeffs(B=7.45, C=1.48, D=1.00, E=-0.22)

        # State
        self.state = VehicleState()
        self.outputs = VehicleOutputs()

        # Dynamic obstacles
        self.walls = []

        # Inputs
        self.delta: float = 0.0   # Steering angle [rad]
        self.TL: float = 0.0      # Left motor torque [Nm]
        self.TR: float = 0.0      # Right motor torque [Nm]
        self.throttle: float = 0.0

    def reset(self):
        """Reset vehicle to initial conditions."""
        self.state = VehicleState()
        self.outputs = VehicleOutputs()
        self.TL = 0.0
        self.TR = 0.0
        self.delta = 0.0
        self.throttle = 0.0
        self.walls.clear()

    # ── Pacejka Magic Formula ──
    @staticmethod
    def pacejka_force(alpha: float, Fz: float, mu: float, c: PacejkaCoeffs) -> float:
        """
        Fy = μ·Fz·D·sin(C·arctan(B·α - E·(B·α - arctan(B·α))))

        Returns the lateral tire force [N] using the semi-empirical
        Pacejka Magic Formula for the given slip angle.
        """
        Ba = c.B * alpha
        return mu * Fz * c.D * np.sin(
            c.C * np.arctan(Ba - c.E * (Ba - np.arctan(Ba)))
        )

    # ── Slip Angle Computation ──
    def _compute_slip_angles(self, s: VehicleState) -> Tuple[float, float, float]:
        """
        Compute tire slip angles for delta-trike geometry.

        αf  = arctan((vy + lf·γ) / vx) - δ
        αrL = arctan((vy - lr·γ) / (vx - Tw/2·γ))
        αrR = arctan((vy - lr·γ) / (vx + Tw/2·γ))
        """
        vx_safe = max(abs(s.vx), 0.5) * (1.0 if s.vx >= 0 else -1.0)
        vx_rL = s.vx - (self.Tw / 2.0) * s.gamma
        vx_rR = s.vx + (self.Tw / 2.0) * s.gamma
        vx_rL_safe = max(abs(vx_rL), 0.5) * (1.0 if vx_rL >= 0 else -1.0)
        vx_rR_safe = max(abs(vx_rR), 0.5) * (1.0 if vx_rR >= 0 else -1.0)

        alpha_f = self.delta - np.arctan2(s.vy + self.lf * s.gamma, vx_safe)
        alpha_rL = -np.arctan2(s.vy - self.lr * s.gamma, vx_rL_safe)
        alpha_rR = -np.arctan2(s.vy - self.lr * s.gamma, vx_rR_safe)

        return alpha_f, alpha_rL, alpha_rR

    # ── Dynamic Load Transfer ──
    def _compute_normal_forces(self, s: VehicleState, ay: float) -> Tuple[float, float, float]:
        """
        Compute dynamic vertical tire forces with longitudinal & lateral transfer.

        Fzf       = (m·g·lr·cos(θ) - m·hcg·(ax + g·sin(θ))) / L
        FzR_total = (m·g·lf·cos(θ) + m·hcg·(ax + g·sin(θ))) / L
        ΔFz_lat   = (m·ay·hcg / Tw) · (L / lr)
        """
        cos_p = np.cos(self.theta_pitch)
        Fzf = (self.m * self.G * self.lr * cos_p) / self.L
        FzR_total = (self.m * self.G * self.lf * cos_p) / self.L

        delta_Fz_lat = (self.m * ay * self.hcg / self.Tw) * (self.L / self.lr)

        FzL = max(0.0, FzR_total / 2.0 - delta_Fz_lat)
        FzR = max(0.0, FzR_total / 2.0 + delta_Fz_lat)

        return Fzf, FzL, FzR

    # ── 3-DOF Equations of Motion ──
    def _derivatives(self, state_arr: np.ndarray) -> Tuple[np.ndarray, dict]:
        """
        Compute state derivatives from the 3-DOF Newton-Euler equations.

        m(v̇x - vy·γ) = Fxf·cos(δ) - Fyf·sin(δ) + FxR + FxL - Faero - Fgrad
        m(v̇y + vx·γ) = Fxf·sin(δ) + Fyf·cos(δ) + FyR + FyL
        Iz·γ̇ = lf(Fyf·cos(δ) + Fxf·sin(δ)) - lr(FyR + FyL) + Tw/2·(FxR - FxL)
        """
        s = VehicleState.from_array(state_arr)

        # Slip angles
        alpha_f, alpha_rL, alpha_rR = self._compute_slip_angles(s)

        # Lateral acceleration estimate for load transfer
        ay_est = s.vx * s.gamma

        # Normal forces
        Fzf, FzL, FzR = self._compute_normal_forces(s, ay_est)

        # Lateral tire forces (Pacejka) with low-speed damping
        damp = min(1.0, abs(s.vx) / 1.0)
        Fyf = self.pacejka_force(alpha_f, Fzf, self.base_mu, self.pacejka_front) * damp
        FyL = self.pacejka_force(alpha_rL, FzL, self.mu_left, self.pacejka_rear) * damp
        FyR = self.pacejka_force(alpha_rR, FzR, self.mu_right, self.pacejka_rear) * damp

        # Longitudinal forces
        FxL = self.TL / self.rw
        FxR = self.TR / self.rw

        # Resistance forces
        F_aero = 0.5 * self.rho * self.Cd * self.A_front * s.vx * abs(s.vx)
        F_grad = self.m * self.G * np.sin(self.theta_pitch)
        F_rr = self.Crr * self.m * self.G * np.sign(s.vx) if abs(s.vx) > 0.05 else 0.0

        cos_d = np.cos(self.delta)
        sin_d = np.sin(self.delta)

        # 3-DOF equations of motion (Newton-Euler in body frame)
        dot_vx = (FxL + FxR - Fyf * sin_d - F_aero - F_rr - F_grad) / self.m + s.vy * s.gamma
        dot_vy = (Fyf * cos_d + FyL + FyR) / self.m - s.vx * s.gamma
        dot_gamma = (
            self.lf * (Fyf * cos_d) -
            self.lr * (FyL + FyR) +
            (self.Tw / 2.0) * (FxR - FxL)
        ) / self.Iz

        # Global position derivatives
        dot_x = s.vx * np.cos(s.yaw) - s.vy * np.sin(s.yaw)
        dot_z = -(s.vx * np.sin(s.yaw) + s.vy * np.cos(s.yaw))
        dot_yaw = s.gamma

        derivs = np.array([dot_vx, dot_vy, dot_gamma, dot_x, dot_z, dot_yaw])

        extras = {
            'ax': dot_vx - s.vy * s.gamma,
            'ay': dot_vy + s.vx * s.gamma,
            'alpha_f': alpha_f,
            'alpha_rL': alpha_rL,
            'alpha_rR': alpha_rR,
            'Fzf': Fzf, 'FzL': FzL, 'FzR': FzR,
            'Fyf': Fyf, 'FyL': FyL, 'FyR': FyR,
        }

        return derivs, extras

    # ── RK4 Integration ──
    def step(self, dt: float):
        """
        Advance vehicle state by dt using 4th-order Runge-Kutta integration.
        Includes sleep-state detection and NaN watchdog.
        """
        s = self.state

        # Sleep state: prevent numerical drift when idle
        # We don't return early! We need to compute Fzf, FzL, etc.
        # So we just snap velocities to exactly zero.
        if (abs(self.TL) < 1.0 and abs(self.TR) < 1.0 and
                abs(s.vx) < 0.05 and abs(s.vy) < 0.05 and abs(self.theta_pitch) < 0.01):
            s.vx = 0.0
            s.vy = 0.0
            s.gamma = 0.0
            self.outputs.ax = 0.0
            self.outputs.ay = 0.0

        y = s.as_array()

        # RK4 stages
        k1, extras = self._derivatives(y)
        k2, _ = self._derivatives(y + 0.5 * dt * k1)
        k3, _ = self._derivatives(y + 0.5 * dt * k2)
        k4, _ = self._derivatives(y + dt * k3)

        y_new = y + (dt / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4)

        # Numerical damping for stability
        y_new[1] *= 0.999  # vy
        y_new[2] *= 0.999  # gamma

        # Arena boundary collision
        ARENA = 195.0
        if abs(y_new[3]) > ARENA:
            y_new[3] = np.sign(y_new[3]) * ARENA
            y_new[0] *= -0.3
        if abs(y_new[4]) > ARENA:
            y_new[4] = np.sign(y_new[4]) * ARENA
            y_new[0] *= -0.3

        # Object Walls collision (OBB approx as bounding circles for simplicity)
        VEHICLE_R = 1.2
        for w in self.walls:
            dx = y_new[3] - w['x']
            dz = y_new[4] - w['z']
            dist = np.sqrt(dx*dx + dz*dz)
            if dist < VEHICLE_R + (w['thick']/2.0):
                # Hard crash! Zero velocity, bounce back slightly
                y_new[0] *= -0.1  # Heavy inelastic bounce
                y_new[1] = 0.0
                y_new[2] = 0.0
                # push out
                y_new[3] += (dx/dist) * 0.1
                y_new[4] += (dz/dist) * 0.1

        # NaN watchdog
        if np.any(np.isnan(y_new)):
            self.reset()
            return

        self.state = VehicleState.from_array(y_new)

        # Cache outputs
        self.outputs.ax = extras['ax']
        self.outputs.ay = extras['ay']
        self.outputs.alpha_f = extras['alpha_f']
        self.outputs.alpha_rL = extras['alpha_rL']
        self.outputs.alpha_rR = extras['alpha_rR']
        self.outputs.Fzf = extras['Fzf']
        self.outputs.FzL = extras['FzL']
        self.outputs.FzR = extras['FzR']
        self.outputs.Fyf = extras['Fyf']
        self.outputs.FyL = extras['FyL']
        self.outputs.FyR = extras['FyR']

        # Rollover Index: RI = (2·hcg / Tw) · (ay / g) · (L / lr)
        self.outputs.RI = (
            (2.0 * self.hcg / self.Tw) *
            (self.outputs.ay / self.G) *
            (self.L / self.lr)
        )

