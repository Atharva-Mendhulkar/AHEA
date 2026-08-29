import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { setup, runDiagnostic } from "./helpers.js";
import { defaultProjectContext } from "../server/config.js";
import { rankResistorCandidates } from "../server/tuning.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
describe("deterministic FSR evidence", () => {
  it("calculates known-good statistics, an outlier, and a bounded candidate", async () => {
    const value = await setup(); roots.push(value.root); const session = await runDiagnostic(value.coordinator, value.session);
    expect(session.evidence.reference?.deviceIds).toEqual(["fsr1", "fsr2", "fsr3", "fsr4"]);
    expect(session.evidence.state).toBe("CIRCUIT_MISMATCH");
    expect(session.evidence.subject!.referenceDeviationFraction).toBeGreaterThan(0.1);
    expect(session.evidence.recommendations[0]?.parameters.resistorOhms).toBe(22000);
    expect([10000, 22000, 33000, 47000, 56000, 68000, 100000]).toContain(session.evidence.recommendations[0]?.parameters.resistorOhms);
  });
  it("does not confuse unstable evidence with a resistor mismatch", async () => {
    const value = await setup("fsr_noisy"); roots.push(value.root); const session = await runDiagnostic(value.coordinator, value.session);
    expect(session.evidence.state).toBe("EXCESS_NOISE"); expect(session.evidence.recommendations).toEqual([]); expect(session.decisions.at(-1)?.selectedAction).toBe("request_manual_check");
  });
  it("keeps read failures out of reference conclusions", async () => {
    const value = await setup("fsr_read_failure"); roots.push(value.root); const session = await runDiagnostic(value.coordinator, value.session);
    expect(session.evidence.state).toBe("COMMUNICATION_FAILURE"); expect(session.evidence.recommendations).toEqual([]);
  });
  it("blocks candidate analysis when the physical divider is unknown or unsafe", () => {
    const context = structuredClone(defaultProjectContext); const device = context.components.find((item) => item.id === "fsr5")!;
    if (device.type !== "fsr") throw new Error("fixture mismatch");
    const reference = { deviceIds: ["fsr1"], collectedTrials: 3, requiredTrials: 3, meanRaw: 1800, stddevRaw: 10, rangeRaw: [1790, 1810] as [number, number] };
    const subject = { deviceId: "fsr5", collectedTrials: 3, requiredTrials: 3, meanRaw: 1400, stddevRaw: 10, normalizedResponse: 1400 / 4095, referenceDeviationFraction: 400 / 1800 };
    device.circuit.topology = "unknown"; expect(rankResistorCandidates(context, device, reference, subject)).toEqual([]);
    device.circuit.topology = "fsr_to_vcc"; context.constraints.maximumDividerCurrentMilliamps = 0.000001; expect(rankResistorCandidates(context, device, reference, subject)).toEqual([]);
  });
});
