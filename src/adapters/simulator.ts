import type {
  AdapterResult,
  ExperimentTool,
  HardwareAdapter,
  RawMeasurement,
  SensorName
} from "../types.js";

export type SimulatorFixture = "disconnected" | "healthy" | "stalled" | "sensor_failure";

function reading(
  name: RawMeasurement["name"],
  value: number,
  unit: RawMeasurement["unit"],
  sensor: SensorName,
  errorRate = 0
): RawMeasurement {
  return {
    name,
    value,
    unit,
    sensor,
    health: { healthy: errorRate <= 0.05, errorRate }
  };
}

export class SimulatorAdapter implements HardwareAdapter {
  readonly identity = {
    source: "simulation" as const,
    adapter: "simulator" as const,
    deviceId: "sim-esp32-s3",
    firmwareVersion: "sim-1.0.0"
  };

  private emergencyStopLatched = false;
  private repaired = false;
  private faultArmed = false;
  private verificationCount = 0;

  constructor(public readonly fixture: SimulatorFixture) {}

  applyRepair(): void {
    this.repaired = true;
  }

  armFault(): void {
    this.faultArmed = true;
  }

  async execute(tool: ExperimentTool, requestId: string): Promise<AdapterResult> {
    const started = performance.now();
    if (tool === "emergency_stop") {
      this.emergencyStopLatched = true;
      return this.result(requestId, started, [], false);
    }
    if (this.emergencyStopLatched) {
      return this.result(requestId, started, [], false, {
        code: "E_STOP_LATCHED",
        message: "Emergency stop remains latched until adapter reset."
      });
    }
    if (tool === "scan_i2c") {
      return {
        ...this.result(requestId, started, [], false),
        detectedAddresses: ["0x40", "0x68"],
        firmwareVersion: this.identity.firmwareVersion
      };
    }
    if (tool === "sample_motion") {
      return this.result(requestId, started, [
        reading("baseline_rms_g", 0.01, "g", "MPU6050"),
        reading("current_mean_ma", 2.1, "mA", "INA219")
      ], false);
    }

    const effectiveFixture: SimulatorFixture =
      !this.faultArmed || this.repaired ? "healthy" : this.fixture;
    const errorRate = effectiveFixture === "sensor_failure" ? 0.12 : 0;
    const motionRms = effectiveFixture === "healthy" ? 0.22 : 0.012;
    const currentMean =
      effectiveFixture === "healthy"
        ? this.verificationCount++ % 2 === 0
          ? 176
          : 182
        : effectiveFixture === "stalled"
          ? 410
          : 2.4;
    const currentPeak = effectiveFixture === "stalled" ? 475 : currentMean * 1.18;

    if (tool === "motor_motion_probe") {
      return this.result(
        requestId,
        started,
        [
          reading("acceleration_rms_g", motionRms, "g", "MPU6050", errorRate),
          reading("baseline_rms_g", 0.01, "g", "MPU6050", errorRate)
        ],
        true
      );
    }
    if (tool === "motor_current_probe") {
      return this.result(
        requestId,
        started,
        [
          reading("current_mean_ma", currentMean, "mA", "INA219"),
          reading("current_peak_ma", currentPeak, "mA", "INA219")
        ],
        true
      );
    }
    return this.result(
      requestId,
      started,
      [
        reading("acceleration_rms_g", motionRms, "g", "MPU6050", errorRate),
        reading("baseline_rms_g", 0.01, "g", "MPU6050", errorRate),
        reading("current_mean_ma", currentMean, "mA", "INA219"),
        reading("current_peak_ma", currentPeak, "mA", "INA219")
      ],
      true
    );
  }

  async close(): Promise<void> {}

  private result(
    requestId: string,
    started: number,
    measurements: RawMeasurement[],
    activationAccepted: boolean,
    error?: { code: string; message: string }
  ): AdapterResult {
    return {
      requestId,
      ok: !error,
      elapsedMs: Math.max(1, Math.round(performance.now() - started)),
      measurements,
      activationAccepted,
      tripped: false,
      ...(error ? { error } : {})
    };
  }
}
