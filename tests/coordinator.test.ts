import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { DomainError } from "../server/coordinator.js";
import type { HardwareAdapter } from "../server/adapters/adapter.js";
import { runDiagnostic, setup } from "./helpers.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
describe("coordinator lifecycle and provenance", () => {
  it("starts with destination observation and records complete provenance", async () => {
    const value = await setup(); roots.push(value.root); let session = await value.coordinator.submitProblem(value.session.id, "Destination is missing.");
    expect(session.pendingDecision?.experiment.type).toBe("observe_destination"); session = await value.coordinator.startInvestigation(session.id); expect(session.agentState).toBe("READY_TO_EXECUTE");
    session = await value.coordinator.advanceInvestigation(session.id); const observation = session.observations[0]!;
    expect(observation).toMatchObject({ source: "simulation", adapter: "simulator", targetId: "loopback-path", planId: "loopback.observe-destination.1khz.v1", projectContextDigest: session.projectContextDigest, registryDigest: session.hardware.registry.digest });
    expect(observation.bindingIds).toEqual(["gpio4_stimulus", "gpio6_destination_observer"]); expect(observation.gatewayValidation.accepted).toBe(true); expect(observation.limitations.join(" ")).toMatch(/simulated/i);
  });
  it("requires a supported recommendation and human safety declaration", async () => {
    const value = await setup(); roots.push(value.root); const session = await runDiagnostic(value.coordinator, value.session); const recommendation = session.evidence.recommendations[0]!;
    await expect(value.coordinator.declareIntervention(session.id, "Installed jumper.", "invented", true)).rejects.toBeInstanceOf(DomainError);
    await expect(value.coordinator.declareIntervention(session.id, "Installed jumper.", recommendation.id, false)).rejects.toBeInstanceOf(DomainError);
  });
  it("requires two runs but never physically confirms simulation", async () => {
    const value = await setup(); roots.push(value.root); let session = await runDiagnostic(value.coordinator, value.session); const recommendation = session.evidence.recommendations[0]!;
    session = await value.coordinator.declareIntervention(session.id, "Powered down and installed the removable jumper.", recommendation.id, true);
    session = await value.coordinator.executePending(session.id, session.pendingDecision!.id, session.version, true, "Fixture restored and powered."); expect(session.evidence.verification.consecutivePasses).toBe(1); expect(session.lifecycle).toBe("VERIFYING");
    session = await value.coordinator.executePending(session.id, session.pendingDecision!.id, session.version, true, "Fixture restored and powered."); expect(session.evidence.verification.status).toBe("SIMULATED_PASS"); expect(session.lifecycle).toBe("INCONCLUSIVE"); expect(session.lifecycle).not.toBe("CONFIRMED");
  });
  it("reports failed verification after repeated failed runs", async () => {
    const value = await setup("loopback_verification_failure"); roots.push(value.root); let session = await runDiagnostic(value.coordinator, value.session); const recommendation = session.evidence.recommendations[0]!;
    session = await value.coordinator.declareIntervention(session.id, "Inspected and reseated the jumper.", recommendation.id, true);
    session = await value.coordinator.executePending(session.id, session.pendingDecision!.id, session.version, true, "Fixture powered.");
    session = await value.coordinator.executePending(session.id, session.pendingDecision!.id, session.version, true, "Fixture powered.");
    expect(session.lifecycle).toBe("FAILED_VERIFICATION"); expect(session.evidence.verification.status).toBe("FAILED");
  });
  it("keeps monitoring out of deterministic evidence and diagnostic budgets", async () => {
    const value = await setup("loopback_intact"); roots.push(value.root); const result = await value.coordinator.captureLiveReading(value.session.id); const session = await value.coordinator.getSession(value.session.id);
    expect(result.observation.phase).toBe("monitoring"); expect(session.monitoringReads).toBe(1); expect(session.experimentsExecuted).toBe(0); expect(session.evidence.state).toBe("INSUFFICIENT_EVIDENCE");
  });
  it("rejects stale, duplicate, and unconfirmed executions", async () => {
    const value = await setup(); roots.push(value.root); const session = await value.coordinator.submitProblem(value.session.id, "Destination is missing."); const decisionId = session.pendingDecision!.id;
    await expect(value.coordinator.executePending(session.id, decisionId, session.version, false)).rejects.toBeInstanceOf(DomainError);
    await expect(value.coordinator.executePending(session.id, decisionId, session.version, true)).rejects.toThrow(/setup declaration/i);
    await expect(value.coordinator.executePending(session.id, decisionId, session.version - 1, true)).rejects.toBeInstanceOf(DomainError);
    const completed = await value.coordinator.executePending(session.id, decisionId, session.version, true, "Fixture confirmed.");
    await expect(value.coordinator.executePending(completed.id, decisionId, completed.version, true)).rejects.toBeInstanceOf(DomainError);
  });
  it("rejects mixed physical and simulation provenance and fails closed", async () => {
    const value = await setup(); roots.push(value.root); const session = await value.coordinator.submitProblem(value.session.id, "Destination is missing.");
    const internals = value.coordinator as unknown as { adapters: Map<string, HardwareAdapter> };
    const adapter = internals.adapters.get(session.id)!;
    const execute = adapter.execute.bind(adapter);
    adapter.execute = async (experiment, context) => ({ ...(await execute(experiment, context)), source: "physical", adapter: "esp32" });
    await expect(value.coordinator.executePending(session.id, session.pendingDecision!.id, session.version, true, "Fixture confirmed.")).rejects.toThrow(/provenance/i);
    const interrupted = await value.coordinator.getSession(session.id);
    expect(interrupted.lifecycle).toBe("INTERRUPTED");
    expect(interrupted.observations).toHaveLength(0);
    expect(interrupted.failureReason).toMatch(/provenance/i);
  });
});
