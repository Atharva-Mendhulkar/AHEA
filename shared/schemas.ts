import { z } from "zod";
import { agentActions, hardwareCommands, sessionModes } from "./domain.js";

export const sessionModeSchema = z.enum(sessionModes);
export const hardwareCommandSchema = z.enum(hardwareCommands);
export const agentActionSchema = z.enum(agentActions);

export const createSessionSchema = z.object({
  mode: sessionModeSchema,
  fixture: z.enum(["disconnected", "healthy", "stalled", "sensor_failure"]).optional(),
}).strict();

export const problemSchema = z.object({ problem: z.string().trim().min(3).max(1_000) }).strict();
export const executeDecisionSchema = z.object({ expectedVersion: z.number().int().nonnegative() }).strict();
export const interventionSchema = z.object({ description: z.string().trim().min(3).max(500) }).strict();

export const modelArgumentsSchema = z.object({
  objective: z.string().trim().min(1).max(240),
  rationale: z.string().trim().min(1).max(500),
}).strict();

export const calibrationProfileSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  profileId: z.string().min(1),
  boardIdentity: z.string().min(1),
  firmwareVersion: z.string().min(1),
  sensorIdentities: z.object({ motion: z.string().min(1), current: z.string().min(1) }).strict(),
  capturedAt: z.string().datetime(),
  sampleCounts: z.object({ inactive: z.number().int().positive(), healthy: z.number().int().positive() }).strict(),
  sensorErrorRates: z.object({ inactive: z.number().min(0).max(1), healthy: z.number().min(0).max(1) }).strict(),
  idleCurrentMa: z.number().nonnegative(),
  healthyCurrentMa: z.number().positive(),
  baseMotionRmsG: z.number().nonnegative(),
  healthyMotionRmsG: z.number().positive(),
  thresholds: z.object({
    motionMultiplier: z.number().positive(),
    healthyMotionFraction: z.number().positive(),
    motionNoiseFloorG: z.number().nonnegative(),
    idleCurrentMarginMa: z.number().nonnegative(),
    currentNoiseFloorMa: z.number().nonnegative(),
    healthyCurrentLowFraction: z.number().positive(),
    healthyCurrentHighFraction: z.number().positive(),
    maximumSensorErrorRate: z.number().min(0).max(1),
  }).strict(),
}).strict();

export const protocolRequestSchema = z.object({
  id: z.string().min(1).max(80),
  cmd: hardwareCommandSchema.or(z.enum(["hello", "arm_session", "arm_calibration"])),
  args: z.object({}).strict(),
}).strict();

const measurementSchema = z.object({
  name: z.string(),
  value: z.union([z.number(), z.boolean(), z.string()]),
  unit: z.string(),
  sensor: z.enum(["mpu6050", "ina219", "firmware"]),
  quality: z.enum(["valid", "invalid"]),
}).strict();

const sensorHealthSchema = z.object({
  sensor: z.enum(["mpu6050", "ina219", "firmware"]),
  healthy: z.boolean(),
  errorRate: z.number().min(0).max(1),
  detail: z.string().optional(),
}).strict();

const measurementSeriesSchema = z.object({
  name: z.enum(["motion_rms_g", "current_ma"]),
  unit: z.enum(["g", "mA"]),
  sensor: z.enum(["mpu6050", "ina219"]),
  sampleIntervalMs: z.number().positive(),
  values: z.array(z.number()).max(256),
}).strict();

export const protocolResponseSchema = z.object({
  id: z.string(),
  ok: z.boolean(),
  data: z.object({
    deviceUptimeMs: z.number().nonnegative().optional(),
    elapsedMs: z.number().nonnegative(),
    measurements: z.array(measurementSchema),
    series: z.array(measurementSeriesSchema).optional(),
    sensorHealth: z.array(sensorHealthSchema),
    safety: z.object({
      activationAccepted: z.boolean(),
      tripped: z.boolean(),
      estopLatched: z.boolean(),
      timeout: z.boolean(),
      reasons: z.array(z.string()),
    }).strict(),
  }).optional(),
  error: z.object({ code: z.string(), message: z.string() }).strict().nullable(),
}).strict();

export type ProtocolResponse = z.infer<typeof protocolResponseSchema>;
