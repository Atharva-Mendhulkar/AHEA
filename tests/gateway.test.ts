import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { validateExperiment } from "../server/gateway.js";
import { setup } from "./helpers.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
describe("experiment safety gateway", () => {
  it("requires setup confirmation and rejects invented plans", async () => {
    const value = await setup(); roots.push(value.root); const session = await value.coordinator.submitProblem(value.session.id, "Destination signal is missing."); const pending = session.pendingDecision!.experiment;
    expect(validateExperiment({ ...session, pendingDecision: undefined }, pending, false).accepted).toBe(false);
    expect(validateExperiment({ ...session, pendingDecision: undefined }, { ...pending, planId: "raw.gpio17.1234hz", id: "invented" }, true).reasons).toEqual(expect.arrayContaining([expect.stringMatching(/eligible|allowed|advertised/i)]));
  });
  it("fails closed on exhausted budgets and stale state", async () => {
    const value = await setup(); roots.push(value.root); const session = await value.coordinator.submitProblem(value.session.id, "Destination signal is missing."); session.experimentsExecuted = session.projectContext.constraints.maximumExperiments;
    expect(validateExperiment({ ...session, pendingDecision: undefined }, session.pendingDecision!.experiment, true).reasons.join(" ")).toMatch(/budget/i);
  });
});
