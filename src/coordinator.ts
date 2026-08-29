import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { DeterministicFallbackAgent } from "./agent/fallback.js";
import { SimulatorAdapter, type SimulatorFixture } from "./adapters/simulator.js";
import { classifyObservation, evaluateDiagnosis, measurement } from "./domain/evidence.js";
import { validateAgentAction } from "./domain/safety.js";
import type {
  AgentContext,
  AgentDecisionRecord,
  AgentSelector,
  CalibrationProfile,
  EvidenceObservation,
  EvidenceSource,
  HardwareAdapter,
  PendingExperiment,
  SessionSnapshot
} from "./types.js";

export interface CoordinatorOptions {
  adapter: HardwareAdapter;
  primaryAgent?: AgentSelector;
  motorCooldownMs: number;
  activationBudget: number;
  fixture?: SimulatorFixture;
}

export class ExperimentCoordinator {
  private readonly events = new EventEmitter();
  private readonly fallback = new DeterministicFallbackAgent();
  private readonly adapter: HardwareAdapter;
  private readonly primaryAgent: AgentSelector | undefined;
  private readonly cooldownMs: number;
  private lastActivationAt = 0;
  private session: SessionSnapshot;

  constructor(options: CoordinatorOptions) {
    this.adapter = options.adapter;
    this.primaryAgent = options.primaryAgent;
    this.cooldownMs = options.motorCooldownMs;
    this.session = {
      id: randomUUID(),
      mode: options.adapter.identity.source,
      ...(options.fixture ? { fixture: options.fixture } : {}),
      phase: "CREATED",
      problem: "",
      observations: [],
      decisions: [],
      diagnosis: evaluateDiagnosis([], undefined, false),
      activationsUsed: 0,
      activationBudget: options.activationBudget,
      emergencyStopLatched: false,
      fallbackMode: !options.primaryAgent,
      statusMessage: "Run healthy calibration before introducing the fault."
    };
  }

  snapshot(): SessionSnapshot {
    return structuredClone(this.session);
  }

  subscribe(listener: (snapshot: SessionSnapshot) => void): () => void {
    this.events.on("update", listener);
    return () => this.events.off("update", listener);
  }

  async scanHardware(): Promise<SessionSnapshot> {
    const result = await this.adapter.execute("scan_i2c", `exp-${randomUUID()}`);
    this.ingest("scan_i2c", "system", result);
    if (!result.ok || !result.detectedAddresses?.includes("0x40") || !result.detectedAddresses.includes("0x68")) {
      this.session.phase = "ERROR";
      this.session.statusMessage = "Required INA219 (0x40) and MPU6050 (0x68) sensors were not both detected.";
    } else {
      this.session.statusMessage = "Required sensors detected. Healthy calibration is ready."
    }
    this.emit();
    return this.snapshot();
  }

  async startCalibration(): Promise<SessionSnapshot> {
    if (!(["CREATED", "READY"] as const).includes(this.session.phase as "CREATED" | "READY")) {
      throw new Error("Calibration cannot start in the current state.");
    }
    this.session.phase = "CALIBRATING";
    const result = await this.adapter.execute("sample_motion", `exp-${randomUUID()}`);
    const idle = this.ingest("sample_motion", "calibration", result);
    if (!result.ok || !measurement(idle, "baseline_rms_g") || !measurement(idle, "current_mean_ma")) {
      this.session.phase = "ERROR";
      this.session.statusMessage = "Idle calibration failed. Check both sensors.";
      this.emit();
      return this.snapshot();
    }
    this.session.pendingExperiment = this.pending("verify_motor", "calibration");
    this.session.phase = "AWAITING_APPROVAL";
    this.session.statusMessage = "Approve one known-good motor pulse to complete healthy calibration.";
    this.emit();
    return this.snapshot();
  }

  async startDiagnosis(problem: string): Promise<SessionSnapshot> {
    if (!this.session.calibration || this.session.phase !== "READY") {
      throw new Error("Healthy calibration must complete before diagnosis.");
    }
    if (!problem.trim()) throw new Error("A problem description is required.");
    if (this.adapter instanceof SimulatorAdapter) this.adapter.armFault();
    this.session.problem = problem.trim();
    this.session.phase = "DIAGNOSING";
    this.session.statusMessage = "Agent is selecting the first safe experiment.";
    await this.advanceAgent();
    return this.snapshot();
  }

