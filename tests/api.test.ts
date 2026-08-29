import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { Coordinator } from "../server/coordinator.js";
import { JsonStore } from "../server/store.js";
import { fallbackDecision, type DecisionClient, type DecisionContext } from "../server/agent.js";

class Agent implements DecisionClient {
  decide(context: DecisionContext) { return Promise.resolve(fallbackDecision(context)); }
  clear() {}
}

describe("HTTP API", () => {
  let root: string;
  let app: ReturnType<typeof createApp>;
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ahea-api-"));
    app = createApp(new Coordinator({ store: new JsonStore(root), agent: new Agent(), physicalEnabled: false, now: () => new Date(Date.now() + 60_000) }));
  });
  afterAll(async () => rm(root, { recursive: true, force: true }));

  it("creates immutable simulation sessions and rejects unknown fields", async () => {
    const created = await request(app).post("/api/sessions").send({ mode: "simulation", fixture: "disconnected" }).expect(201);
    expect(created.body.mode).toBe("simulation");
    await request(app).post("/api/sessions").send({ mode: "simulation", source: "physical" }).expect(400);
  });

  it("keeps physical mode locked without an approved profile", async () => {
    const response = await request(app).post("/api/sessions").send({ mode: "physical" }).expect(503);
    expect(response.body.error).toMatch(/disabled/);
  });
});
