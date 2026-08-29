# Architecture

## Responsibility boundaries

```text
User and dashboard
        |
Experiment coordinator
  | agent selector
  | policy and approval gate
  | deterministic evidence engine
  | immutable session mode
        |
Physical adapter OR simulator adapter
        |
ESP32-S3 firmware
  | fixed actuation
  | sensor sampling
  | local safety enforcement
        |
Motor assembly
```

The model answers one bounded question: **what should be tested next, and why?** It cannot choose pins, PWM, duration, current limits, raw serial data, or shell commands.

The coordinator owns tool schemas, approvals, preconditions, cooldown, the four-activation diagnostic budget, evidence classification, confidence, and diagnosis state. The firmware independently enforces its own limits because host validation cannot protect hardware after a laptop or serial failure.

## Deliberate simplification

The tool gateway is not a separate service. It is part of `ExperimentCoordinator`, along with session state and approval handling. This avoids distributed state without weakening the trust boundary. The browser never talks directly to an adapter.

## Observation flow

1. An adapter returns raw measurements and execution status.
2. The coordinator assigns observation, session, and experiment IDs plus a receipt timestamp.
3. Adapter identity supplies the immutable evidence source (`physical` or `simulation`).
4. The observation references one calibration profile.
5. The evidence engine validates sensor health and derives classifications.
6. The agent receives the classified observation before selecting another action.
7. The decision record stores input observation IDs, selected action, concise rationale, provider response ID, and backend validation.

Calibration values are referenced by ID rather than copied into every canonical measurement. The dashboard joins the reference when presenting healthy comparisons.

## Session modes

A session is created as either physical or simulation and cannot change mode. The adapter—not an HTTP body or model output—assigns evidence provenance. Observations from one mode cannot be inserted into another session.

Simulation is prominently labeled and never reported as physical verification.

## Agent actions

The Azure Responses integration exposes only:

- `motor_motion_probe`
- `motor_current_probe`
- `verify_motor`
- `request_repair`
- `report_not_reproduced`
- `request_sensor_recovery`
- `finish`

Every action includes candidate hypotheses, an objective, and a concise rationale. The schema has no confidence, diagnosis, hardware-parameter, or provenance fields.

## Probe semantics

`motor_motion_probe` activates the motor with firmware-fixed parameters and exposes MPU6050 motion measurements. INA219 remains active as a safety monitor, but diagnostic current is not returned. This preserves current as a genuinely new second experiment.

`motor_current_probe` performs another fixed activation and returns diagnostic current. It is valid only after a healthy motion measurement reports the expected signature absent.

`verify_motor` measures current and motion together. It is available only after a human declares an intervention and is used for two consecutive verification trials.

## Diagnosis state

Before intervention, absent motion plus near-idle current supports an **open or otherwise unenergized motor-path condition**. It does not locate the electrical break and does not prove a motor lead is broken.

`CONFIRMED` is produced only by backend code after:

1. A supported condition exists.
2. The user declares the intervention.
3. Two consecutive post-intervention verification observations pass.

Any failed or invalid verification resets the consecutive-pass counter.