  async approveExperiment(experimentId: string): Promise<SessionSnapshot> {
    const pending = this.session.pendingExperiment;
    if (!pending || pending.id !== experimentId) throw new Error("Experiment is not awaiting approval.");
    const now = Date.now();
    const remaining = this.cooldownMs - (now - this.lastActivationAt);
    if (this.lastActivationAt > 0 && remaining > 0) {
      throw new Error(`Motor cooldown active for ${remaining} ms.`);
    }
    if (pending.purpose !== "calibration" && this.session.activationsUsed >= this.session.activationBudget) {
      throw new Error("Diagnostic activation budget exhausted.");
    }

    delete this.session.pendingExperiment;
    this.session.statusMessage = `Executing ${pending.tool} with firmware-fixed parameters.`;
    this.emit();
    const result = await this.adapter.execute(pending.tool, pending.id);
    this.lastActivationAt = Date.now();
    if (pending.purpose !== "calibration") this.session.activationsUsed += 1;
    const observation = this.ingest(pending.tool, pending.purpose, result);

    if (pending.purpose === "calibration") {
      this.completeCalibration(observation);
      return this.snapshot();
    }

    const previousPasses = this.session.diagnosis.consecutiveVerificationPasses;
    this.session.diagnosis = evaluateDiagnosis(
      this.diagnosticObservations(),
      this.session.calibration,
      Boolean(this.session.intervention),
      previousPasses
    );
    if (this.session.diagnosis.confidence === "CONFIRMED") {
      this.session.phase = "CONFIRMED";
      this.session.statusMessage = "Repair confirmed by two consecutive physical-response checks.";
      this.emit();
      return this.snapshot();
    }
    await this.advanceAgent();
    return this.snapshot();
  }

  async declareIntervention(kind: "motor_lead_reconnected"): Promise<SessionSnapshot> {
    if (this.session.phase !== "AWAITING_REPAIR") {
      throw new Error("An intervention may only be declared after the backend requests repair.");
    }
    this.session.intervention = { kind, declaredAt: new Date().toISOString() };
    if (this.adapter instanceof SimulatorAdapter) this.adapter.applyRepair();
    this.session.phase = "VERIFYING";
    this.session.statusMessage = "Intervention recorded. Agent is selecting verification.";
    await this.advanceAgent();
    return this.snapshot();
  }

  async emergencyStop(): Promise<SessionSnapshot> {
    try {
      await this.adapter.execute("emergency_stop", `estop-${randomUUID()}`);
    } finally {
      delete this.session.pendingExperiment;
      this.session.emergencyStopLatched = true;
      this.session.phase = "STOPPED";
      this.session.statusMessage = "Emergency stop latched. Physical reset is required.";
      this.emit();
    }
    return this.snapshot();
  }

  async close(): Promise<void> {
    await this.adapter.close();
  }

  private async advanceAgent(): Promise<void> {
    const context: AgentContext = {
      problem: this.session.problem,
      observations: this.diagnosticObservations(),
      ...(this.session.calibration ? { calibration: this.session.calibration } : {}),
      confidence: this.session.diagnosis.confidence,
      evidenceState: this.session.diagnosis.evidenceState,
      interventionDeclared: Boolean(this.session.intervention),
      consecutiveVerificationPasses: this.session.diagnosis.consecutiveVerificationPasses
    };

    let selector = this.primaryAgent ?? this.fallback;
    let decision;
    try {
      decision = await selector.decide(context);
    } catch {
      selector = this.fallback;
      decision = await selector.decide(context);
      this.session.fallbackMode = true;
    }
    const validation = validateAgentAction(this.snapshot(), decision.action);
    const record: AgentDecisionRecord = {
      ...decision,
      decisionId: randomUUID(),
      createdAt: new Date().toISOString(),
      mode: selector.mode,
      deployment: selector.deployment,
      inputObservationIds: context.observations.map((item) => item.observationId),
      validation
    };
    this.session.decisions.push(record);

    if (!validation.allowed) {
      this.session.phase = "ERROR";
      this.session.statusMessage = `Agent action rejected: ${validation.reason}`;
    } else if (decision.action.kind === "run_experiment") {
      const purpose = decision.action.tool === "verify_motor" ? "verification" : "diagnosis";
      this.session.pendingExperiment = this.pending(decision.action.tool, purpose);
      this.session.phase = "AWAITING_APPROVAL";
      this.session.statusMessage = `${decision.action.tool} selected: ${decision.rationale}`;
    } else if (decision.action.kind === "request_repair") {
      this.session.phase = "AWAITING_REPAIR";
      this.session.statusMessage = "Inspect and restore the motor power path, then declare the intervention.";
    } else if (decision.action.kind === "request_sensor_recovery") {
      this.session.phase = "ERROR";
      this.session.statusMessage = "Motion evidence is invalid. Check sensor wiring and mounting before retrying.";
    } else if (decision.action.kind === "report_not_reproduced") {
      this.session.phase = "READY";
      this.session.statusMessage = "The expected calibrated motion signature was detected; the problem was not reproduced.";
    } else {
      this.session.phase = this.session.diagnosis.confidence === "CONFIRMED" ? "CONFIRMED" : "READY";
      this.session.statusMessage = "Investigation finished without additional physical operations.";
    }
    this.emit();
  }

