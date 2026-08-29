import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { validateExperiment } from "../server/gateway.js";
import { setup } from "./helpers.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
describe("experiment safety gateway", () => {
  it("requires setup confirmation and rejects invented experiments", async () => {
    const value = await setup(); roots.push(value.root); const session = await value.coordinator.submitProblem(value.session.id, "FSR5 is abnormal."); const pending = session.pendingDecision!.experiment;
    expect(validateExperiment({ ...session, pendingDecision: undefined }, pending, false).accepted).toBe(false);
    expect(validateExperiment({ ...session, pendingDecision: undefined }, { ...pending, id: "invented", planId: "raw-gpio-17" }, true).accepted).toBe(false);
    expect(validateExperiment({ ...session, pendingDecision: undefined }, { ...pending, planId: "raw-gpio-17" }, true).accepted).toBe(false);
  });
  it("fails closed when the experiment budget is exhausted", async () => {
    const value = await setup(); roots.push(value.root); const session = await value.coordinator.submitProblem(value.session.id, "FSR5 is abnormal."); session.experimentsExecuted = session.projectContext.constraints.maximumExperiments;
    expect(validateExperiment({ ...session, pendingDecision: undefined }, session.pendingDecision!.experiment, true).reasons.join(" ")).toMatch(/budget/);
  });
});
