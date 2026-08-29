import type {
  CalibrationProfile,
  ConfidenceLabel,
  EvidenceView,
  HypothesisEvidence,
  Observation,
  ObservationEvidence,
} from "../shared/domain.js";
import { measurement } from "../shared/domain.js";

function observationIsValid(observation: Observation, calibration: CalibrationProfile): boolean {
  return !observation.safety.tripped &&
    !observation.safety.timeout &&
    !observation.safety.estopLatched &&
    observation.sensorHealth.every(
      (sensor) => sensor.healthy && sensor.errorRate <= calibration.thresholds.maximumSensorErrorRate,
    ) &&
    observation.measurements.every((entry) => entry.quality === "valid");
}

export function calculateThresholds(calibration: CalibrationProfile) {
  return {
    motionThresholdG: Math.max(
      calibration.thresholds.motionMultiplier * calibration.baseMotionRmsG,
      calibration.thresholds.healthyMotionFraction * calibration.healthyMotionRmsG,
      calibration.thresholds.motionNoiseFloorG,
    ),
    nearIdleThresholdMa: Math.max(
      calibration.idleCurrentMa + calibration.thresholds.idleCurrentMarginMa,
      calibration.thresholds.currentNoiseFloorMa,
    ),
    healthyCurrentRangeMa: [
      calibration.thresholds.healthyCurrentLowFraction * calibration.healthyCurrentMa,
      calibration.thresholds.healthyCurrentHighFraction * calibration.healthyCurrentMa,
    ] as [number, number],
  };
}

export function classifyObservation(observation: Observation, calibration: CalibrationProfile): ObservationEvidence {
  const thresholds = calculateThresholds(calibration);
  const reportedMotion = measurement<boolean>(observation, "expected_motion_signature_detected");
  const motionRmsG = measurement<number>(observation, "acceleration_rms_g");
  // Adapters may report a convenience boolean, but calibrated raw evidence is authoritative.
  const motionDetected = motionRmsG === undefined ? reportedMotion : motionRmsG >= thresholds.motionThresholdG;
  const currentMeanMa = measurement<number>(observation, "current_mean_ma");
  const valid = observationIsValid(observation, calibration);
  const comparisons: string[] = [];

  if (motionDetected !== undefined) {
    comparisons.push(
      `Motion signature ${motionDetected ? "detected" : "absent"}${motionRmsG === undefined ? "" : ` at ${motionRmsG.toFixed(3)} g`} (threshold ${thresholds.motionThresholdG.toFixed(3)} g).`,
    );
  }
  if (currentMeanMa !== undefined) {
    comparisons.push(
      `Mean current ${currentMeanMa.toFixed(1)} mA; near-idle threshold ${thresholds.nearIdleThresholdMa.toFixed(1)} mA.`,
    );
  }

  const currentHealthy = currentMeanMa !== undefined &&
    currentMeanMa >= thresholds.healthyCurrentRangeMa[0] &&
    currentMeanMa <= thresholds.healthyCurrentRangeMa[1];
  const verificationPass = observation.command === "verify_motor"
    ? valid && observation.safety.activationAccepted && motionDetected === true && currentHealthy
    : undefined;

  return {
    observationId: observation.id,
    command: observation.command,
    valid,
    motionDetected,
    motionThresholdG: motionDetected === undefined ? undefined : thresholds.motionThresholdG,
    currentMeanMa,
    nearIdleThresholdMa: currentMeanMa === undefined ? undefined : thresholds.nearIdleThresholdMa,
    healthyCurrentRangeMa: currentMeanMa === undefined ? undefined : thresholds.healthyCurrentRangeMa,
    verificationPass,
    comparisons,
  };
}

function hypothesis(
  name: HypothesisEvidence["hypothesis"],
  support: number,
  confidence: ConfidenceLabel,
  reasons: string[],
  limitations: string[] = [],
): HypothesisEvidence {
  return { hypothesis: name, support, confidence, reasons, limitations };
}

