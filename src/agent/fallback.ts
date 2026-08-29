import type { AgentContext, AgentDecision, AgentSelector, Hypothesis } from "../types.js";

const allHypotheses: Hypothesis[] = [
  "open_or_unenergized_motor_path",
  "mechanical_stall",
  "driver_control_failure",
  "motion_sensor_or_mounting_failure"
];

export class DeterministicFallbackAgent implements AgentSelector {
  readonly mode = "fallback" as const;
  readonly deployment = "deterministic-fallback";

  async decide(context: AgentContext): Promise<AgentDecision> {
    const last = context.observations.at(-1);
    if (context.confidence === "CONFIRMED") {
      return this.decision(
        { kind: "finish" },
        "Finish the investigation",
        "The backend has permitted confirmation after two passing verification trials."
      );
    }
    if (context.interventionDeclared) {
      return this.decision(
        { kind: "run_experiment", tool: "verify_motor" },
        "Verify the declared intervention",
        "Current and motion must both return to calibrated healthy ranges."
      );
    }
    if (context.evidenceState === "OPEN_OR_UNENERGIZED_PATH_SUPPORTED") {
      return this.decision(
        { kind: "request_repair" },
        "Inspect and restore the motor power path",
        "Absent motion and near-idle current support an open or unenergized path, without locating the exact break."
      );
    }
    if (!last) {
      return this.decision(
        { kind: "run_experiment", tool: "motor_motion_probe" },
        "Observe the physical response to a bounded motor command",
        "A calibrated motion response establishes whether the reported failure is reproduced."
      );
    }
    if (last.classification.includes("MOTION_MEASUREMENT_INVALID")) {
      return this.decision(
        { kind: "request_sensor_recovery" },
        "Restore valid motion sensing",
        "Invalid motion evidence cannot support a current-dependent diagnosis."
      );
    }
    if (last.classification.includes("MOTION_SIGNATURE_DETECTED")) {
      return this.decision(
        { kind: "report_not_reproduced" },
        "Report the observed healthy physical response",
        "The expected calibrated motion signature was present, so the stated failure was not reproduced."
      );
    }
    if (last.classification.includes("MOTION_SIGNATURE_ABSENT")) {
      return this.decision(
        { kind: "run_experiment", tool: "motor_current_probe" },
        "Distinguish an unenergized path from an energized stall",
        "Current provides electrical evidence that the motion measurement cannot provide."
      );
    }
    return this.decision(
      { kind: "finish" },
      "Stop without overstating the evidence",
      "The available evidence does not justify another bounded experiment."
    );
  }

  private decision(
    action: AgentDecision["action"],
    objective: string,
    rationale: string
  ): AgentDecision {
    return { action, candidateHypotheses: allHypotheses, objective, rationale };
  }
}
