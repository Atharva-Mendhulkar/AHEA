import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type {
  AgentAction,
  DiagnosisReport,
  DiagnosisSession,
  MotorCommand,
  Observation,
  PendingDecision,
  SessionMode,
  TimelineEvent,
} from "../shared/domain.js";
import { DEFAULT_LIMITS, isMotorCommand } from "../shared/domain.js";
import { deriveEvidence } from "./evidence.js";
import { simulationCalibration } from "./config.js";
import type { DecisionClient } from "./agent.js";
import { fallbackDecision, toDecisionRecord } from "./agent.js";
import { validateAction } from "./gateway.js";
import type { HardwareAdapter } from "./adapters/adapter.js";
import { SimulatorAdapter, type SimulatorFixture } from "./adapters/simulator.js";
import { SerialAdapter } from "./adapters/serial.js";
import { JsonStore } from "./store.js";

export interface CoordinatorOptions {
  store: JsonStore;
  agent: DecisionClient;
  serialPath?: string;
  physicalEnabled: boolean;
  physicalCalibration?: DiagnosisSession["calibration"];
  now?: () => Date;
}

export class DomainError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export class Coordinator {
  readonly events = new EventEmitter();
  private readonly sessions = new Map<string, DiagnosisSession>();
  private readonly adapters = new Map<string, HardwareAdapter>();
  private readonly now: () => Date;