export function deriveEvidence(
  observations: Observation[],
  calibration: CalibrationProfile,
  interventionDeclared: boolean,
): EvidenceView {
  const classified = observations.map((observation) => classifyObservation(observation, calibration));
  const motion = [...classified].reverse().find((item) => item.command === "motor_motion_probe");
  const current = [...classified].reverse().find((item) => item.command === "motor_current_probe");
  const verification = classified.filter((item) => item.command === "verify_motor");
  let consecutiveVerificationPasses = 0;
  for (const result of verification) {
    consecutiveVerificationPasses = result.verificationPass ? consecutiveVerificationPasses + 1 : 0;
  }

  const invalid = classified.some((item) => !item.valid);
  const nearIdle = current?.valid && current.currentMeanMa !== undefined &&
    current.nearIdleThresholdMa !== undefined && current.currentMeanMa <= current.nearIdleThresholdMa;
  const absentMotion = motion?.valid && motion.motionDetected === false;
  const stallCurrent = current?.valid && current.currentMeanMa !== undefined &&
    current.healthyCurrentRangeMa !== undefined && current.currentMeanMa > current.healthyCurrentRangeMa[1];
  const confirmed = interventionDeclared && consecutiveVerificationPasses >= 2;

  let evidenceState: EvidenceView["evidenceState"] = "INSUFFICIENT";
  let confidenceLabel: ConfidenceLabel = "UNKNOWN";
  if (invalid) evidenceState = "INVALID";
  if (absentMotion) {
    evidenceState = "MOTION_ABSENT";
    confidenceLabel = "POSSIBLE";
  }
  if (absentMotion && nearIdle) {
    evidenceState = "OPEN_PATH_SUPPORTED";
    confidenceLabel = "HIGH CONFIDENCE";
  }
  if (absentMotion && stallCurrent) {
    evidenceState = "STALL_SUPPORTED";
    confidenceLabel = "LIKELY";
  }
  if (confirmed) {
    evidenceState = "HEALTHY";
    confidenceLabel = "CONFIRMED";
  }

  const openSupport = absentMotion && nearIdle ? 90 : absentMotion ? 35 : 10;
  const stallSupport = absentMotion && stallCurrent ? 80 : absentMotion ? 30 : 5;
  const hypotheses = [
    hypothesis(
      "open_motor_path",
      openSupport,
      confirmed ? "CONFIRMED" : absentMotion && nearIdle ? "HIGH CONFIDENCE" : absentMotion ? "POSSIBLE" : "UNKNOWN",
      absentMotion && nearIdle
        ? ["Valid absent-motion evidence and near-idle current agree.", "An energized mechanical stall is materially reduced."]
        : absentMotion ? ["Expected motor-induced motion was not detected."] : [],
      ["Pre-repair evidence identifies an open or unenergized path, not the exact break location."],
    ),
    hypothesis(
      "mechanical_stall",
      stallSupport,
      absentMotion && stallCurrent ? "LIKELY" : absentMotion ? "POSSIBLE" : "UNKNOWN",
      stallCurrent ? ["Absent motion coincided with elevated current."] : [],
    ),
    hypothesis(
      "driver_control_failure",
      absentMotion && nearIdle ? 45 : absentMotion ? 30 : 10,
      absentMotion && nearIdle ? "POSSIBLE" : "UNKNOWN",
      nearIdle ? ["A driver output failure can also produce a no-current path."] : [],
    ),
    hypothesis(
      "motion_sensor_mounting_failure",
      absentMotion ? (nearIdle ? 15 : 40) : 5,
      absentMotion && !nearIdle ? "POSSIBLE" : "UNKNOWN",
      absentMotion ? ["Motion sensing is indirect and depends on mounting."] : [],
    ),
  ];

  return {
    calibrationId: calibration.id,
    observations: classified,
    hypotheses,
    evidenceState,
    confidenceLabel,
    consecutiveVerificationPasses,
    limitations: [
      "The MPU6050 measures a motor-induced vibration signature, not shaft rotation.",
      "Repeated verification trials share the same sensors and setup and are not fully independent.",
      ...(absentMotion && nearIdle
        ? ["A disconnected lead cannot be distinguished from every electrical driver-output failure before inspection."]
        : []),
    ],
  };
}
