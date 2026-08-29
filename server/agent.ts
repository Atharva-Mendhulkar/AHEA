import { createHash, randomUUID } from "node:crypto";
import OpenAI from "openai";
import type { DecisionRecord, DiagnosisSession, ExperimentDefinition } from "../shared/domain.js";
import { modelSelectionSchema } from "../shared/schemas.js";

export interface DecisionContext { session: DiagnosisSession; eligibleExperiments: ExperimentDefinition[] }
export interface DecisionSelection { experimentId: string; objective: string; rationale: string; provider: "openai" | "deterministic"; model: string; responseId?: string; decisionSource: "openai" | "fallback"; contextDigest: string; observationIds: string[] }
export interface DecisionClient { decide(context: DecisionContext): Promise<DecisionSelection>; clear(sessionId: string): void }
interface Continuation { output: unknown[]; callId: string }

function normalizedContext({ session, eligibleExperiments }: DecisionContext) {
  return {
    sessionId: session.id, lifecycle: session.lifecycle, phase: session.phase, mode: session.mode, problem: session.problem,
    project: session.projectContext.project, profile: session.projectContext.profile, evidence: session.evidence,
    capabilityRegistryDigest: session.hardware.registry.digest,
    budget: { executed: session.experimentsExecuted, maximum: session.projectContext.constraints.maximumExperiments },
    eligibleExperiments: eligibleExperiments.map(({ id, type, label, description, planId, targetId, evidenceReferences }) => ({ id, type, label, description, planId, targetId, evidenceReferences })),
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
    const ids = context.eligibleExperiments.map((entry) => entry.id);
    const instructions = "Select exactly one backend-offered opaque experiment ID. Prefer the experiment that best resolves current evidence. Never invent pins, registers, waveform values, timing, ADC settings, bus operations, evidence, confidence, lifecycle state, or repair steps. Return a concise rationale referencing observations, not private chain-of-thought.";
    const continuation = this.continuations.get(context.session.id);
    const input: unknown[] = continuation ? [...continuation.output, { type: "function_call_output", call_id: continuation.callId, output: JSON.stringify(normalized) }] : [{ role: "user", content: JSON.stringify(normalized) }];
    for (let attempt = 0; attempt < 2; attempt += 1) try {
      const response = await this.client.responses.create({ model: this.model, instructions, input: input as never, tool_choice: "required", parallel_tool_calls: false, tools: [{ type: "function", name: "select_experiment", description: "Select one offered experiment.", strict: true, parameters: { type: "object", properties: { experimentId: { type: "string", enum: ids }, objective: { type: "string" }, rationale: { type: "string" } }, required: ["experimentId", "objective", "rationale"], additionalProperties: false } }] });
      const calls = response.output.filter((entry) => entry.type === "function_call");
      if (calls.length !== 1) throw new Error("Expected exactly one function call.");
      const args = modelSelectionSchema.parse(JSON.parse(calls[0]!.arguments));
      if (!ids.includes(args.experimentId)) throw new Error("Selected experiment is not eligible.");
      this.continuations.set(context.session.id, { output: response.output as unknown[], callId: calls[0]!.call_id });
      return { ...args, provider: "openai", model: this.model, responseId: response.id, decisionSource: "openai", contextDigest, observationIds: context.session.observations.map((entry) => entry.id) };
    } catch { /* Retry once, then use the deterministic selector. */ }
    return fallbackDecision(context, contextDigest, this.model);
  }
}

export function fallbackDecision(context: DecisionContext, contextDigest = digest(normalizedContext(context)), model = "fallback"): DecisionSelection {
  const chosen = context.eligibleExperiments[0];
  if (!chosen) throw new Error("No eligible experiment is available.");
  return { experimentId: chosen.id, objective: chosen.label, rationale: chosen.description, provider: "deterministic", model, decisionSource: "fallback", contextDigest, observationIds: context.session.observations.filter((entry) => entry.phase !== "monitoring").map((entry) => entry.id) };
}

export function toDecisionRecord(selection: DecisionSelection, experiment: ExperimentDefinition, session: DiagnosisSession, eligible: ExperimentDefinition[]): DecisionRecord {
  return { id: randomUUID(), observationIds: selection.observationIds, contextDigest: selection.contextDigest, candidateHypotheses: session.evidence.hypotheses.filter((entry) => entry.status === "POSSIBLE" || entry.status === "SUPPORTED").map((entry) => entry.id), eligibleExperimentIds: eligible.map((entry) => entry.id), selectedExperimentId: experiment.id, selectedAction: experiment.type, objective: selection.objective, rationale: selection.rationale, provider: selection.provider, model: selection.model, responseId: selection.responseId, createdAt: new Date().toISOString(), gatewayValidation: { accepted: false, reasons: ["Pending gateway validation."] }, decisionSource: selection.decisionSource };
}
