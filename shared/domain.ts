export const sessionModes = ["physical", "simulation"] as const;
export type SessionMode = (typeof sessionModes)[number];

export const profileKinds = ["loopback", "hc_sr04", "mpu6050", "dht11"] as const;
export type ProfileKind = (typeof profileKinds)[number];

export const simulationFixtures = [
  "loopback_intact", "loopback_open", "loopback_distorted", "loopback_stimulus_fault",
  "loopback_conflicting", "loopback_verification_failure", "sensor_normal", "sensor_fault",
] as const;
export type SimulationFixture = (typeof simulationFixtures)[number];

export const hardwareCommands = ["execute_plan", "abort"] as const;
export type HardwareCommand = (typeof hardwareCommands)[number];
export const experimentTypes = [
  "observe_destination", "observe_source", "compare_endpoints", "measure_timing", "inspect_stimulus",
  "repeat_synchronized_capture", "sensor_identity", "sensor_baseline", "sensor_response", "sensor_consistency",
  "verify_repair", "request_intervention", "conclude_normal", "conclude_inconclusive", "abort",
] as const;
export type ExperimentType = (typeof experimentTypes)[number];
export type ExperimentPhase = "monitoring" | "diagnostic" | "verification";
export type BudgetClass = "read" | "timed_io" | "bounded_output";

interface BaseTargetContext { id: string; label: string; type: ProfileKind; bindingIds: string[]; limitations: string[] }
export interface LoopbackTargetContext extends BaseTargetContext {
  type: "loopback";
  bindings: { stimulus: "gpio4_stimulus"; sourceObserver: "gpio5_source_observer"; destinationObserver: "gpio6_destination_observer" };
  fixture: { stimulusSeriesOhms: 1000; observerSeriesOhms: 4700; destinationPulldownOhms: 100000; removableJumper: true };
  expected: { frequencyHz: 1000; dutyPercent: 50; durationMs: 500; frequencyToleranceFraction: number; dutyTolerancePercent: number; minimumCorrelation: number };
}
export interface Hcsr04TargetContext extends BaseTargetContext {
  type: "hc_sr04";
  echoProtection: { reviewed: boolean; upperOhms: 8200; lowerOhms: 10000; pullupVolts?: never };
  expected: { distanceCm?: [number, number]; maximumStddevCm: number; maximumTimeoutRate: number };
}
export interface Mpu6050TargetContext extends BaseTargetContext {
  type: "mpu6050";
  i2c: { address: "0x68" | "0x69"; pullupVolts: 3.3; reviewed: boolean };
  expected: { maximumStationaryNoiseG: number; maximumInvalidSampleRate: number };
}
export interface Dht11TargetContext extends BaseTargetContext {
  type: "dht11";
  dataInterface: { pullupVolts: 3.3; levelShifted: boolean; reviewed: boolean };
  expected: { temperatureC?: [number, number]; humidityPercent?: [number, number]; maximumInvalidRate: number; minimumReadIntervalMs: number };
}
export type TargetContext = LoopbackTargetContext | Hcsr04TargetContext | Mpu6050TargetContext | Dht11TargetContext;

export interface ProjectContext {
  schemaVersion: 2;
  project: { id: string; name: string; goal: string };
  profile: { kind: ProfileKind; moduleId: string };
  hardwareProfileId: string;
  primaryTargetId: string;
  targets: TargetContext[];
  allowedPlanIds: string[];
  procedures: {
    setupChecklist: string[];
    interventionSafety: string[];
    reference?: { kind: "baseline_characterization" | "project_calibration"; procedureId?: string; description: string };
  };
  constraints: { maximumExperiments: number; maximumMonitoringReads: number; requiredVerificationPasses: 2; physicalSourceRequiredForConfirmation: true; humanOnlyIntervention: true };
}

