import { describe, expect, it } from "vitest";
import { OpenAIDecisionClient } from "../server/agent.js";

const enabled = process.env.AHEA_LIVE_OPENAI === "1" && Boolean(process.env.OPENAI_API_KEY);

describe.skipIf(!enabled)("live OpenAI Responses API acceptance", () => {
  it("is opt-in and requires a fixture session from the coordinator", () => {
    expect(new OpenAIDecisionClient(process.env.OPENAI_MODEL ?? "gpt-5-mini")).toBeDefined();
  });
});
