import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { CapabilityRegistry, DiagnosisSession, ExperimentDefinition, ProfileKind, ProjectContext, RegisteredPlan, TargetContext } from "../shared/domain.js";

const loopbackLimit = "Consistency is measured against the ESP32-S3 timebase; this is not independent frequency calibration.";
const plan = (value: RegisteredPlan): RegisteredPlan => value;
const endpointMeasurements: RegisteredPlan["measurements"] = [
  { channel: "source_present", unit: "boolean", description: "Source signal presence." },
  { channel: "destination_present", unit: "boolean", description: "Destination signal presence." },
  { channel: "source_frequency_hz", unit: "Hz", description: "Source frequency against the ESP32 timebase." },
  { channel: "destination_frequency_hz", unit: "Hz", description: "Destination frequency against the ESP32 timebase." },
  { channel: "source_duty_percent", unit: "%", description: "Source high-time ratio." },
  { channel: "destination_duty_percent", unit: "%", description: "Destination high-time ratio." },
  { channel: "endpoint_correlation", unit: "ratio", description: "Synchronized digital agreement." },
];
export const registeredPlans: RegisteredPlan[] = [
  plan({ id: "loopback.observe-destination.1khz.v1", capabilityId: "digital_waveform_capture", type: "observe_destination", label: "Observe destination", description: "Drive the registered 1 kHz waveform and capture only the physical destination node.", targetType: "loopback", command: "execute_plan", bindingIds: ["gpio4_stimulus", "gpio6_destination_observer"], phases: ["monitoring", "diagnostic"], budgetClass: "bounded_output", requiresSetupConfirmation: true, durationMs: 500, fixedParameters: { frequencyHz: 1000, dutyPercent: 50, durationMs: 500 }, measurements: [{ channel: "destination_present", unit: "boolean", description: "Whether destination transitions were captured." }, { channel: "destination_frequency_hz", unit: "Hz", description: "Destination frequency against the ESP32 timebase." }, { channel: "destination_duty_percent", unit: "%", description: "Destination high-time ratio." }], limitations: [loopbackLimit], cleanup: "GPIO4 low" }),
  plan({ id: "loopback.observe-source.1khz.v1", capabilityId: "digital_waveform_capture", type: "observe_source", label: "Verify source", description: "Capture the physical source node while driving the registered waveform.", targetType: "loopback", command: "execute_plan", bindingIds: ["gpio4_stimulus", "gpio5_source_observer"], phases: ["diagnostic"], budgetClass: "bounded_output", requiresSetupConfirmation: true, durationMs: 500, fixedParameters: { frequencyHz: 1000, dutyPercent: 50, durationMs: 500 }, measurements: [{ channel: "source_present", unit: "boolean", description: "Whether source transitions were captured." }, { channel: "source_frequency_hz", unit: "Hz", description: "Source frequency against the ESP32 timebase." }, { channel: "source_duty_percent", unit: "%", description: "Source high-time ratio." }], limitations: [loopbackLimit], cleanup: "GPIO4 low" }),
  plan({ id: "loopback.compare-endpoints.1khz.v1", capabilityId: "synchronized_endpoint_capture", type: "compare_endpoints", label: "Compare endpoints", description: "Capture source and destination in one registered window and calculate endpoint correlation.", targetType: "loopback", command: "execute_plan", bindingIds: ["gpio4_stimulus", "gpio5_source_observer", "gpio6_destination_observer"], phases: ["diagnostic"], budgetClass: "bounded_output", requiresSetupConfirmation: true, durationMs: 500, fixedParameters: { frequencyHz: 1000, dutyPercent: 50, durationMs: 500 }, measurements: endpointMeasurements, limitations: [loopbackLimit, "Correlation applies only to the registered capture resolution and thresholds."], cleanup: "GPIO4 low" }),
  plan({ id: "loopback.measure-timing.1khz.v1", capabilityId: "edge_timing", type: "measure_timing", label: "Measure duty and timing", description: "Measure registered source and destination edge timing at 1 kHz.", targetType: "loopback", command: "execute_plan", bindingIds: ["gpio4_stimulus", "gpio5_source_observer", "gpio6_destination_observer"], phases: ["diagnostic"], budgetClass: "bounded_output", requiresSetupConfirmation: true, durationMs: 500, fixedParameters: { frequencyHz: 1000, dutyPercent: 50, durationMs: 500 }, measurements: endpointMeasurements, limitations: [loopbackLimit], cleanup: "GPIO4 low" }),
  plan({ id: "loopback.inspect-stimulus.static.v1", capabilityId: "static_level_sequence", type: "inspect_stimulus", label: "Inspect stimulus profile", description: "Run a registry-fixed low/high/low sequence to separate waveform setup from path behavior.", targetType: "loopback", command: "execute_plan", bindingIds: ["gpio4_stimulus", "gpio5_source_observer", "gpio6_destination_observer"], phases: ["diagnostic"], budgetClass: "bounded_output", requiresSetupConfirmation: true, durationMs: 300, fixedParameters: { waveform: "low-high-low", stepDurationMs: 100 }, measurements: [{ channel: "source_static_sequence_valid", unit: "boolean", description: "Source followed the static sequence." }, { channel: "destination_static_sequence_valid", unit: "boolean", description: "Destination followed the static sequence." }], limitations: ["This checks digital levels only."], cleanup: "GPIO4 low" }),
  plan({ id: "loopback.repeat-synchronized.500hz.v1", capabilityId: "synchronized_endpoint_capture", type: "repeat_synchronized_capture", label: "Repeat synchronized capture", description: "Repeat endpoint comparison with a registered 500 Hz waveform to resolve conflicting evidence.", targetType: "loopback", command: "execute_plan", bindingIds: ["gpio4_stimulus", "gpio5_source_observer", "gpio6_destination_observer"], phases: ["diagnostic"], budgetClass: "bounded_output", requiresSetupConfirmation: true, durationMs: 500, fixedParameters: { frequencyHz: 500, dutyPercent: 50, durationMs: 500 }, measurements: endpointMeasurements, limitations: [loopbackLimit], cleanup: "GPIO4 low" }),
  plan({ id: "loopback.verify-path.1khz.v1", capabilityId: "synchronized_endpoint_capture", type: "verify_repair", label: "Verify restored path", description: "Run a fresh physical endpoint comparison after the declared intervention.", targetType: "loopback", command: "execute_plan", bindingIds: ["gpio4_stimulus", "gpio5_source_observer", "gpio6_destination_observer"], phases: ["verification"], budgetClass: "bounded_output", requiresSetupConfirmation: true, durationMs: 500, fixedParameters: { frequencyHz: 1000, dutyPercent: 50, durationMs: 500 }, measurements: endpointMeasurements, limitations: [loopbackLimit], cleanup: "GPIO4 low" }),
  plan({ id: "hc-sr04.echo-timing.v1", capabilityId: "ultrasonic_echo_timing", type: "sensor_baseline", label: "Measure echo timing", description: "Run a bounded trigger/echo timing plan.", targetType: "hc_sr04", command: "execute_plan", bindingIds: ["hc_trigger", "hc_echo_protected"], phases: ["monitoring", "diagnostic"], budgetClass: "timed_io", requiresSetupConfirmation: true, durationMs: 500, fixedParameters: { triggerPulseUs: 10, echoTimeoutUs: 60000, samples: 8, intervalMs: 60 }, measurements: [{ channel: "distance_cm", unit: "cm", description: "Distance estimate." }, { channel: "timeout_rate", unit: "ratio", description: "Echo timeout rate." }], limitations: ["Requires the reviewed 8.2 kΩ/10 kΩ Echo divider and controlled target geometry."], cleanup: "Trigger low" }),
  plan({ id: "hc-sr04.variance.v1", capabilityId: "ultrasonic_variance", type: "sensor_consistency", label: "Measure distance variance", description: "Measure repeated echo timing and variance.", targetType: "hc_sr04", command: "execute_plan", bindingIds: ["hc_trigger", "hc_echo_protected"], phases: ["diagnostic"], budgetClass: "timed_io", requiresSetupConfirmation: true, durationMs: 900, fixedParameters: { triggerPulseUs: 10, echoTimeoutUs: 60000, samples: 12, intervalMs: 60 }, measurements: [{ channel: "distance_stddev_cm", unit: "cm", description: "Repeated distance standard deviation." }], limitations: ["No distance accuracy claim exists without a declared reference procedure."], cleanup: "Trigger low" }),
  plan({ id: "hc-sr04.progression.v1", capabilityId: "ultrasonic_progression", type: "sensor_response", label: "Check distance progression", description: "Check response to declared target movement and alignment.", targetType: "hc_sr04", command: "execute_plan", bindingIds: ["hc_trigger", "hc_echo_protected"], phases: ["diagnostic"], budgetClass: "timed_io", requiresSetupConfirmation: true, durationMs: 900, fixedParameters: { triggerPulseUs: 10, echoTimeoutUs: 60000, samples: 12, intervalMs: 60 }, measurements: [{ channel: "progression_consistent", unit: "boolean", description: "Readings follow the declared movement direction." }], limitations: ["Beam geometry, target material, alignment, and speed of sound affect results."], cleanup: "Trigger low" }),
  plan({ id: "mpu6050.identity.v1", capabilityId: "i2c_identity", type: "sensor_identity", label: "Read MPU6050 identity", description: "Read the registered WHO_AM_I value.", targetType: "mpu6050", command: "execute_plan", bindingIds: ["i2c_sda", "i2c_scl"], phases: ["monitoring", "diagnostic"], budgetClass: "read", requiresSetupConfirmation: true, durationMs: 100, fixedParameters: { address: "profile-owned", register: "WHO_AM_I" }, measurements: [{ channel: "identity_valid", unit: "boolean", description: "Registered identity matched." }], limitations: ["Identity does not prove axis accuracy."], cleanup: "I2C idle" }),
  plan({ id: "mpu6050.stationary.v1", capabilityId: "imu_stationary_baseline", type: "sensor_baseline", label: "Characterize stationary baseline", description: "Capture stationary bias, noise, and drift.", targetType: "mpu6050", command: "execute_plan", bindingIds: ["i2c_sda", "i2c_scl"], phases: ["diagnostic"], budgetClass: "read", requiresSetupConfirmation: true, durationMs: 1000, fixedParameters: { samples: 50, sampleIntervalMs: 20 }, measurements: [{ channel: "stationary_noise_g", unit: "g", description: "Acceleration noise." }, { channel: "drift_dps", unit: "deg/s", description: "Gyroscope drift." }], limitations: ["This is baseline characterization without an external orientation reference."], cleanup: "I2C idle" }),
  plan({ id: "mpu6050.motion-axis.v1", capabilityId: "imu_motion_response", type: "sensor_response", label: "Check motion and axes", description: "Capture bounded motion response and axis consistency.", targetType: "mpu6050", command: "execute_plan", bindingIds: ["i2c_sda", "i2c_scl"], phases: ["diagnostic"], budgetClass: "read", requiresSetupConfirmation: true, durationMs: 1000, fixedParameters: { samples: 50, sampleIntervalMs: 20 }, measurements: [{ channel: "motion_detected", unit: "boolean", description: "Motion response observed." }, { channel: "axis_consistent", unit: "boolean", description: "Axis response follows the declared procedure." }], limitations: ["Motion at the sensor does not prove movement elsewhere."], cleanup: "I2C idle" }),
  plan({ id: "dht11.response.v1", capabilityId: "dht_response_timing", type: "sensor_identity", label: "Check DHT11 response", description: "Check registered response timing and checksum.", targetType: "dht11", command: "execute_plan", bindingIds: ["dht_data_3v3"], phases: ["monitoring", "diagnostic"], budgetClass: "timed_io", requiresSetupConfirmation: true, durationMs: 250, fixedParameters: { minimumReadIntervalMs: 2000 }, measurements: [{ channel: "checksum_valid", unit: "boolean", description: "Frame checksum validity." }, { channel: "response_time_us", unit: "us", description: "Protocol response time." }], limitations: ["A valid checksum does not establish environmental accuracy."], cleanup: "Data pin released" }),
  plan({ id: "dht11.environment.v1", capabilityId: "environment_reading", type: "sensor_baseline", label: "Characterize environment", description: "Read temperature and humidity under the registered timing plan.", targetType: "dht11", command: "execute_plan", bindingIds: ["dht_data_3v3"], phases: ["diagnostic"], budgetClass: "timed_io", requiresSetupConfirmation: true, durationMs: 250, fixedParameters: { minimumReadIntervalMs: 2000 }, measurements: [{ channel: "temperature_c", unit: "C", description: "Temperature reading." }, { channel: "humidity_percent", unit: "%", description: "Humidity reading." }], limitations: ["This is baseline characterization without a trusted environmental reference."], cleanup: "Data pin released" }),
  plan({ id: "dht11.valid-rate.v1", capabilityId: "dht_consistency", type: "sensor_consistency", label: "Check valid and stale rates", description: "Measure checksum, valid-read, and stale-reading behavior.", targetType: "dht11", command: "execute_plan", bindingIds: ["dht_data_3v3"], phases: ["diagnostic"], budgetClass: "timed_io", requiresSetupConfirmation: true, durationMs: 4500, fixedParameters: { samples: 3, intervalMs: 2000 }, measurements: [{ channel: "valid_rate", unit: "ratio", description: "Valid frame rate." }, { channel: "stale_rate", unit: "ratio", description: "Repeated unchanged frame rate." }], limitations: ["DHT11 resolution, lag, placement, and self-heating limit conclusions."], cleanup: "Data pin released" }),
];

