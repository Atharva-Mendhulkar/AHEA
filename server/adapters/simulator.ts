import { randomUUID } from "node:crypto";
import type { ExperimentDefinition, HardwareStatus, Measurement, Observation, ProjectContext, SimulationFixture } from "../../shared/domain.js";
import { targetById } from "../../shared/domain.js";
import { registryForContext } from "../modules.js";
import type { ExecuteContext, HardwareAdapter } from "./adapter.js";

export class SimulatorAdapter implements HardwareAdapter {
  readonly source = "simulation" as const;
  readonly name = "simulator" as const;
  private interventionDeclared = false;
  private estopLatched = false;
  private sequence = 0;
  private readonly startedAt = Date.now();
  private readonly status: HardwareStatus;

  constructor(readonly fixture: SimulationFixture, private readonly context: ProjectContext) {
    const registry = registryForContext(context);
    this.status = { connected: true, firmwareVersion: "sim-3.0.0", boardIdentity: registry.boardIdentity, protocolVersion: "3.0", profileId: context.hardwareProfileId, physicalEnabled: false, estopLatched: false, registry, limitations: ["All measurements are deterministic simulation output and cannot produce physical confirmation."] };
  }
  async preflight(): Promise<HardwareStatus> { return structuredClone(this.status); }
  async armSession(): Promise<void> {}
  declareIntervention(): void { this.interventionDeclared = true; }
  async close(): Promise<void> {}

  async execute(experiment: ExperimentDefinition, execution: ExecuteContext): Promise<Observation> {
    if (!experiment.command || !experiment.planId) throw new Error(`Experiment ${experiment.type} has no registered hardware plan.`);
    const registered = this.status.registry.plans.find((entry) => entry.id === experiment.planId);
    if (!registered) throw new Error(`Plan ${experiment.planId} was not advertised.`);
    const target = targetById(this.context, experiment.targetId);
    if (!target || target.type !== registered.targetType) throw new Error("Plan target does not match project context.");
    const started = Date.now() - this.startedAt;
    this.sequence += 1;
    if (experiment.command === "abort") this.estopLatched = true;
    const measurements = target.type === "loopback" ? this.loopbackMeasurements(experiment.planId, target.id) : this.sensorMeasurements(target.type, experiment.planId, target.id);
    const invalid = measurements.some((entry) => entry.quality === "invalid");
    const ended = Math.max(started + registered.durationMs, Date.now() - this.startedAt);
    const binary = measurements.find((entry) => entry.channel === "destination_present")?.value === true;
    return {
      id: randomUUID(), sessionId: execution.sessionId, experimentId: experiment.id, targetId: target.id, targetType: target.type, source: "simulation", adapter: "simulator", command: experiment.command, planId: experiment.planId, phase: execution.phase, capturedAt: new Date().toISOString(), monotonicStartedMs: started, monotonicEndedMs: ended, sequenceNumber: this.sequence,
      measurements,
      series: target.type === "loopback" ? [{ channel: "destination_level", unit: "logic", targetId: target.id, sampleIntervalUs: 250, values: Array.from({ length: 32 }, (_, index) => binary && index % 2 === 0 ? 1 : 0) }] : [],
      targetHealth: [{ targetId: target.id, healthy: !invalid, errorRate: invalid ? 1 : 0, detail: invalid ? "Simulated profile fault." : undefined }],
      operation: { accepted: !invalid, aborted: experiment.command === "abort", timedOut: false, estopLatched: this.estopLatched, cleanupSucceeded: true, reasons: invalid ? ["SIMULATED_PROFILE_FAULT"] : [] },
      projectContextDigest: execution.projectContextDigest, registryDigest: this.status.registry.digest, firmwareVersion: this.status.firmwareVersion, boardIdentity: this.status.boardIdentity, hardwareProfileId: this.status.profileId, bindingIds: registered.bindingIds, setupDeclaration: execution.setupDeclaration, gatewayValidation: execution.gatewayValidation, limitations: ["Simulated observation; no physical claim is supported.", ...registered.limitations],
    };
  }

