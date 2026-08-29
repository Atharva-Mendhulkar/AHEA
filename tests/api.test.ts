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
  beforeAll(async () => { root = await mkdtemp(path.join(tmpdir(), "ahea-api-")); app = createApp(new Coordinator({ store: new JsonStore(root), agent: new TestAgent(), physicalEnabled: false, stateDwellMs: 0 })); });
  afterAll(async () => rm(root, { recursive: true, force: true }));
  it("creates a context-bound simulation session and rejects unknown input", async () => {
    const created = await request(app).post("/api/sessions").send({ mode: "simulation", fixture: "fsr_outlier_compensable" }).expect(201);
    expect(created.body.schemaVersion).toBe(2); expect(created.body.targetDeviceId).toBe("fsr5"); expect(created.body.projectContextDigest).toMatch(/^[a-f0-9]{64}$/);
    await request(app).post("/api/sessions").send({ mode: "simulation", gpio: 17 }).expect(400);
  });
  it("keeps physical mode locked without a reviewed profile", async () => { const response = await request(app).post("/api/sessions").send({ mode: "physical" }).expect(409); expect(response.body.error).toMatch(/reviewed/); });
  it("returns sensor guidance and bounded live observations", async () => {
    const created = await request(app).post("/api/sessions").send({ mode: "simulation" }).expect(201);
    const guidance = await request(app).get(`/api/sessions/${created.body.id}/devices/distance1/guidance`).expect(200);
    expect(guidance.body.guidance.steps.join(" ")).toMatch(/obstacle/i);
    const reading = await request(app).post(`/api/sessions/${created.body.id}/devices/distance1/live-reading`).send({}).expect(200);
    expect(reading.body.observation.phase).toBe("monitoring"); expect(reading.body.observation.measurements[0].channel).toBe("distance_cm");
  });
  it("starts and advances an agent-owned recording state", async () => {
    const created = await request(app).post("/api/sessions").send({ mode: "simulation" }).expect(201);
    const submitted = await request(app).post(`/api/sessions/${created.body.id}/problem`).send({ problem: "FSR5 is abnormal." }).expect(200);
    expect(submitted.body.agentState).toBe("IDLE");
    const started = await request(app).post(`/api/sessions/${created.body.id}/investigation/start`).send({}).expect(200);
    expect(started.body.agentState).toBe("INITIALIZING");
    const baseline = await request(app).post(`/api/sessions/${created.body.id}/investigation/advance`).send({}).expect(200);
    expect(baseline.body.agentState).toBe("WAITING_FOR_USER_STIMULUS");
    expect(baseline.body.activeExperiment.baseline).toBeTypeOf("number");
  });
});
