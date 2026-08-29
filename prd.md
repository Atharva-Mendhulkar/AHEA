# AHEA Product Requirements

## Product thesis

AHEA is an open-source agentic framework that investigates and tunes hardware/software systems by combining declared project intent with bounded physical experiments and deterministic evidence.

The core loop is:

`PROJECT CONTEXT → OBSERVE → HYPOTHESES → UNCERTAINTY → EXPERIMENT → MEASURE → UPDATE → RECOMMEND → INTERVENE → VERIFY`

Project context says what the system should do. The ESP32 reports what configured hardware actually did. The agent chooses the next useful semantic experiment. The evidence engine determines what the measurement proves. The backend alone determines whether verification is sufficient.

## Available hardware and honest claims

The sensor-first MVP targets ESP32/ESP32-S3, MPU6050, DHT11, HC-SR04, and FSR voltage dividers. A 9g servo and 5 V relay are represented as disabled extension points. Relay control requires a reviewed driver/flyback circuit, and servo control requires a reviewed supply and mechanical setup.

The system does not require dedicated current or voltage instruments. ESP32 ADC measurements are allowed only through a declared circuit and fixed firmware profile. MPU6050 motion is an indirect motion signature, not proof of shaft rotation. Relay GPIO state is not proof that an external load switched.

## MVP user outcome

Given four reference FSRs and one subject FSR, AHEA must:

1. Collect repeated measurements under an operator-confirmed manual stimulus.
2. Calculate reference and subject statistics deterministically.
3. Maintain competing hypotheses rather than immediately declaring a failed sensor.
4. Select a different next action for normal, noisy, failed-read, and stable-outlier evidence.
5. When the divider model is complete, evaluate only configured resistor candidates and reject electrically unsafe candidates.
6. Require a human to make the physical modification.
7. Repeat measurement and require two consecutive passing verification trials.
8. Keep simulated evidence visibly separate and refuse physical confirmation from simulation.

## Agent-session experience

The primary interface is one state-aware investigation surface rather than a lab worksheet. The user starts the investigation once. The backend then prepares each bounded experiment, captures a baseline, requests physical input only when necessary, detects a meaningful response, records sufficient samples, analyzes evidence, and selects the next experiment automatically.

The visible agent states are `IDLE`, `INITIALIZING`, `WAITING_FOR_USER_STIMULUS`, `RECORDING`, `ANALYZING`, `SELECTING_NEXT_EXPERIMENT`, `WAITING_FOR_INTERVENTION`, `POST_INTERVENTION_VERIFY`, `DIAGNOSIS_READY`, `CONFIRMED`, and `INCONCLUSIVE`. These are presentation-safe summaries of backend activity, not chain-of-thought.

Signal sufficiency is deterministic. It requires a valid bounded observation, healthy sensor status, minimum sample coverage, a device-specific meaningful change from baseline where applicable, and acceptable stability. A hard probe limit stops an unproductive recording as inconclusive. The model cannot declare a signal sufficient.

The default demonstration treats one stable 64-sample window per FSR as sufficient for that sensor, then compares the subject against all four reference sensors. Reviewed physical profiles may require additional windows. Short backend-enforced dwell periods keep baseline, stimulus, steady recording, and analysis states perceptible and give the builder time to reposition between sensors.

Monitoring observations are provenance-tagged as `monitoring` and retained for the live graph and audit trail. They cannot affect reference statistics, diagnosis, recommendations, confidence, or verification. Only the bounded diagnostic window selected by the agent and accepted by the safety gateway enters the evidence engine.

The same graph changes mode with the investigation: live response and baseline while recording, expected versus observed during analysis, current versus target for a recommendation, and before versus after during verification. Project context, hardware status, evidence coverage, and timeline remain secondary.

## Functional requirements

- Project context is versioned, validated, immutable within a session, and included by digest in every observation and decision.
- Built-in device modules describe capabilities, honest claims, limitations, and supported semantic commands.
- The model selects only opaque backend-offered experiment IDs.
- Pin mappings, ADC configuration, timing, I²C registers, actuator parameters, and electrical limits remain in trusted firmware/profile code.
- Every observation records device, experiment, source, measurements, units, health, timing, operation result, and context digest.
- The evidence engine owns statistics, evidence state, hypotheses, recommendations, confidence, and verification counters.
- Recommendations include observed problem, reference behavior, candidate modification, calculation, expected effect, constraints, verification procedure, and confidence.
- Sessions preserve an append-only audit timeline and immutable physical/simulation provenance.
- The active experiment states what physical input is required; the user does not navigate trial sequencing or decide when recording stops.
- The UI uses one dynamic investigation surface for live behavior, controlled evidence, deterministic comparison, diagnosis, adjustment, and verification.
- Physical and code changes are presented separately. Neither is recommended until the evidence supports it.
- A healthy sensor result stops the hardware investigation and presents project-level checks derived from project context instead of inventing a component fault.

## FSR tuning constraints

Candidate analysis is unavailable unless divider topology, current resistor, supply voltage, ADC maximum, current bound, and candidate set are all declared. Candidate values are never invented by the model. The first physical procedure is repeatable manual pressure, so evidence and recommendations must state that the stimulus is not a calibrated force source.

The bundled `config/project.json` is a simulation example using 10 kΩ and other kΩ-range candidates. It is not evidence about the user's unconfirmed physical divider.

## Scope

### Must have

- Physical-capable MPU6050, DHT11, HC-SR04, and FSR commands behind a safe-disabled profile.
- Complete FSR simulation, reference comparison, bounded recommendation, intervention, and verification path.
- Project-context UI/API, safety gateway, deterministic fallback, provenance, audit, and reports.
- Backend-owned bounded recording for configured FSR, MPU6050, DHT11, and HC-SR04 sensors, with dynamic stimulus prompts and strict monitoring/evidence separation.
- Expected-versus-observed visualization, numeric deviation, plain-language diagnosis, and separate physical/software adjustment guidance.

### Should have

- Richer device-specific evidence for MPU6050, DHT11, and HC-SR04.
- Reviewed physical profiles and recorded hardware-in-loop results.
- Simulator-only servo and relay response modules.

### Later

- Physical servo/relay experiments after separate electrical and mechanical review.
- Automated resistor testing only with real switching hardware.
- Optional external current/voltage instrument adapters.
- Remote module catalogs and package signing.

## Acceptance criteria

- TypeScript build and deterministic tests pass.
- Raw hardware parameters and arbitrary resistor candidates are rejected.
- Different observations produce different next experiments.
- Reference statistics and candidate calculations are deterministic.
- Stale approvals, missing setup confirmation, invalid interventions, mixed provenance, and exhausted budgets fail closed.
- Simulation can pass verification but cannot produce physical `CONFIRMED` status.
- Physical claims remain explicitly unverified until a reviewed profile is flashed and hardware-in-loop tests are recorded.
- Live monitoring cannot consume the diagnostic experiment budget or alter evidence state.

## Current validation status

- Simulation, agent-driven bounded recording, deterministic sufficiency detection, and static TypeScript validation: implemented.
- Live OpenAI selection: opt-in and not required for deterministic tests.
- Firmware native/build validation: pending because PlatformIO is not installed in the current environment.
- Physical ESP32, sensor wiring, ADC behavior, timing, and tuning results: not yet validated.