  private loopbackMeasurements(planId: string, targetId: string): Measurement[] {
    const repaired = this.interventionDeclared && this.fixture !== "loopback_verification_failure";
    const open = (this.fixture === "loopback_open" || this.fixture === "loopback_verification_failure") && !repaired;
    const distorted = this.fixture === "loopback_distorted" && !repaired;
    const stimulusFault = this.fixture === "loopback_stimulus_fault";
    const conflicting = this.fixture === "loopback_conflicting";
    const sourcePresent = !stimulusFault;
    const destinationPresent = sourcePresent && !open;
    const sourceFrequency = sourcePresent ? 1000 : 0;
    const destinationFrequency = destinationPresent ? (distorted ? 720 : 1000) : 0;
    const sourceDuty = sourcePresent ? 50 : 0;
    const destinationDuty = destinationPresent ? (distorted ? 68 : 50) : 0;
    const correlation = sourcePresent && destinationPresent ? (distorted ? .62 : .998) : 0;
    const values: Measurement[] = [];
    const add = (channel: string, value: number | boolean, unit: string) => values.push({ channel, value, unit, targetId, quality: "valid" });
    if (planId.includes("observe-destination")) { add("destination_present", destinationPresent, "boolean"); add("destination_frequency_hz", destinationFrequency, "Hz"); add("destination_duty_percent", destinationDuty, "%"); }
    else if (planId.includes("observe-source")) { add("source_present", sourcePresent, "boolean"); add("source_frequency_hz", sourceFrequency, "Hz"); add("source_duty_percent", sourceDuty, "%"); }
    else if (planId.includes("inspect-stimulus")) { add("source_static_sequence_valid", sourcePresent, "boolean"); add("destination_static_sequence_valid", destinationPresent, "boolean"); }
    else {
      const capturedDestination = conflicting ? false : destinationPresent;
      add("source_present", sourcePresent, "boolean"); add("destination_present", capturedDestination, "boolean"); add("source_frequency_hz", sourceFrequency, "Hz"); add("destination_frequency_hz", capturedDestination ? destinationFrequency : 0, "Hz"); add("source_duty_percent", sourceDuty, "%"); add("destination_duty_percent", capturedDestination ? destinationDuty : 0, "%"); add("endpoint_correlation", capturedDestination ? correlation : 0, "ratio");
    }
    return values;
  }

  private sensorMeasurements(kind: Exclude<ProjectContext["profile"]["kind"], "loopback">, planId: string, targetId: string): Measurement[] {
    const fault = this.fixture === "sensor_fault";
    const value = (channel: string, entry: number | boolean, unit: string): Measurement => ({ channel, value: entry, unit, targetId, quality: fault ? "invalid" : "valid" });
    if (kind === "hc_sr04") {
      if (planId.includes("variance")) return [value("distance_stddev_cm", .7, "cm")];
      if (planId.includes("progression")) return [value("progression_consistent", true, "boolean")];
      return [value("distance_cm", 24.8, "cm"), value("timeout_rate", 0, "ratio")];
    }
    if (kind === "mpu6050") {
      if (planId.includes("identity")) return [value("identity_valid", true, "boolean")];
      if (planId.includes("stationary")) return [value("stationary_noise_g", .018, "g"), value("drift_dps", .4, "deg/s")];
      return [value("motion_detected", true, "boolean"), value("axis_consistent", true, "boolean")];
    }
    if (planId.includes("response")) return [value("checksum_valid", true, "boolean"), value("response_time_us", 82, "us")];
    if (planId.includes("valid-rate")) return [value("valid_rate", 1, "ratio"), value("stale_rate", 0, "ratio")];
    return [value("temperature_c", 27.2, "C"), value("humidity_percent", 54, "%")];
  }
}
