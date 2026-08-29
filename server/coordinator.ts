import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { ActiveExperimentState, DiagnosisReport, DiagnosisSession, ExperimentDefinition, Observation, ProjectContext, SessionMode, SimulationFixture, TimelineEvent } from "../shared/domain.js";
import { DEFAULT_LIMITS, deviceById } from "../shared/domain.js";
import { projectContextSchema } from "../shared/schemas.js";
import { fallbackDecision, toDecisionRecord, type DecisionClient } from "./agent.js";
import type { HardwareAdapter } from "./adapters/adapter.js";
import { SerialAdapter } from "./adapters/serial.js";
import { SimulatorAdapter } from "./adapters/simulator.js";
import { defaultProjectContext, projectContextDigest } from "./config.js";
import { deriveEvidence } from "./evidence.js";
import { validateExperiment } from "./gateway.js";
import { buildEligibleExperiments, buildMonitoringExperiment, guidanceForDevice } from "./modules.js";
import { assessSignal, baselinePrompt, primaryChannel, stimulusPrompt } from "./recording.js";
import { JsonStore } from "./store.js";

export interface CoordinatorOptions { store: JsonStore; agent: DecisionClient; serialPath?: string; physicalEnabled: boolean; now?: () => Date; stateDwellMs?: number }
export class DomainError extends Error { constructor(message: string, readonly status = 400) { super(message); } }

export class Coordinator {
  readonly events = new EventEmitter();
  private readonly sessions = new Map<string, DiagnosisSession>();
  private readonly adapters = new Map<string, HardwareAdapter>();
  private readonly lastMonitoringRead = new Map<string, number>();
  private readonly now: () => Date;
  private readonly stateDwellMs: number;
  constructor(private readonly options: CoordinatorOptions) { this.now = options.now ?? (() => new Date()); this.stateDwellMs = options.stateDwellMs ?? 1_500; }

  async createSession(mode: SessionMode, fixture: SimulationFixture = "fsr_outlier_compensable", inputContext: ProjectContext = defaultProjectContext, requestedTarget?: string): Promise<DiagnosisSession> {
    const context = projectContextSchema.parse(inputContext);
    if (mode === "physical" && context.hardwareProfileId.includes("safe-disabled")) throw new DomainError("Physical sessions require an explicitly reviewed project and firmware profile, not the bundled simulation profile.", 409);
    const targetDeviceId = requestedTarget ?? context.expectedBehavior.subjectDeviceIds[0]!;
    if (!context.expectedBehavior.subjectDeviceIds.includes(targetDeviceId) || deviceById(context, targetDeviceId)?.type !== "fsr") throw new DomainError("Target device must be an FSR subject declared in project context.");
    const id = randomUUID();
    const adapter: HardwareAdapter = mode === "simulation" ? new SimulatorAdapter(fixture, context) : new SerialAdapter(this.options.serialPath ?? "", this.options.physicalEnabled, context);
    let hardware;
    try { hardware = await adapter.preflight(); await adapter.armSession?.(); }
    catch (error) { await adapter.close(); throw new DomainError(error instanceof Error ? error.message : "Hardware preflight failed.", 503); }
    const createdAt = this.now().toISOString();
    const digest = projectContextDigest(context);
    const session: DiagnosisSession = {
      schemaVersion: 2, id, mode, fixture: mode === "simulation" ? fixture : undefined, targetDeviceId, projectContext: context, projectContextDigest: digest, createdAt, updatedAt: createdAt, version: 0, lifecycle: "READY", phase: "diagnostic", agentState: "IDLE", hardware, observations: [], decisions: [], experimentsExecuted: 0, monitoringReads: 0, verificationRuns: 0, consecutiveVerificationPasses: 0, evidence: deriveEvidence([], context, targetDeviceId, false), timeline: [], fallbackUsed: false,
    };
    this.sessions.set(id, session); this.adapters.set(id, adapter);
    await this.addEvent(session, "session.created", `${mode === "simulation" ? "Simulation" : "Physical"} session created for ${context.project.name}.`, { fixture, targetDeviceId, projectContextDigest: digest });
    await this.commit(session); return session;
  }

