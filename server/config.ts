import { readFileSync } from "node:fs";
import type { CalibrationProfile } from "../shared/domain.js";
import { calibrationProfileSchema } from "../shared/schemas.js";

export const simulationCalibration: CalibrationProfile = {
  id: "cal-simulator-v1",
  projectId: "dc-motor-demo",
  profileId: "sim-dc-motor-v1",
  boardIdentity: "SIM-ESP32S3",
  firmwareVersion: "sim-1.0.0",
  sensorIdentities: { motion: "SIM-MPU6050@0x68", current: "SIM-INA219@0x40" },
  capturedAt: "2026-01-01T00:00:00.000Z",
  sampleCounts: { inactive: 100, healthy: 100 },
  sensorErrorRates: { inactive: 0, healthy: 0 },
  idleCurrentMa: 2.5,
  healthyCurrentMa: 181,
  baseMotionRmsG: 0.012,
  healthyMotionRmsG: 0.22,
  thresholds: {
    motionMultiplier: 3,
    healthyMotionFraction: 0.5,
    motionNoiseFloorG: 0.05,
    idleCurrentMarginMa: 10,
    currentNoiseFloorMa: 20,
    healthyCurrentLowFraction: 0.6,
    healthyCurrentHighFraction: 1.4,
    maximumSensorErrorRate: 0.05,
  },
};

export const appConfig = {
  port: Number(process.env.PORT ?? 3000),
  dataDir: process.env.AHEA_DATA_DIR ?? "./data",
  model: process.env.OPENAI_MODEL ?? "gpt-5-mini",
  serialPath: process.env.AHEA_SERIAL_PATH,
  physicalEnabled: process.env.AHEA_PHYSICAL_ENABLED === "true",
  calibrationPath: process.env.AHEA_CALIBRATION_PATH,
};

export function loadPhysicalCalibration(filePath = appConfig.calibrationPath): CalibrationProfile | undefined {
  if (!filePath) return undefined;
  return calibrationProfileSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
}
