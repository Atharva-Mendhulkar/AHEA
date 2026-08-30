import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Coordinator } from "../server/coordinator.js";
import { defaultProjectContext } from "../server/config.js";
import { JsonStore } from "../server/store.js";
import { TestAgent } from "./helpers.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function firstCapture(coordinator: Coordinator, sessionId: string) {
  let session = await coordinator.submitProblem(sessionId, "Capture the registered behavior.");
  session = await coordinator.startInvestigation(session.id);
  return coordinator.advanceInvestigation(session.id);
}

describe("calibrated simulation engine", () => {
  it("reproduces generated series for the same seed and resolved scenario", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ahea-sim-")); roots.push(root);
    const coordinator = new Coordinator({ store: new JsonStore(root), agent: new TestAgent(), physicalEnabled: false });
    const request = { engine: "generated" as const, seed: "repeatable-seed", scenario: { condition: "normal" as const } };
    const first = await coordinator.createSession("simulation", undefined, defaultProjectContext, undefined, request);
    const second = await coordinator.createSession("simulation", undefined, defaultProjectContext, undefined, request);
    const firstRun = await firstCapture(coordinator, first.id); const secondRun = await firstCapture(coordinator, second.id);
    expect(firstRun.observations[0]?.series).toEqual(secondRun.observations[0]?.series);
    expect(firstRun.simulation?.calibration.status).toBe("model_only");
    expect(firstRun.observations[0]?.simulation).toEqual(firstRun.simulation);
  });

  it("relabels replayed physical values as simulation and retains the origin digest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ahea-replay-")); roots.push(root); const captureDir = path.join(root, "captures"); await mkdir(captureDir);
    const sourceCoordinator = new Coordinator({ store: new JsonStore(path.join(root, "source")), agent: new TestAgent(), physicalEnabled: false });
    const sourceSession = await sourceCoordinator.createSession("simulation", "loopback_intact"); const captured = await firstCapture(sourceCoordinator, sourceSession.id); const report = await sourceCoordinator.report(captured.id);
    const physical = structuredClone(report) as unknown as Record<string, unknown>; physical.evidenceSource = "physical";
    for (const observation of physical.experiments as Array<Record<string, unknown>>) { observation.source = "physical"; observation.adapter = "esp32"; delete observation.simulation; }
    await writeFile(path.join(captureDir, "bench-1.json"), JSON.stringify(physical), "utf8");
    const replayCoordinator = new Coordinator({ store: new JsonStore(path.join(root, "replay")), agent: new TestAgent(), physicalEnabled: false, captureDir });
    const replay = await replayCoordinator.createSession("simulation", undefined, defaultProjectContext, undefined, { engine: "replay", replayCaptureId: "bench-1" });
    const replayed = await firstCapture(replayCoordinator, replay.id); const observation = replayed.observations[0]!;
    expect(observation.source).toBe("simulation"); expect(observation.adapter).toBe("simulator"); expect(observation.measurements).toEqual(captured.observations[0]!.measurements);
    expect(observation.simulation?.replay?.originDigest).toMatch(/^[a-f0-9]{64}$/);
  });
});
