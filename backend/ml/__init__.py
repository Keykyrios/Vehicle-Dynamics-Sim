"""
==========================================================================
 NEXUS L5 — Machine Learning Intelligence Layer
 Physics-Informed Neural Networks & Convex Optimization for VCU
 
 Modules:
   - Lyapunov Neural Network:    Stability certification & adaptive gain
   - Hamiltonian Neural Network:  Energy-conserving dynamics learning
   - Convex Torque Optimizer:     DCCP / SDP torque allocation
   - ML Supervisor:               Orchestrates all ML modules
==========================================================================
"""

from .ml_supervisor import MLSupervisor

__all__ = ['MLSupervisor']

