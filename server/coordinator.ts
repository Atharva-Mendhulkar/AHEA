import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { DiagnosisReport, DiagnosisSession, ExperimentDefinition, Observation, ProjectContext, SessionMode, SimulationFixture, SimulationRequest, TimelineEvent } from "../shared/domain.js";
import { targetById, terminalLifecycleStates } from "../shared/domain.js";
import { projectContextSchema } from "../shared/schemas.js";
import { fallbackDecision, toDecisionRecord, type DecisionClient } from "./agent.js";
import type { HardwareAdapter } from "./adapters/adapter.js";
import { SerialAdapter } from "./adapters/serial.js";
import { SimulatorAdapter } from "./adapters/simulator.js";
import { defaultProjectContext, projectContextDigest } from "./config.js";
import { deriveEvidence } from "./evidence.js";
import { validateExperiment } from "./gateway.js";
import { buildEligibleExperiments, buildMonitoringExperiment, guidanceForTarget, registryMatchesReviewedPlans } from "./modules.js";
import { JsonStore } from "./store.js";
import { legacyFixtureRequest, resolveSimulation, simulationCatalog, type SimulationPaths } from "./simulation/catalog.js";

export interface CoordinatorOptions extends SimulationPaths { store: JsonStore; agent: DecisionClient; serialPath?: string; physicalEnabled: boolean; now?: () => Date }
export class DomainError extends Error { constructor(message: string, readonly status = 400) { super(message); } }

export class Coordinator {
  readonly events = new EventEmitter();
  private readonly sessions = new Map<string, DiagnosisSession>();
  private readonly adapters = new Map<string, HardwareAdapter>();
  private readonly lastMonitoringRead = new Map<string, number>();
  private readonly now: () => Date;
  constructor(private readonly options: CoordinatorOptions) { this.now = options.now ?? (() => new Date()); }

  getSimulationCatalog() { return simulationCatalog(this.options); }

