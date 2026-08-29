import type {
  CalibrationProfile,
  ConfidenceLabel,
  DiagnosisState,
  EvidenceObservation,
  Hypothesis,
  RawMeasurement
} from "../types.js";

export const MAX_SENSOR_ERROR_RATE = 0.05;

const hypotheses: Hypothesis[] = [
  "open_or_unenergized_motor_path",
  "mechanical_stall",
  "driver_control_failure",
  "motion_sensor_or_mounting_failure"
];

export function measurement(
  observation: EvidenceObservation | undefined,
  name: RawMeasurement["name"]
): RawMeasurement | undefined {
  return observation?.measurements.find((item) => item.name === name);
}

export function isMeasurementValid(value: RawMeasurement | undefined): boolean {
  return Boolean(
    value &&
      Number.isFinite(value.value) &&
      value.health.healthy &&
      value.health.errorRate <= MAX_SENSOR_ERROR_RATE
  );
}

export function motionThreshold(calibration: CalibrationProfile): number {
  return Math.max(
    calibration.baselineMotionRmsG * 3,
    calibration.healthyMotionRmsG * 0.5,
    0.05
  );
}

export function nearIdleThreshold(calibration: CalibrationProfile): number {
  return Math.max(calibration.idleCurrentMa + 10, 20);
}

export function healthyCurrentRange(calibration: CalibrationProfile): [number, number] {
  return [calibration.healthyCurrentMa * 0.6, calibration.healthyCurrentMa * 1.4];
}

export function classifyObservation(
  observation: Omit<EvidenceObservation, "classification">,
  calibration?: CalibrationProfile
): string[] {
  if (!observation.ok) return ["EXPERIMENT_INVALID"];
  if (observation.tripped) return ["SAFETY_TRIP"];
  if (!calibration) return ["UNCALIBRATED"];

  const classifications: string[] = [];
  const motion = measurement(observation as EvidenceObservation, "acceleration_rms_g");
  const current = measurement(observation as EvidenceObservation, "current_mean_ma");

  if (motion) {
    classifications.push(
      isMeasurementValid(motion)
        ? motion.value >= motionThreshold(calibration)
          ? "MOTION_SIGNATURE_DETECTED"
          : "MOTION_SIGNATURE_ABSENT"
        : "MOTION_MEASUREMENT_INVALID"
    );
  }

  if (current) {
    if (!isMeasurementValid(current)) {
      classifications.push("CURRENT_MEASUREMENT_INVALID");
    } else if (current.value <= nearIdleThreshold(calibration)) {
      classifications.push("CURRENT_NEAR_IDLE");
    } else {
      const [minimum, maximum] = healthyCurrentRange(calibration);
      classifications.push(
        current.value >= minimum && current.value <= maximum
          ? "CURRENT_IN_HEALTHY_RANGE"
          : current.value > maximum
            ? "CURRENT_ELEVATED"
            : "CURRENT_BELOW_HEALTHY_RANGE"
      );
    }
  }

  if (classifications.length === 0) classifications.push("NO_DIAGNOSTIC_MEASUREMENT");
  return classifications;
}

function emptySupport(): Record<Hypothesis, ConfidenceLabel> {
  return Object.fromEntries(hypotheses.map((name) => [name, "UNKNOWN"])) as Record<
    Hypothesis,
    ConfidenceLabel
  >;
}

export function evaluateDiagnosis(
  observations: EvidenceObservation[],
  calibration: CalibrationProfile | undefined,
  interventionDeclared: boolean,
  previousConsecutivePasses = 0
): DiagnosisState {
  const support = emptySupport();
  if (!calibration) {
    return {
      evidenceState: "CALIBRATION_REQUIRED",
      confidence: "UNKNOWN",
      hypothesisSupport: support,
      consecutiveVerificationPasses: 0
    };
  }

  const motion = [...observations]
    .reverse()
    .find((item) => item.tool === "motor_motion_probe");
  const current = [...observations]
    .reverse()
    .find((item) => item.tool === "motor_current_probe");
  const motionAbsent = motion?.classification.includes("MOTION_SIGNATURE_ABSENT") ?? false;
  const motionInvalid = motion?.classification.includes("MOTION_MEASUREMENT_INVALID") ?? false;
  const currentNearIdle = current?.classification.includes("CURRENT_NEAR_IDLE") ?? false;
  const currentElevated = current?.classification.includes("CURRENT_ELEVATED") ?? false;

  let evidenceState = "INSUFFICIENT_EVIDENCE";
  let confidence: ConfidenceLabel = "UNKNOWN";

  if (motionInvalid) {
    support.motion_sensor_or_mounting_failure = "LIKELY";
    evidenceState = "MOTION_EVIDENCE_INVALID";
  } else if (motionAbsent && !current) {
    support.open_or_unenergized_motor_path = "POSSIBLE";
    support.mechanical_stall = "POSSIBLE";
    support.driver_control_failure = "POSSIBLE";
    support.motion_sensor_or_mounting_failure = "POSSIBLE";
    confidence = "POSSIBLE";
    evidenceState = "MOTION_ABSENT_INCONCLUSIVE";
  } else if (motionAbsent && currentNearIdle && !motion?.tripped && !current?.tripped) {
    support.open_or_unenergized_motor_path = "HIGH CONFIDENCE";
    support.driver_control_failure = "LIKELY";
    support.motion_sensor_or_mounting_failure = "POSSIBLE";
    evidenceState = "OPEN_OR_UNENERGIZED_PATH_SUPPORTED";
    confidence = "HIGH CONFIDENCE";
  } else if (motionAbsent && currentElevated) {
    support.mechanical_stall = "HIGH CONFIDENCE";
    evidenceState = "ENERGIZED_STALL_SUPPORTED";
    confidence = "HIGH CONFIDENCE";
  }

  const verification = observations.at(-1);
  let consecutiveVerificationPasses = previousConsecutivePasses;
  if (verification?.tool === "verify_motor" && interventionDeclared) {
    const passed =
      verification.ok &&
      !verification.tripped &&
      verification.classification.includes("MOTION_SIGNATURE_DETECTED") &&
      verification.classification.includes("CURRENT_IN_HEALTHY_RANGE");
    consecutiveVerificationPasses = passed ? previousConsecutivePasses + 1 : 0;
    if (consecutiveVerificationPasses >= 2) {
      evidenceState = "REPAIR_VERIFIED_TWICE";
      confidence = "CONFIRMED";
      support.open_or_unenergized_motor_path = "CONFIRMED";
    } else if (passed) {
      evidenceState = "REPAIR_VERIFICATION_ONE_OF_TWO";
      confidence = "HIGH CONFIDENCE";
    } else {
      evidenceState = "REPAIR_VERIFICATION_FAILED";
      confidence = "UNKNOWN";
    }
  }

  return {
    evidenceState,
    confidence,
    hypothesisSupport: support,
    consecutiveVerificationPasses
  };
}