  async getSession(id: string): Promise<DiagnosisSession> {
    const active = this.sessions.get(id); if (active) return active;
    let stored: DiagnosisSession | undefined;
    try { stored = await this.options.store.loadSession(id); }
    catch (error) { throw new DomainError(error instanceof Error ? error.message : "Stored session is incompatible.", 409); }
    if (!stored) throw new DomainError("Session not found.", 404);
    stored.agentState ??= stored.lifecycle === "AWAITING_INTERVENTION" ? "WAITING_FOR_INTERVENTION" : stored.lifecycle === "CONFIRMED" ? "CONFIRMED" : stored.lifecycle === "CONCLUDED" ? "DIAGNOSIS_READY" : "IDLE";
    stored.evidence.projectLevelChecks ??= [];
    this.sessions.set(id, stored); return stored;
  }

  async submitProblem(id: string, problem: string): Promise<DiagnosisSession> {
    const session = await this.getSession(id); if (session.lifecycle !== "READY") throw new DomainError("Problem can only be submitted to a ready session.", 409);
    session.problem = problem; session.lifecycle = "INVESTIGATING"; session.agentState = "IDLE"; await this.addEvent(session, "problem.submitted", problem); await this.advance(session); await this.commit(session); return session;
  }

  async startInvestigation(id: string): Promise<DiagnosisSession> {
    const session = await this.getSession(id);
    if (!["IDLE", "INCONCLUSIVE"].includes(session.agentState)) throw new DomainError("The agent investigation is already active or complete.", 409);
    if (!session.pendingDecision?.experiment.command) throw new DomainError("No bounded sensor experiment is ready.", 409);
    session.activeExperiment = this.activeState(session, session.pendingDecision.experiment);
    session.agentState = "INITIALIZING";
    session.failureReason = undefined;
    await this.addEvent(session, "investigation.started", `Agent started a bounded investigation of ${session.activeExperiment.deviceId}.`, { experimentId: session.activeExperiment.experimentId });
    await this.commit(session); return session;
  }