  async createSession(mode: SessionMode, fixture?: SimulationFixture, inputContext: ProjectContext = defaultProjectContext, requestedTarget?: string, requestedSimulation?: SimulationRequest): Promise<DiagnosisSession> {
    const context = projectContextSchema.parse(inputContext);
    if (mode === "physical" && context.hardwareProfileId.includes("safe-disabled")) throw new DomainError("Physical sessions require an explicitly reviewed project and firmware profile.", 409);
    const targetId = requestedTarget ?? context.primaryTargetId;
    const target = targetById(context, targetId);
    if (!target || target.type !== context.profile.kind) throw new DomainError("Target must exist and match the selected profile.");
    const selectedFixture = fixture ?? (context.profile.kind === "loopback" ? "loopback_open" : "sensor_normal");
    if (mode === "simulation" && context.profile.kind === "loopback" && selectedFixture.startsWith("sensor_")) throw new DomainError("Sensor fixtures cannot be used with the loopback profile.");
    if (mode === "simulation" && context.profile.kind !== "loopback" && selectedFixture.startsWith("loopback_")) throw new DomainError("Loopback fixtures cannot be used with an optional sensor profile.");
    if (mode === "physical" && ((target.type === "hc_sr04" && !target.echoProtection.reviewed) || (target.type === "mpu6050" && !target.i2c.reviewed) || (target.type === "dht11" && !target.dataInterface.reviewed))) throw new DomainError("Physical optional profiles require their electrical interface to be explicitly reviewed.", 409);
    const id = randomUUID();
    let simulation;
    if (mode === "simulation") try { simulation = resolveSimulation(requestedSimulation ?? legacyFixtureRequest(selectedFixture, context.profile.kind), context.profile.kind, this.options); }
    catch (error) { throw new DomainError(error instanceof Error ? error.message : "Simulation specification is invalid.", 409); }
    const adapter: HardwareAdapter = mode === "simulation" ? new SimulatorAdapter(simulation!, context, this.options) : new SerialAdapter(this.options.serialPath ?? "", this.options.physicalEnabled, context);
    let hardware;
    try { hardware = await adapter.preflight(); }
    catch (error) { await adapter.close(); throw new DomainError(error instanceof Error ? error.message : "Hardware preflight failed.", 503); }
    const advertisedIds = new Set(hardware.registry.plans.map((entry) => entry.id));
    const bindingsMatchTarget = hardware.registry.plans.filter((plan) => context.allowedPlanIds.includes(plan.id)).every((plan) => plan.bindingIds.every((binding) => target.bindingIds.includes(binding)));
    if (context.allowedPlanIds.some((planId) => !advertisedIds.has(planId)) || hardware.registry.plans.some((plan) => plan.targetType !== context.profile.kind) || !bindingsMatchTarget || !registryMatchesReviewedPlans(context, hardware.registry)) { await adapter.close(); throw new DomainError("Advertised capabilities do not match the immutable project context and reviewed plan definitions.", 409); }
    try { await adapter.armSession?.(); }
    catch (error) { await adapter.close(); throw new DomainError(error instanceof Error ? error.message : "Hardware session arming failed.", 503); }
    const createdAt = this.now().toISOString(); const digest = projectContextDigest(context);
    const session: DiagnosisSession = {
      schemaVersion: 3, id, mode, fixture: mode === "simulation" && !requestedSimulation ? selectedFixture : undefined, simulation, targetId, projectContext: context, projectContextDigest: digest,
      createdAt, updatedAt: createdAt, version: 0, lifecycle: "READY", phase: "diagnostic", agentState: "IDLE", hardware, observations: [], decisions: [],
      experimentsExecuted: 0, monitoringReads: 0, verificationRuns: 0, consecutiveVerificationPasses: 0,
      evidence: deriveEvidence([], context, targetId, false, mode), timeline: [], fallbackUsed: false,
    };
    this.sessions.set(id, session); this.adapters.set(id, adapter);
    await this.addEvent(session, "session.created", `${mode === "simulation" ? "Simulation" : "Physical"} ${context.profile.kind} session created.`, { fixture: session.fixture, simulation, targetId, projectContextDigest: digest, registryDigest: hardware.registry.digest });
    await this.commit(session); return session;
  }

  async getSession(id: string): Promise<DiagnosisSession> {
    const active = this.sessions.get(id); if (active) return active;
    let stored: DiagnosisSession | undefined;
    try { stored = await this.options.store.loadSession(id); }
    catch (error) { throw new DomainError(error instanceof Error ? error.message : "Stored session is incompatible.", 409); }
    if (!stored) throw new DomainError("Session not found.", 404);
    this.sessions.set(id, stored); return stored;
  }

  async submitProblem(id: string, problem: string): Promise<DiagnosisSession> {
    const session = await this.getSession(id);
    if (session.lifecycle !== "READY") throw new DomainError("Problem can only be submitted to a ready session.", 409);
    session.problem = problem; session.lifecycle = "INVESTIGATING"; session.agentState = "SELECTING_NEXT_EXPERIMENT";
    await this.addEvent(session, "problem.submitted", problem); await this.selectNext(session, true); await this.commit(session); return session;
  }

  async startInvestigation(id: string): Promise<DiagnosisSession> {
    const session = await this.getSession(id);
    if (session.lifecycle !== "INVESTIGATING" || !session.pendingDecision?.experiment.command) throw new DomainError("No bounded experiment is ready.", 409);
    session.agentState = "READY_TO_EXECUTE";
    await this.addEvent(session, "investigation.started", `The agent selected ${session.pendingDecision.experiment.label}.`, { experimentId: session.pendingDecision.experiment.id, planId: session.pendingDecision.experiment.planId });
    await this.commit(session); return session;
  }

  async advanceInvestigation(id: string): Promise<DiagnosisSession> {
    const session = await this.getSession(id);
    if (terminalLifecycleStates.includes(session.lifecycle) || session.lifecycle === "DIAGNOSIS_READY") return session;
    if (!session.pendingDecision) { await this.selectNext(session); await this.commit(session); return session; }
    if (session.mode === "physical") throw new DomainError("Physical execution requires explicit setup confirmation through the decision endpoint.", 409);
    return this.executePending(id, session.pendingDecision.id, session.version, true, "Simulation fixture setup acknowledged.");
  }

