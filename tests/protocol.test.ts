import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { modelSelectionSchema, projectContextSchema, protocolRequestSchema } from "../shared/schemas.js";
import { defaultProjectContext, optionalProjectContexts, projectContexts } from "../server/config.js";
import { builtInModules, registryForContext, registryMatchesReviewedPlans } from "../server/modules.js";

describe("strict capability and protocol contracts", () => {
  it("validates the loopback default and all optional profiles", () => {
    expect(projectContextSchema.parse(defaultProjectContext).profile.kind).toBe("loopback");
    for (const context of Object.values(optionalProjectContexts)) expect(projectContextSchema.parse(context).profile.kind).not.toBe("loopback");
    expect(Object.keys(builtInModules)).toEqual(["loopback", "hc_sr04", "mpu6050", "dht11"]);
  });
  it.each([
    ["project.json", "loopback"],
    ["hc-sr04.project.json", "hc_sr04"],
    ["mpu6050.project.json", "mpu6050"],
    ["dht11.project.json", "dht11"],
  ] as const)("validates checked-in project profile %s", (filename, kind) => {
    const input = JSON.parse(readFileSync(path.resolve("config", filename), "utf8"));
    const parsed = projectContextSchema.parse(input);
    expect(parsed.profile.kind).toBe(kind);
    expect(parsed).toEqual(projectContexts[kind]);
  });
  it("rejects unsafe optional-profile voltage and interface declarations", () => {
    const mpu = structuredClone(optionalProjectContexts.mpu6050);
    const dht = structuredClone(optionalProjectContexts.dht11);
    const sonar = structuredClone(optionalProjectContexts.hc_sr04);
    if (mpu.targets[0]?.type === "mpu6050") mpu.targets[0].i2c.pullupVolts = 5 as 3.3;
    if (dht.targets[0]?.type === "dht11") dht.targets[0].dataInterface.pullupVolts = 5 as 3.3;
    if (sonar.targets[0]?.type === "hc_sr04") sonar.targets[0].echoProtection.upperOhms = 1000 as 8200;
    expect(() => projectContextSchema.parse(mpu)).toThrow();
    expect(() => projectContextSchema.parse(dht)).toThrow();
    expect(() => projectContextSchema.parse(sonar)).toThrow();
  });
  it("rejects a profile whose primary target belongs to another module", () => {
    const mismatched = structuredClone(optionalProjectContexts.mpu6050) as unknown as Record<string, unknown>;
    (mismatched.profile as { kind: string }).kind = "dht11";
    expect(() => projectContextSchema.parse(mismatched)).toThrow(/Profile kind must match/i);
  });
  it("rejects a profile kind paired with the wrong module ID", () => {
    const mismatched = structuredClone(optionalProjectContexts.dht11);
    mismatched.profile.moduleId = "core.loopback.v1";
    expect(() => projectContextSchema.parse(mismatched)).toThrow(/module ID/i);
  });
  it("advertises only context-allowed registered plans", () => {
    const registry = registryForContext(defaultProjectContext);
    expect(registry.plans.map((entry) => entry.id)).toEqual(defaultProjectContext.allowedPlanIds); expect(registry.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(registryMatchesReviewedPlans(defaultProjectContext, registry)).toBe(true);
    registry.plans[0]!.fixedParameters.frequencyHz = 1234;
    expect(registryMatchesReviewedPlans(defaultProjectContext, registry)).toBe(false);
  });
  it.each([
    { targetId: "loopback-path", planId: "loopback.observe-destination.1khz.v1", gpio: 17 },
    { targetId: "loopback-path", planId: "loopback.observe-destination.1khz.v1", frequencyHz: 1234 },
    { targetId: "loopback-path", planId: "loopback.observe-destination.1khz.v1", durationMs: 9999 },
    { targetId: "loopback-path", planId: "loopback.observe-destination.1khz.v1", attenuation: 11 },
    { targetId: "loopback-path", planId: "loopback.observe-destination.1khz.v1", register: 117 },
  ])("rejects caller-supplied low-level arguments", (args) => expect(() => protocolRequestSchema.parse({ id: "x", cmd: "execute_plan", args })).toThrow());
  it("rejects model-owned confidence and lifecycle", () => {
    expect(() => modelSelectionSchema.parse({ experimentId: "e", objective: "measure", rationale: "useful", confidence: "HIGH_CONFIDENCE" })).toThrow();
    expect(() => modelSelectionSchema.parse({ experimentId: "e", objective: "measure", rationale: "useful", lifecycle: "CONFIRMED" })).toThrow();
  });
});