  async advanceInvestigation(id: string): Promise<DiagnosisSession> {
    let session = await this.getSession(id);
    if (["CONFIRMED", "DIAGNOSIS_READY", "WAITING_FOR_INTERVENTION", "INCONCLUSIVE"].includes(session.agentState)) return session;
    if (["FAILED", "INTERRUPTED", "ESTOPPED"].includes(session.lifecycle)) { session.agentState = "INCONCLUSIVE"; await this.commit(session); return session; }

    if (session.agentState === "POST_INTERVENTION_VERIFY" || session.agentState === "SELECTING_NEXT_EXPERIMENT") {
      if (!session.pendingDecision?.experiment.command) { session.agentState = "INCONCLUSIVE"; session.failureReason = "No safe measurement remains."; await this.commit(session); return session; }
      session.activeExperiment = this.activeState(session, session.pendingDecision.experiment);
      session.agentState = "INITIALIZING";
      await this.addEvent(session, "agent.preparing", `Preparing ${session.pendingDecision.experiment.label.toLowerCase()} for ${session.activeExperiment.deviceId}.`);
      await this.commit(session); return session;
    }

    if (session.agentState === "ANALYZING") {
      if (session.activeExperiment?.notBefore && this.now().getTime() < new Date(session.activeExperiment.notBefore).getTime()) return session;
      if (session.lifecycle === "AWAITING_INTERVENTION") session.agentState = "WAITING_FOR_INTERVENTION";
      else if (session.lifecycle === "CONFIRMED" || session.evidence.verificationStatus === "PASSED") session.agentState = "CONFIRMED";
      else if (session.lifecycle === "CONCLUDED") session.agentState = "DIAGNOSIS_READY";
      else if (session.pendingDecision) session.agentState = "SELECTING_NEXT_EXPERIMENT";
      else session.agentState = "INCONCLUSIVE";
      await this.addEvent(session, "analysis.completed", this.agentSummary(session), { evidenceState: session.evidence.state, nextState: session.agentState });
      await this.commit(session); return session;
    }

    const active = session.activeExperiment;
    const pending = session.pendingDecision;
    if (!active || !pending || pending.experiment.id !== active.experimentId) throw new DomainError("Active experiment no longer matches the agent decision.", 409);
    const device = deviceById(session.projectContext, active.deviceId);
    if (!device) throw new DomainError("Active device is not in project context.", 409);
    if (active.notBefore && this.now().getTime() < new Date(active.notBefore).getTime()) return session;

    if (session.agentState === "INITIALIZING") {
      const observation = await this.captureMonitoring(session, device.id, "baseline");
      const baseline = observation.measurements.find((item) => item.channel === primaryChannel(device) && typeof item.value === "number")?.value;
      active.baseline = typeof baseline === "number" ? baseline : undefined;
      active.currentValue = active.baseline;
      active.sampleCount = observation.series?.find((item) => item.deviceId === device.id)?.values.length ?? 1;
      active.statusMessage = session.mode === "simulation" ? "Baseline captured. Injecting the configured simulated stimulus." : stimulusPrompt(device, session.phase === "verification");
      active.notBefore = new Date(this.now().getTime() + this.stateDwellMs).toISOString();
      session.agentState = "WAITING_FOR_USER_STIMULUS";
      await this.addEvent(session, "recording.baseline", `Captured a baseline for ${device.label}.`, { observationId: observation.id, baseline: active.baseline });
      await this.commit(session); return session;
    }

    if (session.agentState === "WAITING_FOR_USER_STIMULUS") {
      const observation = await this.captureMonitoring(session, device.id, "stimulus");
      const assessment = assessSignal(device, observation, active.baseline);
      active.currentValue = assessment.value; active.delta = assessment.delta; active.sampleCount += assessment.sampleCount; active.probeReads += 1; active.stimulusDetected ||= assessment.stimulusDetected; active.signalQuality = assessment.quality; active.statusMessage = assessment.message;
      if (assessment.sufficient) {
        session.agentState = "RECORDING";
        active.notBefore = new Date(this.now().getTime() + Math.round(this.stateDwellMs * .7)).toISOString();
        await this.addEvent(session, "recording.signal_detected", `Meaningful ${device.label} response detected.`, { observationId: observation.id, delta: assessment.delta, sampleCount: active.sampleCount });
      } else if (active.probeReads >= active.maximumProbeReads) {
        session.agentState = "INCONCLUSIVE";
        session.failureReason = assessment.quality === "NOISY" ? "Signal remained too unstable for a trustworthy experiment." : "No meaningful physical response was detected within the bounded collection window.";
        active.statusMessage = session.failureReason;
        await this.addEvent(session, "recording.insufficient", session.failureReason, { probeReads: active.probeReads, signalQuality: active.signalQuality });
      }
      await this.commit(session); return session;
    }

    if (session.agentState === "RECORDING") {
      const completedExperimentId = pending.experiment.id;
      session = await this.executePending(id, pending.id, session.version, true, true);
      const observation = [...session.observations].reverse().find((item) => item.experimentId === completedExperimentId);
      if (session.activeExperiment && observation) {
        const value = observation.measurements.find((item) => item.channel === primaryChannel(device) && typeof item.value === "number")?.value;
        session.activeExperiment.currentValue = typeof value === "number" ? value : session.activeExperiment.currentValue;
        session.activeExperiment.sampleCount += observation.series?.find((item) => item.deviceId === device.id)?.values.length ?? 1;
        session.activeExperiment.signalQuality = observation.operation.accepted ? "GOOD" : "INVALID";
        session.activeExperiment.statusMessage = "That’s enough data. Analyzing the response…";
      }
      session.agentState = "ANALYZING";
      if (session.activeExperiment) session.activeExperiment.notBefore = new Date(this.now().getTime() + this.stateDwellMs).toISOString();
      await this.addEvent(session, "recording.completed", `Evidence window completed for ${device.label}.`, { observationId: observation?.id });
      await this.commit(session); return session;
    }

    return session;
  }

  async captureLiveReading(id: string, deviceId: string): Promise<{ observation: Observation; version: number; monitoringReads: number }> {
    const session = await this.getSession(id);
    if (["INTERRUPTED", "FAILED", "ESTOPPED"].includes(session.lifecycle)) throw new DomainError("Live monitoring is unavailable for this terminal session.", 409);
    if (session.monitoringReads >= 60) throw new DomainError("The bounded live-monitoring budget of 60 reads is exhausted.", 429);
    const last = this.lastMonitoringRead.get(id) ?? 0;
    if (Date.now() - last < 250) throw new DomainError("Live readings are rate-limited to one bounded sample every 250 ms.", 429);
    this.lastMonitoringRead.set(id, Date.now());
    const observation = await this.captureMonitoring(session, deviceId, "monitor");
    await this.commit(session);
    return { observation, version: session.version, monitoringReads: session.monitoringReads };
  }