  async executePending(id: string, decisionId: string, expectedVersion: number, setupConfirmed = false, setupDeclaration?: string): Promise<DiagnosisSession> {
    const session = await this.getSession(id); const pending = session.pendingDecision;
    if (!pending || pending.id !== decisionId) throw new DomainError("Pending decision does not exist or has already executed.", 409);
    if (session.version !== expectedVersion || pending.sessionVersion !== expectedVersion) throw new DomainError("Decision is stale; refresh before execution.", 409);
    if (pending.experiment.requiresSetupConfirmation && !setupDeclaration?.trim()) throw new DomainError("A setup declaration is required for this registered experiment.", 409);
    const validation = validateExperiment({ ...session, pendingDecision: undefined }, pending.experiment, setupConfirmed);
    if (!validation.accepted) throw new DomainError(validation.reasons.join(" "), 409);
    session.pendingDecision = undefined; session.agentState = "EXECUTING";
    const checkedAt = this.now().toISOString();
    await this.addEvent(session, "gateway.accepted", `Safety gateway accepted ${pending.experiment.planId}.`, { decisionId, setupConfirmed, validation });
    const adapter = this.adapters.get(id); if (!adapter) throw new DomainError("Adapter is unavailable after process restart; create a new session.", 503);
    let observation: Observation;
    try { observation = await adapter.execute(pending.experiment, { sessionId: session.id, projectContextDigest: session.projectContextDigest, phase: session.phase, setupDeclaration, gatewayValidation: { ...validation, checkedAt } }); }
    catch (error) { session.lifecycle = "INTERRUPTED"; session.agentState = "INCONCLUSIVE"; session.failureReason = error instanceof Error ? error.message : "Adapter execution failed."; await this.addEvent(session, "session.interrupted", session.failureReason); await this.commit(session); return session; }
    try { this.assertProvenance(session, pending.experiment, observation); }
    catch (error) {
      session.lifecycle = "INTERRUPTED";
      session.agentState = "INCONCLUSIVE";
      session.failureReason = error instanceof Error ? error.message : "Observation provenance validation failed.";
      await this.addEvent(session, "session.interrupted", session.failureReason, { decisionId, planId: pending.experiment.planId });
      await this.commit(session);
      throw error;
    }
    session.observations.push(observation); session.experimentsExecuted += 1; if (session.phase === "verification") session.verificationRuns += 1;
    session.agentState = "ANALYZING";
    session.evidence = deriveEvidence(session.observations, session.projectContext, session.targetId, Boolean(session.intervention), session.mode);
    session.consecutiveVerificationPasses = session.evidence.verification.consecutivePasses;
    await this.addEvent(session, "observation.captured", session.evidence.assessments.at(-1)?.summary ?? "Observation captured.", { observationId: observation.id, planId: observation.planId, source: observation.source, evidenceState: session.evidence.state });
    if (observation.operation.estopLatched) { session.lifecycle = "ESTOPPED"; session.agentState = "INCONCLUSIVE"; }
    else if (session.evidence.verification.status === "PASSED") { session.lifecycle = "CONFIRMED"; session.agentState = "CONFIRMED"; this.options.agent.clear(session.id); await this.addEvent(session, "verification.confirmed", "Two consecutive physical verification runs passed."); }
    else if (session.evidence.verification.status === "SIMULATED_PASS") { session.lifecycle = "INCONCLUSIVE"; session.agentState = "INCONCLUSIVE"; session.failureReason = "Simulation verification passed, but physical confirmation requires a physical session."; this.options.agent.clear(session.id); await this.addEvent(session, "verification.simulated", session.failureReason); }
    else if (session.evidence.verification.status === "FAILED") { session.lifecycle = "FAILED_VERIFICATION"; session.agentState = "FAILED_VERIFICATION"; session.failureReason = "The declared intervention did not pass the bounded verification procedure."; this.options.agent.clear(session.id); await this.addEvent(session, "verification.failed", session.failureReason); }
    else await this.selectNext(session);
    await this.commit(session); return session;
  }