export interface ProfileModule { kind: ProfileKind; title: string; claims: string[]; limitations: string[]; planIds: string[] }
export const builtInModules: Record<ProfileKind, ProfileModule> = Object.fromEntries((["loopback", "hc_sr04", "mpu6050", "dht11"] as ProfileKind[]).map((kind) => [kind, {
  kind,
  title: ({ loopback: "Protected waveform loopback", hc_sr04: "HC-SR04 diagnostics", mpu6050: "MPU6050 diagnostics", dht11: "DHT11 diagnostics" })[kind],
  claims: kind === "loopback" ? ["Registered digital waveform presence, timing, and endpoint consistency."] : ["Registered protocol and response behavior under declared conditions."],
  limitations: registeredPlans.filter((entry) => entry.targetType === kind).flatMap((entry) => entry.limitations),
  planIds: registeredPlans.filter((entry) => entry.targetType === kind).map((entry) => entry.id),
}])) as Record<ProfileKind, ProfileModule>;

export function registryForContext(context: ProjectContext, boardIdentity = "SIM-ESP32S3"): CapabilityRegistry {
  const plans = structuredClone(registeredPlans.filter((entry) => context.allowedPlanIds.includes(entry.id)));
  const body = { schemaVersion: 1 as const, registryVersion: "3.0.0", boardIdentity, hardwareProfileId: context.hardwareProfileId, plans };
  return { ...body, digest: createHash("sha256").update(JSON.stringify(body)).digest("hex") };
}