  async deviceGuidance(id: string, deviceId: string) {
    const session = await this.getSession(id); const device = deviceById(session.projectContext, deviceId);
    if (!device) throw new DomainError("Device is not in project context.", 404);
    return { device: { id: device.id, label: device.label, type: device.type }, guidance: guidanceForDevice(device) };
  }

  async executePending(id: string, decisionId: string, expectedVersion: number, setupConfirmed = false, agentOwned = false): Promise<DiagnosisSession> {
    const session = await this.getSession(id); const pending = session.pendingDecision;
    if (!pending || pending.id !== decisionId) throw new DomainError("Pending decision does not exist or has already executed.", 409);
    if (session.version !== expectedVersion || pending.sessionVersion !== expectedVersion) throw new DomainError("Approval is stale; refresh the session before approving.", 409);
    const validation = validateExperiment({ ...session, pendingDecision: undefined }, pending.experiment, setupConfirmed);
    if (!validation.accepted) throw new DomainError(validation.reasons.join(" "), 409);
    session.pendingDecision = undefined;
    await this.addEvent(session, agentOwned ? "gateway.accepted" : "approval.accepted", agentOwned ? `Safety gateway accepted ${pending.experiment.type}.` : `Approved ${pending.experiment.type}.`, { decisionId, setupConfirmed, agentOwned });
    const adapter = this.adapters.get(id); if (!adapter) throw new DomainError("Adapter is unavailable after process restart; create a new physical session.", 503);
    let observation: Observation;
    try { observation = await adapter.execute(pending.experiment, { sessionId: session.id, projectContextDigest: session.projectContextDigest, phase: session.phase }); }
    catch (error) { session.lifecycle = "INTERRUPTED"; session.failureReason = error instanceof Error ? error.message : "Adapter execution failed."; await this.addEvent(session, "session.interrupted", session.failureReason); await this.commit(session); return session; }
    this.assertProvenance(session, pending.experiment, observation);
    session.observations.push(observation); session.experimentsExecuted += 1;
    if (session.phase === "verification") session.verificationRuns += 1;
    session.evidence = deriveEvidence(session.observations, session.projectContext, session.targetDeviceId, Boolean(session.intervention));
    session.consecutiveVerificationPasses = session.evidence.consecutiveVerificationPasses;
    const observedDevice = pending.experiment.targetDeviceId ? deviceById(session.projectContext, pending.experiment.targetDeviceId) : undefined;
    const observationSummary = session.evidence.state === "INSUFFICIENT_EVIDENCE" && observation.operation.accepted
      ? `Stored a valid response from ${observedDevice?.label ?? pending.experiment.targetDeviceId}; building the comparison set.`
      : `${observedDevice?.label ?? pending.experiment.type} updated evidence to ${session.evidence.state.toLowerCase().replaceAll("_", " ")}.`;
    await this.addEvent(session, "observation.captured", observationSummary, { observationId: observation.id, source: observation.source, operation: observation.operation });
    if (observation.operation.estopLatched) session.lifecycle = "ESTOPPED";
    else if (session.phase === "verification" && session.consecutiveVerificationPasses >= DEFAULT_LIMITS.requiredVerificationPasses) {
      if (session.mode === "physical" || !session.projectContext.constraints.physicalSourceRequiredForConfirmation) session.lifecycle = "CONFIRMED";
      else { session.lifecycle = "CONCLUDED"; session.failureReason = "Simulation verification passed; physical confirmation is still required."; }
      await this.addEvent(session, "verification.completed", session.lifecycle === "CONFIRMED" ? "Physical verification threshold reached." : "Simulation verification passed without physical confirmation.");
      this.options.agent.clear(session.id);
    } else await this.advance(session);
    await this.commit(session); return session;
  }

