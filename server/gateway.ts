import type { DiagnosisSession, ExperimentDefinition } from "../shared/domain.js";
import { deviceById } from "../shared/domain.js";
import { buildEligibleExperiments } from "./modules.js";

export interface ValidationResult { accepted: boolean; reasons: string[] }
export function validateExperiment(session: DiagnosisSession, experiment: ExperimentDefinition, setupConfirmed = true): ValidationResult {
  const reasons: string[] = [];
  if (["CONFIRMED", "CONCLUDED", "FAILED", "INTERRUPTED", "ESTOPPED"].includes(session.lifecycle)) reasons.push(`Session is terminal: ${session.lifecycle}.`);
  if (session.hardware.estopLatched || session.lifecycle === "ESTOPPED") reasons.push("Emergency stop is latched.");
  if (session.experimentsExecuted >= session.projectContext.constraints.maximumExperiments) reasons.push("Experiment budget is exhausted.");
  if (experiment.targetDeviceId && !deviceById(session.projectContext, experiment.targetDeviceId)) reasons.push("Target device is not in project context.");
  if (!buildEligibleExperiments({ ...session, pendingDecision: undefined }).some((candidate) => candidate.id === experiment.id && candidate.type === experiment.type && candidate.planId === experiment.planId && candidate.command === experiment.command && candidate.targetDeviceId === experiment.targetDeviceId && candidate.recommendationId === experiment.recommendationId)) reasons.push("Experiment is not eligible for the current evidence state.");
  if (experiment.requiresSetupConfirmation && !setupConfirmed) reasons.push("Operator must confirm the declared physical setup or stimulus.");
  if (experiment.type === "verify_sensor" && !session.intervention) reasons.push("Verification requires a declared intervention.");
  if (experiment.budgetClass === "actuation") reasons.push("Actuation is disabled in the sensor-first MVP.");
  return { accepted: reasons.length === 0, reasons };
}
