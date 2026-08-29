import { randomUUID } from "node:crypto";
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import type { ExperimentDefinition, HardwareCommand, HardwareStatus, Observation, ProjectContext } from "../../shared/domain.js";
import { protocolResponseSchema, type ProtocolResponse } from "../../shared/schemas.js";
import type { ExecuteContext, HardwareAdapter } from "./adapter.js";

export class SerialAdapter implements HardwareAdapter {
  readonly source = "physical" as const;
  readonly name = "esp32" as const;
  private port?: SerialPort;
  private parser?: ReadlineParser;
  private status?: HardwareStatus;
  private pending = new Map<string, { resolve: (value: ProtocolResponse) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  constructor(private readonly path: string, private readonly physicalEnabled: boolean, private readonly projectContext: ProjectContext) {}

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
    try { const parsed = protocolResponseSchema.parse(JSON.parse(line)); const waiter = this.pending.get(parsed.id); if (!waiter) return; clearTimeout(waiter.timer); this.pending.delete(parsed.id); waiter.resolve(parsed); }
    catch { void this.request("abort", {}, 500).catch(() => undefined); }
  }
  private rejectAll(error: Error): void { for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); } this.pending.clear(); }
  private async request(cmd: HardwareCommand | "hello" | "arm_session", args: { deviceId?: string; planId?: string }, timeoutMs = 2_500): Promise<ProtocolResponse> {
    await this.connect(); const id = randomUUID(); const payload = JSON.stringify({ id, cmd, args }) + "\n";
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Serial command ${cmd} timed out.`)); }, timeoutMs); this.pending.set(id, { resolve, reject, timer }); this.port!.write(payload, (error) => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); } }); });
  }

  async preflight(): Promise<HardwareStatus> {
    if (!this.physicalEnabled) throw new Error("Physical mode is disabled by AHEA_PHYSICAL_ENABLED.");
    if (!this.path) throw new Error("AHEA_SERIAL_PATH is required for physical mode.");
    const hello = await this.request("hello", {}); if (!hello.ok || !hello.data) throw new Error(hello.error?.message ?? "Firmware hello failed.");
    const get = (channel: string) => hello.data!.measurements.find((item) => item.channel === channel)?.value;
    const scan = await this.request("scan_i2c", {}); const mpuPresent = scan.ok && scan.data?.measurements.find((item) => item.channel === "mpu6050_present")?.value === true;
    this.status = { connected: true, firmwareVersion: String(get("firmware_version") ?? "unknown"), boardIdentity: String(get("board_identity") ?? "unknown"), protocolVersion: String(get("protocol_version") ?? "unknown"), profileId: String(get("profile_id") ?? "unknown"), physicalEnabled: get("physical_enabled") === true, estopLatched: hello.data.operation.estopLatched, supportedCommands: ["scan_i2c", "identify_mpu6050", "sample_mpu6050", "sample_dht11", "measure_distance", "sample_fsr", "abort"], detectedDevices: this.projectContext.components.map((device) => ({ deviceId: device.id, type: device.type, present: device.type === "mpu6050" ? mpuPresent : undefined, identity: device.type === "mpu6050" && mpuPresent ? "MPU6050@configured-address" : undefined })), limitations: ["Only I2C presence is discoverable. DHT11, HC-SR04, and FSR bindings remain unverified until their explicit bounded read succeeds."] };
    if (!this.status.physicalEnabled || this.status.profileId !== this.projectContext.hardwareProfileId) throw new Error("Firmware profile is disabled or does not match project context.");
    return this.status;
  }
  async armSession(): Promise<void> { const response = await this.request("arm_session", {}); if (!response.ok) throw new Error(response.error?.message ?? "Firmware refused session arming."); }
  declareIntervention(): void {}
  async execute(experiment: ExperimentDefinition, context: ExecuteContext): Promise<Observation> {
    if (!experiment.command) throw new Error("Experiment has no hardware command.");
    if (!this.status) await this.preflight();
    const response = await this.request(experiment.command, { deviceId: experiment.targetDeviceId, planId: experiment.planId });
    if (!response.ok || !response.data) throw new Error(response.error?.message ?? `Firmware rejected ${experiment.command}.`);
    const device = experiment.targetDeviceId ? this.projectContext.components.find((item) => item.id === experiment.targetDeviceId) : undefined;
    return { id: randomUUID(), sessionId: context.sessionId, experimentId: experiment.id, deviceId: device?.id, deviceType: device?.type, source: "physical", adapter: "esp32", command: experiment.command, phase: context.phase, capturedAt: new Date().toISOString(), deviceUptimeMs: response.data.deviceUptimeMs, elapsedMs: response.data.elapsedMs, measurements: response.data.measurements, series: response.data.series, sensorHealth: response.data.sensorHealth, operation: response.data.operation, projectContextDigest: context.projectContextDigest };
  }
  async close(): Promise<void> { if (!this.port?.isOpen) return; await new Promise<void>((resolve) => this.port!.close(() => resolve())); }
}
