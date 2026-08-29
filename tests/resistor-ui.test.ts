import { describe, expect, it } from "vitest";
import { createResistorAsset, resistorCode } from "../web/resistor.js";

describe("dynamic resistor visual", () => {
  it("encodes 22 kΩ as red-red-orange-gold", () => {
    const code = resistorCode(22_000);
    expect(code?.bands.map((band) => band.name)).toEqual(["red", "red", "orange", "gold"]);
    expect(code?.label).toBe("22 kΩ");
    expect(createResistorAsset(22_000)?.alt).toBe("22 kΩ axial resistor with red-red-orange-gold bands");
  });

  it.each([
    [10_000, ["brown", "black", "orange", "gold"]],
    [33_000, ["orange", "orange", "orange", "gold"]],
    [47_000, ["yellow", "violet", "orange", "gold"]],
    [56_000, ["green", "blue", "orange", "gold"]],
    [68_000, ["blue", "gray", "orange", "gold"]],
    [100_000, ["brown", "black", "yellow", "gold"]],
  ])("derives bands for the bounded candidate %i Ω", (ohms, expected) => {
    expect(resistorCode(ohms)?.bands.map((band) => band.name)).toEqual(expected);
  });
});
