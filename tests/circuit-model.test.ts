import { describe, expect, it } from "vitest";
import { components, gpioAssignments, validateCircuit, wires } from "../web/circuit-model.js";

describe("circuit setup model", () => {
  it("passes deterministic electrical validation", () => {
    const result = validateCircuit();
    expect(result.errors).toEqual([]);
    expect(result.checked.wires).toBe(wires.length);
  });

  it("keeps signal GPIO assignments unique and exposes all ESP32 headers", () => {
    expect(new Set(gpioAssignments.map((item) => item.pin)).size).toBe(gpioAssignments.length);
    expect(components.find((item) => item.id === "esp32")?.pins).toHaveLength(44);
  });

  it("contains the required protected five-volt paths", () => {
    expect(wires.some((wire) => wire.net === "US_ECHO_5V" && wire.to === "r_echo_hi.1")).toBe(true);
    expect(wires.some((wire) => wire.net === "US_ECHO_3V" && wire.to === "esp32.GPIO15")).toBe(true);
    expect(wires.some((wire) => wire.net === "LOAD_5V" && wire.from === "sg90.5V")).toBe(true);
  });
});
