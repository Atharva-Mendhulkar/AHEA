import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { deriveEvidence } from "../server/evidence.js";
import { runDiagnostic, setup } from "./helpers.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
describe("deterministic loopback evidence", () => {
  it("supports an open-path diagnosis only after source and endpoint evidence", async () => {
    const value = await setup("loopback_open"); roots.push(value.root); const session = await runDiagnostic(value.coordinator, value.session);
    expect(session.lifecycle).toBe("DIAGNOSIS_READY"); expect(session.evidence.state).toBe("PATH_OPEN_SUPPORTED"); expect(session.evidence.confidence).toBe("HIGH_CONFIDENCE");
    expect(session.evidence.conclusion?.disposition).toBe("ADJUST_AND_RETEST");
    expect(session.decisions.map((entry) => entry.selectedAction)).toEqual(["observe_destination", "observe_source", "compare_endpoints", "request_intervention"]);
    expect(session.evidence.recommendations[0]?.kind).toBe("restore_loopback_path");
  });
  it("concludes normal without inventing an intervention", async () => {
    const value = await setup("loopback_intact"); roots.push(value.root); const session = await runDiagnostic(value.coordinator, value.session);
    expect(session.lifecycle).toBe("CONCLUDED_NORMAL"); expect(session.evidence.state).toBe("NORMAL"); expect(session.intervention).toBeUndefined();
    expect(session.evidence.conclusion?.disposition).toBe("READY_TO_USE");
    expect(session.decisions.map((entry) => entry.selectedAction)).toEqual(["observe_destination", "compare_endpoints", "conclude_normal"]);
  });
  it("separates destination distortion from the source before diagnosis", async () => {
    const value = await setup("loopback_distorted"); roots.push(value.root); const session = await runDiagnostic(value.coordinator, value.session);
    expect(session.lifecycle).toBe("DIAGNOSIS_READY"); expect(session.evidence.state).toBe("SIGNAL_PATH_FAULT_SUPPORTED");
    expect(session.decisions.map((entry) => entry.selectedAction)).toEqual(["observe_destination", "observe_source", "measure_timing", "request_intervention"]);
  });
  it("stops inconclusive for a malformed source", async () => {
    const value = await setup("loopback_stimulus_fault"); roots.push(value.root); const session = await runDiagnostic(value.coordinator, value.session);
    expect(session.lifecycle).toBe("INCONCLUSIVE"); expect(session.evidence.state).toBe("SOURCE_MALFORMED"); expect(session.evidence.recommendations).toEqual([]);
  });
  it("bounds conflicting captures before stopping inconclusive", async () => {
    const value = await setup("loopback_conflicting"); roots.push(value.root); const session = await runDiagnostic(value.coordinator, value.session);
    expect(session.lifecycle).toBe("INCONCLUSIVE"); expect(session.evidence.state).toBe("CONFLICTING_EVIDENCE");
    expect(session.observations.filter((entry) => entry.planId.includes("repeat-synchronized"))).toHaveLength(2);
  });
  it("replaces the adjustment verdict after two passing physical verification runs", async () => {
    const value = await setup("loopback_open"); roots.push(value.root); let session = await runDiagnostic(value.coordinator, value.session); const recommendation = session.evidence.recommendations[0]!;
    session = await value.coordinator.declareIntervention(session.id, "Powered down and installed the removable jumper.", recommendation.id, true);
    session = await value.coordinator.executePending(session.id, session.pendingDecision!.id, session.version, true, "Fixture restored and powered.");
    session = await value.coordinator.executePending(session.id, session.pendingDecision!.id, session.version, true, "Fixture restored and powered.");
    const physicalEvidence = deriveEvidence(session.observations, session.projectContext, session.targetId, true, "physical");
    expect(physicalEvidence.verification.status).toBe("PASSED");
    expect(physicalEvidence.conclusion?.disposition).toBe("READY_TO_USE");
    expect(physicalEvidence.conclusion?.headline).toMatch(/Repair verified/i);
    expect(physicalEvidence.conclusion?.adjustments).toEqual([]);
  });
});
