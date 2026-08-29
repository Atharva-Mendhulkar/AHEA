import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { optionalProjectContexts } from "../server/config.js";
import { DomainError } from "../server/coordinator.js";
import { runDiagnostic, setup } from "./helpers.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
describe("optional profiles reuse the core loop", () => {
  it.each(["hc_sr04", "mpu6050", "dht11"] as const)("runs the %s normal fixture without a repair", async (kind) => {
    const value = await setup("sensor_normal", optionalProjectContexts[kind]); roots.push(value.root); const session = await runDiagnostic(value.coordinator, value.session);
    expect(session.lifecycle).toBe("CONCLUDED_NORMAL"); expect(session.evidence.state).toBe("NORMAL"); expect(session.intervention).toBeUndefined();
    expect(session.observations.every((entry) => entry.targetType === kind)).toBe(true);
    expect(session.observations.every((entry) => entry.series.length > 0)).toBe(true);
  });
  it.each([
    ["hc_sr04", /obstacle/i, /Obstacle positioned/i],
    ["mpu6050", /motionless/i, /Sensor connected/i],
    ["dht11", /stable air/i, /Sensor ready/i],
  ] as const)("prompts for %s operator stimulus before automatic capture", async (kind, prompt, confirmation) => {
    const value = await setup("sensor_normal", optionalProjectContexts[kind]); roots.push(value.root);
    let session = await value.coordinator.submitProblem(value.session.id, "Run the optional profile with guided operator actions.");
    expect(session.pendingDecision?.experiment.operatorPrompt).toMatch(prompt);
    expect(session.pendingDecision?.experiment.confirmationLabel).toMatch(confirmation);
    session = await value.coordinator.executePending(session.id, session.pendingDecision!.id, session.version, true, "Operator completed the prompted action.");
    expect(session.observations[0]?.series.length).toBeGreaterThan(0);
  });
  it("advances MPU6050 from stationary baseline to directed motion capture", async () => {
    const value = await setup("sensor_normal", optionalProjectContexts.mpu6050); roots.push(value.root);
    let session = await value.coordinator.submitProblem(value.session.id, "Guide the complete MPU6050 simulation.");
    session = await value.coordinator.executePending(session.id, session.pendingDecision!.id, session.version, true, "MPU6050 connected and motionless.");
    expect(session.pendingDecision?.experiment.operatorPrompt).toMatch(/stable surface/i);
    session = await value.coordinator.executePending(session.id, session.pendingDecision!.id, session.version, true, "MPU6050 flat and still.");
    expect(session.pendingDecision?.experiment.operatorPrompt).toMatch(/\+X direction/i);
    session = await value.coordinator.executePending(session.id, session.pendingDecision!.id, session.version, true, "MPU6050 moved along +X and returned.");
    expect(session.observations.at(-1)?.series.map((entry) => entry.channel)).toEqual(["accel_x", "accel_y", "accel_z"]);
  });
  it("advances HC-SR04 from a fixed obstacle to distance progression", async () => {
    const value = await setup("sensor_normal", optionalProjectContexts.hc_sr04); roots.push(value.root);
    let session = await value.coordinator.submitProblem(value.session.id, "Guide the complete HC-SR04 simulation.");
    session = await value.coordinator.executePending(session.id, session.pendingDecision!.id, session.version, true, "Flat obstacle positioned.");
    expect(session.pendingDecision?.experiment.operatorPrompt).toMatch(/same distance/i);
    session = await value.coordinator.executePending(session.id, session.pendingDecision!.id, session.version, true, "Obstacle held fixed.");
    expect(session.pendingDecision?.experiment.operatorPrompt).toMatch(/steadily away/i);
    session = await value.coordinator.executePending(session.id, session.pendingDecision!.id, session.version, true, "Obstacle moved away.");
    const progression = session.observations.at(-1)?.series[0]?.values ?? [];
    expect(progression.at(-1)).toBeGreaterThan(progression[0]!);
  });
  it("stops a sensor fault inconclusive without inventing a modification", async () => {
    const value = await setup("sensor_fault", optionalProjectContexts.mpu6050); roots.push(value.root); const session = await runDiagnostic(value.coordinator, value.session);
    expect(session.lifecycle).toBe("INCONCLUSIVE"); expect(session.evidence.state).toBe("SENSOR_ANOMALY"); expect(session.evidence.recommendations).toEqual([]);
  });
  it("rejects capabilities registered for a different profile", async () => {
    const context = structuredClone(optionalProjectContexts.mpu6050);
    context.allowedPlanIds = ["dht11.response.v1"];
    const value = await setup(); roots.push(value.root);
    await expect(value.coordinator.createSession("simulation", "sensor_normal", context)).rejects.toBeInstanceOf(DomainError);
  });
  it("rejects an incomplete built-in profile plan set", async () => {
    const context = structuredClone(optionalProjectContexts.dht11);
    context.allowedPlanIds = context.allowedPlanIds.slice(0, 2);
    const value = await setup(); roots.push(value.root);
    await expect(value.coordinator.createSession("simulation", "sensor_normal", context)).rejects.toBeInstanceOf(DomainError);
  });
});