  async declareIntervention(id: string, description: string, recommendationId: string, safetyConfirmed: boolean): Promise<DiagnosisSession> {
    const session = await this.getSession(id);
    if (session.lifecycle !== "DIAGNOSIS_READY") throw new DomainError("Intervention is available only after an evidence-supported diagnosis.", 409);
    const recommendation = session.evidence.recommendations.find((entry) => entry.id === recommendationId);
    if (!recommendation) throw new DomainError("Recommendation is not valid for current evidence.", 409);
    if (!safetyConfirmed) throw new DomainError("The human operator must confirm the intervention safety procedure.", 409);
    session.lifecycle = "INTERVENTION";
    session.intervention = { description, recommendationId, safetyConfirmed: true, declaredAt: this.now().toISOString() };
    await this.addEvent(session, "intervention.declared", description, { recommendationId, safetyConfirmed: true });
    this.adapters.get(id)?.declareIntervention();
    session.lifecycle = "VERIFYING"; session.phase = "verification"; session.agentState = "VERIFYING";
    session.evidence = deriveEvidence(session.observations, session.projectContext, session.targetId, true, session.mode);
    await this.selectNext(session); await this.commit(session); return session;
  }

  async captureLiveReading(id: string): Promise<{ observation: Observation; version: number; monitoringReads: number }> {
    const session = await this.getSession(id);
    if (session.mode === "physical") throw new DomainError("Physical monitoring requires an explicitly confirmed registered execution.", 409);
    if (terminalLifecycleStates.includes(session.lifecycle)) throw new DomainError("Monitoring is unavailable for this terminal session.", 409);
    if (session.monitoringReads >= session.projectContext.constraints.maximumMonitoringReads) throw new DomainError("Monitoring budget is exhausted.", 429);
    const last = this.lastMonitoringRead.get(id) ?? 0; if (Date.now() - last < 250) throw new DomainError("Monitoring is rate-limited.", 429); this.lastMonitoringRead.set(id, Date.now());
    const experiment = buildMonitoringExperiment(session); if (!experiment) throw new DomainError("No registered monitoring plan is available.", 409);
    const adapter = this.adapters.get(id); if (!adapter) throw new DomainError("Adapter is unavailable after process restart.", 503);
    const checkedAt = this.now().toISOString();
    const observation = await adapter.execute(experiment, { sessionId: session.id, projectContextDigest: session.projectContextDigest, phase: "monitoring", setupDeclaration: "Simulation monitoring fixture.", gatewayValidation: { accepted: true, checkedAt, reasons: [] } });
    this.assertProvenance(session, experiment, observation); session.observations.push(observation); session.monitoringReads += 1;
    await this.addEvent(session, "monitoring.sample", "Captured a provenance-tagged monitoring sample excluded from evidence.", { observationId: observation.id }); await this.commit(session);
    return { observation, version: session.version, monitoringReads: session.monitoringReads };
  }

  async targetGuidance(id: string) { const session = await this.getSession(id); const target = targetById(session.projectContext, session.targetId); if (!target) throw new DomainError("Target is not in project context.", 404); return { target: { id: target.id, label: target.label, type: target.type }, guidance: guidanceForTarget(target) }; }

