import { AzureOpenAI } from "openai";
import type {
  AgentAction,
  AgentContext,
  AgentDecision,
  AgentSelector,
  Hypothesis
} from "../types.js";

const hypothesisNames: Hypothesis[] = [
  "open_or_unenergized_motor_path",
  "mechanical_stall",
  "driver_control_failure",
  "motion_sensor_or_mounting_failure"
];

const decisionProperties = {
  candidate_hypotheses: {
    type: "array",
    items: { type: "string", enum: hypothesisNames }
  },
  objective: { type: "string" },
  rationale: { type: "string" }
} as const;

const tool = (name: string, description: string) => ({
  type: "function" as const,
  name,
  description,
  strict: true,
  parameters: {
    type: "object",
    properties: decisionProperties,
    required: ["candidate_hypotheses", "objective", "rationale"],
    additionalProperties: false
  }
});

const tools = [
  tool("motor_motion_probe", "Run the fixed motor pulse and measure the calibrated motor-induced motion signature."),
  tool("motor_current_probe", "Run the fixed motor pulse and measure diagnostic motor-path current."),
  tool("verify_motor", "After a declared intervention, measure calibrated current and motion together."),
  tool("request_repair", "Ask the user to inspect and restore a suspected open or unenergized motor path."),
  tool("report_not_reproduced", "Report that the expected physical response was observed."),
  tool("request_sensor_recovery", "Ask the user to repair or remount an unhealthy motion sensor."),
  tool("finish", "Finish because no further safe experiment is justified.")
];

export interface AzureAgentOptions {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
}

export class AzureAgentSelector implements AgentSelector {
  readonly mode = "azure" as const;
  readonly deployment: string;
  private readonly client: AzureOpenAI;

  constructor(options: AzureAgentOptions) {
    this.deployment = options.deployment;
    this.client = new AzureOpenAI(options);
  }

  async decide(context: AgentContext): Promise<AgentDecision> {
    const input = JSON.stringify({
      problem: context.problem,
      calibration: context.calibration,
      evidence_state: context.evidenceState,
      backend_confidence: context.confidence,
      intervention_declared: context.interventionDeclared,
      consecutive_verification_passes: context.consecutiveVerificationPasses,
      observations: context.observations.map((observation) => ({
        observation_id: observation.observationId,
        experiment: observation.tool,
        source: observation.provenance.source,
        classifications: observation.classification,
        measurements: observation.measurements
      }))
    });

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.client.responses.create({
          model: this.deployment,
          instructions:
            "Select exactly one bounded action. Base it only on supplied observations. " +
            "Do not provide confidence labels, hardware parameters, or hidden reasoning. " +
            "Use rationale for one concise evidence-based explanation.",
          input,
          tools,
          tool_choice: "required",
          parallel_tool_calls: false
        });
        const call = response.output.find((item) => item.type === "function_call");
        if (!call || call.type !== "function_call") throw new Error("Model returned no decision tool call.");
        const args = JSON.parse(call.arguments) as Record<string, unknown>;
        return {
          action: actionForTool(call.name),
          candidateHypotheses: validateHypotheses(args.candidate_hypotheses),
          objective: validateBriefText(args.objective, "objective"),
          rationale: validateBriefText(args.rationale, "rationale"),
          providerResponseId: response.id
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Azure agent decision failed.");
  }
}

function actionForTool(name: string): AgentAction {
  if (name === "motor_motion_probe" || name === "motor_current_probe" || name === "verify_motor") {
    return { kind: "run_experiment", tool: name };
  }
  if (
    name === "request_repair" ||
    name === "report_not_reproduced" ||
    name === "request_sensor_recovery" ||
    name === "finish"
  ) {
    return { kind: name };
  }
  throw new Error(`Unsupported model action: ${name}`);
}

function validateHypotheses(value: unknown): Hypothesis[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("Candidate hypotheses are required.");
  const names = value.filter((item): item is Hypothesis =>
    typeof item === "string" && hypothesisNames.includes(item as Hypothesis)
  );
  if (names.length !== value.length) throw new Error("Model returned an unknown hypothesis.");
  return names;
}

function validateBriefText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length < 3 || value.length > 300) {
    throw new Error(`Invalid ${field}.`);
  }
  return value.trim();
}
