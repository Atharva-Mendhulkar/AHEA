import { describe, expect, it } from "vitest";
import { deriveEvidence } from "../server/evidence.js";
import { simulationCalibration } from "../server/config.js";
import { SimulatorAdapter } from "../server/adapters/simulator.js";

describe("deterministic evidence engine", () => {
  it("supports an open or unenergized path without claiming the exact break", async () => {
    const adapter = new SimulatorAdapter("disconnected");
    const context = { sessionId: "session", calibration: simulationCalibration };
    const motion = await adapter.execute("motor_motion_probe", { ...context, experimentId: "motion" });
    const current = await adapter.execute("motor_current_probe", { ...context, experimentId: "current" });
    const evidence = deriveEvidence([motion, current], simulationCalibration, false);

    expect(evidence.evidenceState).toBe("OPEN_PATH_SUPPORTED");
    expect(evidence.confidenceLabel).toBe("HIGH CONFIDENCE");
    expect(evidence.limitations.join(" ")).toMatch(/driver-output failure/);
    expect(evidence.hypotheses.find((item) => item.hypothesis === "mechanical_stall")!.support).toBeLessThan(40);
  });

  it("requires two consecutive post-intervention verification passes", async () => {
    const adapter = new SimulatorAdapter("disconnected");
    adapter.declareIntervention();
    const context = { sessionId: "session", calibration: simulationCalibration };
    const first = await adapter.execute("verify_motor", { ...context, experimentId: "verify-1" });
    const onePass = deriveEvidence([first], simulationCalibration, true);
    expect(onePass.consecutiveVerificationPasses).toBe(1);
    expect(onePass.confidenceLabel).not.toBe("CONFIRMED");
    const second = await adapter.execute("verify_motor", { ...context, experimentId: "verify-2" });
    const confirmed = deriveEvidence([first, second], simulationCalibration, true);
    expect(confirmed.consecutiveVerificationPasses).toBe(2);
    expect(confirmed.confidenceLabel).toBe("CONFIRMED");
  });

  it("resets the consecutive pass count after an invalid result", async () => {
    const healthy = new SimulatorAdapter("healthy");
    const broken = new SimulatorAdapter("sensor_failure");
    const context = { sessionId: "session", calibration: simulationCalibration };
    const pass1 = await healthy.execute("verify_motor", { ...context, experimentId: "v1" });
    const invalid = await broken.execute("verify_motor", { ...context, experimentId: "v2" });
    const pass2 = await healthy.execute("verify_motor", { ...context, experimentId: "v3" });
    expect(deriveEvidence([pass1, invalid, pass2], simulationCalibration, true).consecutiveVerificationPasses).toBe(1);
  });

  it("derives motion from calibrated raw RMS instead of trusting an adapter boolean", async () => {
    const adapter = new SimulatorAdapter("healthy");
    const observation = await adapter.execute("motor_motion_probe", {
      sessionId: "session", experimentId: "motion", calibration: simulationCalibration,
    });
    const reported = observation.measurements.find((item) => item.name === "expected_motion_signature_detected")!;
    reported.value = false;
    const evidence = deriveEvidence([observation], simulationCalibration, false);
    expect(evidence.observations[0]?.motionDetected).toBe(true);
  });
});
