"""
==========================================================================
 NEXUS L5 — FastAPI WebSocket Physics Server
 Streams vehicle state at 100 Hz to the Three.js frontend.
 Receives driver inputs (throttle, steer, parameters) from the client.
==========================================================================
"""

import asyncio
import json
import time

import math
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
import os

from physics.vehicle_dynamics import VehicleDynamics
from physics.vcu import VehicleControlUnit
from ml import MLSupervisor
from pqc import PQCSession

app = FastAPI(title="NEXUS L5 VCU Physics Server")

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve frontend static files
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend")
FRONTEND_DIR = os.path.normpath(FRONTEND_DIR)

@app.get("/")
async def serve_frontend():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

# Mount CSS and JS directories at their correct URL paths
if os.path.exists(os.path.join(FRONTEND_DIR, "css")):
    app.mount("/css", StaticFiles(directory=os.path.join(FRONTEND_DIR, "css")), name="css")
if os.path.exists(os.path.join(FRONTEND_DIR, "js")):
    app.mount("/js", StaticFiles(directory=os.path.join(FRONTEND_DIR, "js")), name="js")


# ── PQC Encapsulation REST endpoint for browser clients ──
# The browser cannot run ML-KEM natively, so it calls this endpoint
# to perform the encapsulation step server-side.
@app.post("/api/encaps")
async def pqc_encapsulate(request: Request):
    """
    Browser-friendly encapsulation endpoint.
    Receives: { "ek": "<hex-encoded encapsulation key>" }
    Returns:  { "ct": "<hex>", "shared_key": "<hex>" }
    """
    body = await request.json()
    ek_hex = body.get('ek', '')
    ek_bytes = bytes.fromhex(ek_hex)

    # Use a temporary PQCSession to run encapsulation
    temp = PQCSession()
    shared_key, ct = temp.server_encapsulate(ek_bytes)

    return JSONResponse({
        'ct': ct.hex(),
        'shared_key': shared_key.hex(),
    })


