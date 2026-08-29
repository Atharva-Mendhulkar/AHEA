<!-- Improved compatibility of back to top link: See https://github.com/othneildrew/Best-README-Template/pull/73 -->
<a id="readme-top"></a>

<!-- PROJECT SHIELDS -->
[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![MIT License][license-shield]][license-url]
[![ESP32-S3][esp32-shield]][esp32-url]

<!-- PROJECT LOGO -->
<br />
<div align="center">
  <a href="https://github.com/Atharva-Mendhulkar/AHEA">
    <img src="logo.svg" alt="AHEA logo" width="120" height="120" />
  </a>

  <h3 align="center">AHEA Hardware Agent</h3>

  <p align="center">
    Evidence-driven physical diagnostics for ESP32-S3 systems.
    <br />
    <a href="docs/architecture.md"><strong>Explore the documentation »</strong></a>
    <br />
    <br />
    <a href="#getting-started">Run the demo</a>
    &middot;
    <a href="https://github.com/Atharva-Mendhulkar/AHEA/issues/new?labels=bug">Report a bug</a>
    &middot;
    <a href="https://github.com/Atharva-Mendhulkar/AHEA/issues/new?labels=enhancement">Request a feature</a>
  </p>
</div>

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#how-it-works">How It Works</a></li>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li>
      <a href="#usage">Usage</a>
      <ul>
        <li><a href="#simulation">Simulation</a></li>
        <li><a href="#physical-hardware">Physical Hardware</a></li>
        <li><a href="#commands">Commands</a></li>
      </ul>
    </li>
    <li><a href="#safety-and-trust-boundaries">Safety and Trust Boundaries</a></li>
    <li><a href="#api">API</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

<!-- ABOUT THE PROJECT -->
## About The Project

AHEA is an open-source, ESP32-S3-centered framework for evidence-driven diagnostics of physical computing systems. An agent selects from backend-offered semantic experiments, while reviewed firmware and a safety gateway retain control over pins, timing, electrical limits, and cleanup. Deterministic rules—not the language model—decide what the resulting measurements support.

The MVP proves this architecture using a protected waveform loopback with separate source and destination observers. HC-SR04, MPU6050, and DHT11 profiles demonstrate how the same capability, provenance, evidence, and lifecycle interfaces extend to optional sensors.

AHEA is designed to reach an evidence-supported diagnosis or explicitly report that the available evidence is inconclusive. It does not claim autonomous root-cause discovery or laboratory-grade measurement.

Read the [product requirements](prd.md), [architecture](docs/architecture.md), and [safety model](docs/safety.md) for the complete design contract.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### How It Works

```text
Immutable project context + reviewed capability registry
                            ↓
             Evidence-dependent experiment set
                            ↓
              Agent selects an opaque plan ID
                            ↓
                 Safety gateway validates
                            ↓
                Simulator or ESP32-S3 adapter
                            ↓
               Provenance-complete observation
                            ↓
                 Deterministic evidence rules
                            ↓
 Normal / inconclusive / diagnosis → human change → verification
```

The required physical proof uses this protected 3.3 V fixture:

```text
GPIO4 ── 1 kΩ ── source ── removable jumper ── destination ── 100 kΩ ── GND
                    │                              │
                  4.7 kΩ                         4.7 kΩ
                    │                              │
                  GPIO5                          GPIO6
```

The registered initial plan generates a 1 kHz, 50% duty-cycle waveform for 500 ms. Because the same ESP32-S3 generates and observes it, the result establishes internal timing consistency—not independent calibration.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built With