  private completeCalibration(healthy: EvidenceObservation): void {
    const idle = [...this.session.observations]
      .reverse()
      .find((item) => item.purpose === "calibration" && item.tool === "sample_motion");
    const idleCurrent = measurement(idle, "current_mean_ma");
    const baselineMotion = measurement(idle, "baseline_rms_g");
    const healthyCurrent = measurement(healthy, "current_mean_ma");
    const healthyMotion = measurement(healthy, "acceleration_rms_g");
    const readings = [idleCurrent, baselineMotion, healthyCurrent, healthyMotion];
    if (!healthy.ok || healthy.tripped || readings.some((item) => !item?.health.healthy)) {
      this.session.phase = "ERROR";
      this.session.statusMessage = "Healthy calibration pulse failed or returned unhealthy sensor data.";
      this.emit();
      return;
    }
    const calibration: CalibrationProfile = {
      id: `cal-${randomUUID()}`,
      source: this.session.mode,
      createdAt: new Date().toISOString(),
      idleCurrentMa: idleCurrent!.value,
      healthyCurrentMa: healthyCurrent!.value,
      baselineMotionRmsG: baselineMotion!.value,
      healthyMotionRmsG: healthyMotion!.value
    };
    this.session.calibration = calibration;
    this.session.observations = this.session.observations.map((observation) => ({
      ...observation,
      calibrationId: calibration.id,
      classification: classifyObservation(observation, calibration)
    }));
    this.session.diagnosis = evaluateDiagnosis([], calibration, false);
    this.session.phase = "READY";
    this.session.statusMessage = "Healthy calibration captured. Introduce the hidden fault before diagnosis.";
    this.emit();
  }

  private ingest(
    tool: EvidenceObservation["tool"],
    purpose: EvidenceObservation["purpose"],
    result: Awaited<ReturnType<HardwareAdapter["execute"]>>
  ): EvidenceObservation {
    const base = {
      ...result,
      observationId: randomUUID(),
      experimentId: result.requestId,
      sessionId: this.session.id,
      capturedAt: new Date().toISOString(),
      tool,
      purpose,
      provenance: structuredClone(this.adapter.identity),
      ...(this.session.calibration ? { calibrationId: this.session.calibration.id } : {})
    };
    const observation: EvidenceObservation = {
      ...base,
      classification: classifyObservation(base, this.session.calibration)
    };
    this.session.observations.push(observation);
    return observation;
  }

  private diagnosticObservations(): EvidenceObservation[] {
    return this.session.observations.filter((item) => item.purpose === "diagnosis" || item.purpose === "verification");
  }

  private pending(tool: PendingExperiment["tool"], purpose: PendingExperiment["purpose"]): PendingExperiment {
    return {
      id: `exp-${randomUUID()}`,
      tool,
      purpose,
      createdAt: new Date().toISOString(),
      durationMs: 500
    };
  }

  private emit(): void {
    this.events.emit("update", this.snapshot());
  }
}

export function modeForAdapter(adapter: HardwareAdapter): EvidenceSource {
  return adapter.identity.source;
}
