# Hardware Agent MVP Requirements

## Product

Hardware Agent is an open-source agentic hardware-debugging framework. The MVP uses an ESP32-S3 as a deterministic physical adapter for an MPU6050, INA219, L298N, and DC motor.

The demonstration investigates one controlled failure: an intentionally disconnected motor lead.

## Required loop

```text
User problem → hypotheses → safe experiment selection → physical execution
→ deterministic evidence → updated hypotheses → repair request → physical verification
```

The model selects what to test and gives a concise rationale. The backend validates tools and owns evidence, confidence, and diagnosis state. The ESP32 executes fixed operations and maintains safety without laptop assistance.

## Calibration and evidence

Healthy calibration precedes fault injection:

- `Iidle`: inactive motor-rail current
- `Ihealthy`: known-good active current
- `Mbase`: inactive acceleration RMS
- `Mhealthy`: known-good motor-induced acceleration RMS

MPU6050 data is indirect evidence of an expected motor-induced motion/vibration signature. It does not prove shaft rotation.

After absent motion, the model should choose a current probe because current distinguishes a near-idle open/unenergized condition from an energized stall. Near-idle current does not locate the break or exclude every driver failure.

## Confidence ownership

Only the evidence engine assigns:

- `UNKNOWN`
- `POSSIBLE`
- `LIKELY`
- `HIGH CONFIDENCE`
- `CONFIRMED`

Absent valid motion plus near-idle valid current and no trip supports:

> HIGH CONFIDENCE: Open or otherwise unenergized motor-path condition.

`CONFIRMED` requires a declared intervention and two consecutive passing verification trials. Any failed or invalid trial resets the count.

## Agentic proof

The audit trail must contain the observation IDs supplied to the model, model-selected action, concise rationale, backend validation, and returned observation. Simulation tests must show different decisions for absent, detected, and invalid motion.

A deterministic fallback is visibly labeled and does not count as proof of model-selected behavior.

## Safety

- No arbitrary hardware parameters or raw commands
- Fixed firmware pulse and current threshold
- Human approval before activation
- Four diagnostic activations
- Minimum configured cooldown
- Firmware-local timeout and activation budgets
- Current and sensor failure shutdown
- Physical and serial E-stop latched until reset
- LOW motor outputs on boot and failure
- Physical experiments disabled until hardware configuration is validated

## User interface

The dashboard shows mode, hardware status, calibration, problem, hypotheses, current observation, next decision, rationale, evidence provenance, approval, repair declaration, emergency stop, timeline, and final backend diagnosis.

## Non-goals

No project generation, repository analysis, firmware generation, universal component discovery, multiple MCU support, cloud infrastructure, authentication, complex memory, arbitrary fault injection, computer vision, or production safety certification.