  constructor(private readonly options: CoordinatorOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async createSession(mode: SessionMode, fixture: SimulatorFixture = "disconnected"): Promise<DiagnosisSession> {
    const id = randomUUID();
    const adapter: HardwareAdapter = mode === "simulation"
      ? new SimulatorAdapter(fixture)
      : new SerialAdapter(this.options.serialPath ?? "", this.options.physicalEnabled);
    let hardware;
    try {
      hardware = await adapter.preflight();
    } catch (error) {
      await adapter.close();
      throw new DomainError(error instanceof Error ? error.message : "Hardware preflight failed.", 503);
    }
    const calibration = mode === "simulation" ? simulationCalibration : this.options.physicalCalibration;
    if (!calibration) {
      await adapter.close();
      throw new DomainError("No reviewed physical calibration profile is configured.", 409);
    }
    if (mode === "physical" && (
      hardware.boardIdentity !== calibration.boardIdentity ||
      hardware.firmwareVersion !== calibration.firmwareVersion ||
      hardware.profileId !== calibration.profileId
    )) {
      await adapter.close();
      throw new DomainError("Calibration does not match the connected board, firmware, and hardware profile.", 409);
    }
    await adapter.armSession?.();
    const createdAt = this.now().toISOString();
    const emptyEvidence = deriveEvidence([], calibration, false);
    const session: DiagnosisSession = {
      id,
      mode,
      fixture: mode === "simulation" ? fixture : undefined,
      createdAt,
      updatedAt: createdAt,
      version: 0,
      lifecycle: "READY",
      hardware,
      calibration,
      observations: [],
      decisions: [],
      diagnosticActivations: 0,
      verificationActivations: 0,
      totalActivations: 0,
      consecutiveVerificationPasses: 0,
      evidence: emptyEvidence,
      timeline: [],
      fallbackUsed: false,
    };
    this.sessions.set(id, session);
    this.adapters.set(id, adapter);
    await this.addEvent(session, "session.created", `${mode === "simulation" ? "Simulation" : "Physical"} session created.`, { fixture });
    const baseline = await adapter.execute("sample_motion", {
      sessionId: id,
      experimentId: `baseline-${randomUUID()}`,
      calibration: session.calibration,
    });
    this.assertProvenance(session, baseline);
    session.observations.push(baseline);
    session.evidence = deriveEvidence(session.observations, session.calibration, false);
    await this.addEvent(session, "observation.baseline", "Inactive motion baseline captured.", { observationId: baseline.id });
    await this.commit(session);
    return session;
  }

  async getSession(id: string): Promise<DiagnosisSession> {
    const active = this.sessions.get(id);
    if (active) return active;
    const stored = await this.options.store.loadSession(id);
    if (!stored) throw new DomainError("Session not found.", 404);
    this.sessions.set(id, stored);
    return stored;
  }

  async submitProblem(id: string, problem: string): Promise<DiagnosisSession> {
    const session = await this.getSession(id);
    if (session.lifecycle !== "READY") throw new DomainError("Problem can only be submitted to a ready session.", 409);
    session.problem = problem;
    session.lifecycle = "INVESTIGATING";
    await this.addEvent(session, "problem.submitted", problem);
    await this.advance(session);
    await this.commit(session);
    return session;
  }

  async executePending(id: string, decisionId: string, expectedVersion: number): Promise<DiagnosisSession> {
    const session = await this.getSession(id);
    const pending = session.pendingDecision;
    if (!pending || pending.id !== decisionId) throw new DomainError("Pending decision does not exist or has already executed.", 409);
    if (session.version !== expectedVersion || pending.sessionVersion !== expectedVersion) {
      throw new DomainError("Approval is stale; refresh the session before approving.", 409);
    }
    const readyAt = session.lastActivationAt
      ? new Date(session.lastActivationAt).getTime() + DEFAULT_LIMITS.cooldownMs
      : 0;
    if (this.now().getTime() < readyAt) throw new DomainError(`Cooldown active until ${new Date(readyAt).toISOString()}.`, 429);

    const validation = validateAction({ ...session, pendingDecision: undefined }, pending.action, this.now().getTime());
    if (!validation.accepted) throw new DomainError(validation.reasons.join(" "), 409);
    session.pendingDecision = undefined;
    await this.addEvent(session, "approval.accepted", `Approved ${pending.action}.`, { decisionId });

    const adapter = this.adapters.get(id);
    if (!adapter) throw new DomainError("Adapter is unavailable after process restart; reconnect in a new session.", 503);
    let observation: Observation;
    try {
      observation = await adapter.execute(pending.action, {
        sessionId: session.id,
        experimentId: pending.id,
        calibration: session.calibration,
      });
    } catch (error) {
      session.lifecycle = "INTERRUPTED";
      session.failureReason = error instanceof Error ? error.message : "Adapter execution failed.";
      await this.addEvent(session, "session.interrupted", session.failureReason);
      await this.commit(session);
      return session;
    }
    this.assertProvenance(session, observation);
    session.observations.push(observation);
    if (observation.safety.activationAccepted) {
      session.totalActivations += 1;
      session.lastActivationAt = observation.capturedAt;
      if (pending.action === "verify_motor") session.verificationActivations += 1;
      else session.diagnosticActivations += 1;
    }
    session.evidence = deriveEvidence(session.observations, session.calibration, Boolean(session.intervention));
    session.consecutiveVerificationPasses = session.evidence.consecutiveVerificationPasses;
    await this.addEvent(session, "observation.captured", `${pending.action} returned ${session.evidence.evidenceState}.`, {
      observationId: observation.id,
      source: observation.source,
      safety: observation.safety,
    });

    if (observation.safety.estopLatched) {
      session.lifecycle = "ESTOPPED";
    } else if (pending.action === "verify_motor" && session.consecutiveVerificationPasses >= 2) {
      session.lifecycle = "CONFIRMED";
      await this.addEvent(session, "diagnosis.confirmed", "Two consecutive valid verification trials passed.");
      this.options.agent.clear(session.id);
    } else if (pending.action === "verify_motor" && session.verificationActivations >= DEFAULT_LIMITS.verificationActivations) {
      session.lifecycle = "FAILED";
      session.failureReason = "Verification budget exhausted without two consecutive passes.";
    } else {
      await this.advance(session, observation);
    }
    await this.commit(session);
    return session;
  }

  async declareIntervention(id: string, description: string): Promise<DiagnosisSession> {
    const session = await this.getSession(id);
    if (session.lifecycle !== "AWAITING_INTERVENTION") {
      throw new DomainError("Intervention can only be declared when the session is awaiting repair.", 409);
    }
    session.intervention = { description, declaredAt: this.now().toISOString() };
    session.lifecycle = "VERIFYING";
    session.consecutiveVerificationPasses = 0;
    this.adapters.get(id)?.declareIntervention();
    await this.addEvent(session, "intervention.declared", description);
    await this.advance(session);
    await this.commit(session);
    return session;
  }

  async emergencyStop(id: string): Promise<DiagnosisSession> {
    const session = await this.getSession(id);
    const adapter = this.adapters.get(id);
    if (adapter) {
      try {
        const observation = await adapter.execute("emergency_stop", {
          sessionId: session.id,
          experimentId: `estop-${randomUUID()}`,
          calibration: session.calibration,
        });
        this.assertProvenance(session, observation);
        session.observations.push(observation);
      } catch {
        // State still fails closed if transport cannot acknowledge the stop.
      }
    }
    session.hardware.estopLatched = true;
    session.lifecycle = "ESTOPPED";
    session.pendingDecision = undefined;
    await this.addEvent(session, "safety.estop", "Emergency stop latched; physical reset required.");
    await this.commit(session);
    return session;
  }

  async report(id: string): Promise<DiagnosisReport> {
    const session = await this.getSession(id);
    const machineActiveMs = session.observations.reduce((total, observation) => total + observation.elapsedMs, 0);
    const top = [...session.evidence.hypotheses].sort((a, b) => b.support - a.support)[0];
    return {
      sessionId: session.id,
      evidenceSource: session.mode,
      reportedProblem: session.problem,
      conditionDiagnosed: session.lifecycle === "CONFIRMED"
        ? "The motor power path was open and was restored after the declared intervention."
        : top?.hypothesis ?? "No supported condition",
      confidence: session.evidence.confidenceLabel,
      calibrationId: session.calibration.id,
      experiments: session.observations,
      intervention: session.intervention,
      verificationResults: session.evidence.observations.filter((item) => item.command === "verify_motor"),
      limitations: session.evidence.limitations,
      status: session.lifecycle,
      timing: { machineActiveMs, wallClockMs: this.now().getTime() - new Date(session.createdAt).getTime() },
      agenticProof: session.decisions.some((decision) => decision.decisionSource === "openai") && !session.fallbackUsed,
    };
  }

  private allowedActions(session: DiagnosisSession): AgentAction[] {
    if (session.lifecycle === "VERIFYING") return ["verify_motor"];
    const latestMotion = [...session.evidence.observations].reverse().find((item) => item.command === "motor_motion_probe");
    const latestCurrent = [...session.evidence.observations].reverse().find((item) => item.command === "motor_current_probe");
    if (!latestMotion) return ["motor_motion_probe"];
    if (!latestMotion.valid) return ["request_sensor_recovery"];
    if (latestMotion.motionDetected) return ["report_fault_not_reproduced"];
    if (!latestCurrent) return ["motor_current_probe", "motor_motion_probe"];
    if (!latestCurrent.valid) return ["request_sensor_recovery"];
    return ["request_intervention"];
  }

  private async advance(session: DiagnosisSession, latestObservation?: Observation): Promise<void> {
    const allowedActions = this.allowedActions(session);
    let selection = await this.options.agent.decide({ session, allowedActions, latestObservation });
    let record = toDecisionRecord(selection, session.evidence);
    let validation = validateAction(session, selection.action, Number.POSITIVE_INFINITY);
    if (!allowedActions.includes(selection.action)) {
      validation = { accepted: false, reasons: ["Action is not available for the current evidence state."] };
    }
    record.gatewayValidation = validation;
    session.decisions.push(record);
    session.fallbackUsed ||= selection.decisionSource === "fallback";
    await this.addEvent(session, "agent.decision", `${selection.action}: ${selection.rationale}`, {
      decisionId: record.id,
      source: selection.decisionSource,
      responseId: selection.responseId,
      observationIds: selection.observationIds,
      contextDigest: selection.contextDigest,
      validation,
    });

    if (!validation.accepted) {
      selection = fallbackDecision({ session, allowedActions, latestObservation });
      record = toDecisionRecord(selection, session.evidence);
      record.gatewayValidation = validateAction(session, selection.action, Number.POSITIVE_INFINITY);
      session.decisions.push(record);
      session.fallbackUsed = true;
      if (!record.gatewayValidation.accepted) {
        session.lifecycle = "FAILED";
        session.failureReason = record.gatewayValidation.reasons.join(" ");
        return;
      }
    }

    if (selection.action === "request_intervention") {
      session.lifecycle = "AWAITING_INTERVENTION";
      return;
    }
    if (selection.action === "request_sensor_recovery") {
      session.lifecycle = "FAILED";
      session.failureReason = "Sensor recovery is required before diagnosis can continue.";
      return;
    }
    if (selection.action === "report_fault_not_reproduced") {
      session.lifecycle = "FAILED";
      session.failureReason = "The expected motor-induced motion signature was detected; the fault was not reproduced.";
      return;
    }
    if (!isMotorCommand(selection.action)) return;
    const pendingVersion = session.version + 1;
    const pending: PendingDecision = {
      id: record.id,
      sessionVersion: pendingVersion,
      action: selection.action as MotorCommand,
      objective: selection.objective,
      rationale: selection.rationale,
      fixedParameters: {
        durationMs: DEFAULT_LIMITS.pulseDurationMs,
        currentLimitMa: DEFAULT_LIMITS.currentLimitMa,
        cooldownMs: DEFAULT_LIMITS.cooldownMs,
      },
      activationsRemaining: DEFAULT_LIMITS.totalActivations - session.totalActivations,
      cooldownReadyAt: session.lastActivationAt
        ? new Date(new Date(session.lastActivationAt).getTime() + DEFAULT_LIMITS.cooldownMs).toISOString()
        : undefined,
      createdAt: this.now().toISOString(),
    };
    session.pendingDecision = pending;
  }

  private assertProvenance(session: DiagnosisSession, observation: Observation): void {
    if (observation.sessionId !== session.id || observation.source !== session.mode) {
      throw new DomainError("Observation provenance does not match the immutable session source.", 409);
    }
    const expectedAdapter = session.mode === "physical" ? "esp32" : "simulator";
    if (observation.adapter !== expectedAdapter || observation.calibrationId !== session.calibration.id) {
      throw new DomainError("Observation adapter or calibration provenance does not match the session.", 409);
    }
  }

  private async addEvent(session: DiagnosisSession, type: string, summary: string, data?: Record<string, unknown>): Promise<void> {
    const event: TimelineEvent = {
      id: randomUUID(),
      sessionId: session.id,
      at: this.now().toISOString(),
      type,
      summary,
      data,
    };
    session.timeline.push(event);
    await this.options.store.appendEvent(event);
    this.events.emit(session.id, event);
  }

  private async commit(session: DiagnosisSession): Promise<void> {
    session.version += 1;
    session.updatedAt = this.now().toISOString();
    if (session.pendingDecision) session.pendingDecision.sessionVersion = session.version;
    await this.options.store.saveSession(session);
  }
}
