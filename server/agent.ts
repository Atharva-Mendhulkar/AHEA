import { createHash, randomUUID } from "node:crypto";
import OpenAI from "openai";
import type { DecisionRecord, DiagnosisSession, ExperimentDefinition } from "../shared/domain.js";
import { modelSelectionSchema } from "../shared/schemas.js";

export interface DecisionContext { session: DiagnosisSession; eligibleExperiments: ExperimentDefinition[] }
export interface DecisionSelection { experimentId: string; objective: string; rationale: string; provider: "openai" | "deterministic"; model: string; responseId?: string; decisionSource: "openai" | "fallback"; contextDigest: string; observationIds: string[] }
export interface DecisionClient { decide(context: DecisionContext): Promise<DecisionSelection>; clear(sessionId: string): void }
interface Continuation { output: unknown[]; callId: string }

function normalizedContext(context: DecisionContext) {
  const session = context.session;
  return {
    sessionId: session.id, lifecycle: session.lifecycle, phase: session.phase, problem: session.problem, mode: session.mode,
    project: session.projectContext.project,
    intendedBehavior: session.projectContext.expectedBehavior,
    components: session.projectContext.components.map(({ id, label, type, role }) => ({ id, label, type, role })),
    evidence: session.evidence,
    intervention: session.intervention,
    budget: { executed: session.experimentsExecuted, maximum: session.projectContext.constraints.maximumExperiments },
    eligibleExperiments: context.eligibleExperiments.map(({ id, type, label, description, targetDeviceId, referenceDeviceIds, recommendationId }) => ({ id, type, label, description, targetDeviceId, referenceDeviceIds, recommendationId })),
  };
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

export class OpenAIDecisionClient implements DecisionClient {
  private readonly client?: OpenAI;
  private readonly continuations = new Map<string, Continuation>();
  constructor(private readonly model: string, apiKey = process.env.OPENAI_API_KEY) { if (apiKey) this.client = new OpenAI({ apiKey, timeout: 20_000, maxRetries: 0 }); }
  clear(sessionId: string): void { this.continuations.delete(sessionId); }
  async decide(context: DecisionContext): Promise<DecisionSelection> {
    const normalized = normalizedContext(context); const contextDigest = digest(normalized);
    if (!this.client) return fallbackDecision(context, contextDigest, this.model);
    const ids = context.eligibleExperiments.map((item) => item.id);
    const instructions = [
      "Select exactly one backend-offered semantic experiment for a hardware investigation.",
      "Use project intent and deterministic evidence to choose the most informative next step, and stop when evidence is sufficient.",
      "Never invent pins, PWM, ADC settings, I2C bytes, timings, resistor values, confidence, or lifecycle state.",
      "FSR measurements use a repeatable manual stimulus, so preserve that limitation.",
    ].join(" ");
    const continuation = this.continuations.get(context.session.id);
    const input: unknown[] = continuation ? [...continuation.output, { type: "function_call_output", call_id: continuation.callId, output: JSON.stringify(normalized) }] : [{ role: "user", content: JSON.stringify(normalized) }];
    for (let attempt = 0; attempt < 2; attempt += 1) try {
      const response = await this.client.responses.create({
        model: this.model, instructions: attempt === 0 ? instructions : `${instructions} Your prior output was invalid; call the tool exactly once.`, input: input as never, tool_choice: "required", parallel_tool_calls: false,
        tools: [{ type: "function", name: "select_experiment", description: "Select one offered experiment by its opaque ID.", strict: true, parameters: { type: "object", properties: { experimentId: { type: "string", enum: ids }, objective: { type: "string" }, rationale: { type: "string" } }, required: ["experimentId", "objective", "rationale"], additionalProperties: false } }],
      });
      const calls = response.output.filter((item) => item.type === "function_call");
      if (calls.length !== 1) throw new Error("Expected exactly one function call.");
      const args = modelSelectionSchema.parse(JSON.parse(calls[0]!.arguments));
      if (!ids.includes(args.experimentId)) throw new Error("Selected experiment is not eligible.");
      this.continuations.set(context.session.id, { output: response.output as unknown[], callId: calls[0]!.call_id });
      return { ...args, provider: "openai", model: this.model, responseId: response.id, decisionSource: "openai", contextDigest, observationIds: context.session.observations.map((item) => item.id) };
    } catch { /* Retry once, then use the deterministic policy. */ }
    return fallbackDecision(context, contextDigest, this.model);
  }
}

export function fallbackDecision(context: DecisionContext, contextDigest = digest(normalizedContext(context)), model = "fallback"): DecisionSelection {
  const chosen = context.eligibleExperiments[0];
  if (!chosen) throw new Error("No eligible experiment is available.");
  const objectives: Partial<Record<ExperimentDefinition["type"], string>> = {
    sample_fsr: "Collect the next required bounded FSR trial.", verify_sensor: "Measure whether the declared modification brought the subject within the reference tolerance.", request_intervention: "Apply the evidence-backed bounded modification.", request_manual_check: "Resolve a setup, wiring, stability, or missing-circuit prerequisite.", conclude_normal: "Stop because the subject is within the configured reference tolerance.",
  };
  return { experimentId: chosen.id, objective: objectives[chosen.type] ?? "Collect the next required evidence.", rationale: chosen.description, provider: "deterministic", model, decisionSource: "fallback", contextDigest, observationIds: context.session.observations.map((item) => item.id) };
}

export function toDecisionRecord(selection: DecisionSelection, experiment: ExperimentDefinition, session: DiagnosisSession): DecisionRecord {
  return { id: randomUUID(), observationIds: selection.observationIds, contextDigest: selection.contextDigest, candidateHypotheses: session.evidence.hypotheses.filter((item) => item.status === "PLAUSIBLE" || item.status === "SUPPORTED").map((item) => item.id), selectedExperimentId: experiment.id, selectedAction: experiment.type, objective: selection.objective, rationale: selection.rationale, provider: selection.provider, model: selection.model, responseId: selection.responseId, createdAt: new Date().toISOString(), gatewayValidation: { accepted: false, reasons: ["Pending gateway validation."] }, decisionSource: selection.decisionSource };
}
