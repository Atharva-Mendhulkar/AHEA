import { randomUUID } from "node:crypto";
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import type { HardwareCommand, HardwareStatus, Observation } from "../../shared/domain.js";
import { protocolResponseSchema, type ProtocolResponse } from "../../shared/schemas.js";
import type { ExecuteContext, HardwareAdapter } from "./adapter.js";

export class SerialAdapter implements HardwareAdapter {
  readonly source = "physical" as const;
  readonly name = "esp32" as const;
  private port?: SerialPort;
  private parser?: ReadlineParser;
  private status?: HardwareStatus;
  private pending = new Map<string, { resolve: (value: ProtocolResponse) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  constructor(private readonly path: string, private readonly physicalEnabled: boolean) {}

  private async connect(): Promise<void> {
    if (this.port?.isOpen) return;
    this.port = new SerialPort({ path: this.path, baudRate: 115_200, autoOpen: false });
    this.parser = this.port.pipe(new ReadlineParser({ delimiter: "\n" }));
    this.parser.on("data", (line: string) => this.onLine(line));
    this.port.on("close", () => this.rejectAll(new Error("Serial connection closed.")));
    this.port.on("error", (error) => this.rejectAll(error));
    await new Promise<void>((resolve, reject) => this.port!.open((error) => error ? reject(error) : resolve()));
  }

  private onLine(line: string): void {
    try {
      const parsed = protocolResponseSchema.parse(JSON.parse(line));
      const waiter = this.pending.get(parsed.id);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      this.pending.delete(parsed.id);
      waiter.resolve(parsed);
    } catch {
      void this.sendEmergencyStop();
    }
  }

  private rejectAll(error: Error): void {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
  }

  private async request(cmd: HardwareCommand | "hello" | "arm_session", timeoutMs = 2_000): Promise<ProtocolResponse> {
    await this.connect();
    const id = randomUUID();
    const payload = JSON.stringify({ id, cmd, args: {} }) + "\n";
    return new Promise<ProtocolResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        void this.sendEmergencyStop();
        reject(new Error(`Serial command ${cmd} timed out.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.port!.write(payload, (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  private async sendEmergencyStop(): Promise<void> {
    if (!this.port?.isOpen) return;
    this.port.write(JSON.stringify({ id: randomUUID(), cmd: "emergency_stop", args: {} }) + "\n");
  }

  async preflight(): Promise<HardwareStatus> {
    if (!this.physicalEnabled) throw new Error("Physical mode is disabled by AHEA_PHYSICAL_ENABLED.");
    const hello = await this.request("hello");
    if (!hello.ok || !hello.data) throw new Error(hello.error?.message ?? "Firmware hello failed.");
    const get = (name: string) => hello.data!.measurements.find((item) => item.name === name)?.value;
    const scan = await this.request("scan_i2c");
    if (!scan.ok || !scan.data) throw new Error(scan.error?.message ?? "I2C scan failed.");
    const present = (name: string) => scan.data!.measurements.find((item) => item.name === name)?.value === true;
    this.status = {
      connected: true,
      firmwareVersion: String(get("firmware_version") ?? "unknown"),
      boardIdentity: String(get("board_identity") ?? "unknown"),
      protocolVersion: String(get("protocol_version") ?? "unknown"),
      profileId: String(get("profile_id") ?? "unknown"),
      physicalEnabled: get("physical_enabled") === true,
      estopLatched: hello.data.safety.estopLatched,
      supportedCommands: ["scan_i2c", "sample_motion", "motor_motion_probe", "motor_current_probe", "verify_motor", "emergency_stop"],
      detectedI2c: [present("ina219_present") ? "0x40" : "", present("mpu6050_present") ? "0x68" : ""].filter(Boolean),
    };
    if (!this.status.physicalEnabled) throw new Error("Firmware hardware profile is safe-disabled.");
    if (!present("ina219_present") || !present("mpu6050_present")) throw new Error("Required MPU6050 or INA219 sensor is missing.");
    return this.status;
  }

  async armSession(): Promise<void> {
    const response = await this.request("arm_session");
    if (!response.ok) throw new Error(response.error?.message ?? "Firmware refused session arming.");
  }

  declareIntervention(): void {}

  async execute(command: HardwareCommand, context: ExecuteContext): Promise<Observation> {
    if (!this.status) await this.preflight();
    const response = await this.request(command, command === "emergency_stop" ? 1_000 : 3_000);
    if (!response.ok || !response.data) throw new Error(response.error?.message ?? `Firmware rejected ${command}.`);
    return {
      id: randomUUID(),
      sessionId: context.sessionId,
      experimentId: context.experimentId,
      source: "physical",
      adapter: "esp32",
      command,
      capturedAt: new Date().toISOString(),
      deviceUptimeMs: response.data.deviceUptimeMs,
      elapsedMs: response.data.elapsedMs,
      measurements: response.data.measurements,
      series: response.data.series,
      sensorHealth: response.data.sensorHealth,
      safety: response.data.safety,
      calibrationId: context.calibration.id,
    };
  }

  async close(): Promise<void> {
    if (!this.port?.isOpen) return;
    await new Promise<void>((resolve) => this.port!.close(() => resolve()));
  }
}
