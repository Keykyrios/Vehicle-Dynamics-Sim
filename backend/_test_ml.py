"""Quick smoke test for ML integration."""
import sys
sys.path.insert(0, '.')
from physics.vehicle_dynamics import VehicleDynamics
from physics.vcu import VehicleControlUnit
from ml import MLSupervisor

# Create instances exactly as main.py does
dynamics = VehicleDynamics()
dynamics.step(0.001)
vcu = VehicleControlUnit(dynamics)
ml = MLSupervisor()

# Simulate 20 ticks with throttle + steering
dynamics.delta = 0.15
for i in range(20):
    vcu.execute(0.5, 0.15, 0.005)
    dynamics.step(0.005)

# Run ML step
telemetry = ml.step(dynamics, vcu)

# Print results
print("=== ML TELEMETRY ===")
for k, v in sorted(telemetry.items()):
    print(f"  {k}: {v}")
print(f"\nTotal fields: {len(telemetry)}")
print(f"Compute time: {telemetry['ml_compute_ms']:.2f} ms")

# Verify key fields exist
required = [
    'ml_lyap_V', 'ml_lyap_Vdot', 'ml_stability_margin', 'ml_roa_radius', 'ml_gain_mult',
    'ml_energy_total', 'ml_energy_kinetic', 'ml_efficiency', 'ml_anomaly_score',
    'ml_opt_TL', 'ml_opt_TR', 'ml_friction_util_L', 'ml_friction_util_R',
    'ml_pareto_score', 'ml_robustness',
    'ml_safety_score', 'ml_efficiency_score', 'ml_intelligence',
]
missing = [k for k in required if k not in telemetry]
if missing:
    print(f"MISSING FIELDS: {missing}")
    sys.exit(1)

# Run 100 ticks to test stability
for i in range(100):
    vcu.execute(0.8, 0.3, 0.005)
    dynamics.step(0.005)
    t = ml.step(dynamics, vcu)

print(f"\n100-tick stress test passed. Final safety={t['ml_safety_score']:.3f}, "
      f"efficiency={t['ml_efficiency_score']:.3f}")
print("\nALL TESTS PASSED")