export interface MeasurementChannelDescriptor { channel: string; unit: string; description: string }
export interface RegisteredPlan {
  id: string; capabilityId: string; type: ExperimentType; label: string; description: string; targetType: ProfileKind;
  command: HardwareCommand; bindingIds: string[]; phases: ExperimentPhase[]; budgetClass: BudgetClass;
  requiresSetupConfirmation: boolean; durationMs: number; fixedParameters: Record<string, number | string | boolean>;
  measurements: MeasurementChannelDescriptor[]; limitations: string[]; cleanup: string;
}
export interface CapabilityRegistry { schemaVersion: 1; registryVersion: string; digest: string; boardIdentity: string; hardwareProfileId: string; plans: RegisteredPlan[] }

export interface ExperimentDefinition {
  id: string; type: ExperimentType; label: string; description: string; targetId: string; planId?: string; command?: HardwareCommand;
  phase: ExperimentPhase; requiresSetupConfirmation: boolean; budgetClass: BudgetClass; evidenceReferences: string[]; recommendationId?: string;
  operatorPrompt?: string; confirmationLabel?: string;
}

export type MeasurementValue = number | boolean | string;
export interface Measurement { channel: string; value: MeasurementValue; unit: string; targetId: string; quality: "valid" | "invalid" }
export interface MeasurementSeries { channel: string; unit: string; targetId: string; sampleIntervalUs: number; values: number[] }
export interface TargetHealth { targetId: string; healthy: boolean; errorRate: number; detail?: string }
export interface OperationResult { accepted: boolean; aborted: boolean; timedOut: boolean; estopLatched: boolean; cleanupSucceeded: boolean; reasons: string[] }
export interface Observation {
  id: string; sessionId: string; experimentId: string; targetId: string; targetType: ProfileKind; source: SessionMode; adapter: "esp32" | "simulator";
  command: HardwareCommand; planId: string; phase: ExperimentPhase; capturedAt: string; monotonicStartedMs: number; monotonicEndedMs: number;
  sequenceNumber: number; measurements: Measurement[]; series: MeasurementSeries[]; targetHealth: TargetHealth[]; operation: OperationResult;
  projectContextDigest: string; registryDigest: string; firmwareVersion: string; boardIdentity: string; hardwareProfileId: string; bindingIds: string[];
  setupDeclaration?: string; gatewayValidation: { accepted: boolean; checkedAt: string; reasons: string[] }; limitations: string[];
}

export const evidenceStates = ["INSUFFICIENT_EVIDENCE", "DESTINATION_MISSING", "DESTINATION_MALFORMED", "SOURCE_MALFORMED", "PATH_OPEN_SUPPORTED", "SIGNAL_PATH_FAULT_SUPPORTED", "CONFLICTING_EVIDENCE", "NORMAL", "SENSOR_ANOMALY"] as const;
export type EvidenceState = (typeof evidenceStates)[number];
export const confidenceLabels = ["UNKNOWN", "POSSIBLE", "LIKELY", "HIGH_CONFIDENCE"] as const;
export type ConfidenceLabel = (typeof confidenceLabels)[number];
export type HypothesisStatus = "UNTESTED" | "POSSIBLE" | "SUPPORTED" | "WEAKENED";
export type VerificationStatus = "NOT_RUN" | "PENDING" | "PASSED" | "FAILED" | "SIMULATED_PASS";
export type SignalClassification = "VALID" | "MISSING" | "MALFORMED" | "CONFLICTING" | "INVALID";
export interface ObservationAssessment { observationId: string; planId: string; valid: boolean; classification: SignalClassification; summary: string; limitations: string[] }
export interface EvidenceStatement { id: string; text: string; observationIds: string[]; limitations: string[] }
export interface HypothesisEvidence { id: string; label: string; status: HypothesisStatus; reasons: string[]; limitations: string[] }
export interface Recommendation {
  id: string; targetId: string; kind: "restore_loopback_path" | "inspect_signal_path"; action: string; basis: string; expectedEffect: string;
  safetyConstraints: string[]; verificationPlanId: string; confidence: ConfidenceLabel;
}
export interface VerificationSummary { status: VerificationStatus; requiredConsecutivePasses: number; consecutivePasses: number; observationIds: string[]; summary: string }
export interface EvidenceView {
  state: EvidenceState; confidence: ConfidenceLabel; assessments: ObservationAssessment[]; observed: EvidenceStatement[]; inferences: EvidenceStatement[];
  hypotheses: HypothesisEvidence[]; recommendations: Recommendation[]; verification: VerificationSummary; limitations: string[];
}

