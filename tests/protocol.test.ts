import { describe, expect, it } from "vitest";
import { modelArgumentsSchema, protocolRequestSchema, protocolResponseSchema } from "../shared/schemas.js";

describe("strict schemas", () => {
  it("rejects raw hardware parameters and unknown protocol commands", () => {
    expect(() => protocolRequestSchema.parse({ id: "x", cmd: "motor_motion_probe", args: { pwm: 255 } })).toThrow();
    expect(() => protocolRequestSchema.parse({ id: "x", cmd: "write_gpio", args: {} })).toThrow();
  });

  it("rejects model-owned confidence or state fields", () => {
    expect(() => modelArgumentsSchema.parse({ objective: "measure", rationale: "useful", confidence: "HIGH" })).toThrow();
    expect(() => modelArgumentsSchema.parse({ objective: "measure", rationale: "useful", lifecycle: "CONFIRMED" })).toThrow();
  });

  it("requires explicit response safety and sensor health", () => {
    expect(() => protocolResponseSchema.parse({ id: "x", ok: true, data: { elapsedMs: 1, measurements: [] }, error: null })).toThrow();
  });

  it("accepts bounded sensor sample series for the plotter", () => {
    expect(protocolResponseSchema.parse({
      id: "x",
      ok: true,
      data: {
        elapsedMs: 16,
        measurements: [],
        series: [{ name: "current_ma", unit: "mA", sensor: "ina219", sampleIntervalMs: 8, values: [2.4, 2.5] }],
        sensorHealth: [{ sensor: "ina219", healthy: true, errorRate: 0 }],
        safety: { activationAccepted: true, tripped: false, estopLatched: false, timeout: false, reasons: [] },
      },
      error: null,
    }).data?.series?.[0]?.values).toEqual([2.4, 2.5]);
  });
});
