import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { OpenAIDecisionClient } from "../server/agent.js";
import { Coordinator } from "../server/coordinator.js";
import { JsonStore } from "../server/store.js";
import type { SimulatorFixture } from "../server/adapters/simulator.js";

const enabled = process.env.AHEA_LIVE_OPENAI === "1" && Boolean(process.env.OPENAI_API_KEY);
const directories: string[] = [];

async function runMotionBranch(fixture: SimulatorFixture) {
  const root = await mkdtemp(path.join(tmpdir(), "ahea-live-"));
  directories.push(root);
  const coordinator = new Coordinator({
    store: new JsonStore(root),
    agent: new OpenAIDecisionClient(process.env.OPENAI_MODEL ?? "gpt-5-mini"),
    physicalEnabled: false,
    now: () => new Date(Date.now() + 60_000),
  });
  let session = await coordinator.createSession("simulation", fixture);
  session = await coordinator.submitProblem(session.id, "The motor should run, but nothing is moving. Diagnose it.");
  session = await coordinator.executePending(session.id, session.pendingDecision!.id, session.version);
  return session;
}

afterAll(async () => Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true }))));

describe.skipIf(!enabled)("live OpenAI Responses API adaptivity", () => {
  it("records divergent evidence-grounded decisions and provider response IDs", async () => {
    const absent = await runMotionBranch("disconnected");
    const detected = await runMotionBranch("healthy");
    const invalid = await runMotionBranch("sensor_failure");

    expect(absent.decisions.at(-1)?.selectedAction).toBe("motor_current_probe");
    expect(detected.decisions.at(-1)?.selectedAction).toBe("report_fault_not_reproduced");
    expect(invalid.decisions.at(-1)?.selectedAction).toBe("request_sensor_recovery");
    for (const session of [absent, detected, invalid]) {
      expect(session.decisions.at(-1)?.decisionSource).toBe("openai");
      expect(session.decisions.at(-1)?.responseId).toMatch(/^resp_/);
    }
  }, 120_000);
});
