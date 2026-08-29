import { createHash } from "node:crypto";
import type { ProjectContext } from "../shared/domain.js";
import { projectContextSchema } from "../shared/schemas.js";

const fsr = (id: string, role: "reference" | "subject", binding: string) => ({
  id, label: id.toUpperCase(), type: "fsr" as const, role, binding,
  circuit: { topology: "fsr_to_vcc" as const, fixedResistorOhms: 10_000, supplyMillivolts: 3_300, adcMaximumMillivolts: 3_100, adcMaximumRaw: 4_095 },
  expected: { maximumSampleStddevRaw: 80, maximumInvalidSampleRate: 0.05 },
});

export const defaultProjectContext: ProjectContext = projectContextSchema.parse({
  schemaVersion: 1,
  project: { id: "pressure-floor-demo", name: "Pressure-sensitive floor", goal: "Five FSR sensors should produce equivalent normalized responses under the same manual stimulus." },
  hardwareProfileId: "esp32-fsr-safe-disabled-v1",
  components: [
    fsr("fsr1", "reference", "fsr_1_adc"), fsr("fsr2", "reference", "fsr_2_adc"), fsr("fsr3", "reference", "fsr_3_adc"), fsr("fsr4", "reference", "fsr_4_adc"), fsr("fsr5", "subject", "fsr_5_adc"),
    { id: "motion1", label: "MPU6050 motion sensor", type: "mpu6050", role: "observer", binding: "mpu6050_i2c", address: "0x68", expected: { maximumAccelerationStddevG: 0.08, maximumInvalidSampleRate: 0.05 } },
    { id: "climate1", label: "DHT11 climate sensor", type: "dht11", role: "observer", binding: "dht11_data", expected: { temperatureC: [10, 50], humidityPercent: [10, 90], maximumInvalidSampleRate: 0.1 } },
    { id: "distance1", label: "HC-SR04 distance sensor", type: "hc_sr04", role: "observer", binding: "hc_sr04_timing", echoProtectionReviewed: false, expected: { distanceCm: [2, 400], maximumStddevCm: 2, maximumTimeoutRate: 0.05 } },
  ],
  expectedBehavior: { kind: "equivalent_normalized_response", referenceDeviceIds: ["fsr1", "fsr2", "fsr3", "fsr4"], subjectDeviceIds: ["fsr5"], toleranceFraction: 0.1 },
  procedures: { fsrStimulus: { kind: "repeatable_manual", trialsPerDevice: 1, operatorConfirmationRequired: true } },
  constraints: { maximumExperiments: 24, physicalSourceRequiredForConfirmation: true, humanApprovalBeforeModification: true, allowedResistorOhms: [10_000, 22_000, 33_000, 47_000, 56_000, 68_000, 100_000], maximumDividerCurrentMilliamps: 1 },
});

export const appConfig = {
  port: Number(process.env.PORT ?? 3000),
  dataDir: process.env.AHEA_DATA_DIR ?? "./data",
  model: process.env.OPENAI_MODEL ?? "gpt-5-mini",
  serialPath: process.env.AHEA_SERIAL_PATH,
  physicalEnabled: process.env.AHEA_PHYSICAL_ENABLED === "true",
};

export function projectContextDigest(context: ProjectContext): string {
  return createHash("sha256").update(JSON.stringify(context)).digest("hex");
}
