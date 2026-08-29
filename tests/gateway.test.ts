import { describe, expect, it } from "vitest";
import { validateAction } from "../server/gateway.js";
import { deriveEvidence } from "../server/evidence.js";
import { simulationCalibration } from "../server/config.js";
import type { DiagnosisSession } from "../shared/domain.js";

function session(): DiagnosisSession {
  return {
    id: "s", mode: "simulation", fixture: "disconnected", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    version: 1, lifecycle: "INVESTIGATING", problem: "motor stopped",
    hardware: { connected: true, firmwareVersion: "sim", boardIdentity: "SIM-ESP32S3", protocolVersion: "1.0", profileId: "sim", physicalEnabled: false, estopLatched: false, supportedCommands: [], detectedI2c: [] },
    calibration: simulationCalibration, observations: [], decisions: [], diagnosticActivations: 0, verificationActivations: 0,
    totalActivations: 0, consecutiveVerificationPasses: 0, evidence: deriveEvidence([], simulationCalibration, false), timeline: [], fallbackUsed: false,
  };
}

describe("tool and safety gateway", () => {
  it("rejects current sampling before valid absent-motion evidence", () => {
    expect(validateAction(session(), "motor_current_probe").accepted).toBe(false);
  });

  it("rejects verification without a declared intervention", () => {
    expect(validateAction(session(), "verify_motor").reasons).toContain("Verification requires a declared intervention.");
  });

  it("fails closed for exhausted and estopped sessions", () => {
    const value = session();
    value.totalActivations = 6;
    value.hardware.estopLatched = true;
    const result = validateAction(value, "motor_motion_probe");
    expect(result.accepted).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/Emergency stop/);
    expect(result.reasons.join(" ")).toMatch(/budget is exhausted/);
  });
});
