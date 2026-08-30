import { randomUUID } from "node:crypto";
import type { ExperimentDefinition, HardwareStatus, Observation, ProjectContext, SimulationSpecification } from "../../shared/domain.js";
import { targetById } from "../../shared/domain.js";
import { registryForContext } from "../modules.js";
import { generateCapture } from "../simulation/generators.js";
import { loadReplayCapture, loadSimulationModel, type SimulationPaths } from "../simulation/catalog.js";
import type { ExecuteContext, HardwareAdapter } from "./adapter.js";

export class SimulatorAdapter implements HardwareAdapter {
  readonly source = "simulation" as const;
  readonly name = "simulator" as const;
  private interventionDeclared = false;
  private estopLatched = false;
  private sequence = 0;
  private readonly startedAt = Date.now();
  private readonly status: HardwareStatus;

  constructor(readonly specification: SimulationSpecification, private readonly context: ProjectContext, private readonly paths: SimulationPaths = {}) {
    const registry = registryForContext(context);
    this.status = { connected: true, firmwareVersion: `sim-${specification.model.version}`, boardIdentity: "SIM-ESP32S3", protocolVersion: "3.0", profileId: context.hardwareProfileId, physicalEnabled: false, estopLatched: false, registry, limitations: ["Simulation output is synthetic or replayed and cannot produce physical confirmation.", specification.calibration.status === "model_only" ? "Model only: no qualifying ESP32-S3 calibration corpus has been accepted." : "Generated parameters were derived from the declared ESP32-S3 calibration corpus."] };
  }
  async preflight(): Promise<HardwareStatus> { return structuredClone(this.status); }
  async armSession(): Promise<void> {}
  declareIntervention(): void { this.interventionDeclared = true; }
  async close(): Promise<void> {}

  private replay(planId: string, targetId: string) {
    const capture = loadReplayCapture(this.specification.replay!.captureId, this.paths);
    const matching = capture.report.experiments.filter((entry) => entry.planId === planId);
    const source = matching[(this.sequence - 1) % Math.max(matching.length, 1)];
    if (!source) throw new Error(`Replay capture does not contain plan ${planId}.`);
    return {
      measurements: source.measurements.map((entry) => ({ ...entry, targetId })),
      series: source.series.map((entry) => ({ ...entry, targetId, values: [...entry.values] })),
      targetHealth: source.targetHealth.map((entry) => ({ ...entry, targetId })),
      operation: { ...source.operation, estopLatched: this.estopLatched, reasons: [...source.operation.reasons, "SIMULATION_REPLAY"] },
    };
  }

  async execute(experiment: ExperimentDefinition, execution: ExecuteContext): Promise<Observation> {
    if (!experiment.command || !experiment.planId) throw new Error(`Experiment ${experiment.type} has no registered hardware plan.`);
    const registered = this.status.registry.plans.find((entry) => entry.id === experiment.planId);
    if (!registered) throw new Error(`Plan ${experiment.planId} was not advertised.`);
    const target = targetById(this.context, experiment.targetId);
    if (!target || target.type !== registered.targetType) throw new Error("Plan target does not match project context.");
    const started = Date.now() - this.startedAt; this.sequence += 1;
    if (experiment.command === "abort") this.estopLatched = true;
    let measurements; let series; let targetHealth; let operation;
    if (this.specification.engine === "replay") {
      ({ measurements, series, targetHealth, operation } = this.replay(experiment.planId, target.id));
    } else {
      const generated = generateCapture({ kind: target.type, planId: experiment.planId, phase: execution.phase, ordinal: this.sequence, targetId: target.id, seed: this.specification.seed, scenario: this.specification.scenario, model: loadSimulationModel(target.type, this.paths), interventionDeclared: this.interventionDeclared });
      measurements = generated.measurements; series = generated.series;
      const invalidRate = measurements.length ? measurements.filter((entry) => entry.quality === "invalid").length / measurements.length : 0;
      targetHealth = [{ targetId: target.id, healthy: generated.healthy, errorRate: generated.healthy ? invalidRate : Math.max(invalidRate, 1), detail: generated.detail }];
      operation = { accepted: generated.healthy, aborted: experiment.command === "abort", timedOut: this.specification.scenario.condition === "timeout", estopLatched: this.estopLatched, cleanupSucceeded: true, reasons: generated.healthy ? [] : ["SIMULATED_PROFILE_FAULT"] };
    }
    const ended = Math.max(started + registered.durationMs, Date.now() - this.startedAt);
    return {
      id: randomUUID(), sessionId: execution.sessionId, experimentId: experiment.id, targetId: target.id, targetType: target.type, source: "simulation", adapter: "simulator", command: experiment.command, planId: experiment.planId, phase: execution.phase, capturedAt: new Date().toISOString(), monotonicStartedMs: started, monotonicEndedMs: ended, sequenceNumber: this.sequence,
      measurements, series, targetHealth, operation,
      projectContextDigest: execution.projectContextDigest, registryDigest: this.status.registry.digest, firmwareVersion: this.status.firmwareVersion, boardIdentity: this.status.boardIdentity, hardwareProfileId: this.status.profileId, bindingIds: registered.bindingIds, setupDeclaration: execution.setupDeclaration, gatewayValidation: execution.gatewayValidation,
      limitations: [this.specification.engine === "replay" ? "Simulated replay of a prior physical capture; this observation is not new physical evidence." : "Seeded physics-based simulated observation; no physical claim is supported.", ...registered.limitations], simulation: structuredClone(this.specification),
    };
  }
}
