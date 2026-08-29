# Physical hardware bring-up

Physical mode is not enabled by the committed configuration.

## Required equipment

- ESP32-S3, MPU6050, INA219, L298N, and a 3–6 V hobby motor
- Separate current-limited motor supply or correctly rated fuse
- Physical normally-closed emergency-stop button
- Reviewed common-ground, current-sense, driver, and motor wiring
- USB serial connection to the laptop

Never power the motor from an ESP32 GPIO or from an unprotected USB rail.

## Enablement checklist

1. Review and replace every value in `firmware/include/hardware_profile.h`.
2. Change `PHYSICAL_ENABLED` only after the motor pins, direction, PWM duty, pulse duration, e-stop pin, timeout, and current limit are reviewed.
3. Build and flash the firmware, then verify outputs remain LOW during boot and reset.
4. Confirm `hello` reports the expected board, firmware, protocol, and profile identities.
5. Verify MPU6050 at `0x68` and INA219 at `0x40`.
6. Run inactive calibration, then an explicitly approved healthy pulse calibration.
7. Store a calibration profile matching the exact board, firmware, profile, and sensor identities.
8. Save the validated profile using `config/calibration.physical.example.json` as the schema reference.
9. Configure `AHEA_SERIAL_PATH` and `AHEA_CALIBRATION_PATH`, then set `AHEA_PHYSICAL_ENABLED=true` only after all checks pass.

## Hardware-in-loop release gate

Test physical e-stop during a pulse, Node termination, serial unplug, current trip, sensor disconnect, brownout/reset, provenance, healthy calibration, the complete fault/repair sequence, and five consecutive rehearsals. Record machine-active and wall-clock durations separately.
