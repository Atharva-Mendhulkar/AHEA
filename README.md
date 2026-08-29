# AHEA Hardware Agent

AHEA is a safety-bounded agentic framework that compares intended hardware behavior from project context with measurements from an ESP32, selects the next useful experiment, and verifies repairs or tuning changes.

The MVP is a sensor-first FSR reference/outlier investigation. Four known-good FSR channels establish a deterministic response range; an abnormal fifth channel is measured, compared, and—only when its divider circuit is fully declared—matched against a bounded resistor candidate set. A human performs any component change before repeated verification.

The browser presents one agent session rather than a manual trial worksheet. After one **Start investigation** action, backend state drives baseline capture, sensor-specific stimulus prompts, live response detection, bounded recording, analysis, next-experiment selection, and post-intervention verification. The browser never decides whether evidence is sufficient.

See [prd.md](prd.md) for the maintained product requirements.

## Core boundaries

- The model selects only backend-offered semantic experiment IDs.
- The backend owns eligibility, statistics, diagnosis, recommendations, confidence, and lifecycle.
- Firmware owns fixed bindings, plan IDs, timeouts, budgets, deduplication, and abort behavior.
- Physical and simulated observations cannot be mixed.
- Servo and relay actuation are disabled until their power, driver, and observation setup is separately reviewed.
- No dedicated current or voltage sensor is required by the MVP.

## Supported sensor capabilities

- MPU6050: I²C presence/identity plus bounded acceleration and gyroscope sampling.
- DHT11: bounded temperature/humidity reads with failure detection.
- HC-SR04: bounded echo timing and distance measurement after echo protection review.
- FSR: repeated ADC sampling, mean/variance, known-good comparison, and bounded divider analysis.

## Quick start

Requirements: Node.js 22+ and npm 10+.

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000` and use the FSR simulation fixtures. Without `OPENAI_API_KEY`, the visibly recorded deterministic fallback selects from the same safe experiment list.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the TypeScript server in watch mode |
| `npm run build` | Compile TypeScript |
| `npm test` | Run deterministic tests |
| `npm run check` | Build and test |
| `npm run test:openai` | Run opt-in live model selection |
| `npm run firmware:test` | Run native firmware safety tests with PlatformIO |
| `npm run firmware:build` | Build safe-disabled ESP32-S3 firmware |

## API

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

Physical mode ships disabled. The bundled project and resistor values are a simulation example, not a claim about the user's unconfirmed FSR circuit. Before physical use, record the exact board, fixed pins, FSR topology and units, ADC limits, DHT wiring, and HC-SR04 echo protection in a reviewed profile.

Simulation tests do not validate real sensors, wiring, timing, ADC calibration, manual-pressure repeatability, or resistor effectiveness.
