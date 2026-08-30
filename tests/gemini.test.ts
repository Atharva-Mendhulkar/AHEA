import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiDecisionClient } from "../server/agent.js";
import { buildEligibleExperiments } from "../server/modules.js";
import { setup } from "./helpers.js";

const roots: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function decisionContext() {
  const value = await setup(); roots.push(value.root);
  const session = await value.coordinator.submitProblem(value.session.id, "Destination waveform is missing.");
  const withoutPending = { ...session, pendingDecision: undefined };
  return { session: withoutPending, eligibleExperiments: buildEligibleExperiments(withoutPending) };
}

describe("Gemini decision client", () => {
  it("uses structured output and accepts only an offered experiment", async () => {
    const context = await decisionContext(); const selected = context.eligibleExperiments[0]!;
    const fetchMock = vi.fn(async (_url: string | URL | Request, _request: RequestInit) => new Response(JSON.stringify({ responseId: "gemini-response-1", candidates: [{ content: { parts: [{ text: JSON.stringify({ experimentId: selected.id, objective: selected.label, rationale: selected.description }) }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new GeminiDecisionClient("gemini-2.5-flash", "test-key").decide(context);
    expect(result).toMatchObject({ experimentId: selected.id, provider: "gemini", decisionSource: "gemini", responseId: "gemini-response-1" });
    const [url, request] = fetchMock.mock.calls[0]!; expect(String(url)).toContain("gemini-2.5-flash:generateContent"); expect((request.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    const body = JSON.parse(String(request.body)); expect(body.generationConfig.responseSchema.properties.experimentId.enum).toEqual(context.eligibleExperiments.map((entry) => entry.id));
  });

  it("fails closed to the deterministic selector after malformed responses", async () => {
    const context = await decisionContext(); const fetchMock = vi.fn(async (_url: string | URL | Request, _request: RequestInit) => new Response(JSON.stringify({ candidates: [] }), { status: 200 })); vi.stubGlobal("fetch", fetchMock);
    const result = await new GeminiDecisionClient("gemini-2.5-flash", "test-key").decide(context);
    expect(result).toMatchObject({ provider: "deterministic", decisionSource: "fallback", experimentId: context.eligibleExperiments[0]!.id }); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
