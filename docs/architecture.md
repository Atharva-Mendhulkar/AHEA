# Architecture

## Runtime flow

```text
Project context + trusted hardware profile
                 ↓
Eligible semantic experiments
                 ↓
Agent selection → safety gateway → bounded recording state
                                      ↓
                           simulator or ESP32 adapter
                                      ↓
                           canonical observation
                                      ↓
                  deterministic evidence and tuning
                                      ↓
                       next experiment or stop
```

The project context describes intended behavior, device roles, reference groups, procedures, and allowed modifications. The trusted firmware profile maps logical bindings to fixed pins and electrical settings. The model sees semantic device/experiment identities but cannot author hardware parameters.

## Preserved trust boundaries

1. The browser submits project intent, one investigation start action, and explicit physical-intervention declarations.
2. The coordinator owns lifecycle, agent state, immutable source, context digest, budgets, read authorization, and audit events.
3. The agent selects one experiment from a backend-generated eligible list.
4. The gateway revalidates the opaque experiment ID and every prerequisite.
5. Adapters preserve physical/simulation provenance and normalize firmware responses.
6. The evidence engine computes statistics, hypotheses, recommendations, confidence, and verification.
7. Firmware accepts registered device and plan IDs only and independently bounds operations.

Built-in modules cover MPU6050, DHT11, HC-SR04, and FSR. Servo and relay descriptors deliberately expose no executable commands in the sensor-first MVP. The extension point is local; there is no remote catalog or installer.

## Agent orchestration and controlled evidence

`DiagnosisSession.agentState` drives the visible experience. After one start action, the frontend calls the bounded advance endpoint while the session is active. The coordinator—not the browser—chooses the experiment, captures a baseline, evaluates device-specific signal sufficiency, runs the approved bounded evidence window, updates deterministic evidence, and selects the next state. SSE continues to carry audited transitions.

Baseline and stimulus probes are `monitoring` observations. They use the same semantic-command, profile, adapter, provenance, timeout, and audit boundaries as diagnostic experiments, but remain excluded from deterministic diagnosis and verification. Only the subsequent gateway-validated `diagnostic` or `verification` window updates reference statistics, hypotheses, recommendations, confidence, or consecutive-pass state.

The deterministic sufficiency evaluator checks operation acceptance, sensor health, sample coverage, device-specific change from baseline, and configured stability thresholds. Eight unsuccessful probes end the active measurement as `INCONCLUSIVE`; neither the model nor the frontend can extend that bound.

Sessions use schema version 2. Legacy current-based sessions are preserved on disk but rejected rather than reinterpreted.
