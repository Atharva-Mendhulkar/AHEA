import assert from "node:assert/strict";
import test from "node:test";
import { validateAgentAction } from "../src/domain/safety.js";
import type { SessionSnapshot } from "../src/types.js";

function session(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    id: "session",
    mode: "simulation",
    phase: "DIAGNOSING",
    problem: "Motor failed",
    observations: [],
    decisions: [],
    diagnosis: {
      evidenceState: "INSUFFICIENT_EVIDENCE",
      confidence: "UNKNOWN",
      hypothesisSupport: {
        open_or_unenergized_motor_path: "UNKNOWN",
        mechanical_stall: "UNKNOWN",
        driver_control_failure: "UNKNOWN",
        motion_sensor_or_mounting_failure: "UNKNOWN"
      },
      consecutiveVerificationPasses: 0
    },
    activationsUsed: 0,
    activationBudget: 4,
    emergencyStopLatched: false,
    fallbackMode: false,
    statusMessage: "",
    ...overrides
  };
}

test("activation fails closed without calibration", () => {
  const result = validateAgentAction(session(), { kind: "run_experiment", tool: "motor_motion_probe" });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /calibration/i);
});

test("emergency-stop latch rejects all agent activity", () => {
  const result = validateAgentAction(session({ emergencyStopLatched: true }), { kind: "finish" });
  assert.equal(result.allowed, false);
});

test("activation budget is enforced", () => {
  const result = validateAgentAction(session({
    calibration: {
      id: "cal",
      source: "simulation",
      createdAt: new Date().toISOString(),
      idleCurrentMa: 2,
      healthyCurrentMa: 180,
      baselineMotionRmsG: 0.01,
      healthyMotionRmsG: 0.2
    },
    activationsUsed: 4
  }), { kind: "run_experiment", tool: "motor_motion_probe" });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /budget/i);
});

test("repair request is rejected before deterministic evidence supports it", () => {
  const result = validateAgentAction(session(), { kind: "request_repair" });
  assert.equal(result.allowed, false);
});
