import type {
  AgentAction,
  EvidenceObservation,
  SessionSnapshot
} from "../types.js";

export interface ValidationResult {
  allowed: boolean;
  reason: string;
}

export function validateAgentAction(
  session: SessionSnapshot,
  action: AgentAction
): ValidationResult {
  if (session.emergencyStopLatched || session.phase === "STOPPED") {
    return { allowed: false, reason: "Emergency stop is latched." };
  }

  if (action.kind !== "run_experiment") {
    if (action.kind === "request_repair") {
      return session.diagnosis.evidenceState === "OPEN_OR_UNENERGIZED_PATH_SUPPORTED"
        ? { allowed: true, reason: "Evidence supports requesting inspection or repair." }
        : { allowed: false, reason: "Repair cannot be requested before supporting evidence exists." };
    }
    if (action.kind === "report_not_reproduced") {
      const motion = lastObservation(session.observations, "motor_motion_probe");
      return motion?.classification.includes("MOTION_SIGNATURE_DETECTED")
        ? { allowed: true, reason: "A valid expected motion signature was detected." }
        : { allowed: false, reason: "A not-reproduced report requires a valid detected motion signature." };
    }
    if (action.kind === "request_sensor_recovery") {
      const motion = lastObservation(session.observations, "motor_motion_probe");
      return motion?.classification.includes("MOTION_MEASUREMENT_INVALID")
        ? { allowed: true, reason: "Motion sensor evidence is invalid." }
        : { allowed: false, reason: "Sensor recovery requires invalid sensor evidence." };
    }
    return { allowed: true, reason: "Non-activating action is allowed." };
  }

  if (!session.calibration) {
    return { allowed: false, reason: "Healthy calibration is required." };
  }
  if (session.pendingExperiment) {
    return { allowed: false, reason: "Another experiment is awaiting approval." };
  }
  if (session.activationsUsed >= session.activationBudget) {
    return { allowed: false, reason: "Diagnostic activation budget exhausted." };
  }

  if (action.tool === "motor_motion_probe") {
    const alreadyRan = session.observations.some((item) => item.tool === "motor_motion_probe");
    return alreadyRan
      ? { allowed: false, reason: "Motion probe already completed for this diagnosis." }
      : { allowed: true, reason: "Calibrated motion probe is available." };
  }

  if (action.tool === "motor_current_probe") {
    const motion = lastObservation(session.observations, "motor_motion_probe");
    return motion?.classification.includes("MOTION_SIGNATURE_ABSENT")
      ? { allowed: true, reason: "A valid absent-motion observation is available." }
      : { allowed: false, reason: "Current probe requires a valid absent-motion observation." };
  }

  const mayVerify =
    Boolean(session.intervention) &&
    ["OPEN_OR_UNENERGIZED_PATH_SUPPORTED", "REPAIR_VERIFICATION_ONE_OF_TWO"].includes(
      session.diagnosis.evidenceState
    );
  return mayVerify
    ? { allowed: true, reason: "A human intervention was declared and verification is pending." }
    : { allowed: false, reason: "Verification requires a declared intervention and supported diagnosis." };
}

function lastObservation(
  observations: EvidenceObservation[],
  tool: EvidenceObservation["tool"]
): EvidenceObservation | undefined {
  return [...observations].reverse().find((item) => item.tool === tool);
}