  async emergencyStop(id: string): Promise<DiagnosisSession> {
    const session = await this.getSession(id); const adapter = this.adapters.get(id);
    if (adapter) try {
      const experiment: ExperimentDefinition = { id: `abort:${randomUUID()}`, type: "abort", label: "Abort", description: "Stop active operations and apply safe cleanup.", targetId: session.targetId, command: "abort", planId: "abort.v1", phase: session.phase, requiresSetupConfirmation: false, budgetClass: "read", evidenceReferences: [] };
      await adapter.execute(experiment, { sessionId: session.id, projectContextDigest: session.projectContextDigest, phase: session.phase, gatewayValidation: { accepted: true, checkedAt: this.now().toISOString(), reasons: [] } });
    } catch { /* Local state still fails closed. */ }
    session.hardware.estopLatched = true; session.lifecycle = "ESTOPPED"; session.agentState = "INCONCLUSIVE"; session.pendingDecision = undefined;
    await this.addEvent(session, "safety.estop", "Emergency stop latched; registered outputs were commanded to their safe state."); await this.commit(session); return session;
  }

  async report(id: string): Promise<DiagnosisReport> {
    const session = await this.getSession(id);
    return { sessionId: session.id, evidenceSource: session.mode, project: session.projectContext.project, profile: session.projectContext.profile, targetId: session.targetId, reportedProblem: session.problem, observed: session.evidence.observed, inference: session.evidence.inferences, recommendation: session.evidence.recommendations, conclusion: session.evidence.conclusion, verification: session.evidence.verification, confidence: session.evidence.confidence, limitations: session.evidence.limitations, experiments: session.observations, intervention: session.intervention, status: session.lifecycle, timing: { machineActiveMs: session.observations.reduce((sum, observation) => sum + Math.max(0, observation.monotonicEndedMs - observation.monotonicStartedMs), 0), wallClockMs: this.now().getTime() - new Date(session.createdAt).getTime() }, agenticProof: session.decisions.some((decision) => decision.decisionSource === "gemini" || decision.decisionSource === "openai") };
  }

  private async selectNext(session: DiagnosisSession, initial = false): Promise<void> {
    if (session.experimentsExecuted >= session.projectContext.constraints.maximumExperiments) { session.lifecycle = "INCONCLUSIVE"; session.agentState = "INCONCLUSIVE"; session.failureReason = "Experiment budget exhausted before a supported conclusion."; return; }
    const eligible = buildEligibleExperiments(session);
    if (!eligible.length) { session.lifecycle = "INCONCLUSIVE"; session.agentState = "INCONCLUSIVE"; session.failureReason = "No safe eligible experiment remains."; return; }
    let selection = await this.options.agent.decide({ session, eligibleExperiments: eligible });
    let experiment = eligible.find((entry) => entry.id === selection.experimentId);
    if (!experiment) { selection = fallbackDecision({ session, eligibleExperiments: eligible }); experiment = eligible[0]!; session.fallbackUsed = true; }
    const record = toDecisionRecord(selection, experiment, session, eligible);
    record.gatewayValidation = validateExperiment(session, experiment, true); session.decisions.push(record); session.fallbackUsed ||= selection.decisionSource === "fallback";
    await this.addEvent(session, "agent.decision", `${experiment.type}: ${selection.rationale}`, { decisionId: record.id, eligibleExperimentIds: record.eligibleExperimentIds, experimentId: experiment.id, evidenceReferences: experiment.evidenceReferences, source: selection.decisionSource, validation: record.gatewayValidation });
    if (!record.gatewayValidation.accepted) { session.lifecycle = "INCONCLUSIVE"; session.agentState = "INCONCLUSIVE"; session.failureReason = record.gatewayValidation.reasons.join(" "); return; }
    if (experiment.type === "request_intervention") { session.lifecycle = "DIAGNOSIS_READY"; session.agentState = "WAITING_FOR_INTERVENTION"; this.options.agent.clear(session.id); return; }
    if (experiment.type === "conclude_normal") { session.lifecycle = "CONCLUDED_NORMAL"; session.agentState = "CONCLUDED_NORMAL"; this.options.agent.clear(session.id); return; }
    if (experiment.type === "conclude_inconclusive") { session.lifecycle = "INCONCLUSIVE"; session.agentState = "INCONCLUSIVE"; session.failureReason = "Bounded evidence did not support a repair claim."; this.options.agent.clear(session.id); return; }
    if (!experiment.command) { session.lifecycle = "INCONCLUSIVE"; session.agentState = "INCONCLUSIVE"; session.failureReason = "Selected experiment has no registered command."; return; }
    session.pendingDecision = { id: record.id, sessionVersion: session.version + 1, experiment, objective: selection.objective, rationale: selection.rationale, experimentsRemaining: session.projectContext.constraints.maximumExperiments - session.experimentsExecuted, createdAt: this.now().toISOString() };
    session.agentState = initial ? "IDLE" : session.phase === "verification" ? "VERIFYING" : "READY_TO_EXECUTE";
  }

