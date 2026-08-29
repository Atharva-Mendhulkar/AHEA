# Physical acceptance readiness

This record separates completed software evidence from work that requires the protected fixture. It must not be used to claim physical acceptance before hardware-in-loop evidence exists.

## Completed before wiring

- The connected ESP32-S3 was identified as an N16R8 device with 16 MB flash and 8 MB PSRAM over a CP2102 UART bridge.
- A project-local N16R8 PlatformIO definition selects QIO flash, OPI PSRAM, the 16 MB partition table, and UART serial transport.
- Firmware defaults remain safe-disabled and advertise no unreviewed plans.
- Firmware derives the advertised registry digest from the actual serialized registry rather than a fixed constant.
- The backend rejects a stale digest, identity mismatch, protocol mismatch, incomplete plan set, extra plan, or altered safety-critical plan definition.
- Firmware accepts exact command argument shapes only and rejects unknown plans or mismatched targets before starting an operation.
- While an operation is active, only a fresh argument-free abort is accepted; other overlapping input faults the operation and applies safe outputs.
- Operation deadlines, an 8-second task watchdog, session budgets, emergency-stop latching, duplicate-request rejection, and output cleanup are enforced independently by firmware.
- Simulation and physical provenance remain isolated; simulation cannot produce `CONFIRMED`.
- Deterministic evidence owns confidence, diagnosis, intervention eligibility, and the two-pass verification rule.

## Requires the completed fixture

- Inspect and record the exact 1 kΩ, 4.7 kΩ, 4.7 kΩ, and 100 kΩ network, removable jumper, and common ground.
- Confirm no ESP32-S3 GPIO can receive 5 V.
- Measure GPIO4 low at boot and after success, malformed input, timeout, abort, disconnect, and restart.
- Create matching reviewed firmware/project profile identities and enable the loopback profile.
- Flash the reviewed build and retain the validated `hello` exchange.
- Retain intact-jumper and hidden-open-jumper physical reports.
- Declare the human repair and retain two consecutive passing physical verification runs.
