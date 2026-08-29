import { z } from "zod";
import { evidenceStates, experimentTypes, hardwareCommands, lifecycleStates, profileKinds, sessionModes, simulationFixtures } from "./domain.js";

const id = z.string().min(1).max(120);
const range = z.tuple([z.number(), z.number()]).refine(([minimum, maximum]) => minimum <= maximum, "Range minimum must not exceed maximum.");
const baseTarget = { id, label: z.string().min(1).max(160), bindingIds: z.array(id).min(1).max(16), limitations: z.array(z.string().min(1)).min(1) };
const loopbackTargetSchema = z.object({
  ...baseTarget, type: z.literal("loopback"),
  bindings: z.object({ stimulus: z.literal("gpio4_stimulus"), sourceObserver: z.literal("gpio5_source_observer"), destinationObserver: z.literal("gpio6_destination_observer") }).strict(),
  fixture: z.object({ stimulusSeriesOhms: z.literal(1000), observerSeriesOhms: z.literal(4700), destinationPulldownOhms: z.literal(100000), removableJumper: z.literal(true) }).strict(),
  expected: z.object({ frequencyHz: z.literal(1000), dutyPercent: z.literal(50), durationMs: z.literal(500), frequencyToleranceFraction: z.number().positive().max(.25), dutyTolerancePercent: z.number().positive().max(20), minimumCorrelation: z.number().min(0).max(1) }).strict(),
}).strict();
const hcsr04TargetSchema = z.object({
  ...baseTarget, type: z.literal("hc_sr04"),
  echoProtection: z.object({ reviewed: z.boolean(), upperOhms: z.literal(8200), lowerOhms: z.literal(10000) }).strict(),
  expected: z.object({ distanceCm: range.optional(), maximumStddevCm: z.number().positive(), maximumTimeoutRate: z.number().min(0).max(1) }).strict(),
}).strict();
const mpu6050TargetSchema = z.object({
  ...baseTarget, type: z.literal("mpu6050"),
  i2c: z.object({ address: z.enum(["0x68", "0x69"]), pullupVolts: z.literal(3.3), reviewed: z.boolean() }).strict(),
  expected: z.object({ maximumStationaryNoiseG: z.number().positive(), maximumInvalidSampleRate: z.number().min(0).max(1) }).strict(),
}).strict();
const dht11TargetSchema = z.object({
  ...baseTarget, type: z.literal("dht11"),
  dataInterface: z.object({ pullupVolts: z.literal(3.3), levelShifted: z.boolean(), reviewed: z.boolean() }).strict(),
  expected: z.object({ temperatureC: range.optional(), humidityPercent: range.optional(), maximumInvalidRate: z.number().min(0).max(1), minimumReadIntervalMs: z.number().int().min(1000) }).strict(),
}).strict();
export const targetContextSchema = z.discriminatedUnion("type", [loopbackTargetSchema, hcsr04TargetSchema, mpu6050TargetSchema, dht11TargetSchema]);

export const projectContextSchema = z.object({
  schemaVersion: z.literal(2),
  project: z.object({ id, name: z.string().min(1).max(160), goal: z.string().min(3).max(1000) }).strict(),
  profile: z.object({ kind: z.enum(profileKinds), moduleId: id }).strict(),
  hardwareProfileId: id,
  primaryTargetId: id,
  targets: z.array(targetContextSchema).min(1).max(32),
  allowedPlanIds: z.array(id).min(1).max(64),
  procedures: z.object({
    setupChecklist: z.array(z.string().min(1)).min(1),
    interventionSafety: z.array(z.string().min(1)).min(1),
    reference: z.object({ kind: z.enum(["baseline_characterization", "project_calibration"]), procedureId: id.optional(), description: z.string().min(1) }).strict().optional(),
  }).strict(),
  constraints: z.object({ maximumExperiments: z.number().int().min(1).max(100), maximumMonitoringReads: z.number().int().min(0).max(500), requiredVerificationPasses: z.literal(2), physicalSourceRequiredForConfirmation: z.literal(true), humanOnlyIntervention: z.literal(true) }).strict(),
}).strict().superRefine((value, context) => {
  const moduleIds = { loopback: "core.loopback.v1", hc_sr04: "optional.hc-sr04.v1", mpu6050: "optional.mpu6050.v1", dht11: "optional.dht11.v1" } as const;
  const ids = value.targets.map((target) => target.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["targets"], message: "Target IDs must be unique." });
  const primary = value.targets.find((target) => target.id === value.primaryTargetId);
  if (!primary) context.addIssue({ code: z.ZodIssueCode.custom, path: ["primaryTargetId"], message: "Primary target must exist." });
  else if (primary.type !== value.profile.kind) context.addIssue({ code: z.ZodIssueCode.custom, path: ["profile", "kind"], message: "Profile kind must match the primary target." });
  if (value.profile.moduleId !== moduleIds[value.profile.kind]) context.addIssue({ code: z.ZodIssueCode.custom, path: ["profile", "moduleId"], message: "Profile kind must match its registered module ID." });
  if (new Set(value.allowedPlanIds).size !== value.allowedPlanIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["allowedPlanIds"], message: "Allowed plan IDs must be unique." });
  if (value.procedures.reference?.kind === "project_calibration" && !value.procedures.reference.procedureId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["procedures", "reference", "procedureId"], message: "Project calibration requires a declared reference procedure ID." });
});

