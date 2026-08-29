import { z } from "zod";
import { deviceRoles, deviceTypes, experimentTypes, hardwareCommands, lifecycleStates, sessionModes, simulationFixtures } from "./domain.js";

export const sessionModeSchema = z.enum(sessionModes);
export const deviceTypeSchema = z.enum(deviceTypes);
export const hardwareCommandSchema = z.enum(hardwareCommands);
export const experimentTypeSchema = z.enum(experimentTypes);
const id = z.string().min(1).max(80);
const baseDevice = { id, label: z.string().min(1).max(120), role: z.enum(deviceRoles), binding: id };
const mpu6050Schema = z.object({ ...baseDevice, type: z.literal("mpu6050"), role: z.enum(["reference", "subject", "observer"]), address: z.enum(["0x68", "0x69"]), expected: z.object({ maximumAccelerationStddevG: z.number().positive(), maximumInvalidSampleRate: z.number().min(0).max(1) }).strict() }).strict();
const dht11Schema = z.object({ ...baseDevice, type: z.literal("dht11"), role: z.enum(["reference", "subject", "observer"]), expected: z.object({ temperatureC: z.tuple([z.number(), z.number()]).optional(), humidityPercent: z.tuple([z.number(), z.number()]).optional(), maximumInvalidSampleRate: z.number().min(0).max(1) }).strict() }).strict();
const hcsr04Schema = z.object({ ...baseDevice, type: z.literal("hc_sr04"), role: z.enum(["reference", "subject", "observer"]), echoProtectionReviewed: z.boolean(), expected: z.object({ distanceCm: z.tuple([z.number(), z.number()]).optional(), maximumStddevCm: z.number().positive(), maximumTimeoutRate: z.number().min(0).max(1) }).strict() }).strict();
const fsrSchema = z.object({
  ...baseDevice, type: z.literal("fsr"), role: z.enum(["reference", "subject"]),
  circuit: z.object({ topology: z.enum(["unknown", "fsr_to_vcc", "fsr_to_gnd"]), fixedResistorOhms: z.number().positive().optional(), supplyMillivolts: z.number().positive().optional(), adcMaximumMillivolts: z.number().positive().optional(), adcMaximumRaw: z.number().int().positive() }).strict(),
  expected: z.object({ maximumSampleStddevRaw: z.number().positive(), maximumInvalidSampleRate: z.number().min(0).max(1) }).strict(),
}).strict();
const servoSchema = z.object({ ...baseDevice, type: z.literal("servo"), role: z.literal("actuator"), actuationEnabled: z.literal(false), observerDeviceId: id.optional() }).strict();
const relaySchema = z.object({ ...baseDevice, type: z.literal("relay"), role: z.literal("actuator"), actuationEnabled: z.literal(false), driverReviewed: z.literal(false), observerDeviceId: id.optional() }).strict();
export const deviceContextSchema = z.discriminatedUnion("type", [mpu6050Schema, dht11Schema, hcsr04Schema, fsrSchema, servoSchema, relaySchema]);

export const projectContextSchema = z.object({
  schemaVersion: z.literal(1),
  project: z.object({ id, name: z.string().min(1).max(160), goal: z.string().min(3).max(1000) }).strict(),
  hardwareProfileId: id,
  components: z.array(deviceContextSchema).min(1).max(64),
  expectedBehavior: z.object({ kind: z.literal("equivalent_normalized_response"), referenceDeviceIds: z.array(id).min(1), subjectDeviceIds: z.array(id).min(1), toleranceFraction: z.number().positive().max(1) }).strict(),
  procedures: z.object({ fsrStimulus: z.object({ kind: z.literal("repeatable_manual"), trialsPerDevice: z.number().int().min(1).max(10), operatorConfirmationRequired: z.literal(true) }).strict() }).strict(),
  constraints: z.object({ maximumExperiments: z.number().int().min(1).max(100), physicalSourceRequiredForConfirmation: z.boolean(), humanApprovalBeforeModification: z.literal(true), allowedResistorOhms: z.array(z.number().positive()).max(32), maximumDividerCurrentMilliamps: z.number().positive().optional() }).strict(),
}).strict().superRefine((value, context) => {
  const ids = value.components.map((component) => component.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["components"], message: "Component IDs must be unique." });
  const known = new Set(ids);
  const groups = [["referenceDeviceIds", value.expectedBehavior.referenceDeviceIds], ["subjectDeviceIds", value.expectedBehavior.subjectDeviceIds]] as const;
  for (const [key, values] of groups) values.forEach((valueId, index) => {
    if (!known.has(valueId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["expectedBehavior", key, index], message: `Unknown component ${valueId}.` });
    else if (value.components.find((component) => component.id === valueId)?.type !== "fsr") context.addIssue({ code: z.ZodIssueCode.custom, path: ["expectedBehavior", key, index], message: "Equivalent normalized response currently supports FSR components only." });
  });
});

export const createSessionSchema = z.object({ mode: sessionModeSchema, fixture: z.enum(simulationFixtures).optional(), targetDeviceId: id.optional(), projectContext: projectContextSchema.optional() }).strict();
export const problemSchema = z.object({ problem: z.string().trim().min(3).max(1_000) }).strict();
export const executeDecisionSchema = z.object({ expectedVersion: z.number().int().nonnegative(), setupConfirmed: z.boolean().optional() }).strict();
export const interventionSchema = z.object({ description: z.string().trim().min(3).max(500), recommendationId: id.optional() }).strict();
export const modelSelectionSchema = z.object({ experimentId: id, objective: z.string().trim().min(1).max(240), rationale: z.string().trim().min(1).max(500) }).strict();

const measurementSchema = z.object({ channel: id, value: z.union([z.number(), z.boolean(), z.string()]), unit: z.string().max(40), deviceId: id, quality: z.enum(["valid", "invalid"]) }).strict();
const seriesSchema = z.object({ channel: id, unit: z.string().max(40), deviceId: id, sampleIntervalMs: z.number().positive(), values: z.array(z.number()).max(1024) }).strict();
const healthSchema = z.object({ deviceId: id, healthy: z.boolean(), errorRate: z.number().min(0).max(1), detail: z.string().max(500).optional() }).strict();
const operationSchema = z.object({ accepted: z.boolean(), aborted: z.boolean(), timedOut: z.boolean(), estopLatched: z.boolean(), reasons: z.array(z.string()) }).strict();
export const protocolRequestSchema = z.object({ id, cmd: hardwareCommandSchema.or(z.enum(["hello", "arm_session"])), args: z.object({ deviceId: id.optional(), planId: id.optional() }).strict() }).strict();
export const protocolResponseSchema = z.object({ id, ok: z.boolean(), data: z.object({ deviceUptimeMs: z.number().nonnegative().optional(), elapsedMs: z.number().nonnegative(), measurements: z.array(measurementSchema), series: z.array(seriesSchema).optional(), sensorHealth: z.array(healthSchema), operation: operationSchema }).strict().optional().nullable(), error: z.object({ code: z.string(), message: z.string() }).strict().nullable() }).strict();
export const storedSessionHeaderSchema = z.object({ schemaVersion: z.literal(2), lifecycle: z.enum(lifecycleStates) }).passthrough();
export type ProtocolResponse = z.infer<typeof protocolResponseSchema>;