export function registryMatchesReviewedPlans(context: ProjectContext, registry: CapabilityRegistry): boolean {
  const requiredPlanIds = builtInModules[context.profile.kind].planIds;
  if (context.allowedPlanIds.length !== requiredPlanIds.length || requiredPlanIds.some((id) => !context.allowedPlanIds.includes(id))) return false;
  return context.allowedPlanIds.every((id) => {
    const expected = registeredPlans.find((entry) => entry.id === id);
    const advertised = registry.plans.find((entry) => entry.id === id);
    if (!expected || !advertised) return false;
    const safetyCritical = (entry: RegisteredPlan) => ({
      id: entry.id,
      capabilityId: entry.capabilityId,
      type: entry.type,
      targetType: entry.targetType,
      command: entry.command,
      bindingIds: [...entry.bindingIds].sort(),
      phases: [...entry.phases].sort(),
      budgetClass: entry.budgetClass,
      requiresSetupConfirmation: entry.requiresSetupConfirmation,
      durationMs: entry.durationMs,
      fixedParameters: entry.fixedParameters,
      measurements: entry.measurements.map(({ channel, unit }) => ({ channel, unit })).sort((a, b) => a.channel.localeCompare(b.channel)),
      cleanup: entry.cleanup,
    });
    return isDeepStrictEqual(safetyCritical(advertised), safetyCritical(expected));
  });
}

