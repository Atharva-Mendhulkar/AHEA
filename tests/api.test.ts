import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { Coordinator } from "../server/coordinator.js";
import { JsonStore } from "../server/store.js";
import { TestAgent } from "./helpers.js";

describe("HTTP API", () => {
  let root: string; let app: ReturnType<typeof createApp>;
  beforeAll(async () => { root = await mkdtemp(path.join(tmpdir(), "ahea-api-")); app = createApp(new Coordinator({ store: new JsonStore(root), agent: new TestAgent(), physicalEnabled: false })); });
  afterAll(async () => rm(root, { recursive: true, force: true }));
  it("lists the core and optional project contexts", async () => { const response = await request(app).get("/api/project-contexts").expect(200); expect(Object.keys(response.body)).toEqual(["loopback", "hc_sr04", "mpu6050", "dht11"]); });
  it("creates a context-bound loopback simulation and rejects raw input", async () => {
    const created = await request(app).post("/api/sessions").send({ mode: "simulation", fixture: "loopback_open" }).expect(201);
    expect(created.body.schemaVersion).toBe(3); expect(created.body.targetId).toBe("loopback-path"); expect(created.body.hardware.registry.plans).toHaveLength(7); expect(created.body.projectContextDigest).toMatch(/^[a-f0-9]{64}$/);
    await request(app).post("/api/sessions").send({ mode: "simulation", gpio: 17 }).expect(400);
  });
  it("keeps physical mode locked for the bundled profile", async () => { const response = await request(app).post("/api/sessions").send({ mode: "physical" }).expect(409); expect(response.body.error).toMatch(/reviewed/i); });
  it("serves the circuit setup workbench", async () => {
    const response = await request(app).get("/circuit-setup").expect(200);
    expect(response.text).toContain("Circuit setup");
    expect(response.text).toContain("Pin inspection");
  });
  it("starts and advances the destination-first investigation", async () => {
    const created = await request(app).post("/api/sessions").send({ mode: "simulation", fixture: "loopback_open" }).expect(201);
    const submitted = await request(app).post(`/api/sessions/${created.body.id}/problem`).send({ problem: "The loopback destination is missing." }).expect(200); expect(submitted.body.pendingDecision.experiment.type).toBe("observe_destination");
    const started = await request(app).post(`/api/sessions/${created.body.id}/investigation/start`).send({}).expect(200); expect(started.body.agentState).toBe("READY_TO_EXECUTE");
    const advanced = await request(app).post(`/api/sessions/${created.body.id}/investigation/advance`).send({}).expect(200); expect(advanced.body.observations[0].planId).toBe("loopback.observe-destination.1khz.v1");
  });
});
