import { describe, expect, it } from "vitest";
import { OpenAIDecisionClient } from "../server/agent.js";
import { buildEligibleExperiments } from "../server/modules.js";
import { setup } from "./helpers.js";

const enabled = process.env.AHEA_LIVE_OPENAI === "1" && Boolean(process.env.OPENAI_API_KEY);
describe.skipIf(!enabled)("live OpenAI experiment selection", () => {
  it("selects only a backend-offered opaque experiment", async () => {
    const value = await setup(); const session = await value.coordinator.submitProblem(value.session.id, "Destination waveform is missing."); const client = new OpenAIDecisionClient(process.env.OPENAI_MODEL ?? "gpt-5-mini"); const eligibleExperiments = buildEligibleExperiments({ ...session, pendingDecision: undefined }); const selection = await client.decide({ session: { ...session, pendingDecision: undefined }, eligibleExperiments });
    expect(eligibleExperiments.some((entry) => entry.id === selection.experimentId)).toBe(true); expect(selection.responseId).toMatch(/^resp_/);
  }, 120000);
});
