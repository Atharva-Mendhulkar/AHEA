import { describe, expect, it } from "vitest";
import type { Observation } from "../shared/domain.js";
import { defaultProjectContext } from "../server/config.js";
import { assessSignal, stimulusPrompt } from "../server/recording.js";

const fsr = defaultProjectContext.components.find((device) => device.id === "fsr5")!;
function observation(mean: number, stddev: number, accepted = true): Observation {
  return {
    id: "observation", sessionId: "session", experimentId: "stimulus:fsr5:1", deviceId: "fsr5", deviceType: "fsr", source: "simulation", adapter: "simulator", command: "sample_fsr", phase: "monitoring", capturedAt: new Date(0).toISOString(), elapsedMs: 640, projectContextDigest: "digest",
    measurements: [{ channel: "adc_mean", value: mean, unit: "adc_raw", deviceId: "fsr5", quality: accepted ? "valid" : "invalid" }, { channel: "adc_stddev", value: stddev, unit: "adc_raw", deviceId: "fsr5", quality: accepted ? "valid" : "invalid" }],
    series: [{ channel: "adc_raw", unit: "adc_raw", deviceId: "fsr5", sampleIntervalMs: 10, values: Array.from({ length: 64 }, () => mean) }], sensorHealth: [{ deviceId: "fsr5", healthy: accepted, errorRate: accepted ? 0 : 1 }], operation: { accepted, aborted: false, timedOut: false, estopLatched: false, reasons: [] },
  };
}

describe("deterministic recording sufficiency", () => {
  it("accepts a stable meaningful FSR response", () => {
    const result = assessSignal(fsr, observation(1000, 18), 120);
    expect(result).toMatchObject({ stimulusDetected: true, sufficient: true, quality: "GOOD", sampleCount: 64 });
  });
  it("keeps waiting when the response has not moved from baseline", () => {
    const result = assessSignal(fsr, observation(140, 12), 120);
    expect(result).toMatchObject({ stimulusDetected: false, sufficient: false, quality: "WAITING" });
  });
  it("rejects a noisy response even when stimulus is detected", () => {
    const result = assessSignal(fsr, observation(1000, 120), 120);
    expect(result).toMatchObject({ stimulusDetected: true, sufficient: false, quality: "NOISY" });
  });
  it("derives the physical prompt from the configured device", () => {
    expect(stimulusPrompt(fsr)).toMatch(/FSR5/i);
  });
});
