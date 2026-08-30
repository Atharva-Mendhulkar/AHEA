import { describe, expect, it } from "vitest";
import { GeminiDecisionClient } from "../server/agent.js";
import { buildEligibleExperiments } from "../server/modules.js";
import { setup } from "./helpers.js";

const enabled = process.env.AHEA_LIVE_GEMINI === "1" && Boolean(process.env.GEMINI_API_KEY);
describe.skipIf(!enabled)("live Gemini experiment selection", () => {
  it("selects only a backend-offered opaque experiment", async () => {
    const value = await setup(); const session = await value.coordinator.submitProblem(value.session.id, "Destination waveform is missing."); const client = new GeminiDecisionClient(process.env.GEMINI_MODEL ?? "gemini-2.5-flash"); const eligibleExperiments = buildEligibleExperiments({ ...session, pendingDecision: undefined }); const selection = await client.decide({ session: { ...session, pendingDecision: undefined }, eligibleExperiments });
    expect(eligibleExperiments.some((entry) => entry.id === selection.experimentId)).toBe(true); expect(selection.provider).toBe("gemini");
  }, 120000);
});