  private assertProvenance(session: DiagnosisSession, experiment: ExperimentDefinition, observation: Observation): void {
    const expectedAdapter = session.mode === "physical" ? "esp32" : "simulator";
    const plan = session.hardware.registry.plans.find((entry) => entry.id === experiment.planId);
    const target = targetById(session.projectContext, experiment.targetId);
    const bindingsMatch = Boolean(plan) && observation.bindingIds.length === plan!.bindingIds.length && plan!.bindingIds.every((binding) => observation.bindingIds.includes(binding));
    const nestedTargetsMatch = [...observation.measurements, ...observation.series, ...observation.targetHealth].every((entry) => entry.targetId === experiment.targetId);
    const declaredMeasurementsMatch = Boolean(plan) && observation.measurements.length === plan!.measurements.length && plan!.measurements.every((descriptor) => observation.measurements.some((entry) => entry.channel === descriptor.channel && entry.unit === descriptor.unit));
    const declaredSeriesMatch = Boolean(plan) && observation.series.every((entry) => plan!.series.some((descriptor) => descriptor.channel === entry.channel && descriptor.unit === entry.unit && descriptor.sampleIntervalUs === entry.sampleIntervalUs && entry.values.length <= descriptor.maximumSamples));
    const previousSequence = session.observations.at(-1)?.sequenceNumber ?? -1;
    const capturedAtValid = Number.isFinite(Date.parse(observation.capturedAt));
    const simulationMatches = session.mode === "physical" ? observation.simulation === undefined : Boolean(session.simulation && observation.simulation && JSON.stringify(session.simulation) === JSON.stringify(observation.simulation));
    if (!plan || !target || !simulationMatches || observation.sessionId !== session.id || observation.source !== session.mode || observation.adapter !== expectedAdapter || observation.projectContextDigest !== session.projectContextDigest || observation.registryDigest !== session.hardware.registry.digest || observation.hardwareProfileId !== session.hardware.profileId || observation.firmwareVersion !== session.hardware.firmwareVersion || observation.boardIdentity !== session.hardware.boardIdentity || observation.experimentId !== experiment.id || observation.targetId !== experiment.targetId || observation.targetType !== target.type || observation.command !== experiment.command || observation.planId !== experiment.planId || observation.phase !== experiment.phase || observation.sequenceNumber <= previousSequence || observation.monotonicEndedMs < observation.monotonicStartedMs || !capturedAtValid || !bindingsMatch || !nestedTargetsMatch || !declaredMeasurementsMatch || !declaredSeriesMatch || observation.targetHealth.length === 0 || (experiment.requiresSetupConfirmation && !observation.setupDeclaration?.trim()) || !observation.gatewayValidation.accepted) throw new DomainError("Observation provenance does not match the immutable session, registry, plan, target, mode, or measurement schema.", 409);
  }
  private async addEvent(session: DiagnosisSession, type: string, summary: string, data?: Record<string, unknown>): Promise<void> { const event: TimelineEvent = { id: randomUUID(), sessionId: session.id, at: this.now().toISOString(), type, summary, data }; session.timeline.push(event); await this.options.store.appendEvent(event); this.events.emit(session.id, event); }
  private async commit(session: DiagnosisSession): Promise<void> { session.version += 1; session.updatedAt = this.now().toISOString(); if (session.pendingDecision) session.pendingDecision.sessionVersion = session.version; await this.options.store.saveSession(session); }
}