# ── Physics simulation constants ──
PHYS_DT = 0.005          # 5ms physics sub-step (200 Hz internal)
SEND_INTERVAL = 0.010    # 10ms WebSocket frame interval (100 Hz)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    """
    WebSocket endpoint for real-time physics streaming.

    Protocol:
        Client → Server (JSON):
            { throttle, steer, mass, gradient, mu, split_mu, fault_steer, fault_imu, reset }

        Server → Client (JSON):
            { vx, vy, gamma, x, z, yaw, ax, ay, TL, TR, Fzf, FzL, FzR,
              RI, Mz_req, T_req, gamma_ref, est_mu, status, alpha_f, alpha_rL, alpha_rR }
    """
    await ws.accept()
    print("╔══════════════════════════════════════════════╗")
    print("║   NEXUS L5 VCU — WebSocket Connected    ║")
    print("╚══════════════════════════════════════════════╝")

    # ── PQC: Initialize quantum-safe encrypted channel ──
    pqc = PQCSession()
    try:
        # Step 1: Generate ML-KEM-768 keypair
        ek = pqc.generate_keypair()
        print(f"[PQC] ML-KEM-768 keygen complete ({pqc.keygen_time_ms:.1f} ms), ek={len(ek)} bytes")

        # Step 2: Send encapsulation key to client
        await ws.send_text(json.dumps({
            'type': 'pqc_ek',
            'ek': ek.hex(),
            'algorithm': pqc.ALGORITHM,
        }))
        print("[PQC] Sent encapsulation key to client, awaiting ciphertext...")

        # Step 3: Wait for client's ciphertext (with timeout)
        ct_msg = await asyncio.wait_for(ws.receive_text(), timeout=10.0)
        ct_data = json.loads(ct_msg)

        if ct_data.get('type') != 'pqc_ct':
            print(f"[PQC] Warning: Expected pqc_ct, got {ct_data.get('type')}")

        ct_bytes = bytes.fromhex(ct_data['ct'])

        # Step 4: Decapsulate → shared key
        if pqc.complete_handshake(ct_bytes):
            print(f"[PQC] ✅ ML-KEM-768 handshake complete ({pqc.handshake_time_ms:.1f} ms)")
            print(f"[PQC] 🔒 AES-256-GCM encrypted channel established")
        else:
            print("[PQC] ⚠️ Handshake failed, falling back to plaintext")
            pqc.enabled = False

        # Confirm handshake to client
        await ws.send_text(json.dumps({
            'type': 'pqc_ready',
            'success': pqc.handshake_complete,
            'handshake_ms': round(pqc.handshake_time_ms, 2),
        }))

    except asyncio.TimeoutError:
        print("[PQC] ⚠️ Handshake timeout, proceeding with plaintext")
        pqc.enabled = False
        await ws.send_text(json.dumps({'type': 'pqc_ready', 'success': False}))
    except Exception as e:
        print(f"[PQC] ⚠️ Handshake error: {e}, proceeding with plaintext")
        pqc.enabled = False
        await ws.send_text(json.dumps({'type': 'pqc_ready', 'success': False}))

    # Create per-connection physics instances
    dynamics = VehicleDynamics()
    # Run initial physics step so Fz values are non-zero from the start
    dynamics.step(0.001)
    vcu = VehicleControlUnit(dynamics)

    # ML Intelligence Layer (advisory — does NOT modify VCU/physics)
    ml = MLSupervisor()

    # Input state (updated from client messages)
    client_inputs = {
        'throttle': 0.0,
        'steer': 0.0,
        'mass': 766.0,
        'gradient': 0.0,
        'mu': 0.85,
        'split_mu': False,
        'fault_steer': False,
        'fault_imu': False,
    }

    running = True

    debug_counter = [0]

    async def receive_inputs():
        """Continuously receive client input messages."""
        nonlocal running
        try:
            while running:
                raw_data = await ws.receive_text()

                # ── PQC: Decrypt incoming message if encrypted ──
                try:
                    raw_msg = json.loads(raw_data)
                    if raw_msg.get('pqc', False) and pqc.handshake_complete:
                        decrypted = pqc.decrypt(raw_msg)
                        msg = json.loads(decrypted)
                    else:
                        msg = raw_msg
                except Exception:
                    msg = json.loads(raw_data)

                # Handle PQC toggle from client
                if 'pqc_toggle' in msg:
                    pqc.enabled = msg['pqc_toggle']
                    print(f"[PQC] Encryption {'ENABLED' if pqc.enabled else 'DISABLED'} by client")

                client_inputs.update(msg)

                # Debug: log inputs periodically
                debug_counter[0] += 1
                if debug_counter[0] % 100 == 1:
                    print(f"[INPUT] throttle={msg.get('throttle', 0):.3f} steer={msg.get('steer', 0):.3f} mass={msg.get('mass', 766)}")

                # Handle reset command
                if msg.get('reset', False):
                    dynamics.reset()
                    vcu.asmc_prev_e = 0.0
                    vcu.asmc_e_dot_filt = 0.0
        except WebSocketDisconnect:
            running = False
        except Exception as e:
            print(f"[WS Receive Error] {e}")
            running = False

    async def physics_loop():
        """Run physics at fixed timestep, stream state to client."""
        nonlocal running
        last_time = time.perf_counter()
        accumulator = 0.0

        try:
            while running:
                now = time.perf_counter()
                elapsed = now - last_time
                last_time = now

                # ── Apply client parameters ──
                dynamics.m = client_inputs['mass']
                # Removed theta_pitch gravity force so vehicle doesn't slide backward
                dynamics.theta_pitch = 0.0

                dynamics.base_mu = client_inputs['mu']

                if client_inputs['split_mu']:
                    dynamics.mu_left = 0.20
                    dynamics.mu_right = dynamics.base_mu
                else:
                    dynamics.mu_left = dynamics.base_mu
                    dynamics.mu_right = dynamics.base_mu

                # ── One Wheel in Air (Open Differential Failure) ──
                # Right wheel loses contact → friction drops to ~0
                # Open diff sends all torque to the free-spinning wheel
                if client_inputs.get('wheel_in_air', False):
                    dynamics.mu_right = 0.02  # Near-zero: airborne wheel

                # ── Asymmetric Slope (Different slope under each wheel) ──
                # Left wheel on gentle slope, right wheel on steep slope
                # Right wheel reaches friction limit first → open diff fails
                if client_inputs.get('asym_slope', False):
                    dynamics.mu_left = dynamics.base_mu * 0.95   # Gentle slope: almost full grip
                    dynamics.mu_right = dynamics.base_mu * 0.30  # Steep slope: heavily limited
                    # Removed theta_pitch here too to prevent sliding backward

                vcu.fault_steer = client_inputs['fault_steer']
                vcu.fault_imu = client_inputs['fault_imu']
                vcu.fault_motor = client_inputs.get('fault_motor', False)

                throttle = client_inputs['throttle']
                delta = client_inputs['steer']

                # ── Fixed-timestep physics sub-stepping ──
                accumulator += min(elapsed, 0.05)  # Cap at 50ms to prevent death spirals
                steps = 0
                while accumulator >= PHYS_DT and steps < 10:
                    vcu.execute(throttle, delta, PHYS_DT)
                    dynamics.step(PHYS_DT)
                    accumulator -= PHYS_DT
                    steps += 1

                # Debug: log physics state periodically
                debug_counter[0] += 1
                if debug_counter[0] % 200 == 0:
                    print(f"[PHYS] vx={dynamics.state.vx:.3f} TL={dynamics.TL:.1f} TR={dynamics.TR:.1f} Fzf={dynamics.outputs.Fzf:.0f} steps={steps}")

                # ── ML Intelligence tick ──
                try:
                    ml_telemetry = ml.step(dynamics, vcu)
                except Exception:
                    ml_telemetry = {}

                # ── Serialize state + telemetry ──
                state = dynamics.state
                out = dynamics.outputs

                frame = {
                    # Vehicle kinematics
                    'vx': round(state.vx, 4),
                    'vy': round(state.vy, 4),
                    'gamma': round(state.gamma, 5),
                    'x': round(state.x, 3),
                    'z': round(state.z, 3),
                    'yaw': round(state.yaw, 5),
                    # Accelerations
                    'ax': round(out.ax, 4),
                    'ay': round(out.ay, 4),
                    # Motor commands
                    'TL': round(dynamics.TL, 2),
                    'TR': round(dynamics.TR, 2),
                    # Normal forces
                    'Fzf': round(out.Fzf, 1),
                    'FzL': round(out.FzL, 1),
                    'FzR': round(out.FzR, 1),
                    # Rollover index
                    'RI': round(out.RI, 4),
                    # VCU telemetry
                    'Mz_req': round(vcu.Mz_req, 2),
                    'T_req': round(vcu.T_req, 2),
                    'gamma_ref': round(vcu.gamma_ref, 5),
                    'est_mu': round(vcu.est_mu, 3),
                    'status': vcu.status,
                    # Slip angles
                    'alpha_f': round(out.alpha_f, 5),
                    'alpha_rL': round(out.alpha_rL, 5),
                    'alpha_rR': round(out.alpha_rR, 5),
                    # Tire forces
                    'Fyf': round(out.Fyf, 1),
                    'FyL': round(out.FyL, 1),
                    'FyR': round(out.FyR, 1),
                }

                # Merge ML telemetry (non-breaking addition)
                frame.update(ml_telemetry)

                # Merge PQC security telemetry
                frame.update(pqc.get_telemetry())

                # ── PQC: Encrypt outgoing frame ──
                frame_json = json.dumps(frame)
                if pqc.enabled and pqc.handshake_complete:
                    encrypted = pqc.encrypt(frame_json)
                    await ws.send_text(json.dumps(encrypted))
                else:
                    # Explicitly ensure payload is a pure string to avoid any b'...' artifacts by Uvicorn
                    clean_str = frame_json if isinstance(frame_json, str) else frame_json.decode('utf-8')
                    await ws.send_text(clean_str)

                # Maintain ~100 Hz send rate
                compute_time = time.perf_counter() - now
                sleep_time = max(0, SEND_INTERVAL - compute_time)
                await asyncio.sleep(sleep_time)

        except WebSocketDisconnect:
            running = False
        except Exception as e:
            print(f"[Physics Loop Error] {e}")
            running = False

    # Run both tasks concurrently
    await asyncio.gather(
        receive_inputs(),
        physics_loop()
    )

    print("[WS] Client disconnected.")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")