* [![Node.js][node-shield]][node-url]
* [![TypeScript][typescript-shield]][typescript-url]
* [![Express][express-shield]][express-url]
* [![Zod][zod-shield]][zod-url]
* [![OpenAI][openai-shield]][openai-url]
* [![PlatformIO][platformio-shield]][platformio-url]
* [![Arduino][arduino-shield]][arduino-url]
* [![Vitest][vitest-shield]][vitest-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- GETTING STARTED -->
## Getting Started

Simulation is the default and requires no attached hardware. It exercises the full investigation, evidence, provenance, intervention, and verification flow without making physical claims.

### Prerequisites

* [Node.js][node-url] 22 or newer
* npm 10 or newer
* [PlatformIO Core][platformio-url] for firmware builds and tests
* An ESP32-S3 N16R8 board only when following the physical bring-up guide

### Installation

1. Clone the repository:

   ```sh
   git clone https://github.com/Atharva-Mendhulkar/AHEA.git
   cd AHEA
   ```

2. Install the Node.js dependencies:

   ```sh
   npm install
   ```

3. Optionally provide an OpenAI API key. Without one, AHEA uses its deterministic selector:

   ```sh
   export OPENAI_API_KEY="your-api-key"
   ```

4. Start the development server:

   ```sh
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- USAGE EXAMPLES -->
## Usage

### Simulation

Choose the loopback or an optional sensor profile, select a named simulation fixture, and create a session. AHEA starts with the profile's registered first observation and changes the eligible next experiment as evidence arrives.

Optional sensor simulations are operator-guided. The dashboard presents the required stimulus—such as holding or moving an MPU6050, positioning an HC-SR04 obstacle, or stabilizing a DHT11 environment—before advancing the deterministic capture. All resulting traces and reports remain explicitly labeled as simulated and can never produce physical `CONFIRMED` status.

### Physical Hardware

Physical mode intentionally ships disabled. Do not enable or flash a physical profile until the exact board, 3.3 V behavior, protection resistors, common ground, pin bindings, and output-low behavior have been reviewed.

The detected development target is configured as an ESP32-S3 N16R8 with 16 MB flash, 8 MB OPI PSRAM, and CP2102 UART transport. Continue with the [physical bring-up guide](docs/hardware-bringup.md) and [acceptance-readiness checklist](docs/physical-readiness.md).

When a reviewed profile is available, the backend is started with an explicit physical gate and serial path:

```sh
AHEA_PHYSICAL_ENABLED=true \
AHEA_SERIAL_PATH=/dev/cu.usbserial-0001 \
npm run dev
```

The backend still refuses the session unless the firmware identities, registry digest, registered plans, bindings, fixed parameters, and cleanup declarations match the immutable project context.

### Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the TypeScript server in watch mode |
| `npm start` | Start the server without watch mode |
| `npm run build` | Type-check and compile the application |
| `npm test` | Run deterministic software tests |
| `npm run check` | Build and run the software test suite |
| `npm run test:openai` | Run the opt-in live selector test |
| `npm run firmware:test` | Run native firmware safety tests |
| `npm run firmware:build` | Build the safe-disabled ESP32-S3 firmware |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- SAFETY -->
## Safety and Trust Boundaries

* ESP32-S3 GPIO is 3.3 V only and is not 5 V tolerant.
* Project context is immutable within a session and attached by digest to every observation.
* The agent can select only opaque registered experiment IDs; it cannot control pins, waveforms, ADC settings, I²C bytes, or timing values.
* Firmware independently enforces reviewed plans, exact targets, timeouts, budgets, abort behavior, watchdog recovery, and output cleanup.
* The backend rejects stale or altered capability registries and mismatched firmware, board, profile, bindings, or measurement schemas.
* Evidence, confidence labels, lifecycle transitions, and verification counters are deterministic and backend-owned.
* Every physical change is performed and declared by a human.
* Physical and simulation evidence cannot be mixed.
* `CONFIRMED` requires two consecutive passing physical verification runs after a declared intervention.

AHEA is a prototype, not certified test equipment. Review [docs/safety.md](docs/safety.md) before connecting hardware.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- API -->
## API

<details>
  <summary>HTTP endpoints</summary>

* `GET /api/project-contexts`
* `GET /api/project-context/default`
* `POST /api/sessions`
* `POST /api/sessions/:id/problem`
* `POST /api/sessions/:id/investigation/start`
* `POST /api/sessions/:id/investigation/advance`
* `GET /api/sessions/:id/pending-decision`
* `POST /api/sessions/:id/decisions/:decisionId/execute`
* `POST /api/sessions/:id/interventions`
* `POST /api/sessions/:id/emergency-stop`
* `GET /api/sessions/:id`
* `GET /api/sessions/:id/report`
* `GET /api/sessions/:id/events`

</details>

The ESP32-S3 transport uses strict newline-delimited JSON at 115200 baud. See the [USB serial protocol](docs/protocol.md).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ROADMAP -->
## Roadmap

- [x] Capability-first project, registry, and experiment model
- [x] Adaptive destination-first loopback simulation
- [x] Deterministic evidence, provenance, lifecycle, and verification rules
- [x] Strict firmware protocol, safety state, abort handling, timeout, watchdog, and N16R8 build
- [x] Optional HC-SR04, MPU6050, and DHT11 simulation profiles
- [ ] Review and assemble the protected GPIO4/GPIO5/GPIO6 fixture
- [ ] Retain intact-path and hidden-open-path hardware-in-loop evidence
- [ ] Verify output-low behavior after success, error, timeout, abort, disconnect, and restart
- [ ] Complete two consecutive physical post-intervention verification passes
- [ ] Validate optional profiles on separately reviewed electrical interfaces

See the [delivery roadmap](docs/roadmap.md) and [physical readiness record](docs/physical-readiness.md) for detailed exit criteria.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTRIBUTING -->
## Contributing

Contributions that make hardware diagnosis safer, more reproducible, or easier to understand are welcome.

1. Fork the project.
2. Create a feature branch: `git checkout -b feature/your-feature`.
3. Make the change with focused tests and documentation.
4. Run `npm run check` and, for firmware work, `npm run firmware:test` and `npm run firmware:build`.
5. Commit and push the branch.
6. Open a pull request describing any safety, evidence, provenance, or compatibility impact.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing protocol, firmware, evidence, or lifecycle behavior.

<a href="https://github.com/Atharva-Mendhulkar/AHEA/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Atharva-Mendhulkar/AHEA" alt="AHEA contributors" />
</a>

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- LICENSE -->
## License

Distributed under the MIT License. See [LICENSE](LICENSE) for details.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTACT -->
## Contact

Project link: [github.com/Atharva-Mendhulkar/AHEA](https://github.com/Atharva-Mendhulkar/AHEA)

Issues and feature requests: [GitHub Issues](https://github.com/Atharva-Mendhulkar/AHEA/issues)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ACKNOWLEDGMENTS -->
## Acknowledgments

* [Best README Template](https://github.com/othneildrew/Best-README-Template) for the document structure
* [Espressif Systems](https://www.espressif.com/) for the ESP32-S3 platform
* [PlatformIO](https://platformio.org/) for embedded builds and testing
* [ArduinoJson](https://arduinojson.org/) for the firmware JSON protocol
* [Vitest](https://vitest.dev/) for deterministic application tests
* [Shields.io](https://shields.io/) and [contrib.rocks](https://contrib.rocks/) for repository badges

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
[contributors-shield]: https://img.shields.io/github/contributors/Atharva-Mendhulkar/AHEA.svg?style=for-the-badge
[contributors-url]: https://github.com/Atharva-Mendhulkar/AHEA/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/Atharva-Mendhulkar/AHEA.svg?style=for-the-badge
[forks-url]: https://github.com/Atharva-Mendhulkar/AHEA/network/members
[stars-shield]: https://img.shields.io/github/stars/Atharva-Mendhulkar/AHEA.svg?style=for-the-badge
[stars-url]: https://github.com/Atharva-Mendhulkar/AHEA/stargazers
[issues-shield]: https://img.shields.io/github/issues/Atharva-Mendhulkar/AHEA.svg?style=for-the-badge
[issues-url]: https://github.com/Atharva-Mendhulkar/AHEA/issues
[license-shield]: https://img.shields.io/github/license/Atharva-Mendhulkar/AHEA.svg?style=for-the-badge
[license-url]: https://github.com/Atharva-Mendhulkar/AHEA/blob/main/LICENSE
[esp32-shield]: https://img.shields.io/badge/ESP32--S3-N16R8-E7352C?style=for-the-badge&logo=espressif&logoColor=white
[esp32-url]: https://www.espressif.com/en/products/socs/esp32-s3
[node-shield]: https://img.shields.io/badge/Node.js-22%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white
[node-url]: https://nodejs.org/
[typescript-shield]: https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[typescript-url]: https://www.typescriptlang.org/
[express-shield]: https://img.shields.io/badge/Express-5-000000?style=for-the-badge&logo=express&logoColor=white
[express-url]: https://expressjs.com/
[zod-shield]: https://img.shields.io/badge/Zod-3-3E67B1?style=for-the-badge&logo=zod&logoColor=white
[zod-url]: https://zod.dev/
[openai-shield]: https://img.shields.io/badge/OpenAI-optional-412991?style=for-the-badge&logo=openai&logoColor=white
[openai-url]: https://platform.openai.com/docs/
[platformio-shield]: https://img.shields.io/badge/PlatformIO-6-F5822A?style=for-the-badge&logo=platformio&logoColor=white
[platformio-url]: https://platformio.org/
[arduino-shield]: https://img.shields.io/badge/Arduino-ESP32-00878F?style=for-the-badge&logo=arduino&logoColor=white
[arduino-url]: https://docs.espressif.com/projects/arduino-esp32/en/latest/
[vitest-shield]: https://img.shields.io/badge/Vitest-3-6E9F18?style=for-the-badge&logo=vitest&logoColor=white
[vitest-url]: https://vitest.dev/
