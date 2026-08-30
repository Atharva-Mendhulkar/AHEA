import { createHash, randomUUID } from "node:crypto";
import type { DecisionRecord, DiagnosisSession, ExperimentDefinition } from "../shared/domain.js";
import { modelSelectionSchema } from "../shared/schemas.js";

export interface DecisionContext { session: DiagnosisSession; eligibleExperiments: ExperimentDefinition[] }
export interface DecisionSelection { experimentId: string; objective: string; rationale: string; provider: "gemini" | "deterministic"; model: string; responseId?: string; decisionSource: "gemini" | "fallback"; contextDigest: string; observationIds: string[] }
export interface DecisionClient { decide(context: DecisionContext): Promise<DecisionSelection>; clear(sessionId: string): void }

interface GeminiResponse {
  responseId?: string;
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

function normalizedContext({ session, eligibleExperiments }: DecisionContext) {
  return {
    sessionId: session.id, lifecycle: session.lifecycle, phase: session.phase, mode: session.mode, problem: session.problem,
    project: session.projectContext.project, profile: session.projectContext.profile, evidence: session.evidence,
    capabilityRegistryDigest: session.hardware.registry.digest,
    budget: { executed: session.experimentsExecuted, maximum: session.projectContext.constraints.maximumExperiments },
    eligibleExperiments: eligibleExperiments.map(({ id, type, label, description, planId, targetId, evidenceReferences, operatorPrompt }) => ({ id, type, label, description, planId, targetId, evidenceReferences, operatorPrompt })),
  };
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

export class GeminiDecisionClient implements DecisionClient {
  constructor(private readonly model: string, private readonly apiKey = process.env.GEMINI_API_KEY) {}
  clear(_sessionId: string): void {}

  async decide(context: DecisionContext): Promise<DecisionSelection> {
    const normalized = normalizedContext(context); const contextDigest = digest(normalized);
    if (!this.apiKey) return fallbackDecision(context, contextDigest, this.model);
    const ids = context.eligibleExperiments.map((entry) => entry.id);
    const instructions = "Select exactly one backend-offered opaque experiment ID. Prefer the experiment that best resolves current evidence. Never invent pins, registers, waveform values, timing, ADC settings, bus operations, evidence, confidence, lifecycle state, or repair steps. Return only the requested JSON object with a concise rationale referencing observations, not private chain-of-thought.";
    const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(this.model) + ":generateContent";
    const body = {
      systemInstruction: { parts: [{ text: instructions }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(normalized) }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            experimentId: { type: "STRING", enum: ids },
            objective: { type: "STRING" },
            rationale: { type: "STRING" },
          },
          required: ["experimentId", "objective", "rationale"],
        },
      },
    };
    for (let attempt = 0; attempt < 2; attempt += 1) try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error("Gemini request failed with status " + response.status + ".");
      const payload = await response.json() as GeminiResponse;
      const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
      if (!text) throw new Error("Gemini response did not include structured output.");
      const fence = String.fromCharCode(96, 96, 96);
      const cleaned = text.startsWith(fence) ? text.slice(text.indexOf("\n") + 1, text.lastIndexOf(fence)).trim() : text;
      const args = modelSelectionSchema.parse(JSON.parse(cleaned));
      if (!ids.includes(args.experimentId)) throw new Error("Selected experiment is not eligible.");
      return { ...args, provider: "gemini", model: this.model, responseId: payload.responseId, decisionSource: "gemini", contextDigest, observationIds: context.session.observations.map((entry) => entry.id) };
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
