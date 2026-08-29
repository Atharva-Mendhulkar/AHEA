# Safety model

This project is a hackathon prototype, not certified safety equipment.

## Independent layers

- The browser requires explicit confirmation before every motor activation.
- The coordinator validates decision identity, session version, ordering, cooldown, and budgets immediately before execution.
- The adapter accepts semantic commands only and sends empty firmware arguments.
- Firmware owns fixed pins, direction, duty, duration, absolute current limit, local timeout, cooldown, activation counts, overlap rejection, deduplication, sensor checks, watchdog, and e-stop latching.
- Hardware must include a current-limited supply or fuse. INA219 sampling is monitoring, not short-circuit protection.

## Fail-safe conditions

Motor outputs must be LOW on boot, reset, brownout, malformed input, unknown command, sensor failure, watchdog failure, timeout, overcurrent, profile mismatch, and emergency stop. A serial or Node failure cannot extend a pulse beyond the firmware timeout.

The emergency stop must be a physical input in addition to the UI/serial command. Once latched it can only be cleared by a physical ESP32 reset.

## Activation accounting

- Diagnostic limit: two accepted motor activations
- Verification limit: four accepted motor activations
- Total limit: six accepted motor activations
- Required result: two consecutive valid verification passes
- Any failed or invalid verification resets the pass counter
- Calibration is a separate operator workflow but retains approval and all firmware limits

Rejected commands do not consume the accepted-activation budget. Once the firmware energizes the motor, the activation counts even if the resulting measurement is invalid or trips.