  async declareIntervention(id: string, description: string, recommendationId?: string): Promise<DiagnosisSession> {
    const session = await this.getSession(id); if (session.lifecycle !== "AWAITING_INTERVENTION") throw new DomainError("Intervention can only be declared at a human checkpoint.", 409);
    const available = session.evidence.recommendations;
    if (available.length > 0 && !recommendationId) throw new DomainError("The evidence-backed recommendation ID is required.", 409);
    const recommendation = recommendationId ? available.find((item) => item.id === recommendationId) : undefined;
    if (recommendationId && !recommendation) throw new DomainError("Recommendation is not valid for the current evidence.", 409);
    session.intervention = { description, recommendationId, appliedParameters: recommendation?.parameters, declaredAt: this.now().toISOString() };
    session.lifecycle = "VERIFYING"; session.phase = "verification"; session.agentState = "POST_INTERVENTION_VERIFY"; session.consecutiveVerificationPasses = 0; this.adapters.get(id)?.declareIntervention();
    session.evidence = deriveEvidence(session.observations, session.projectContext, session.targetDeviceId, true);
    await this.addEvent(session, "intervention.declared", description, { recommendationId, appliedParameters: recommendation?.parameters });
    await this.advance(session); await this.commit(session); return session;
  }

  async emergencyStop(id: string): Promise<DiagnosisSession> {
    const session = await this.getSession(id); const adapter = this.adapters.get(id);
    if (adapter) { try { const experiment: ExperimentDefinition = { id: `abort:${randomUUID()}`, type: "abort", label: "Abort", description: "Abort active operations.", command: "abort", planId: "abort-v1", phase: session.phase, requiresApproval: false, requiresSetupConfirmation: false, budgetClass: "read" }; const observation = await adapter.execute(experiment, { sessionId: session.id, projectContextDigest: session.projectContextDigest, phase: session.phase }); this.assertProvenance(session, experiment, observation); session.observations.push(observation); } catch { /* Fail closed locally even if transport cannot acknowledge. */ } }
    session.hardware.estopLatched = true; session.lifecycle = "ESTOPPED"; session.agentState = "INCONCLUSIVE"; session.pendingDecision = undefined; await this.addEvent(session, "safety.estop", "Abort/e-stop latched; reset is required."); await this.commit(session); return session;
  }

  async report(id: string): Promise<DiagnosisReport> {
    const session = await this.getSession(id); return { sessionId: session.id, evidenceSource: session.mode, project: session.projectContext.project, targetDeviceId: session.targetDeviceId, reportedProblem: session.problem, evidence: session.evidence, experiments: session.observations, intervention: session.intervention, status: session.lifecycle, timing: { machineActiveMs: session.observations.reduce((sum, observation) => sum + observation.elapsedMs, 0), wallClockMs: this.now().getTime() - new Date(session.createdAt).getTime() }, agenticProof: session.decisions.some((decision) => decision.decisionSource === "openai") && !session.fallbackUsed };
  }

  private async advance(session: DiagnosisSession): Promise<void> {
    const eligibleExperiments = buildEligibleExperiments(session);
    if (eligibleExperiments.length === 0) { session.lifecycle = "FAILED"; session.failureReason = "No safe eligible experiment remains."; return; }
    let selection = await this.options.agent.decide({ session, eligibleExperiments });
    let experiment = eligibleExperiments.find((item) => item.id === selection.experimentId);
    if (!experiment) { selection = fallbackDecision({ session, eligibleExperiments }); experiment = eligibleExperiments[0]!; session.fallbackUsed = true; }
    const record = toDecisionRecord(selection, experiment, session);
    record.gatewayValidation = validateExperiment(session, experiment, true); session.decisions.push(record); session.fallbackUsed ||= selection.decisionSource === "fallback";
    await this.addEvent(session, "agent.decision", `${experiment.type}: ${selection.rationale}`, { decisionId: record.id, experimentId: experiment.id, source: selection.decisionSource, responseId: selection.responseId, contextDigest: selection.contextDigest, validation: record.gatewayValidation });
    if (!record.gatewayValidation.accepted) { session.lifecycle = "FAILED"; session.failureReason = record.gatewayValidation.reasons.join(" "); return; }
    if (experiment.type === "request_intervention" || experiment.type === "request_manual_check") { session.lifecycle = "AWAITING_INTERVENTION"; return; }
    if (experiment.type === "conclude_normal") { session.lifecycle = "CONCLUDED"; this.options.agent.clear(session.id); return; }
    if (!experiment.command) { session.lifecycle = "FAILED"; session.failureReason = `Unsupported local experiment ${experiment.type}.`; return; }
    session.pendingDecision = { id: record.id, sessionVersion: session.version + 1, experiment, objective: selection.objective, rationale: selection.rationale, experimentsRemaining: session.projectContext.constraints.maximumExperiments - session.experimentsExecuted, createdAt: this.now().toISOString() };
  }

