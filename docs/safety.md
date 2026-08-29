# Safety model

AHEA is a prototype, not certified test equipment.

- ESP32-S3 GPIO is not 5 V tolerant.
- The model selects only backend-offered opaque experiment IDs.
- The gateway validates exact plan identity, target bindings, phase, lifecycle, setup confirmation, intervention, profile, and budget.
- Firmware independently resolves registered plans to fixed pins and timing, enforces deadlines and budgets, and reports cleanup.
- GPIO4 is low before and after every loopback plan and on abort or fault paths.
- Physical and simulation observations are immutable and cannot share an evidence chain.
- Every physical change is performed and declared by a human after an evidence-supported diagnosis.
- Two consecutive physical verification passes are required for `CONFIRMED`.

Optional profile requirements are non-negotiable: the HC-SR04 Echo line uses a reviewed 8.2 kΩ/10 kΩ level divider, MPU6050 I²C pull-ups terminate at 3.3 V, and the DHT11 data line uses a verified 3.3 V-compatible interface or reviewed level shifting.

Native ESP32-S3 observations cannot establish current, resistance, impedance, negative voltage, mechanical behavior, exact component failure, laboratory-grade ADC accuracy, or independent frequency calibration.
