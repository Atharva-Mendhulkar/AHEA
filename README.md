# AHEA Hardware Agent

AHEA is an ESP32-S3-centered framework for evidence-driven physical diagnostics. An agent chooses among backend-offered registered experiments; firmware and the safety gateway own the electrical details; deterministic rules decide what observations support.

The required proof is a protected waveform loopback with separate source and destination observers. HC-SR04, MPU6050, and DHT11 are optional profiles built on the same capability, provenance, evidence, and lifecycle interfaces. See [prd.md](prd.md) for the complete requirements.

## Core loopback fixture

```text
GPIO4 ── 1 kΩ ── source ── removable jumper ── destination ── 100 kΩ ── GND
                    │                              │
                  4.7 kΩ                         4.7 kΩ
                    │                              │
                  GPIO5                          GPIO6
```

The initial registered plan is 1 kHz, 50% duty cycle, and 500 ms. GPIO4 is low before and after every operation. The same ESP32-S3 generates and observes the signal, so timing results establish internal consistency rather than independent calibration.

## Quick start

Requirements: Node.js 22+ and npm 10+.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Simulation is the default and never produces physical `CONFIRMED` status. An OpenAI key is optional; without one, the deterministic selector chooses from the same eligible experiment set.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the TypeScript server in watch mode |
| `npm run build` | Type-check and compile |
| `npm test` | Run deterministic tests |
| `npm run check` | Build and test |
| `npm run test:openai` | Run the opt-in live selector test |
| `npm run firmware:test` | Run native firmware safety tests with PlatformIO |
| `npm run firmware:build` | Build safe-disabled ESP32-S3 firmware |

## Trust boundaries

- Project context is immutable within a session and is attached by digest to every observation.
- The agent selects only opaque experiment IDs; it cannot set pins, timing, waveform, ADC, or bus parameters.
- Firmware advertises its registered capabilities; the backend matches their safety-critical definitions before arming, and firmware independently enforces plans, timeouts, budgets, and cleanup.
- Evidence, confidence labels, lifecycle, and verification counters are backend-owned and deterministic.
- Physical changes are human-only and require an explicit declaration.
- Two consecutive physical passes are required for `CONFIRMED`.
- Physical and simulation provenance cannot be mixed.

## API

- `GET /api/project-contexts`
- `GET /api/project-context/default`
- `POST /api/sessions`
- `POST /api/sessions/:id/problem`
- `POST /api/sessions/:id/investigation/start`
- `POST /api/sessions/:id/investigation/advance`
- `GET /api/sessions/:id/pending-decision`
- `POST /api/sessions/:id/decisions/:decisionId/execute`
- `POST /api/sessions/:id/interventions`
- `POST /api/sessions/:id/emergency-stop`
- `GET /api/sessions/:id`
- `GET /api/sessions/:id/report`
- `GET /api/sessions/:id/events`

## Physical status

The committed hardware profile is deliberately disabled. Physical use requires a reviewed ESP32-S3 board/profile, the exact protected loopback wiring, a matching firmware capability registry, and explicit setup confirmation. Simulation validates orchestration and evidence branching only; it does not validate real voltage levels, wiring, timing accuracy, or repairs.
