import { describe, expect, it } from "vitest";
import { OpenAIDecisionClient } from "../server/agent.js";
import { buildEligibleExperiments } from "../server/modules.js";
import { setup } from "./helpers.js";

const enabled = process.env.AHEA_LIVE_OPENAI === "1" && Boolean(process.env.OPENAI_API_KEY);
describe.skipIf(!enabled)("live OpenAI experiment selection", () => {
  it("selects a backend-offered experiment and records a response ID", async () => {
    const value = await setup(); const session = await value.coordinator.submitProblem(value.session.id, "FSR5 differs from the references."); const client = new OpenAIDecisionClient(process.env.OPENAI_MODEL ?? "gpt-5-mini"); const eligibleExperiments = buildEligibleExperiments({ ...session, pendingDecision: undefined }); const selection = await client.decide({ session: { ...session, pendingDecision: undefined }, eligibleExperiments });
    expect(eligibleExperiments.some((item) => item.id === selection.experimentId)).toBe(true); expect(selection.responseId).toMatch(/^resp_/);
  }, 120_000);
});