export const createSessionSchema = z.object({ mode: z.enum(sessionModes), fixture: z.enum(simulationFixtures).optional(), targetId: id.optional(), projectContext: projectContextSchema.optional() }).strict();
export const problemSchema = z.object({ problem: z.string().trim().min(3).max(1000) }).strict();
export const executeDecisionSchema = z.object({ expectedVersion: z.number().int().nonnegative(), setupConfirmed: z.boolean().optional(), setupDeclaration: z.string().trim().min(3).max(500).optional() }).strict();
export const interventionSchema = z.object({ description: z.string().trim().min(3).max(500), recommendationId: id, safetyConfirmed: z.literal(true) }).strict();
export const modelSelectionSchema = z.object({ experimentId: id, objective: z.string().trim().min(1).max(240), rationale: z.string().trim().min(1).max(500) }).strict();

const measurementSchema = z.object({ channel: id, value: z.union([z.number(), z.boolean(), z.string()]), unit: z.string().max(40), targetId: id, quality: z.enum(["valid", "invalid"]) }).strict();
const seriesSchema = z.object({ channel: id, unit: z.string().max(40), targetId: id, sampleIntervalUs: z.number().nonnegative(), values: z.array(z.number()).max(4096) }).strict();
const healthSchema = z.object({ targetId: id, healthy: z.boolean(), errorRate: z.number().min(0).max(1), detail: z.string().max(500).optional() }).strict();
const operationSchema = z.object({ accepted: z.boolean(), aborted: z.boolean(), timedOut: z.boolean(), estopLatched: z.boolean(), cleanupSucceeded: z.boolean(), reasons: z.array(z.string().max(240)).max(32) }).strict();
const planSchema = z.object({
  id, capabilityId: id, type: z.enum(experimentTypes), label: z.string(), description: z.string(), targetType: z.enum(profileKinds), command: z.enum(hardwareCommands),
  bindingIds: z.array(id), phases: z.array(z.enum(["monitoring", "diagnostic", "verification"])).min(1), budgetClass: z.enum(["read", "timed_io", "bounded_output"]),
  requiresSetupConfirmation: z.boolean(), durationMs: z.number().int().nonnegative(), fixedParameters: z.record(z.union([z.number(), z.string(), z.boolean()])),
  measurements: z.array(z.object({ channel: id, unit: z.string(), description: z.string() }).strict()), limitations: z.array(z.string()), cleanup: z.string(),
}).strict();
export const capabilityRegistrySchema = z.object({ schemaVersion: z.literal(1), registryVersion: id, digest: z.string().regex(/^[a-f0-9]{64}$/), boardIdentity: id, hardwareProfileId: id, plans: z.array(planSchema) }).strict().superRefine((value, context) => {
  const planIds = value.plans.map((plan) => plan.id);
  if (new Set(planIds).size !== planIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["plans"], message: "Advertised plan IDs must be unique." });
  value.plans.forEach((plan, index) => {
    if (new Set(plan.bindingIds).size !== plan.bindingIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["plans", index, "bindingIds"], message: "Plan binding IDs must be unique." });
    const channels = plan.measurements.map((measurement) => measurement.channel);
    if (new Set(channels).size !== channels.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["plans", index, "measurements"], message: "Measurement channels must be unique within a plan." });
  });
});

export const protocolRequestSchema = z.object({ id, cmd: z.enum([...hardwareCommands, "hello", "arm_session"] as const), args: z.object({ targetId: id.optional(), planId: id.optional() }).strict() }).strict();
export const protocolResponseSchema = z.object({
  id, ok: z.boolean(),
  data: z.object({
    firmwareVersion: z.string(), boardIdentity: z.string(), protocolVersion: z.string(), hardwareProfileId: z.string(), registryDigest: z.string(), physicalEnabled: z.boolean(),
    monotonicStartedMs: z.number().nonnegative(), monotonicEndedMs: z.number().nonnegative(), sequenceNumber: z.number().int().nonnegative(), planId: z.string(), bindingIds: z.array(id),
    measurements: z.array(measurementSchema), series: z.array(seriesSchema), targetHealth: z.array(healthSchema), operation: operationSchema, registry: capabilityRegistrySchema.optional(), limitations: z.array(z.string()),
  }).strict().optional().nullable(),
  error: z.object({ code: z.string(), message: z.string() }).strict().nullable(),
}).strict();

export const storedSessionHeaderSchema = z.object({ schemaVersion: z.literal(3), lifecycle: z.enum(lifecycleStates) }).passthrough();
export const evidenceStateSchema = z.enum(evidenceStates);
export type ProtocolResponse = z.infer<typeof protocolResponseSchema>;