export const lifecycleStates = ["READY", "INVESTIGATING", "CONCLUDED_NORMAL", "INCONCLUSIVE", "DIAGNOSIS_READY", "INTERVENTION", "VERIFYING", "CONFIRMED", "FAILED_VERIFICATION", "INTERRUPTED", "ESTOPPED"] as const;
export type LifecycleState = (typeof lifecycleStates)[number];
export const terminalLifecycleStates: LifecycleState[] = ["CONCLUDED_NORMAL", "INCONCLUSIVE", "CONFIRMED", "FAILED_VERIFICATION", "INTERRUPTED", "ESTOPPED"];
export const agentStates = ["IDLE", "SELECTING_NEXT_EXPERIMENT", "READY_TO_EXECUTE", "EXECUTING", "ANALYZING", "WAITING_FOR_INTERVENTION", "VERIFYING", "CONCLUDED_NORMAL", "INCONCLUSIVE", "CONFIRMED", "FAILED_VERIFICATION"] as const;
export type AgentState = (typeof agentStates)[number];

export interface DecisionRecord {
  id: string; observationIds: string[]; contextDigest: string; candidateHypotheses: string[]; eligibleExperimentIds: string[];
  selectedExperimentId: string; selectedAction: ExperimentType; objective: string; rationale: string; provider: "openai" | "deterministic";
  model: string; responseId?: string; createdAt: string; gatewayValidation: { accepted: boolean; reasons: string[] }; decisionSource: "openai" | "fallback";
}
export interface PendingDecision { id: string; sessionVersion: number; experiment: ExperimentDefinition; objective: string; rationale: string; experimentsRemaining: number; createdAt: string }
export interface Intervention { description: string; declaredAt: string; recommendationId: string; safetyConfirmed: boolean }
export interface TimelineEvent { id: string; sessionId: string; at: string; type: string; summary: string; data?: Record<string, unknown> }
export interface HardwareStatus {
  connected: boolean; firmwareVersion: string; boardIdentity: string; protocolVersion: string; profileId: string; physicalEnabled: boolean;
  estopLatched: boolean; registry: CapabilityRegistry; limitations: string[];
}
export interface DiagnosisSession {
  schemaVersion: 3; id: string; mode: SessionMode; fixture?: SimulationFixture; targetId: string; projectContext: ProjectContext; projectContextDigest: string;
  createdAt: string; updatedAt: string; version: number; lifecycle: LifecycleState; phase: "diagnostic" | "verification"; agentState: AgentState;
  problem?: string; hardware: HardwareStatus; observations: Observation[]; decisions: DecisionRecord[]; pendingDecision?: PendingDecision; intervention?: Intervention;
  experimentsExecuted: number; monitoringReads: number; verificationRuns: number; consecutiveVerificationPasses: number; evidence: EvidenceView;
  timeline: TimelineEvent[]; fallbackUsed: boolean; failureReason?: string;
}
export interface DiagnosisReport {
  sessionId: string; evidenceSource: SessionMode; project: ProjectContext["project"]; profile: ProjectContext["profile"]; targetId: string;
  reportedProblem?: string; observed: EvidenceStatement[]; inference: EvidenceStatement[]; recommendation: Recommendation[]; verification: VerificationSummary;
  confidence: ConfidenceLabel; limitations: string[]; experiments: Observation[]; intervention?: Intervention; status: LifecycleState;
  timing: { machineActiveMs: number; wallClockMs: number }; agenticProof: boolean;
}

export const DEFAULT_LIMITS = { maximumExperiments: 12, maximumMonitoringReads: 40, requiredVerificationPasses: 2 } as const;
export function measurement<T extends MeasurementValue>(observation: Observation, channel: string): T | undefined { return observation.measurements.find((entry) => entry.channel === channel && entry.quality === "valid")?.value as T | undefined; }
export function targetById(context: ProjectContext, id: string): TargetContext | undefined { return context.targets.find((target) => target.id === id); }
