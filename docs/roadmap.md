# Delivery roadmap

## Phase 0 — Sensor-first simulation MVP

- Versioned project context and built-in device modules
- Adaptive semantic experiment selection
- FSR reference/outlier evidence and bounded candidate analysis
- Human intervention and repeated verification
- Strict provenance, audit timeline, and safe-disabled firmware

Exit gate: `npm run check` passes; balanced, outlier, noisy, and read-failure fixtures diverge; arbitrary hardware/candidate inputs fail closed; simulation cannot claim physical confirmation.

## Phase 1 — Physical sensor bench

- Reviewed ESP32 profile and exact FSR circuit
- MPU6050, DHT11, HC-SR04, and FSR serial measurements
- HC-SR04 echo protection and ADC characterization
- Hardware-in-loop failure, timeout, reset, and provenance evidence

Exit gate: firmware build/native tests pass and physical results are recorded without overstating measurement meaning.

## Phase 2 — Physical FSR tuning demo

- Repeatable stimulus procedure
- Four reference sensors plus one subject
- Evidence-backed candidate, human replacement, and two passing physical verification trials

Exit gate: repeated demonstrations succeed and reports preserve stimulus/circuit limitations.

## Phase 3 — Optional actuators

- Servo only after reviewed power and observable response
- Relay only after a reviewed driver/flyback circuit and observable external effect
- Motor only if a motor/driver is actually available; MPU evidence remains an indirect motion signature

## Later

- Automated resistor network, optional external instruments, durable migrations, observability, and module distribution ecosystem.