  private assertProvenance(session: DiagnosisSession, experiment: ExperimentDefinition, observation: Observation): void {
    const expectedAdapter = session.mode === "physical" ? "esp32" : "simulator";
    if (observation.sessionId !== session.id || observation.source !== session.mode || observation.adapter !== expectedAdapter || observation.projectContextDigest !== session.projectContextDigest || observation.experimentId !== experiment.id || observation.deviceId !== experiment.targetDeviceId) throw new DomainError("Observation provenance does not match the immutable session, context, experiment, or device.", 409);
  }
  private activeState(session: DiagnosisSession, experiment: ExperimentDefinition): ActiveExperimentState {
    const device = experiment.targetDeviceId ? deviceById(session.projectContext, experiment.targetDeviceId) : undefined;
    if (!device) throw new DomainError("The selected experiment has no configured sensor target.", 409);
    return { experimentId: experiment.id, deviceId: device.id, phase: session.phase, startedAt: this.now().toISOString(), prompt: stimulusPrompt(device, session.phase === "verification"), statusMessage: baselinePrompt(device), notBefore: new Date(this.now().getTime() + this.stateDwellMs).toISOString(), sampleCount: 0, probeReads: 0, maximumProbeReads: 8, stimulusDetected: false, signalQuality: "WAITING" };
  }
  private async captureMonitoring(session: DiagnosisSession, deviceId: string, purpose: "monitor" | "baseline" | "stimulus"): Promise<Observation> {
    if (session.monitoringReads >= 60) throw new DomainError("The bounded live-monitoring budget of 60 reads is exhausted.", 429);
    const device = deviceById(session.projectContext, deviceId);
    if (!device) throw new DomainError("Device is not in project context.", 404);
    const experiment = buildMonitoringExperiment(session.projectContext, deviceId, session.monitoringReads + 1, purpose);
    if (!experiment) throw new DomainError("This device has no safe live-reading capability in the sensor-first MVP.", 409);
    const adapter = this.adapters.get(session.id); if (!adapter) throw new DomainError("Adapter is unavailable after process restart.", 503);
    const observation = await adapter.execute(experiment, { sessionId: session.id, projectContextDigest: session.projectContextDigest, phase: "monitoring" });
    this.assertProvenance(session, experiment, observation);
    session.observations.push(observation); session.monitoringReads += 1;
    if (purpose === "monitor") await this.addEvent(session, "monitoring.sample", `Recorded bounded live reading from ${device.label}.`, { observationId: observation.id, deviceId, guidance: guidanceForDevice(device).title });
    return observation;
  }
  private agentSummary(session: DiagnosisSession): string {
    if (session.evidence.verificationStatus === "PASSED") return `${session.targetDeviceId} now falls within the known-good range.`;
    if (session.evidence.state === "NORMAL") return `${session.targetDeviceId} is behaving within the configured reference range; no hardware change is justified.`;
    if (session.evidence.recommendations.length > 0) return `${session.targetDeviceId} differs from the references and an evidence-backed adjustment is available.`;
    if (session.evidence.state === "INSUFFICIENT_EVIDENCE") return "I need another bounded measurement before reaching a conclusion.";
    return `Evidence indicates ${session.evidence.state.toLowerCase().replaceAll("_", " ")}.`;
  }
  private async addEvent(session: DiagnosisSession, type: string, summary: string, data?: Record<string, unknown>): Promise<void> { const event: TimelineEvent = { id: randomUUID(), sessionId: session.id, at: this.now().toISOString(), type, summary, data }; session.timeline.push(event); await this.options.store.appendEvent(event); this.events.emit(session.id, event); }
  private async commit(session: DiagnosisSession): Promise<void> { session.version += 1; session.updatedAt = this.now().toISOString(); if (session.pendingDecision) session.pendingDecision.sessionVersion = session.version; await this.options.store.saveSession(session); }
}
