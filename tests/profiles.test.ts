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
