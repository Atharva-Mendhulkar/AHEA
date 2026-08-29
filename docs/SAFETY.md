# Safety Model

## Trust boundary

Model output is untrusted. It can select only named semantic actions. It cannot supply command arguments, raw serial bytes, pins, voltage, PWM, duration, duty, current thresholds, or shell commands.

The browser is also untrusted. It can approve a pending server-generated experiment but cannot construct a new hardware command.

## Host enforcement

The experiment coordinator validates:

- Strict action allowlist
- Calibration and evidence preconditions
- Human approval for every activation
- Four diagnostic activations
- Cooldown
- Single active operation
- Intervention before verification
- Two consecutive verification passes before confirmation
- Immutable physical or simulation mode

Emergency stop bypasses the normal queue and budget.

## Firmware enforcement

The ESP32 independently enforces:

- Empty argument objects only
- Compile-time fixed pins and activation parameters
- Fail-closed configuration
- LOW outputs on boot and errors
- Fixed local pulse timeout
- INA219 monitoring on every pulse
- Sensor-presence checks during activation
- Cooldown, per-boot count, and cumulative on-time
- Busy rejection
- Physical and serial emergency stop
- E-stop latch until reset

The active operation does not depend on another serial message to stop.

## Failure behavior

| Failure | Required behavior |
|---|---|
| Node or model failure | Firmware finishes or aborts the fixed pulse locally |
| Serial disconnect | Cannot extend the pulse |
| Malformed request | Reject and keep motor LOW |
| Non-empty arguments | Reject and keep motor LOW |
| INA219 failure during pulse | Stop immediately |
| MPU6050 failure during motion/verification | Stop and invalidate result |
| Overcurrent | Stop and return trip |
| Watchdog/reset | Outputs return LOW during startup |
| E-stop | Disable output and latch until reset |

## Limitations

This prototype is not safety certified. I2C current sampling is not a hardware current limiter and cannot protect against every fast fault. Use a suitable fuse or current-limited supply. A software-controlled E-stop also does not replace a hardwired power disconnect where injury or property damage is possible.
