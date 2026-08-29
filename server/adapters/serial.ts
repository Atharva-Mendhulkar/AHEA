import { randomUUID } from "node:crypto";
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import type { ExperimentDefinition, HardwareCommand, HardwareStatus, Observation, ProjectContext } from "../../shared/domain.js";
import { capabilityRegistrySchema, protocolResponseSchema, type ProtocolResponse } from "../../shared/schemas.js";
import type { ExecuteContext, HardwareAdapter } from "./adapter.js";

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
  }
  private onLine(line: string): void { try { const parsed = protocolResponseSchema.parse(JSON.parse(line)); const waiter = this.pending.get(parsed.id); if (!waiter) return; clearTimeout(waiter.timer); this.pending.delete(parsed.id); waiter.resolve(parsed); } catch { void this.request("abort", {}, 500).catch(() => undefined); } }
  private rejectAll(error: Error): void { for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); } this.pending.clear(); }
  private async request(cmd: HardwareCommand | "hello" | "arm_session", args: { targetId?: string; planId?: string }, timeoutMs = 5000): Promise<ProtocolResponse> {
    await this.connect(); const id = randomUUID(); const payload = `${JSON.stringify({ id, cmd, args })}\n`;
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Serial command ${cmd} timed out.`)); }, timeoutMs); this.pending.set(id, { resolve, reject, timer }); this.port!.write(payload, (error) => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); } }); });
  }
  async preflight(): Promise<HardwareStatus> {
    if (!this.physicalEnabled) throw new Error("Physical mode is disabled by AHEA_PHYSICAL_ENABLED.");
    if (!this.path) throw new Error("AHEA_SERIAL_PATH is required for physical mode.");
    const hello = await this.request("hello", {}); if (!hello.ok || !hello.data || !hello.data.registry) throw new Error(hello.error?.message ?? "Firmware hello did not include a capability registry.");
    const registry = capabilityRegistrySchema.parse(hello.data.registry);
    const missing = this.context.allowedPlanIds.filter((planId) => !registry.plans.some((entry) => entry.id === planId));
    if (!hello.data.physicalEnabled || hello.data.hardwareProfileId !== this.context.hardwareProfileId || registry.hardwareProfileId !== this.context.hardwareProfileId || missing.length) throw new Error(`Firmware profile or capability registry does not match project context${missing.length ? `; missing ${missing.join(", ")}` : ""}.`);
    this.status = { connected: true, firmwareVersion: hello.data.firmwareVersion, boardIdentity: hello.data.boardIdentity, protocolVersion: hello.data.protocolVersion, profileId: hello.data.hardwareProfileId, physicalEnabled: true, estopLatched: hello.data.operation.estopLatched, registry, limitations: hello.data.limitations };
    return this.status;
  }
  async armSession(): Promise<void> { const response = await this.request("arm_session", {}); if (!response.ok) throw new Error(response.error?.message ?? "Firmware refused session arming."); }
  declareIntervention(): void {}
  async execute(experiment: ExperimentDefinition, execution: ExecuteContext): Promise<Observation> {
    if (!experiment.command || !experiment.planId) throw new Error("Experiment has no registered hardware plan.");
    if (!this.status) await this.preflight();
    const response = await this.request(experiment.command, { targetId: experiment.targetId, planId: experiment.planId });
    if (!response.ok || !response.data || !this.status) throw new Error(response.error?.message ?? `Firmware rejected ${experiment.planId}.`);
    const target = this.context.targets.find((entry) => entry.id === experiment.targetId); if (!target) throw new Error("Target is not in project context.");
    return { id: randomUUID(), sessionId: execution.sessionId, experimentId: experiment.id, targetId: target.id, targetType: target.type, source: "physical", adapter: "esp32", command: experiment.command, planId: response.data.planId, phase: execution.phase, capturedAt: new Date().toISOString(), monotonicStartedMs: response.data.monotonicStartedMs, monotonicEndedMs: response.data.monotonicEndedMs, sequenceNumber: response.data.sequenceNumber, measurements: response.data.measurements, series: response.data.series, targetHealth: response.data.targetHealth, operation: response.data.operation, projectContextDigest: execution.projectContextDigest, registryDigest: response.data.registryDigest, firmwareVersion: response.data.firmwareVersion, boardIdentity: response.data.boardIdentity, hardwareProfileId: response.data.hardwareProfileId, bindingIds: response.data.bindingIds, setupDeclaration: execution.setupDeclaration, gatewayValidation: execution.gatewayValidation, limitations: response.data.limitations };
  }
  async close(): Promise<void> { if (!this.port?.isOpen) return; await new Promise<void>((resolve) => this.port!.close(() => resolve())); }
}
