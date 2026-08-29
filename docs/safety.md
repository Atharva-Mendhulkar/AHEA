# Safety model

AHEA is a prototype, not certified test equipment.

- The model chooses only backend-offered experiment IDs.
- The gateway validates device membership, plan identity, lifecycle, setup confirmation, intervention, and budget.
- Firmware resolves logical device IDs to compile-time bindings and applies its own operation budget and timeout.
- Simulation and physical evidence are immutable and isolated.
- FSR candidate values come only from project configuration and deterministic divider calculations.
- Physical component replacement always requires human approval and power disconnection.

The sensor-first profile contains no enabled actuation. Servo and relay operations are unavailable. A bare 5 V relay must never be connected directly to an ESP32 GPIO; it requires an appropriate driver and flyback protection. HC-SR04 echo must not reach an ESP32 input until 5 V-to-3.3 V protection is reviewed.

The bundled firmware profile is safe-disabled. Unknown bindings, plans, malformed input, duplicate requests, operation overlap, timeouts, exhausted budgets, and abort state fail closed.
