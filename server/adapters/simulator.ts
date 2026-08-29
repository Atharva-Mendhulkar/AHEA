import { randomUUID } from "node:crypto";
import type {
  HardwareCommand,
  HardwareStatus,
  Measurement,
  Observation,
  SensorHealth,
} from "../../shared/domain.js";
import type { ExecuteContext, HardwareAdapter } from "./adapter.js";

export type SimulatorFixture = "disconnected" | "healthy" | "stalled" | "sensor_failure";

export class SimulatorAdapter implements HardwareAdapter {
  readonly source = "simulation" as const;
  readonly name = "simulator" as const;
  private interventionDeclared = false;
  private estopLatched = false;
  private readonly startedAt = Date.now();

  constructor(readonly fixture: SimulatorFixture = "disconnected") {}

  async preflight(): Promise<HardwareStatus> {
    return {
      connected: true,
      firmwareVersion: "sim-1.0.0",
      boardIdentity: "SIM-ESP32S3",
      protocolVersion: "1.0",
      profileId: "sim-dc-motor-v1",
      physicalEnabled: false,
      estopLatched: this.estopLatched,
      supportedCommands: [
        "scan_i2c", "sample_motion", "motor_motion_probe", "motor_current_probe", "verify_motor", "emergency_stop",
      ],
      detectedI2c: ["0x40", "0x68"],
    };
  }

  declareIntervention(): void {
    this.interventionDeclared = true;
  }

  async armSession(): Promise<void> {}

  async close(): Promise<void> {}

  async execute(command: HardwareCommand, context: ExecuteContext): Promise<Observation> {
    const started = Date.now();
    if (command === "emergency_stop") this.estopLatched = true;
    const activation = command.startsWith("motor_") || command === "verify_motor";
    const repaired = this.interventionDeclared && this.fixture === "disconnected";
    const effectiveFixture: SimulatorFixture = repaired ? "healthy" : this.fixture;
    const sensorFailed = effectiveFixture === "sensor_failure";
    const motionDetected = effectiveFixture === "healthy";
    const currentMean = effectiveFixture === "healthy" ? 181 : effectiveFixture === "stalled" ? 430 : 2.4;
    const measurements: Measurement[] = [];
    const health: SensorHealth[] = [];

    if (command === "scan_i2c") {
      measurements.push({ name: "detected_addresses", value: "0x40,0x68", unit: "address", sensor: "firmware", quality: "valid" });
      health.push({ sensor: "firmware", healthy: true, errorRate: 0 });
    }
    if (command === "sample_motion" || command === "motor_motion_probe" || command === "verify_motor") {
      const rms = motionDetected ? 0.225 : 0.015;
      measurements.push(
        { name: "acceleration_rms_g", value: rms, unit: "g", sensor: "mpu6050", quality: sensorFailed ? "invalid" : "valid" },
        { name: "baseline_rms_g", value: 0.012, unit: "g", sensor: "mpu6050", quality: sensorFailed ? "invalid" : "valid" },
        { name: "delta_from_baseline_g", value: rms - 0.012, unit: "g", sensor: "mpu6050", quality: sensorFailed ? "invalid" : "valid" },
        { name: "expected_motion_signature_detected", value: motionDetected, unit: "boolean", sensor: "mpu6050", quality: sensorFailed ? "invalid" : "valid" },
      );
      health.push({ sensor: "mpu6050", healthy: !sensorFailed, errorRate: sensorFailed ? 0.25 : 0, detail: sensorFailed ? "Simulated I2C read errors" : undefined });
    }
    if (command === "motor_current_probe" || command === "verify_motor") {
      measurements.push(
        { name: "current_mean_ma", value: currentMean, unit: "mA", sensor: "ina219", quality: sensorFailed ? "invalid" : "valid" },
        { name: "current_peak_ma", value: currentMean * 1.08, unit: "mA", sensor: "ina219", quality: sensorFailed ? "invalid" : "valid" },
        { name: "idle_delta_ma", value: currentMean - 2.5, unit: "mA", sensor: "ina219", quality: sensorFailed ? "invalid" : "valid" },
      );
      health.push({ sensor: "ina219", healthy: !sensorFailed, errorRate: sensorFailed ? 0.25 : 0 });
    }
    if (command === "emergency_stop") {
      measurements.push({ name: "estop_latched", value: true, unit: "boolean", sensor: "firmware", quality: "valid" });
      health.push({ sensor: "firmware", healthy: true, errorRate: 0 });
    }

    return {
      id: randomUUID(),
      sessionId: context.sessionId,
      experimentId: context.experimentId,
      source: "simulation",
      adapter: "simulator",
      command,
      capturedAt: new Date().toISOString(),
      deviceUptimeMs: Date.now() - this.startedAt,
      elapsedMs: Math.max(Date.now() - started, activation ? 153 : 5),
      measurements,
      sensorHealth: health,
      safety: {
        activationAccepted: activation && !this.estopLatched,
        tripped: false,
        estopLatched: this.estopLatched,
        timeout: false,
        reasons: this.estopLatched ? ["Emergency stop is latched."] : [],
      },
      calibrationId: context.calibration.id,
    };
  }
}
