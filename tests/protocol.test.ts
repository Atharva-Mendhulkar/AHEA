import { describe, expect, it } from "vitest";
import { modelSelectionSchema, projectContextSchema, protocolRequestSchema, protocolResponseSchema } from "../shared/schemas.js";
import { defaultProjectContext } from "../server/config.js";
import { builtInModules } from "../server/modules.js";

describe("strict contracts", () => {
  it("validates the sensor-first project context", () => expect(projectContextSchema.parse(defaultProjectContext).components).toHaveLength(8));
  it("registers every owned device while leaving actuator commands disabled", () => {
    expect(Object.keys(builtInModules)).toEqual(["mpu6050", "dht11", "hc_sr04", "fsr", "servo", "relay"]);
    expect(builtInModules.servo.commands).toEqual([]); expect(builtInModules.relay.commands).toEqual([]);
  });
  it("rejects raw pins, PWM, and arbitrary resistor arguments", () => {
    expect(() => protocolRequestSchema.parse({ id: "x", cmd: "sample_fsr", args: { deviceId: "fsr5", gpio: 17 } })).toThrow();
    expect(() => protocolRequestSchema.parse({ id: "x", cmd: "sample_fsr", args: { deviceId: "fsr5", resistorOhms: 12345 } })).toThrow();
    expect(() => protocolRequestSchema.parse({ id: "x", cmd: "write_gpio", args: {} })).toThrow();
  });
  it("rejects model-owned confidence and lifecycle", () => {
    expect(() => modelSelectionSchema.parse({ experimentId: "e", objective: "measure", rationale: "useful", confidence: "HIGH" })).toThrow();
    expect(() => modelSelectionSchema.parse({ experimentId: "e", objective: "measure", rationale: "useful", lifecycle: "CONFIRMED" })).toThrow();
  });
  it("requires health, operation, and bounded series", () => {
    expect(() => protocolResponseSchema.parse({ id: "x", ok: true, data: { elapsedMs: 1, measurements: [] }, error: null })).toThrow();
    expect(protocolResponseSchema.parse({ id: "x", ok: true, data: { elapsedMs: 16, measurements: [], series: [{ channel: "adc_raw", unit: "adc_raw", deviceId: "fsr5", sampleIntervalMs: 10, values: [1, 2] }], sensorHealth: [{ deviceId: "fsr5", healthy: true, errorRate: 0 }], operation: { accepted: true, aborted: false, timedOut: false, estopLatched: false, reasons: [] } }, error: null }).data?.series?.[0]?.values).toEqual([1, 2]);
  });
});
