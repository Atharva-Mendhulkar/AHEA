import { randomUUID } from "node:crypto";
import type { ExperimentDefinition, HardwareStatus, Observation, ProjectContext, SimulationFixture } from "../../shared/domain.js";
import { deviceById } from "../../shared/domain.js";
import type { ExecuteContext, HardwareAdapter } from "./adapter.js";

export class SimulatorAdapter implements HardwareAdapter {
  readonly source = "simulation" as const;
  readonly name = "simulator" as const;
  private interventionDeclared = false;
  private estopLatched = false;
  private readonly startedAt = Date.now();
  private readonly calls = new Map<string, number>();

  constructor(readonly fixture: SimulationFixture, private readonly projectContext: ProjectContext) {}

  async preflight(): Promise<HardwareStatus> {
    return {
      connected: true, firmwareVersion: "sim-2.0.0", boardIdentity: "SIM-ESP32S3", protocolVersion: "2.0", profileId: this.projectContext.hardwareProfileId, physicalEnabled: false, estopLatched: this.estopLatched,
      supportedCommands: ["scan_i2c", "identify_mpu6050", "sample_mpu6050", "sample_dht11", "measure_distance", "sample_fsr", "abort"],
      detectedDevices: this.projectContext.components.map((device) => ({ deviceId: device.id, type: device.type, present: true, identity: `SIM-${device.type.toUpperCase()}` })),
      limitations: ["All measurements in this session are simulated."],
    };
  }
  declareIntervention(): void { this.interventionDeclared = true; }
  async armSession(): Promise<void> {}
  async close(): Promise<void> {}

