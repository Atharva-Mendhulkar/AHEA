import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { DomainError } from "../server/coordinator.js";
import { runDiagnostic, setup } from "./helpers.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
describe("adaptive coordinator", () => {
  it("runs the bounded investigation from one start action and stops for intervention", async () => {
    const value = await setup(); roots.push(value.root);
    let session = await value.coordinator.submitProblem(value.session.id, "FSR5 is abnormal.");
    session = await value.coordinator.startInvestigation(session.id);
    expect(session.agentState).toBe("INITIALIZING");
    for (let guard = 0; ["INITIALIZING", "WAITING_FOR_USER_STIMULUS", "RECORDING", "ANALYZING", "SELECTING_NEXT_EXPERIMENT"].includes(session.agentState) && guard < 100; guard += 1) session = await value.coordinator.advanceInvestigation(session.id);
    expect(session.agentState).toBe("WAITING_FOR_INTERVENTION");
    expect(session.lifecycle).toBe("AWAITING_INTERVENTION");
    expect(session.evidence.recommendations[0]?.kind).toBe("resistor_substitution");
    expect(session.monitoringReads).toBeGreaterThan(0);
  });
  it("stops a healthy sensor investigation and exposes project-level checks", async () => {
    const value = await setup("fsr_balanced"); roots.push(value.root);
    let session = await value.coordinator.submitProblem(value.session.id, "FSR5 is abnormal.");
    session = await value.coordinator.startInvestigation(session.id);
    for (let guard = 0; ["INITIALIZING", "WAITING_FOR_USER_STIMULUS", "RECORDING", "ANALYZING", "SELECTING_NEXT_EXPERIMENT"].includes(session.agentState) && guard < 100; guard += 1) session = await value.coordinator.advanceInvestigation(session.id);
    expect(session.agentState).toBe("DIAGNOSIS_READY");
    expect(session.evidence.state).toBe("NORMAL");
    expect(session.evidence.projectLevelChecks).toEqual(expect.arrayContaining([expect.stringMatching(/threshold/i), expect.stringMatching(/channel/i)]));
  });
  it("automatically enters post-intervention verification and reaches a verified result", async () => {
    const value = await setup(); roots.push(value.root);
    let session = await value.coordinator.submitProblem(value.session.id, "FSR5 is abnormal.");
    session = await value.coordinator.startInvestigation(session.id);
    for (let guard = 0; session.agentState !== "WAITING_FOR_INTERVENTION" && guard < 100; guard += 1) session = await value.coordinator.advanceInvestigation(session.id);
    session = await value.coordinator.declareIntervention(session.id, "Replaced the divider resistor.", session.evidence.recommendations[0]!.id);
    expect(session.agentState).toBe("POST_INTERVENTION_VERIFY");
    for (let guard = 0; ["POST_INTERVENTION_VERIFY", "INITIALIZING", "WAITING_FOR_USER_STIMULUS", "RECORDING", "ANALYZING", "SELECTING_NEXT_EXPERIMENT"].includes(session.agentState) && guard < 40; guard += 1) session = await value.coordinator.advanceInvestigation(session.id);
    expect(session.agentState).toBe("CONFIRMED");
    expect(session.evidence.verificationStatus).toBe("PASSED");
  });
  it("stops automatically when the bounded stimulus window remains unstable", async () => {
    const value = await setup("fsr_noisy"); roots.push(value.root);
    let session = await value.coordinator.submitProblem(value.session.id, "FSR5 is unstable.");
    session = await value.coordinator.startInvestigation(session.id);
    for (let guard = 0; ["INITIALIZING", "WAITING_FOR_USER_STIMULUS", "RECORDING", "ANALYZING", "SELECTING_NEXT_EXPERIMENT"].includes(session.agentState) && guard < 100; guard += 1) session = await value.coordinator.advanceInvestigation(session.id);
    expect(session.agentState).toBe("INCONCLUSIVE");
    expect(session.failureReason).toMatch(/unstable/i);
    expect(session.activeExperiment?.probeReads).toBe(8);
  });
  it("observes the reported subject first, then builds the reference comparison", async () => {
    const value = await setup(); roots.push(value.root); const session = await runDiagnostic(value.coordinator, value.session);
    expect(session.observations[0]?.deviceId).toBe("fsr5"); expect(session.lifecycle).toBe("AWAITING_INTERVENTION"); expect(session.decisions.at(-1)?.selectedAction).toBe("request_intervention");
  });
  it("produces a different terminal decision for balanced observations", async () => {
    const value = await setup("fsr_balanced"); roots.push(value.root); const session = await runDiagnostic(value.coordinator, value.session);
    expect(session.lifecycle).toBe("CONCLUDED"); expect(session.decisions.at(-1)?.selectedAction).toBe("conclude_normal");
  });
  it("requires the recommendation and two post-intervention passes", async () => {
    const value = await setup(); roots.push(value.root); let session = await runDiagnostic(value.coordinator, value.session);
    await expect(value.coordinator.declareIntervention(session.id, "Changed the divider resistor.")).rejects.toBeInstanceOf(DomainError);
    const recommendation = session.evidence.recommendations[0]!;
    session = await value.coordinator.declareIntervention(session.id, "Changed the divider resistor.", recommendation.id);
    session = await value.coordinator.executePending(session.id, session.pendingDecision!.id, session.version, true); expect(session.consecutiveVerificationPasses).toBe(1);
    session = await value.coordinator.executePending(session.id, session.pendingDecision!.id, session.version, true);
    expect(session.evidence.verificationStatus).toBe("PASSED"); expect(session.lifecycle).toBe("CONCLUDED"); expect(session.failureReason).toMatch(/physical confirmation/);
  });
  it("rejects stale, duplicate, and unconfirmed manual-stimulus approvals", async () => {
    const value = await setup(); roots.push(value.root); const session = await value.coordinator.submitProblem(value.session.id, "FSR5 is abnormal.");
    const originalDecisionId = session.pendingDecision!.id;
    await expect(value.coordinator.executePending(session.id, originalDecisionId, session.version, false)).rejects.toBeInstanceOf(DomainError);
    await expect(value.coordinator.executePending(session.id, originalDecisionId, session.version - 1, true)).rejects.toBeInstanceOf(DomainError);
    const completed = await value.coordinator.executePending(session.id, originalDecisionId, session.version, true);
    await expect(value.coordinator.executePending(completed.id, originalDecisionId, completed.version, true)).rejects.toBeInstanceOf(DomainError);
  });
  it("rejects mixed physical and simulation provenance", async () => {
    const value = await setup(); roots.push(value.root); const session = await value.coordinator.submitProblem(value.session.id, "FSR5 is abnormal.");
    session.mode = "physical";
    await expect(value.coordinator.executePending(session.id, session.pendingDecision!.id, session.version, true)).rejects.toBeInstanceOf(DomainError);
  });
  it("records bounded live readings without using them as diagnostic evidence", async () => {
    const value = await setup(); roots.push(value.root);
    const result = await value.coordinator.captureLiveReading(value.session.id, "motion1");
    expect(result.observation.phase).toBe("monitoring"); expect(result.observation.measurements.some((item) => item.channel === "acceleration_magnitude_g")).toBe(true);
    const session = await value.coordinator.getSession(value.session.id);
    expect(session.monitoringReads).toBe(1); expect(session.experimentsExecuted).toBe(0); expect(session.evidence.state).toBe("INSUFFICIENT_EVIDENCE");
  });
});
