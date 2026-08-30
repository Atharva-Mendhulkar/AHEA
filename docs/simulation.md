# ESP32-S3 simulation

AHEA supports two explicitly simulated engines:

- `generated` creates seeded, physics-based bounded captures for loopback, HC-SR04, MPU6050, and DHT11 plans.
- `replay` copies measurements and series from an imported physical report, then relabels every new observation as simulation while retaining the physical report digest as its origin.

Create a generated session with:

```json
{
  "mode": "simulation",
  "simulation": {
    "engine": "generated",
    "seed": "bench-run-01",
    "scenario": { "condition": "normal", "distanceCm": 25 }
  }
}
```

The resolved specification is stored on the session and every observation. Its seed, scenario digest, model version, and calibration digest make a capture reproducible. Independent random streams are derived from the seed, plan, phase, ordinal, and channel purpose.

Import a physical report for local replay:

```sh
npm run simulation:capture:import -- ./ahea-physical-report.json bench-capture-01
npm run simulation:calibrate
npm run simulation:validate-models
```

Raw reports live in `data/simulation-captures/` and are ignored by Git. Compact models live in `config/simulation-models/`. A model may claim `esp32s3_calibrated` only when every registered plan has at least 20 accepted captures across at least three physical sessions. Until then the UI and API report `model_only`.

The engine follows registered plan cadence rather than pretending to be a live device stream. Simulation can produce a simulated verification pass, but it can never produce physical `CONFIRMED`.
