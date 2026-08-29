import type { AgentAction, DiagnosisSession } from "../shared/domain.js";
import { DEFAULT_LIMITS, isMotorCommand, measurement } from "../shared/domain.js";

export interface ValidationResult {
  accepted: boolean;
  reasons: string[];
}

export function validateAction(session: DiagnosisSession, action: AgentAction, now = Date.now()): ValidationResult {
  const reasons: string[] = [];
  if (["CONFIRMED", "FAILED", "INTERRUPTED", "ESTOPPED"].includes(session.lifecycle)) {
    reasons.push(`Session is terminal: ${session.lifecycle}.`);
  }
  if (session.hardware.estopLatched || session.lifecycle === "ESTOPPED") reasons.push("Emergency stop is latched.");
  if (session.pendingDecision) reasons.push("Another decision is already pending.");

  if (action === "motor_current_probe") {
    const motion = [...session.observations].reverse().find((observation) => observation.command === "motor_motion_probe");
    const classified = motion && session.evidence.observations.find((item) => item.observationId === motion.id);
    if (!motion || !classified?.valid || measurement<boolean>(motion, "expected_motion_signature_detected") !== false) {
      reasons.push("Current probe requires a valid absent-motion observation in this session.");
    }
  }
  if (action === "verify_motor" && !session.intervention) reasons.push("Verification requires a declared intervention.");
  if (action === "motor_motion_probe" && session.diagnosticActivations >= DEFAULT_LIMITS.diagnosticActivations) {
    reasons.push("Diagnostic activation budget is exhausted.");
  }
  if (action === "motor_current_probe" && session.diagnosticActivations >= DEFAULT_LIMITS.diagnosticActivations) {
    reasons.push("Diagnostic activation budget is exhausted.");
  }
  if (action === "verify_motor" && session.verificationActivations >= DEFAULT_LIMITS.verificationActivations) {
    reasons.push("Verification activation budget is exhausted.");
  }
  if (isMotorCommand(action) && session.totalActivations >= DEFAULT_LIMITS.totalActivations) {
    reasons.push("Total activation budget is exhausted.");
  }
  if (isMotorCommand(action) && session.lastActivationAt) {
    const readyAt = new Date(session.lastActivationAt).getTime() + DEFAULT_LIMITS.cooldownMs;
    if (now < readyAt) reasons.push(`Cooldown active until ${new Date(readyAt).toISOString()}.`);
  }
  return { accepted: reasons.length === 0, reasons };
}
