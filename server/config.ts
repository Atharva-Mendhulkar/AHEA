import { createHash } from "node:crypto";
import type { ProjectContext } from "../shared/domain.js";
import { projectContextSchema } from "../shared/schemas.js";
import { builtInModules } from "./modules.js";

export const defaultProjectContext: ProjectContext = projectContextSchema.parse({
  schemaVersion: 2,
  project: { id: "esp32s3-loopback-demo", name: "ESP32-S3 protected loopback", goal: "Determine whether a registered digital waveform reaches a physically separate destination node and adapt the next experiment to the evidence." },
  profile: { kind: "loopback", moduleId: "core.loopback.v1" },
  hardwareProfileId: "esp32s3-loopback-safe-disabled-v1",
  primaryTargetId: "loopback-path",
  targets: [{
    id: "loopback-path", label: "Protected waveform path", type: "loopback",
    bindingIds: ["gpio4_stimulus", "gpio5_source_observer", "gpio6_destination_observer"],
    bindings: { stimulus: "gpio4_stimulus", sourceObserver: "gpio5_source_observer", destinationObserver: "gpio6_destination_observer" },
    fixture: { stimulusSeriesOhms: 1000, observerSeriesOhms: 4700, destinationPulldownOhms: 100000, removableJumper: true },
    expected: { frequencyHz: 1000, dutyPercent: 50, durationMs: 500, frequencyToleranceFraction: 0.05, dutyTolerancePercent: 5, minimumCorrelation: 0.95 },
    limitations: ["Timing is referenced to the ESP32-S3 timebase, not an independent instrument.", "The fixture supports bounded path conclusions only."],
  }],
  allowedPlanIds: builtInModules.loopback.planIds,
  procedures: {
    setupChecklist: ["Use a common ground and 3.3 V logic only.", "Wire GPIO4 through 1 kΩ to the source node.", "Wire GPIO5 and GPIO6 to their nodes through separate 4.7 kΩ resistors.", "Install a removable source-to-destination jumper and a 100 kΩ destination pull-down."],
    interventionSafety: ["Power down before changing the jumper or wiring.", "A human must perform and declare every physical change."],
    reference: { kind: "baseline_characterization", description: "Waveform consistency is evaluated against the ESP32-S3 timebase; no independent reference instrument is present." },
  },
  constraints: { maximumExperiments: 12, maximumMonitoringReads: 40, requiredVerificationPasses: 2, physicalSourceRequiredForConfirmation: true, humanOnlyIntervention: true },
});

export const physicalLoopbackProjectContext: ProjectContext = projectContextSchema.parse({
  ...defaultProjectContext,
  hardwareProfileId: "esp32s3-n16r8-loopback-2k-10k-reviewed-v1",
  targets: [{
    ...defaultProjectContext.targets[0],
    fixture: { stimulusSeriesOhms: 2000, observerSeriesOhms: 10000, destinationPulldownOhms: 10000, removableJumper: true },
  }],
  procedures: {
    ...defaultProjectContext.procedures,
    setupChecklist: ["Use a common ground and 3.3 V logic only.", "Wire GPIO4 through 2 kΩ to the source node.", "Wire GPIO5 and GPIO6 to their nodes through separate 10 kΩ resistors.", "Install a removable source-to-destination jumper and a 10 kΩ destination pull-down."],
  },
});