function buildExperiment(session: DiagnosisSession, planId: string): ExperimentDefinition {
  const registered = session.hardware.registry.plans.find((entry) => entry.id === planId);
  if (!registered) throw new Error(`Registered plan ${planId} is unavailable.`);
  const ordinal = session.observations.filter((entry) => entry.phase === session.phase).length + 1;
  return { id: `${registered.type}:${ordinal}`, type: registered.type, label: registered.label, description: registered.description, targetId: session.targetId, planId, command: registered.command, phase: session.phase, requiresSetupConfirmation: registered.requiresSetupConfirmation, budgetClass: registered.budgetClass, evidenceReferences: session.evidence.assessments.map((entry) => entry.observationId) };
}
function localExperiment(session: DiagnosisSession, type: "request_intervention" | "conclude_normal" | "conclude_inconclusive"): ExperimentDefinition {
  const recommendation = session.evidence.recommendations[0];
  return { id: `${type}:${session.phase}:${session.observations.filter((entry) => entry.phase === session.phase).length + 1}`, type, label: type === "request_intervention" ? "Request human intervention" : type === "conclude_normal" ? "Conclude normal" : "Stop inconclusive", description: type === "request_intervention" ? "Present the evidence-supported bounded repair and wait for a human declaration." : type === "conclude_normal" ? "End without inventing a repair because tested behavior is normal." : "Stop because bounded evidence cannot support a repair claim.", targetId: session.targetId, phase: session.phase, requiresSetupConfirmation: false, budgetClass: "read", evidenceReferences: session.evidence.assessments.map((entry) => entry.observationId), recommendationId: recommendation?.id };
}
function hasPlan(session: DiagnosisSession, fragment: string, phase: "diagnostic" | "verification" = "diagnostic"): boolean { return session.observations.some((entry) => entry.phase === phase && entry.planId.includes(fragment)); }

