# Hardware Agent

Hardware Agent is an open-source framework for investigating hardware failures with bounded physical experiments. A laptop agent selects what evidence to collect; a deterministic coordinator validates the request; an ESP32-S3 performs the fixed operation; and a deterministic evidence engine decides what the measurements support.

The hackathon MVP diagnoses a disconnected DC-motor path using an MPU6050 as an indirect motion/vibration sensor and an INA219 as the primary electrical discriminator.

## Safety status

The checked-in firmware is intentionally fail-closed. Motor activation is disabled until `firmware/include/hardware_config.h` contains wiring and limits validated for the actual assembly. Read [the hardware build guide](docs/HARDWARE_BUILD_GUIDE.md) and [the safety model](docs/SAFETY.md) before connecting a motor.

This project is an experimental prototype, not safety-certified equipment. Use a current-limited motor supply or fuse. Never power a motor from an ESP32 GPIO.

## Quick start: simulator

Requirements: Node.js 22 or newer.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Open `http://localhost:3000`, keep **Simulation** selected, and choose a fixture. Without Azure credentials, the dashboard clearly enters deterministic fallback mode. The fallback is useful for development but does not count as proof that the model selected the experiment.

## Azure agent configuration

Set these server-side values in `.env` or the process environment:

```text
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_DEPLOYMENT=
AZURE_OPENAI_API_VERSION=
```

Credentials are never sent to the browser. The deployment must support the Responses API and strict function tools.

## Repository guide

- [Product requirements](docs/PRD.md)
- [Architecture and data flow](docs/ARCHITECTURE.md)
- [Hardware engineer build guide](docs/HARDWARE_BUILD_GUIDE.md)
- [Safety model](docs/SAFETY.md)
- [Serial protocol](docs/PROTOCOL.md)
- [Demo runbook](docs/DEMO_RUNBOOK.md)
- [Testing and verification](docs/TESTING.md)

## Commands

```text
npm run dev     Start with file watching
npm start       Start the application
npm run build   Type-check and compile
npm test        Run automated tests
npm run check   Build and test
```

Firmware is under `firmware/` and builds with PlatformIO after the hardware profile is completed.
