import { randomUUID } from "node:crypto";
import type { ExperimentDefinition, HardwareStatus, Measurement, MeasurementSeries, Observation, ProjectContext, SimulationFixture } from "../../shared/domain.js";
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
    const series = target.type === "loopback" ? this.loopbackSeries(experiment.planId, target.id, measurements) : this.sensorSeries(target.type, experiment.planId, target.id);
    const invalid = measurements.some((entry) => entry.quality === "invalid");
    const ended = Math.max(started + registered.durationMs, Date.now() - this.startedAt);
    return {
      id: randomUUID(), sessionId: execution.sessionId, experimentId: experiment.id, targetId: target.id, targetType: target.type, source: "simulation", adapter: "simulator", command: experiment.command, planId: experiment.planId, phase: execution.phase, capturedAt: new Date().toISOString(), monotonicStartedMs: started, monotonicEndedMs: ended, sequenceNumber: this.sequence,
      measurements,
      series,
      targetHealth: [{ targetId: target.id, healthy: !invalid, errorRate: invalid ? 1 : 0, detail: invalid ? "Simulated profile fault." : undefined }],
      operation: { accepted: !invalid, aborted: experiment.command === "abort", timedOut: false, estopLatched: this.estopLatched, cleanupSucceeded: true, reasons: invalid ? ["SIMULATED_PROFILE_FAULT"] : [] },
      projectContextDigest: execution.projectContextDigest, registryDigest: this.status.registry.digest, firmwareVersion: this.status.firmwareVersion, boardIdentity: this.status.boardIdentity, hardwareProfileId: this.status.profileId, bindingIds: registered.bindingIds, setupDeclaration: execution.setupDeclaration, gatewayValidation: execution.gatewayValidation, limitations: ["Simulated observation; no physical claim is supported.", ...registered.limitations],
    };
  }

  private loopbackSeries(planId: string, targetId: string, measurements: Measurement[]): MeasurementSeries[] {
    const present = (channel: string) => measurements.find((entry) => entry.channel === channel)?.value === true;
    if (planId.includes("static")) {
      const values = [0, 0, 1, 1, 0, 0];
      return ["source", "destination"].map((node) => ({ channel: `${node}_level`, unit: "logic", targetId, sampleIntervalUs: 100000, values: present(`${node}_static_sequence_valid`) ? values : values.map(() => 0) }));
    }
    const period = planId.includes("500hz") ? 16 : 8;
    const waveform = (isPresent: boolean, dutyPercent: number) => Array.from({ length: 64 }, (_, index) => isPresent && index % period < Math.round(period * dutyPercent / 100) ? 1 : 0);
    const result: MeasurementSeries[] = [];
    const source = measurements.find((entry) => entry.channel === "source_duty_percent")?.value;
    const destination = measurements.find((entry) => entry.channel === "destination_duty_percent")?.value;
    if (typeof source === "number") result.push({ channel: "source_level", unit: "logic", targetId, sampleIntervalUs: 125, values: waveform(present("source_present"), source) });
    if (typeof destination === "number") result.push({ channel: "destination_level", unit: "logic", targetId, sampleIntervalUs: 125, values: waveform(present("destination_present"), destination) });
    return result;
  }

  private sensorSeries(kind: Exclude<ProjectContext["profile"]["kind"], "loopback">, planId: string, targetId: string): MeasurementSeries[] {
    const fault = this.fixture === "sensor_fault";
    const make = (channel: string, unit: string, sampleIntervalUs: number, values: number[]): MeasurementSeries => ({ channel, unit, targetId, sampleIntervalUs, values: fault ? values.map(() => 0) : values });
    if (kind === "hc_sr04") {
      if (planId.includes("progression")) return [make("distance_cm", "cm", 60000, [18, 21, 24, 28, 32, 37, 42, 48, 54, 61, 68, 76])];
      return [make("distance_cm", "cm", 60000, [24.6, 24.9, 24.7, 25.1, 24.8, 24.7, 25, 24.8, 24.9, 24.7, 24.8, 24.9].slice(0, planId.includes("echo-timing") ? 8 : 12))];
    }
    if (kind === "mpu6050") {
      if (planId.includes("identity")) return [make("i2c_response", "logic", 20000, [0, 1, 1, 0])];
      if (planId.includes("stationary")) return [make("acceleration_magnitude", "g", 20000, [1.002, .997, 1.008, 1.001, .994, 1.004, 1.006, .999, 1.003, .996, 1.001, 1.005])];
      return [
        make("accel_x", "g", 20000, [0, .08, .24, .58, 1.12, .7, .25, .04, -.18, -.42, -.2, 0]),
        make("accel_y", "g", 20000, [.02, .01, .04, .03, .06, .04, .02, .01, -.01, -.03, 0, .01]),
        make("accel_z", "g", 20000, [1, 1.01, .98, .96, .9, .95, .99, 1.01, 1, .98, 1, 1.01]),
      ];
    }
    if (planId.includes("response")) return [make("data_line", "logic", 40, [1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0])];
    if (planId.includes("valid-rate")) return [make("valid_frame", "logic", 2000000, [1, 1, 1])];
    return [make("temperature", "C", 2000000, [27.1, 27.2, 27.2, 27.3]), make("humidity", "%", 2000000, [54, 54, 55, 54])];
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
