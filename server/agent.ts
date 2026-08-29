import { createHash, randomUUID } from "node:crypto";
import OpenAI from "openai";
import type { AgentAction, DecisionRecord, DiagnosisSession, EvidenceView, Observation } from "../shared/domain.js";
import { modelArgumentsSchema } from "../shared/schemas.js";

export interface DecisionContext {
  session: DiagnosisSession;
  allowedActions: AgentAction[];
  latestObservation?: Observation;
}

export interface DecisionSelection {
  action: AgentAction;
  objective: string;
  rationale: string;
  provider: "openai" | "deterministic";
  model: string;
  responseId?: string;
  decisionSource: "openai" | "fallback";
  contextDigest: string;
  observationIds: string[];
}

export interface DecisionClient {
  decide(context: DecisionContext): Promise<DecisionSelection>;
  clear(sessionId: string): void;
}

interface Continuation {
  output: unknown[];
  callId: string;
  observationIdAtCall?: string;
}

function normalizedContext(context: DecisionContext) {
  return {
    sessionId: context.session.id,
    lifecycle: context.session.lifecycle,
    problem: context.session.problem,
    mode: context.session.mode,
    calibration: {
      id: context.session.calibration.id,
      idleCurrentMa: context.session.calibration.idleCurrentMa,
      healthyCurrentMa: context.session.calibration.healthyCurrentMa,
      baseMotionRmsG: context.session.calibration.baseMotionRmsG,
      healthyMotionRmsG: context.session.calibration.healthyMotionRmsG,
    },
    evidence: context.session.evidence,
    observations: context.session.observations.map((observation) => ({
      id: observation.id,
      command: observation.command,
      source: observation.source,
      measurements: observation.measurements,
      sensorHealth: observation.sensorHealth,
      safety: observation.safety,
    })),
    budget: {
      diagnosticRemaining: 2 - context.session.diagnosticActivations,
      verificationRemaining: 4 - context.session.verificationActivations,
      totalRemaining: 6 - context.session.totalActivations,
    },
    intervention: context.session.intervention,
    allowedActions: context.allowedActions,
  };
}

function contextDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const actionDescriptions: Record<AgentAction, string> = {
  scan_i2c: "Inspect the fixed I2C bus for the expected MPU6050 and INA219 without motor activation.",
  sample_motion: "Sample the inactive MPU6050 motion baseline without motor activation.",
  motor_motion_probe: "Request one approved fixed motor pulse and measure the indirect motion signature.",
  motor_current_probe: "After valid absent motion, request one approved fixed pulse and measure motor-path current.",
  verify_motor: "After a declared intervention, request one approved fixed pulse measuring current and motion.",
  emergency_stop: "Latch the hardware emergency stop immediately.",
  request_intervention: "Ask the user to inspect and repair the likely open or unenergized motor path.",
  report_fault_not_reproduced: "Stop because a valid expected motion signature was detected and the reported fault was not reproduced.",
  request_sensor_recovery: "Stop diagnostic advancement and ask the user to repair the sensor or mounting problem.",
};

export class OpenAIDecisionClient implements DecisionClient {
  private readonly client?: OpenAI;
  private readonly continuations = new Map<string, Continuation>();

  constructor(private readonly model: string, apiKey = process.env.OPENAI_API_KEY) {
    if (apiKey) this.client = new OpenAI({ apiKey, timeout: 20_000, maxRetries: 0 });
  }

  clear(sessionId: string): void {
    this.continuations.delete(sessionId);
  }

  async decide(context: DecisionContext): Promise<DecisionSelection> {
    const normalized = normalizedContext(context);
    const digest = contextDigest(normalized);
    if (!this.client) return fallbackDecision(context, digest, this.model);

    try {
      return await this.openAIDecision(context, normalized, digest);
    } catch {
      return fallbackDecision(context, digest, this.model);
    }
  }