export function buildEligibleExperiments(session: DiagnosisSession): ExperimentDefinition[] {
  if (["CONCLUDED_NORMAL", "INCONCLUSIVE", "CONFIRMED", "FAILED_VERIFICATION", "INTERRUPTED", "ESTOPPED"].includes(session.lifecycle)) return [];
  if (session.phase === "verification") return [buildExperiment(session, "loopback.verify-path.1khz.v1")];
  if (session.projectContext.profile.kind !== "loopback") return sensorEligibility(session);
  if (!hasPlan(session, "observe-destination")) return [buildExperiment(session, "loopback.observe-destination.1khz.v1")];

  const evidence = session.evidence.state;
  if (evidence === "INSUFFICIENT_EVIDENCE" && !hasPlan(session, "compare-endpoints")) return [buildExperiment(session, "loopback.compare-endpoints.1khz.v1")];
  if ((evidence === "DESTINATION_MISSING" || evidence === "DESTINATION_MALFORMED") && !hasPlan(session, "observe-source")) return [buildExperiment(session, "loopback.observe-source.1khz.v1")];
  if (evidence === "DESTINATION_MISSING" && !hasPlan(session, "compare-endpoints")) return [buildExperiment(session, "loopback.compare-endpoints.1khz.v1")];
  if (evidence === "DESTINATION_MALFORMED" && !hasPlan(session, "measure-timing")) return [buildExperiment(session, "loopback.measure-timing.1khz.v1")];
  if (evidence === "SOURCE_MALFORMED" && !hasPlan(session, "inspect-stimulus")) return [buildExperiment(session, "loopback.inspect-stimulus.static.v1")];
  if (evidence === "CONFLICTING_EVIDENCE" && session.observations.filter((entry) => entry.planId.includes("repeat-synchronized")).length < 2) return [buildExperiment(session, "loopback.repeat-synchronized.500hz.v1")];
  if (evidence === "PATH_OPEN_SUPPORTED" || evidence === "SIGNAL_PATH_FAULT_SUPPORTED") return [localExperiment(session, "request_intervention")];
  if (evidence === "NORMAL") return [localExperiment(session, "conclude_normal")];
  return [localExperiment(session, "conclude_inconclusive")];
}