const commonConstraints = { maximumExperiments: 12, maximumMonitoringReads: 40, requiredVerificationPasses: 2 as const, physicalSourceRequiredForConfirmation: true as const, humanOnlyIntervention: true as const };
export const optionalProjectContexts: Record<"hc_sr04" | "mpu6050" | "dht11", ProjectContext> = {
  hc_sr04: projectContextSchema.parse({ schemaVersion: 2, project: { id: "hc-sr04-demo", name: "HC-SR04 diagnostics", goal: "Characterize registered trigger/echo behavior without overstating distance accuracy." }, profile: { kind: "hc_sr04", moduleId: "optional.hc-sr04.v1" }, hardwareProfileId: "esp32s3-n16r8-hc-sr04-reviewed-v1", primaryTargetId: "distance-sensor", targets: [{ id: "distance-sensor", label: "HC-SR04", type: "hc_sr04", bindingIds: ["hc_trigger", "hc_echo_protected"], echoProtection: { reviewed: true, upperOhms: 8200, lowerOhms: 10000 }, expected: { distanceCm: [2, 400], maximumStddevCm: 2, maximumTimeoutRate: .05 }, limitations: ["Geometry, alignment, and speed of sound affect the estimate."] }], allowedPlanIds: builtInModules.hc_sr04.planIds, procedures: { setupChecklist: ["Trigger uses GPIO16 through 1 kΩ; Echo uses an 8.2 kΩ/10 kΩ divider into GPIO17; the divider output was verified below 3.3 V."], interventionSafety: ["Power down before rewiring."], reference: { kind: "baseline_characterization", description: "No independent distance reference is declared." } }, constraints: commonConstraints }),
  mpu6050: projectContextSchema.parse({ schemaVersion: 2, project: { id: "mpu6050-demo", name: "MPU6050 diagnostics", goal: "Characterize identity, stationary behavior, drift, and motion response." }, profile: { kind: "mpu6050", moduleId: "optional.mpu6050.v1" }, hardwareProfileId: "esp32s3-n16r8-mpu6050-reviewed-v1", primaryTargetId: "imu", targets: [{ id: "imu", label: "MPU6050", type: "mpu6050", bindingIds: ["i2c_sda", "i2c_scl"], i2c: { address: "0x68", pullupVolts: 3.3, reviewed: true }, expected: { maximumStationaryNoiseG: .08, maximumInvalidSampleRate: .05 }, limitations: ["Motion is observed at the sensor only."] }], allowedPlanIds: builtInModules.mpu6050.planIds, procedures: { setupChecklist: ["SDA on GPIO14 and SCL on GPIO13; pull-ups verified at 3.3 V; AD0 tied to ground for address 0x68."], interventionSafety: ["Power down before changing I²C wiring."], reference: { kind: "baseline_characterization", description: "No independent orientation reference is declared." } }, constraints: commonConstraints }),
  dht11: projectContextSchema.parse({ schemaVersion: 2, project: { id: "dht11-demo", name: "DHT11 diagnostics", goal: "Characterize response timing, checksum health, valid rate, stale readings, temperature, and humidity." }, profile: { kind: "dht11", moduleId: "optional.dht11.v1" }, hardwareProfileId: "esp32s3-dht11-safe-disabled-v1", primaryTargetId: "climate-sensor", targets: [{ id: "climate-sensor", label: "DHT11", type: "dht11", bindingIds: ["dht_data_3v3"], dataInterface: { pullupVolts: 3.3, levelShifted: false, reviewed: false }, expected: { temperatureC: [0, 50], humidityPercent: [20, 90], maximumInvalidRate: .1, minimumReadIntervalMs: 2000 }, limitations: ["Resolution, response lag, placement, and self-heating limit conclusions."] }], allowedPlanIds: builtInModules.dht11.planIds, procedures: { setupChecklist: ["Verify the data pull-up is 3.3 V or add reviewed level shifting."], interventionSafety: ["Power down before rewiring."], reference: { kind: "baseline_characterization", description: "No trusted environmental reference is declared." } }, constraints: commonConstraints }),
};

export const projectContexts = { loopback: physicalLoopbackProjectContext, ...optionalProjectContexts };
export const appConfig = { port: Number(process.env.PORT ?? 3000), dataDir: process.env.AHEA_DATA_DIR ?? "./data", model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash", serialPath: process.env.AHEA_SERIAL_PATH, physicalEnabled: process.env.AHEA_PHYSICAL_ENABLED === "true" };
export function projectContextDigest(context: ProjectContext): string { return createHash("sha256").update(JSON.stringify(context)).digest("hex"); }
