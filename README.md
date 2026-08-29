# AHEA Hardware Agent

AHEA is a safety-bounded hardware diagnostic agent for an ESP32-S3 motor demo. A laptop-side agent selects the next semantic experiment, deterministic code validates and classifies it, and firmware independently limits every physical activation.

The repository is simulation-ready. Physical mode intentionally ships **disabled** until a reviewed board, pin, power, current-limit, sensor, and emergency-stop profile is supplied.

## What the MVP demonstrates

- Evidence-driven experiment selection rather than a fixed hidden sequence
- MPU6050 motor-induced motion sensing and INA219 current sensing
- Strict separation between model decisions and deterministic confidence/state
- Explicit user approval before every motor activation
- Immutable physical/simulation provenance
- Two consecutive post-repair verification passes before `CONFIRMED`
- Firmware-local timeout, cooldown, budgets, current trip, deduplication, and latched e-stop
- Visible deterministic fallback when the OpenAI API is unavailable
- Responsive wireframe dashboard with shadcn-inspired controls, persistent light/dark themes, separate workspace views, and animated observation plotters

## Architecture

```text
Static dashboard
      │ HTTP + SSE
      ▼
Session coordinator ◄────► OpenAI Responses API
      │                         semantic actions only
      ▼
Tool and safety gateway
      │
      ├── Simulator adapter
      └── Serial adapter ─────► ESP32-S3 firmware
                                      │
                                MPU6050 + INA219
      │
      ▼
Canonical observations ─────► Deterministic evidence engine
```

The coordinator owns lifecycle, approvals, budgets, and audit records. The evidence engine is pure and does not accept model-authored confidence. Adapters transport bounded commands and normalize observations. Firmware remains responsible for motor safety even if Node, serial, or the model fails.

See [Architecture](docs/architecture.md), [Safety model](docs/safety.md), [Serial protocol](docs/protocol.md), and the [phased roadmap](docs/roadmap.md) for the detailed contracts and delivery gates.

## Repository layout

```text
config/                  Versioned project and safe-disabled profiles
docs/                    Architecture, protocol, safety, and bring-up guides
firmware/
  include/               Hardware profile and pure safety-state interface
  src/                   ESP32 protocol, sensors, actuation, safety state
  test/                  PlatformIO native safety tests
server/
  adapters/              Simulation and USB serial implementations
  agent.ts               Responses API and deterministic fallback clients
  coordinator.ts         Workflow, approval, budget, and lifecycle owner
  evidence.ts            Pure evidence and confidence rules
  gateway.ts             Semantic-action precondition validation
  app.ts                 HTTP, SSE, and static dashboard routes
shared/                  Domain types and strict runtime schemas
tests/                   Backend, API, protocol, and optional live-model tests
web/                     Dependency-light dashboard
```

The dashboard deliberately stays framework-free to preserve the MVP's no-React constraint. Its component styling follows shadcn conventions—neutral tokens, compact controls, restrained radii, clear focus states, and semantic status variants—without importing React components.

## Quick start

Requirements:

- Node.js 22 or newer
- npm 10 or newer
- PlatformIO only for firmware builds/tests

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`, keep **Simulation** selected, and use the default disconnected-motor fixture. With no `OPENAI_API_KEY`, the app uses a visibly labeled deterministic fallback. This is useful for development but does not count as live-model adaptivity evidence.

To exercise the OpenAI path, set the key only in the server environment:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5-mini
```

The agent client follows the official [OpenAI function-calling flow](https://developers.openai.com/api/docs/guides/function-calling): strict function schemas, at most one tool call per response, correlated function outputs, and preservation of returned response items required by reasoning models.

## Demo flow

1. Create a simulation session and submit the motor problem.
2. Approve the fixed motion probe.
3. Observe a valid absent motor-induced motion signature.
4. Approve the agent-selected current probe.
5. Review the backend's high-confidence open/unenergized-path assessment.
6. Declare that the motor lead was reconnected.
7. Approve two verification pulses.
8. Review the `CONFIRMED` report.

The authoritative session budget is two diagnostic activations plus up to four verification attempts, with six accepted motor activations maximum. A failed or invalid verification resets the consecutive-pass counter.

## Delivery phases

Development is intentionally gated so simulation progress cannot be mistaken for physical verification:

1. **Repository foundation** — shared contracts, build, tests, and contributor documentation.
2. **Simulation MVP** — complete deterministic workflow and divergent fixtures.
3. **Live agent acceptance** — opt-in Responses API evidence with recorded response IDs.
4. **Firmware safety bench** — reviewed profile and hardware-in-loop failure testing.
5. **Physical end-to-end demo** — calibrated fault, repair, two-pass confirmation, and five rehearsals.
6. **Post-MVP hardening** — persistence, migrations, observability, and separately reviewed profiles.

Each phase's deliverables and exit criteria are defined in [docs/roadmap.md](docs/roadmap.md).

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the server with TypeScript watch mode |
| `npm start` | Start the server once |
| `npm run build` | Compile TypeScript into `dist/` |
| `npm test` | Run deterministic backend and API tests |
| `npm run test:openai` | Run opt-in live Responses API acceptance tests |
| `npm run check` | Compile and run all default tests |
| `npm run firmware:test` | Run native firmware safety-state tests |
| `npm run firmware:build` | Build the ESP32-S3 firmware |

## API overview

| Method and path | Purpose |
| --- | --- |
| `POST /api/sessions` | Create an immutable physical or simulation session |
| `POST /api/sessions/:id/problem` | Start an investigation |
| `GET /api/sessions/:id/pending-decision` | Inspect the next bounded action |
| `POST /api/sessions/:id/decisions/:decisionId/execute` | Approve and atomically execute the pending action |
| `POST /api/sessions/:id/interventions` | Declare a repair and begin verification |
| `POST /api/sessions/:id/emergency-stop` | Request and latch emergency stop |
| `GET /api/sessions/:id` | Retrieve current state and evidence |
| `GET /api/sessions/:id/report` | Retrieve the diagnosis report |
| `GET /api/sessions/:id/events` | Subscribe to the SSE audit timeline |

Browser and model requests never contain raw GPIO, PWM, duration, voltage, current-limit, or serial parameters.

## Physical mode

Do not enable physical mode merely by changing the environment variable. Complete the [hardware bring-up checklist](docs/hardware-bringup.md), replace the safe-disabled firmware profile with reviewed values, capture a matching calibration using `config/calibration.physical.example.json`, set `AHEA_CALIBRATION_PATH`, and run the hardware-in-loop release gate.

INA219 software monitoring is not short-circuit protection. A current-limited supply or correctly rated fuse and a physical emergency-stop button are mandatory.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change. Keep model reasoning, deterministic evidence, transport, and firmware safety in separate layers. Changes that weaken fail-closed behavior or blur simulated and physical evidence will not be accepted.

## Current verification limits

Simulation, backend, protocol, and native safety-state behavior can be verified without hardware. Physical safety, real sensor measurements, board timing, and hardware-in-loop behavior remain unverified until the required hardware and reviewed profile are available.

## License

MIT — see [LICENSE](LICENSE).
