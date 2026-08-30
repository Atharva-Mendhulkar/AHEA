import { randomUUID } from "node:crypto";
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import type { ExperimentDefinition, HardwareCommand, HardwareStatus, Observation, ProjectContext } from "../../shared/domain.js";
import { capabilityRegistrySchema, protocolResponseSchema, type ProtocolResponse } from "../../shared/schemas.js";
import { registryMatchesReviewedPlans } from "../modules.js";
import type { ExecuteContext, HardwareAdapter } from "./adapter.js";

export function validatePhysicalHello(response: ProtocolResponse, context: ProjectContext): HardwareStatus {
  if (!response.ok || !response.data || !response.data.registry) throw new Error(response.error?.message ?? "Firmware hello did not include a capability registry.");
  const data = response.data;
  const registry = capabilityRegistrySchema.parse(data.registry);
  const failures: string[] = [];
  if (!data.physicalEnabled) failures.push("physical profile is disabled");
  if (!data.operation.cleanupSucceeded) failures.push("safe cleanup was not reported");
  if (data.operation.estopLatched) failures.push("emergency stop is latched");
  if (data.planId !== "hello") failures.push("response is not a hello handshake");
  if (data.protocolVersion !== "3.0") failures.push("protocol version mismatch");
  if (data.hardwareProfileId !== context.hardwareProfileId || registry.hardwareProfileId !== context.hardwareProfileId) failures.push("hardware profile mismatch");
  if (registry.boardIdentity !== data.boardIdentity) failures.push("board identity mismatch");
  if (registry.digest !== data.registryDigest) failures.push("registry digest mismatch");
  if (!registryMatchesReviewedPlans(context, registry)) failures.push("reviewed plan definitions mismatch");
  if (failures.length) throw new Error(`Firmware identity preflight rejected: ${failures.join("; ")}.`);
  return { connected: true, firmwareVersion: data.firmwareVersion, boardIdentity: data.boardIdentity, protocolVersion: data.protocolVersion, profileId: data.hardwareProfileId, physicalEnabled: true, estopLatched: data.operation.estopLatched, registry, limitations: data.limitations };
}

export class SerialAdapter implements HardwareAdapter {
  readonly source = "physical" as const;
  readonly name = "esp32" as const;
  private port?: SerialPort;
  private parser?: ReadlineParser;
  private status?: HardwareStatus;
  private readonly pending = new Map<string, { resolve: (value: ProtocolResponse) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  constructor(private readonly path: string, private readonly physicalEnabled: boolean, private readonly context: ProjectContext) {}
  private async connect(): Promise<void> {
    if (this.port?.isOpen) return;
    this.port = new SerialPort({ path: this.path, baudRate: 115200, autoOpen: false });
    this.parser = this.port.pipe(new ReadlineParser({ delimiter: "\n" }));
    this.parser.on("data", (line: string) => this.onLine(line));
    this.port.on("close", () => this.rejectAll(new Error("Serial connection closed.")));
    this.port.on("error", (error) => this.rejectAll(error));
    await new Promise<void>((resolve, reject) => this.port!.open((error) => error ? reject(error) : resolve()));
    // CP2102-style UART bridges commonly reset the ESP32-S3 when the port opens.
    // Wait for setup() to complete so the first protocol request is not lost.
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  private onLine(line: string): void {
    let payload: unknown;
    try { payload = JSON.parse(line); } catch { return; } // Ignore ROM/bootloader diagnostics emitted on the UART.
    const result = protocolResponseSchema.safeParse(payload);
    if (!result.success) { this.rejectAll(new Error("Firmware returned a malformed protocol response.")); return; }
    const waiter = this.pending.get(result.data.id); if (!waiter) return;
    clearTimeout(waiter.timer); this.pending.delete(result.data.id); waiter.resolve(result.data);
  }
  private rejectAll(error: Error): void { for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); } this.pending.clear(); }
  private async request(cmd: HardwareCommand | "hello" | "arm_session", args: { targetId?: string; planId?: string }, timeoutMs = 5000): Promise<ProtocolResponse> {
    await this.connect(); const id = randomUUID(); const payload = `${JSON.stringify({ id, cmd, args })}\n`;
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Serial command ${cmd} timed out.`)); }, timeoutMs); this.pending.set(id, { resolve, reject, timer }); this.port!.write(payload, (error) => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); } }); });
  }
  async preflight(): Promise<HardwareStatus> {
    if (!this.physicalEnabled) throw new Error("Physical mode is disabled by AHEA_PHYSICAL_ENABLED.");
    if (!this.path) throw new Error("AHEA_SERIAL_PATH is required for physical mode.");
    this.status = validatePhysicalHello(await this.request("hello", {}), this.context);
    return this.status;
  }
  async armSession(): Promise<void> { const response = await this.request("arm_session", {}); if (!response.ok) throw new Error(response.error?.message ?? "Firmware refused session arming."); }
  async declareIntervention(): Promise<void> {
    // A reviewed intervention requires power removal. Re-establish firmware
    // identity and safety arming after the board has restarted.
    this.status = undefined;
    await this.preflight();
    await this.armSession();
  }
  async execute(experiment: ExperimentDefinition, execution: ExecuteContext): Promise<Observation> {
    if (!experiment.command || !experiment.planId) throw new Error("Experiment has no registered hardware plan.");
    if (!this.status) await this.preflight();
    const response = experiment.command === "abort"
      ? await this.request("abort", {}, 1000)
      : await this.request(experiment.command, { targetId: experiment.targetId, planId: experiment.planId }, Math.max(5000, (this.status?.registry.plans.find((entry) => entry.id === experiment.planId)?.durationMs ?? 0) + 2000));
    if (!response.ok || !response.data || !this.status) throw new Error(response.error?.message ?? `Firmware rejected ${experiment.planId}.`);
    const target = this.context.targets.find((entry) => entry.id === experiment.targetId); if (!target) throw new Error("Target is not in project context.");
    return { id: randomUUID(), sessionId: execution.sessionId, experimentId: experiment.id, targetId: target.id, targetType: target.type, source: "physical", adapter: "esp32", command: experiment.command, planId: response.data.planId, phase: execution.phase, capturedAt: new Date().toISOString(), monotonicStartedMs: response.data.monotonicStartedMs, monotonicEndedMs: response.data.monotonicEndedMs, sequenceNumber: response.data.sequenceNumber, measurements: response.data.measurements, series: response.data.series, targetHealth: response.data.targetHealth, operation: response.data.operation, projectContextDigest: execution.projectContextDigest, registryDigest: response.data.registryDigest, firmwareVersion: response.data.firmwareVersion, boardIdentity: response.data.boardIdentity, hardwareProfileId: response.data.hardwareProfileId, bindingIds: response.data.bindingIds, setupDeclaration: execution.setupDeclaration, gatewayValidation: execution.gatewayValidation, limitations: response.data.limitations };
  }
  async close(): Promise<void> { if (!this.port?.isOpen) return; await new Promise<void>((resolve) => this.port!.close(() => resolve())); }
}
