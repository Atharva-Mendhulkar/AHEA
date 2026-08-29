# Delivery roadmap

## Phase 0 — Capability-first simulation

- Versioned project context and firmware capability registry
- Destination-first adaptive loopback investigation
- Deterministic evidence and confidence labels
- Correct normal, inconclusive, diagnosis, intervention, and verification paths
- Strict provenance and physical/simulation isolation

Exit gate: TypeScript build and deterministic tests pass; all loopback evidence fixtures branch differently; unsafe protocol inputs fail closed; simulation cannot produce physical confirmation.

## Phase 1 — Physical loopback proof

- Reviewed ESP32-S3 profile and protected GPIO4/GPIO5/GPIO6 fixture
- Hardware-in-loop intact-path and hidden removable-jumper trials
- Timeout, abort, disconnect, restart, output-low, and provenance evidence
- Two consecutive physical post-intervention verification passes

Exit gate: firmware and native safety tests pass, the registered capability handshake matches context, and retained physical reports satisfy the PRD without overstating timebase accuracy.

## Phase 2 — Optional profile demonstrations

- HC-SR04 trigger/echo, timeout, variance, progression, and alignment evidence
- MPU6050 identity, stationary baseline, motion, bias, noise, drift, and axis consistency
- DHT11 response timing, checksum, stale-rate, valid-rate, temperature, and humidity

Exit gate: every profile uses the same core gateway, provenance, evidence separation, lifecycle, and confirmation policy, with its electrical review recorded.

## Later

- Independently reviewed external reference instruments
- Isolated analog front ends and additional digital buses
- Durable schema migrations, observability, signed module distribution, and reproducible hardware-in-loop fixtures