  private async openAIDecision(context: DecisionContext, normalized: unknown, digest: string): Promise<DecisionSelection> {
    const tools = context.allowedActions.map((action) => ({
      type: "function" as const,
      name: action,
      description: actionDescriptions[action],
      parameters: {
        type: "object",
        properties: {
          objective: { type: "string", description: "A concise description of the evidence or outcome sought." },
          rationale: { type: "string", description: "A concise, evidence-grounded information-value rationale. Do not include hidden reasoning." },
        },
        required: ["objective", "rationale"],
        additionalProperties: false,
      },
      strict: true,
    }));
    const continuation = this.continuations.get(context.session.id);
    const input: unknown[] = continuation
      ? [
          ...continuation.output,
          {
            type: "function_call_output",
            call_id: continuation.callId,
            output: JSON.stringify({ latestObservation: context.latestObservation, context: normalized }),
          },
        ]
      : [{ role: "user", content: JSON.stringify(normalized) }];

    const instructions = [
      "You are selecting the next bounded semantic action for a DC motor diagnostic session.",
      "Choose exactly one available action. Never invent electrical parameters, confidence, lifecycle state, or verification counters.",
      "Prefer an experiment that distinguishes plausible hypotheses. Motion sensing is indirect.",
      "Near-idle current supports an open or unenergized path but does not locate the break or eliminate driver failure.",
      "Return only a function call with a concise objective and rationale.",
    ].join(" ");

    let response: Awaited<ReturnType<OpenAI["responses"]["create"]>> | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        response = await this.client!.responses.create({
          model: this.model,
          instructions: attempt === 0 ? instructions : `${instructions} Your previous response was invalid; call exactly one listed function.`,
          input: input as never,
          tools,
          tool_choice: "required",
          parallel_tool_calls: false,
        });
        const calls = response.output.filter((item) => item.type === "function_call");
        if (calls.length !== 1) throw new Error("Expected exactly one function call.");
        const call = calls[0]!;
        const action = context.allowedActions.find((candidate) => candidate === call.name);
        if (!action) throw new Error(`Action ${call.name} is not available.`);
        const args = modelArgumentsSchema.parse(JSON.parse(call.arguments));
        this.continuations.set(context.session.id, {
          output: response.output as unknown[],
          callId: call.call_id,
          observationIdAtCall: context.latestObservation?.id,
        });
        return {
          action,
          ...args,
          provider: "openai",
          model: this.model,
          responseId: response.id,
          decisionSource: "openai",
          contextDigest: digest,
          observationIds: context.session.observations.map((observation) => observation.id),
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}

export function fallbackDecision(context: DecisionContext, digest = contextDigest(normalizedContext(context)), model = "fallback"): DecisionSelection {
  const evidence = context.session.evidence;
  let action: AgentAction;
  let objective: string;
  let rationale: string;

  if (context.allowedActions.includes("request_sensor_recovery") && evidence.evidenceState === "INVALID") {
    action = "request_sensor_recovery";
    objective = "Restore trustworthy sensor evidence.";
    rationale = "The latest observation is invalid, so diagnosis must not advance until sensor health is restored.";
  } else if (context.allowedActions.includes("report_fault_not_reproduced") && latestMotion(evidence) === true) {
    action = "report_fault_not_reproduced";
    objective = "Stop the investigation without forcing a diagnosis.";
    rationale = "A valid expected motor-induced motion signature was detected, so the reported no-motion fault was not reproduced.";
  } else if (context.allowedActions.includes("request_intervention") && evidence.evidenceState === "OPEN_PATH_SUPPORTED") {
    action = "request_intervention";
    objective = "Have the user inspect and restore the motor power path.";
    rationale = "Absent motion plus near-idle current strongly supports an open or unenergized path while retaining driver failure as a limitation.";
  } else if (context.allowedActions.includes("verify_motor")) {
    action = "verify_motor";
    objective = "Verify that healthy current and motion returned after intervention.";
    rationale = "A post-intervention pulse must satisfy both calibrated evidence types; two consecutive passes are required.";
  } else if (context.allowedActions.includes("motor_current_probe")) {
    action = "motor_current_probe";
    objective = "Distinguish an open or unenergized path from an energized mechanical stall.";
    rationale = "Current should remain near idle for an open path and rise for an energized stall, independent of motion-sensor mounting.";
  } else {
    action = context.allowedActions.includes("motor_motion_probe") ? "motor_motion_probe" : context.allowedActions[0]!;
    objective = "Measure the motor's physical response safely.";
    rationale = "The bounded motion probe provides the first physical observation needed to narrow the competing hypotheses.";
  }

  return {
    action,
    objective,
    rationale,
    provider: "deterministic",
    model,
    decisionSource: "fallback",
    contextDigest: digest,
    observationIds: context.session.observations.map((observation) => observation.id),
  };
}

function latestMotion(evidence: EvidenceView): boolean | undefined {
  return [...evidence.observations].reverse().find((item) => item.command === "motor_motion_probe")?.motionDetected;
}

export function toDecisionRecord(selection: DecisionSelection, evidence: EvidenceView): DecisionRecord {
  return {
    id: randomUUID(),
    observationIds: selection.observationIds,
    contextDigest: selection.contextDigest,
    candidateHypotheses: evidence.hypotheses.filter((item) => item.support > 0).map((item) => item.hypothesis),
    selectedAction: selection.action,
    objective: selection.objective,
    rationale: selection.rationale,
    provider: selection.provider,
    model: selection.model,
    responseId: selection.responseId,
    createdAt: new Date().toISOString(),
    gatewayValidation: { accepted: false, reasons: ["Pending gateway validation."] },
    decisionSource: selection.decisionSource,
  };
}
