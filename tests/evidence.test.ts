import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyObservation,
  evaluateDiagnosis,
  healthyCurrentRange,
  motionThreshold,
  nearIdleThreshold
} from "../src/domain/evidence.js";
import type {
  CalibrationProfile,
  EvidenceObservation,
  ExperimentTool,
  RawMeasurement
} from "../src/types.js";

const calibration: CalibrationProfile = {
  id: "cal-test",
  source: "simulation",
  createdAt: new Date(0).toISOString(),
  idleCurrentMa: 2,
  healthyCurrentMa: 180,
  baselineMotionRmsG: 0.01,
  healthyMotionRmsG: 0.2
};

function value(
  name: RawMeasurement["name"],
  number: number,
  unit: RawMeasurement["unit"],
  sensor: RawMeasurement["sensor"],
  errorRate = 0
): RawMeasurement {
  return { name, value: number, unit, sensor, health: { healthy: errorRate <= 0.05, errorRate } };
}

function observation(
  tool: ExperimentTool,
  measurements: RawMeasurement[],
  purpose: EvidenceObservation["purpose"] = "diagnosis"
): EvidenceObservation {
  const base = {
    requestId: `req-${tool}`,
    ok: true,
    elapsedMs: 100,
    measurements,
    activationAccepted: true,
    tripped: false,
    observationId: `obs-${tool}-${purpose}`,
    experimentId: `exp-${tool}`,
    sessionId: "session-test",
    capturedAt: new Date().toISOString(),
    tool,
    purpose,
    provenance: {
      source: "simulation" as const,
      adapter: "simulator" as const,
      deviceId: "sim",
      firmwareVersion: "test"
    },
    calibrationId: calibration.id
  };
  return { ...base, classification: classifyObservation(base, calibration) };
}

test("calibration-derived thresholds have conservative floors", () => {
  assert.equal(motionThreshold(calibration), 0.1);
  assert.equal(nearIdleThreshold(calibration), 20);
  assert.deepEqual(healthyCurrentRange(calibration), [108, 251.99999999999997]);
});

test("absent motion alone remains inconclusive", () => {
  const motion = observation("motor_motion_probe", [
    value("acceleration_rms_g", 0.012, "g", "MPU6050"),
    value("baseline_rms_g", 0.01, "g", "MPU6050")
  ]);
  const result = evaluateDiagnosis([motion], calibration, false);
  assert.equal(result.evidenceState, "MOTION_ABSENT_INCONCLUSIVE");
  assert.equal(result.confidence, "POSSIBLE");
});

test("absent motion and near-idle current support a condition, not confirmation", () => {
  const motion = observation("motor_motion_probe", [value("acceleration_rms_g", 0.012, "g", "MPU6050")]);
  const current = observation("motor_current_probe", [value("current_mean_ma", 2.4, "mA", "INA219")]);
  const result = evaluateDiagnosis([motion, current], calibration, false);
  assert.equal(result.evidenceState, "OPEN_OR_UNENERGIZED_PATH_SUPPORTED");
  assert.equal(result.confidence, "HIGH CONFIDENCE");
  assert.notEqual(result.confidence, "CONFIRMED");
});

test("invalid motion evidence cannot support an electrical diagnosis", () => {
  const motion = observation("motor_motion_probe", [value("acceleration_rms_g", 0.012, "g", "MPU6050", 0.06)]);
  const current = observation("motor_current_probe", [value("current_mean_ma", 2.4, "mA", "INA219")]);
  const result = evaluateDiagnosis([motion, current], calibration, false);
  assert.equal(result.evidenceState, "MOTION_EVIDENCE_INVALID");
  assert.equal(result.confidence, "UNKNOWN");
});

test("confirmation requires two consecutive passing post-intervention verifications", () => {
  const motion = observation("motor_motion_probe", [value("acceleration_rms_g", 0.012, "g", "MPU6050")]);
  const current = observation("motor_current_probe", [value("current_mean_ma", 2.4, "mA", "INA219")]);
  const passing = observation("verify_motor", [
    value("acceleration_rms_g", 0.2, "g", "MPU6050"),
    value("current_mean_ma", 180, "mA", "INA219")
  ], "verification");
  const first = evaluateDiagnosis([motion, current, passing], calibration, true, 0);
  assert.equal(first.confidence, "HIGH CONFIDENCE");
  assert.equal(first.consecutiveVerificationPasses, 1);
  const second = evaluateDiagnosis([motion, current, passing, passing], calibration, true, 1);
  assert.equal(second.confidence, "CONFIRMED");
  assert.equal(second.consecutiveVerificationPasses, 2);
});

test("a failed verification resets consecutive passes", () => {
  const failed = observation("verify_motor", [
    value("acceleration_rms_g", 0.01, "g", "MPU6050"),
    value("current_mean_ma", 2, "mA", "INA219")
  ], "verification");
  const result = evaluateDiagnosis([failed], calibration, true, 1);
  assert.equal(result.consecutiveVerificationPasses, 0);
  assert.equal(result.confidence, "UNKNOWN");
});
