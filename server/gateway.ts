import type { DiagnosisSession, ExperimentDefinition } from "../shared/domain.js";
import { targetById, terminalLifecycleStates } from "../shared/domain.js";
import { buildEligibleExperiments } from "./modules.js";

export interface ValidationResult { accepted: boolean; reasons: string[] }
export function validateExperiment(session: DiagnosisSession, experiment: ExperimentDefinition, setupConfirmed = false): ValidationResult {
  const reasons: string[] = [];
  if (terminalLifecycleStates.includes(session.lifecycle)) reasons.push(`Session is terminal: ${session.lifecycle}.`);
  if (session.hardware.estopLatched || session.lifecycle === "ESTOPPED") reasons.push("Emergency stop is latched.");
  if (session.experimentsExecuted >= session.projectContext.constraints.maximumExperiments && experiment.command) reasons.push("Experiment budget is exhausted.");
  if (!targetById(session.projectContext, experiment.targetId)) reasons.push("Target is not in project context.");
  const eligible = buildEligibleExperiments({ ...session, pendingDecision: undefined });
  const exact = eligible.some((candidate) => candidate.id === experiment.id && candidate.type === experiment.type && candidate.planId === experiment.planId && candidate.command === experiment.command && candidate.targetId === experiment.targetId && candidate.phase === experiment.phase && candidate.recommendationId === experiment.recommendationId);
  if (!exact) reasons.push("Experiment is not eligible for the current evidence state.");
  if (experiment.command) {
    if (!experiment.planId || !session.projectContext.allowedPlanIds.includes(experiment.planId)) reasons.push("Plan is not allowed by project context.");
    const registered = session.hardware.registry.plans.find((entry) => entry.id === experiment.planId);
    if (!registered) reasons.push("Plan was not advertised by firmware.");
    else {
      if (registered.command !== experiment.command || registered.type !== experiment.type) reasons.push("Experiment does not match the advertised plan.");
      if (!registered.phases.includes(experiment.phase)) reasons.push("Plan is not registered for this phase.");
      const target = targetById(session.projectContext, experiment.targetId);
      if (target && registered.bindingIds.some((binding) => !target.bindingIds.includes(binding))) reasons.push("Plan uses a binding outside the declared target.");
    }
  }
  if (experiment.requiresSetupConfirmation && !setupConfirmed) reasons.push("Operator must confirm the declared physical setup.");
  if (experiment.type === "verify_repair" && (!session.intervention || session.lifecycle !== "VERIFYING")) reasons.push("Verification requires a declared human intervention.");
  if (experiment.type === "request_intervention" && session.evidence.recommendations.length === 0) reasons.push("No deterministic recommendation supports intervention.");
  return { accepted: reasons.length === 0, reasons };
}