  async execute(experiment: ExperimentDefinition, context: ExecuteContext): Promise<Observation> {
    if (!experiment.command) throw new Error(`Experiment ${experiment.type} has no hardware command.`);
    const device = experiment.targetDeviceId ? deviceById(this.projectContext, experiment.targetDeviceId) : undefined;
    const started = Date.now();
    const measurements: Observation["measurements"] = [];
    const series: NonNullable<Observation["series"]> = [];
    const sensorHealth: Observation["sensorHealth"] = [];
    let accepted = true;
    let timedOut = false;

    if (experiment.command === "abort") this.estopLatched = true;
    if (experiment.command === "sample_fsr" && device?.type === "fsr") {
      const count = (this.calls.get(device.id) ?? 0) + 1;
      this.calls.set(device.id, count);
      const isSubject = device.id === this.projectContext.expectedBehavior.subjectDeviceIds[0];
      const failed = this.fixture === "fsr_read_failure" && isSubject;
      const noisy = this.fixture === "fsr_noisy" && isSubject;
      const repaired = isSubject && this.interventionDeclared;
      const referenceIndex = this.projectContext.expectedBehavior.referenceDeviceIds.indexOf(device.id);
      const isBaselineProbe = experiment.phase === "monitoring" && experiment.id.startsWith("baseline:");
      const center = isBaselineProbe ? 120 : repaired || this.fixture === "fsr_balanced" || !isSubject ? 1800 + Math.max(referenceIndex, 0) * 8 : 1000;
      const amplitude = noisy ? 180 : 18;
      const values = makeTrace(64, center + (count % 3 - 1) * 5, amplitude);
      const sampleMean = mean(values);
      const sampleStddev = stddev(values);
      measurements.push(
        { channel: "adc_mean", value: Number(sampleMean.toFixed(2)), unit: "adc_raw", deviceId: device.id, quality: failed ? "invalid" : "valid" },
        { channel: "adc_stddev", value: Number(sampleStddev.toFixed(2)), unit: "adc_raw", deviceId: device.id, quality: failed ? "invalid" : "valid" },
        { channel: "normalized_response", value: Number((sampleMean / device.circuit.adcMaximumRaw).toFixed(6)), unit: "ratio", deviceId: device.id, quality: failed ? "invalid" : "valid" },
      );
      series.push({ channel: "adc_raw", unit: "adc_raw", deviceId: device.id, sampleIntervalMs: 10, values });
      sensorHealth.push({ deviceId: device.id, healthy: !failed, errorRate: failed ? 1 : 0, detail: failed ? "Simulated ADC read failure." : undefined });
      accepted = !failed;
    } else if (experiment.command === "sample_mpu6050" && device?.type === "mpu6050") {
      const count = (this.calls.get(device.id) ?? 0) + 1; this.calls.set(device.id, count);
      const motion = 0.08 + Math.abs(Math.sin(count * 0.7)) * 0.55; const values = makeTrace(48, motion, 0.06);
      measurements.push({ channel: "acceleration_magnitude_g", value: Number(mean(values).toFixed(4)), unit: "g", deviceId: device.id, quality: "valid" }, { channel: "gyro_magnitude_dps", value: Number((motion * 82).toFixed(2)), unit: "deg/s", deviceId: device.id, quality: "valid" });
      series.push({ channel: "acceleration_magnitude_g", unit: "g", deviceId: device.id, sampleIntervalMs: 20, values }); sensorHealth.push({ deviceId: device.id, healthy: true, errorRate: 0 });
    } else if (experiment.command === "sample_dht11" && device?.type === "dht11") {
      const count = (this.calls.get(device.id) ?? 0) + 1; this.calls.set(device.id, count); const temperature = 27 + Math.sin(count * 0.35) * 1.4; const humidity = 54 + Math.sin(count * 0.22) * 3;
      measurements.push({ channel: "temperature_c", value: Number(temperature.toFixed(2)), unit: "C", deviceId: device.id, quality: "valid" }, { channel: "humidity_percent", value: Number(humidity.toFixed(2)), unit: "%", deviceId: device.id, quality: "valid" }); sensorHealth.push({ deviceId: device.id, healthy: true, errorRate: 0 });
    } else if (experiment.command === "measure_distance" && device?.type === "hc_sr04") {
      const count = (this.calls.get(device.id) ?? 0) + 1; this.calls.set(device.id, count); const center = 55 - Math.abs(Math.sin(count * 0.45)) * 32; const values = makeTrace(20, center, 0.7);
      measurements.push({ channel: "distance_cm", value: Number(mean(values).toFixed(2)), unit: "cm", deviceId: device.id, quality: "valid" }, { channel: "distance_stddev_cm", value: Number(stddev(values).toFixed(2)), unit: "cm", deviceId: device.id, quality: "valid" }); series.push({ channel: "distance_cm", unit: "cm", deviceId: device.id, sampleIntervalMs: 60, values }); sensorHealth.push({ deviceId: device.id, healthy: true, errorRate: 0 });
    } else if (device) {
      measurements.push({ channel: "operation_supported", value: true, unit: "boolean", deviceId: device.id, quality: "valid" }); sensorHealth.push({ deviceId: device.id, healthy: true, errorRate: 0 });
    } else {
      sensorHealth.push({ deviceId: "firmware", healthy: true, errorRate: 0 });
    }

    return {
      id: randomUUID(), sessionId: context.sessionId, experimentId: experiment.id, deviceId: device?.id, deviceType: device?.type, source: "simulation", adapter: "simulator", command: experiment.command, phase: context.phase, capturedAt: new Date().toISOString(), deviceUptimeMs: Date.now() - this.startedAt, elapsedMs: Math.max(Date.now() - started, 25), measurements, series, sensorHealth,
      operation: { accepted, aborted: experiment.command === "abort", timedOut, estopLatched: this.estopLatched, reasons: accepted ? [] : ["SIMULATED_READ_FAILURE"] }, projectContextDigest: context.projectContextDigest,
    };
  }
}

function makeTrace(length: number, center: number, amplitude: number): number[] { return Array.from({ length }, (_, index) => Number((center + Math.sin(index * 0.71) * amplitude + Math.sin(index * 1.91) * amplitude * 0.3).toFixed(2))) }
function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length }
function stddev(values: number[]): number { const average = mean(values); return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length) }
