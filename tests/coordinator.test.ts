import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Coordinator, DomainError } from "../server/coordinator.js";
import { JsonStore } from "../server/store.js";
import { fallbackDecision, type DecisionClient, type DecisionContext } from "../server/agent.js";

class ScriptedAgent implements DecisionClient {
  calls: DecisionContext[] = [];
  async decide(context: DecisionContext) {
    this.calls.push(context);
    return fallbackDecision(context, `digest-${this.calls.length}`, "scripted");
  }
  clear() {}
}

const directories: string[] = [];
async function setup(fixture: "disconnected" | "healthy" | "sensor_failure" = "disconnected") {
  const root = await mkdtemp(path.join(tmpdir(), "ahea-test-"));
  directories.push(root);
  const agent = new ScriptedAgent();
  const coordinator = new Coordinator({
    store: new JsonStore(root), agent, physicalEnabled: false,
    now: () => new Date(Date.now() + 60_000),
  });
  const session = await coordinator.createSession("simulation", fixture);
  return { coordinator, agent, session };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("coordinator", () => {
  it("runs the disconnected fault through two-pass confirmation", async () => {
    const { coordinator, session } = await setup();
    let current = await coordinator.submitProblem(session.id, "The motor should run but does not move.");
    expect(current.pendingDecision?.action).toBe("motor_motion_probe");
    current = await coordinator.executePending(current.id, current.pendingDecision!.id, current.version);
    expect(current.pendingDecision?.action).toBe("motor_current_probe");
    current = await coordinator.executePending(current.id, current.pendingDecision!.id, current.version);
    expect(current.lifecycle).toBe("AWAITING_INTERVENTION");
    expect(current.evidence.confidenceLabel).toBe("HIGH CONFIDENCE");
    current = await coordinator.declareIntervention(current.id, "Reconnected the motor lead.");
    current = await coordinator.executePending(current.id, current.pendingDecision!.id, current.version);
    expect(current.consecutiveVerificationPasses).toBe(1);
    current = await coordinator.executePending(current.id, current.pendingDecision!.id, current.version);
    expect(current.lifecycle).toBe("CONFIRMED");
    expect(current.totalActivations).toBe(4);
    expect((await coordinator.report(current.id)).confidence).toBe("CONFIRMED");
  });

  it("rejects stale and duplicate approvals", async () => {
    const { coordinator, session } = await setup();
    const current = await coordinator.submitProblem(session.id, "Motor does not move.");
    const originalDecisionId = current.pendingDecision!.id;
    await expect(coordinator.executePending(current.id, originalDecisionId, current.version - 1)).rejects.toBeInstanceOf(DomainError);
    const completed = await coordinator.executePending(current.id, originalDecisionId, current.version);
    await expect(coordinator.executePending(completed.id, originalDecisionId, completed.version)).rejects.toBeInstanceOf(DomainError);
  });

  it("demonstrates divergent decisions for valid and invalid motion", async () => {
    const healthy = await setup("healthy");
    let healthySession = await healthy.coordinator.submitProblem(healthy.session.id, "Motor does not move.");
    healthySession = await healthy.coordinator.executePending(healthySession.id, healthySession.pendingDecision!.id, healthySession.version);
    expect(healthySession.failureReason).toMatch(/not reproduced/);
    expect(healthySession.decisions.at(-1)?.selectedAction).toBe("report_fault_not_reproduced");

    const failed = await setup("sensor_failure");
    let failedSession = await failed.coordinator.submitProblem(failed.session.id, "Motor does not move.");
    failedSession = await failed.coordinator.executePending(failedSession.id, failedSession.pendingDecision!.id, failedSession.version);
    expect(failedSession.failureReason).toMatch(/Sensor recovery/);
    expect(failedSession.decisions.at(-1)?.selectedAction).toBe("request_sensor_recovery");
  });

  it("makes emergency stop terminal and clears pending execution", async () => {
    const { coordinator, session } = await setup();
    const current = await coordinator.submitProblem(session.id, "Motor does not move.");
    const stopped = await coordinator.emergencyStop(current.id);
    expect(stopped.lifecycle).toBe("ESTOPPED");
    expect(stopped.pendingDecision).toBeUndefined();
    expect(stopped.hardware.estopLatched).toBe(true);
  });
});