export function buildMonitoringExperiment(session: DiagnosisSession): ExperimentDefinition | undefined {
  const registered = session.hardware.registry.plans.find((entry) => entry.targetType === session.projectContext.profile.kind && entry.phases.includes("monitoring"));
  if (!registered) return undefined;
  return { id: `monitor:${session.monitoringReads + 1}`, type: registered.type, label: `Live ${registered.label}`, description: registered.description, targetId: session.targetId, planId: registered.id, command: registered.command, phase: "monitoring", requiresSetupConfirmation: registered.requiresSetupConfirmation, budgetClass: registered.budgetClass, evidenceReferences: [] };
}

function sensorEligibility(session: DiagnosisSession): ExperimentDefinition[] {
  const plans = session.hardware.registry.plans.filter((entry) => entry.targetType === session.projectContext.profile.kind && entry.phases.includes("diagnostic"));
  const next = plans.find((entry) => !session.observations.some((observation) => observation.phase === "diagnostic" && observation.planId === entry.id));
  if (next) return [buildExperiment(session, next.id)];
  return [localExperiment(session, session.evidence.state === "NORMAL" ? "conclude_normal" : "conclude_inconclusive")];
}

export interface TargetGuidance { title: string; steps: string[]; expectedSignal: string; caution: string }
export function guidanceForTarget(target: TargetContext): TargetGuidance {
  if (target.type === "loopback") return { title: "Protected ESP32-S3 loopback", steps: ["Power off before changing the removable jumper.", "Confirm the 1 kΩ, two 4.7 kΩ, and 100 kΩ resistors match the fixture.", "Keep the jumper state hidden from the agent until the report is complete."], expectedSignal: "An intact path produces matching source and destination timing; an open jumper leaves the destination low.", caution: loopbackLimit };
  if (target.type === "hc_sr04") return { title: "Reviewed HC-SR04 fixture", steps: ["Verify the 8.2 kΩ upper and 10 kΩ lower Echo divider.", "Use a flat target with declared distance and alignment.", "Keep the sensing cone clear of secondary reflectors."], expectedSignal: "Echo timing should be repeatable and progress with the declared target motion.", caution: "Never connect the 5 V Echo output directly to an ESP32-S3 GPIO." };
  if (target.type === "mpu6050") return { title: "3.3 V MPU6050 I²C fixture", steps: ["Verify SDA/SCL pull-ups terminate at 3.3 V.", "Keep the sensor still for baseline capture.", "Follow the declared single-axis motion procedure."], expectedSignal: "Identity, stationary noise, and axis response should satisfy project bounds.", caution: "Breakout-board regulator claims do not prove pull-up safety." };
  return { title: "3.3 V-compatible DHT11 fixture", steps: ["Verify the data pull-up is 3.3 V or use reviewed level shifting.", "Respect the registered read interval.", "Keep placement stable during characterization."], expectedSignal: "Response timing, checksums, valid rate, and stale rate should satisfy project bounds.", caution: "Valid checksums do not establish temperature or humidity accuracy." };
}
