# Testing and Verification

## Automated checks

Run:

```powershell
npm run check
```

The suite covers:

- Calibration-derived thresholds
- Invalid sensor evidence
- Open/unenergized and stall classifications
- Intervention and two-pass confirmation gate
- Verification failure reset
- Tool prerequisites and activation budget
- Provenance and immutable adapter source
- Disconnected, healthy, stalled, and sensor-failure simulator branches
- Five repeated end-to-end simulated repair flows

## Optional live integration

Azure integration requires server-side environment values. Automated acceptance uses an injected test selector so it is reproducible and key-free. A live decision must be recorded in `azure` mode before claiming that the deployed model selected the experiment.

## Physical verification

Software tests cannot prove electrical safety. Complete every bench test in [HARDWARE_BUILD_GUIDE.md](HARDWARE_BUILD_GUIDE.md), record the actual values, and retain the test results with the demo notes.

Claims must remain scoped:

- A simulator pass verifies software behavior only.
- Firmware compilation verifies source compatibility only.
- A connected sensor reading verifies communication, not mounting quality.
- INA219 supervision does not verify hardware current limiting.
- Physical timeout, E-stop, disconnect, and trip behavior require bench observation.
