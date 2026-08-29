# Phased delivery roadmap

Each phase has a required exit gate. Later phases must not be represented as complete until their earlier dependencies and evidence requirements pass.

## Phase 0 — Repository foundation

Deliverables:

- TypeScript build, deterministic tests, environment template, and contributor documentation
- Shared domain and protocol types with runtime validation
- Safe-disabled firmware profile and explicit generated-data exclusions

Exit gate:

- `npm run check` passes from a clean install
- No secret, machine-specific serial path, generated session data, or build artifact is tracked

## Phase 1 — Simulation MVP

Deliverables:

- Session coordinator, immutable mode selection, safety gateway, and local audit store
- Disconnected, healthy, stalled, and sensor-failure fixtures
- Deterministic evidence, confidence, lifecycle, and verification rules
- Version-bound activation approval, six-activation cap, and SSE dashboard
- Visibly labeled deterministic fallback

Exit gate:

- The disconnected fixture reaches `CONFIRMED` only after a declared repair and two consecutive passes
- Healthy and invalid-motion fixtures produce divergent next decisions
- Mixed provenance, stale approval, wrong ordering, exhausted budget, and unsafe arguments fail closed

## Phase 2 — Live agent acceptance

Deliverables:

- Server-side OpenAI Responses API integration using strict semantic function tools
- Preserved response items and correlated function-call outputs across observations
- Provider/model/response identity and context digest in every decision record
- Retry-once and one corrective-call behavior before fallback

Exit gate:

- Opt-in live tests record response IDs for all three divergent motion outcomes
- A fixed sequence cannot pass the adaptivity test
- Fallback runs remain excluded from agentic-proof reporting

## Phase 3 — Firmware safety bench

Deliverables:

- Reviewed ESP32-S3 hardware profile
- Non-blocking shared pulse state machine, sensor sampling, watchdog, deduplication, and local budgets
- Physical e-stop and protected motor supply
- Board/profile-bound calibration capture

Exit gate:

- Native firmware tests and ESP32-S3 build pass
- Outputs remain LOW through boot, reset, malformed input, sensor faults, and timeout
- E-stop, overcurrent, serial loss, Node termination, and brownout checks pass on the bench

## Phase 4 — Physical end-to-end demo

Deliverables:

- Physical serial adapter enabled only for the reviewed profile
- Real MPU6050/INA219 provenance in observations and report
- Healthy calibration, disconnected-lead diagnosis, declared repair, and two-pass verification

Exit gate:

- Five consecutive rehearsals succeed
- Machine-controlled diagnosis time is under 90 seconds
- Wall-clock approval and repair time is reported separately
- The final report preserves driver-failure and indirect-motion limitations

## Phase 5 — Post-MVP hardening

Candidate work after the hackathon gate:

- Crash-safe agent continuation and explicit session-resume/reconnect flows
- Calibration history and compatibility migrations
- Structured observability and longer-duration reliability testing
- Additional hardware profiles only after each receives its own safety review

Authentication, cloud infrastructure, arbitrary hardware control, multiple MCU abstractions, repository analysis, and on-device AI remain out of scope unless the product requirements are deliberately revised.
