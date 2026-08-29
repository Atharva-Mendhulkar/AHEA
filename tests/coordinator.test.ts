import assert from "node:assert/strict";
import test from "node:test";
import { SimulatorAdapter, type SimulatorFixture } from "../src/adapters/simulator.js";
import { DeterministicFallbackAgent } from "../src/agent/fallback.js";
import { ExperimentCoordinator } from "../src/coordinator.js";
import type { AgentContext, AgentDecision, AgentSelector, SessionSnapshot } from "../src/types.js";

class TestAgent implements AgentSelector {
  readonly mode = "test" as const;
  readonly deployment = "adaptive-test-agent";
  private readonly delegate = new DeterministicFallbackAgent();

  decide(context: AgentContext): Promise<AgentDecision> {
    return this.delegate.decide(context);
  }
}

async function calibratedCoordinator(fixture: SimulatorFixture): Promise<ExperimentCoordinator> {
  const coordinator = new ExperimentCoordinator({
    adapter: new SimulatorAdapter(fixture),
    primaryAgent: new TestAgent(),
    motorCooldownMs: 0,
    activationBudget: 4,
    fixture
  });
  await coordinator.scanHardware();
  await coordinator.startCalibration();
  const calibration = coordinator.snapshot().pendingExperiment;
  assert.ok(calibration);
  await coordinator.approveExperiment(calibration.id);
  assert.equal(coordinator.snapshot().phase, "READY");
  return coordinator;
}

async function approvePending(coordinator: ExperimentCoordinator): Promise<SessionSnapshot> {
  const pending = coordinator.snapshot().pendingExperiment;
  assert.ok(pending);
  return coordinator.approveExperiment(pending.id);
}

test("disconnected flow records observation-dependent current selection and confirms only after two verifications", async () => {
  const coordinator = await calibratedCoordinator("disconnected");
  await coordinator.startDiagnosis("The motor is supposed to run, but nothing is moving. Diagnose it.");
  assert.equal(coordinator.snapshot().pendingExperiment?.tool, "motor_motion_probe");

  await approvePending(coordinator);
  const afterMotion = coordinator.snapshot();
  assert.equal(afterMotion.pendingExperiment?.tool, "motor_current_probe");
  const currentDecision = afterMotion.decisions.at(-1);
  assert.equal(currentDecision?.action.kind, "run_experiment");
  assert.ok(currentDecision?.inputObservationIds.includes(afterMotion.observations.at(-1)!.observationId));
  assert.match(currentDecision?.rationale ?? "", /Current|current/);

  await approvePending(coordinator);
  let state = coordinator.snapshot();
  assert.equal(state.phase, "AWAITING_REPAIR");
  assert.equal(state.diagnosis.confidence, "HIGH CONFIDENCE");
  assert.equal(state.diagnosis.evidenceState, "OPEN_OR_UNENERGIZED_PATH_SUPPORTED");

  await coordinator.declareIntervention("motor_lead_reconnected");
  await approvePending(coordinator);
  state = coordinator.snapshot();
  assert.equal(state.diagnosis.consecutiveVerificationPasses, 1);
  assert.notEqual(state.diagnosis.confidence, "CONFIRMED");
  await approvePending(coordinator);
  state = coordinator.snapshot();
  assert.equal(state.phase, "CONFIRMED");
  assert.equal(state.diagnosis.confidence, "CONFIRMED");
  assert.equal(state.activationsUsed, 4);
  assert.equal(state.mode, "simulation");
  assert.ok(state.observations.every((item) => item.provenance.source === "simulation"));
});

test("healthy observation causes a different next decision", async () => {
  const coordinator = await calibratedCoordinator("healthy");
  await coordinator.startDiagnosis("Motor appears not to move.");
  await approvePending(coordinator);
  const state = coordinator.snapshot();
  assert.equal(state.decisions.at(-1)?.action.kind, "report_not_reproduced");
  assert.notEqual(state.pendingExperiment?.tool, "motor_current_probe");
});

test("invalid motion requests sensor recovery and does not run current", async () => {
  const coordinator = await calibratedCoordinator("sensor_failure");
  await coordinator.startDiagnosis("Motor appears not to move.");
  await approvePending(coordinator);
  const state = coordinator.snapshot();
  assert.equal(state.decisions.at(-1)?.action.kind, "request_sensor_recovery");
  assert.equal(state.pendingExperiment, undefined);
  assert.equal(state.diagnosis.confidence, "UNKNOWN");
});

test("stalled motor selects current but is not classified as an open path", async () => {
  const coordinator = await calibratedCoordinator("stalled");
  await coordinator.startDiagnosis("Motor appears not to move.");
  await approvePending(coordinator);
  assert.equal(coordinator.snapshot().pendingExperiment?.tool, "motor_current_probe");
  await approvePending(coordinator);
  const state = coordinator.snapshot();
  assert.equal(state.diagnosis.evidenceState, "ENERGIZED_STALL_SUPPORTED");
  assert.notEqual(state.diagnosis.hypothesisSupport.open_or_unenergized_motor_path, "HIGH CONFIDENCE");
});

test("emergency stop latches and rejects further activity", async () => {
  const coordinator = await calibratedCoordinator("disconnected");
  await coordinator.emergencyStop();
  const state = coordinator.snapshot();
  assert.equal(state.phase, "STOPPED");
  assert.equal(state.emergencyStopLatched, true);
  await assert.rejects(() => coordinator.startDiagnosis("Motor failed."));
});

test("five consecutive simulated disconnected repair rehearsals succeed", async () => {
  for (let run = 0; run < 5; run += 1) {
    const coordinator = await calibratedCoordinator("disconnected");
    await coordinator.startDiagnosis("The motor is supposed to run, but nothing is moving. Diagnose it.");
    await approvePending(coordinator);
    await approvePending(coordinator);
    await coordinator.declareIntervention("motor_lead_reconnected");
    await approvePending(coordinator);
    await approvePending(coordinator);
    assert.equal(coordinator.snapshot().diagnosis.confidence, "CONFIRMED", `rehearsal ${run + 1}`);
  }
});
