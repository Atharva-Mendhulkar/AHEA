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

export const protocolResponseSchema = z.object({
  id: z.string(),
  ok: z.boolean(),
  data: z.object({
    deviceUptimeMs: z.number().nonnegative().optional(),
    elapsedMs: z.number().nonnegative(),
    measurements: z.array(measurementSchema),
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
