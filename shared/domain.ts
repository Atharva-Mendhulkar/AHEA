export const sessionModes = ["physical", "simulation"] as const;
export type SessionMode = (typeof sessionModes)[number];

export const deviceTypes = ["mpu6050", "dht11", "hc_sr04", "fsr", "servo", "relay"] as const;
export type DeviceType = (typeof deviceTypes)[number];
export const deviceRoles = ["reference", "subject", "observer", "actuator"] as const;
export type DeviceRole = (typeof deviceRoles)[number];

export const simulationFixtures = ["fsr_balanced", "fsr_outlier_compensable", "fsr_noisy", "fsr_read_failure"] as const;
export type SimulationFixture = (typeof simulationFixtures)[number];

export const hardwareCommands = ["scan_i2c", "identify_mpu6050", "sample_mpu6050", "sample_dht11", "measure_distance", "sample_fsr", "abort"] as const;
export type HardwareCommand = (typeof hardwareCommands)[number];
export const experimentTypes = [...hardwareCommands, "compare_reference_sensor", "analyze_resistor_candidates", "verify_sensor", "request_intervention", "request_manual_check", "conclude_normal"] as const;
export type ExperimentType = (typeof experimentTypes)[number];

interface BaseDeviceContext { id: string; label: string; type: DeviceType; role: DeviceRole; binding: string }
export interface Mpu6050DeviceContext extends BaseDeviceContext { type: "mpu6050"; role: "reference" | "subject" | "observer"; address: "0x68" | "0x69"; expected: { maximumAccelerationStddevG: number; maximumInvalidSampleRate: number } }
export interface Dht11DeviceContext extends BaseDeviceContext { type: "dht11"; role: "reference" | "subject" | "observer"; expected: { temperatureC?: [number, number]; humidityPercent?: [number, number]; maximumInvalidSampleRate: number } }
export interface Hcsr04DeviceContext extends BaseDeviceContext { type: "hc_sr04"; role: "reference" | "subject" | "observer"; echoProtectionReviewed: boolean; expected: { distanceCm?: [number, number]; maximumStddevCm: number; maximumTimeoutRate: number } }
export type FsrDividerTopology = "unknown" | "fsr_to_vcc" | "fsr_to_gnd";
export interface FsrDeviceContext extends BaseDeviceContext { type: "fsr"; role: "reference" | "subject"; circuit: { topology: FsrDividerTopology; fixedResistorOhms?: number; supplyMillivolts?: number; adcMaximumMillivolts?: number; adcMaximumRaw: number }; expected: { maximumSampleStddevRaw: number; maximumInvalidSampleRate: number } }
export interface ServoDeviceContext extends BaseDeviceContext { type: "servo"; role: "actuator"; actuationEnabled: false; observerDeviceId?: string }
export interface RelayDeviceContext extends BaseDeviceContext { type: "relay"; role: "actuator"; actuationEnabled: false; driverReviewed: false; observerDeviceId?: string }
export type DeviceContext = Mpu6050DeviceContext | Dht11DeviceContext | Hcsr04DeviceContext | FsrDeviceContext | ServoDeviceContext | RelayDeviceContext;

export interface ProjectContext {
  schemaVersion: 1;
  project: { id: string; name: string; goal: string };
  hardwareProfileId: string;
  components: DeviceContext[];
  expectedBehavior: { kind: "equivalent_normalized_response"; referenceDeviceIds: string[]; subjectDeviceIds: string[]; toleranceFraction: number };
  procedures: { fsrStimulus: { kind: "repeatable_manual"; trialsPerDevice: number; operatorConfirmationRequired: true } };
  constraints: { maximumExperiments: number; physicalSourceRequiredForConfirmation: boolean; humanApprovalBeforeModification: true; allowedResistorOhms: number[]; maximumDividerCurrentMilliamps?: number };
}

export interface ExperimentDefinition {
  id: string;
  type: ExperimentType;
  label: string;
  description: string;
  targetDeviceId?: string;
  referenceDeviceIds?: string[];
  recommendationId?: string;
  command?: HardwareCommand;
  planId: string;
  phase: "monitoring" | "diagnostic" | "verification";
  requiresApproval: boolean;
  requiresSetupConfirmation: boolean;
  budgetClass: "read" | "timed_io" | "actuation";
}

export type MeasurementValue = number | boolean | string;
export interface Measurement { channel: string; value: MeasurementValue; unit: string; deviceId: string; quality: "valid" | "invalid" }
export interface MeasurementSeries { channel: string; unit: string; deviceId: string; sampleIntervalMs: number; values: number[] }
export interface SensorHealth { deviceId: string; healthy: boolean; errorRate: number; detail?: string }
export interface OperationResult { accepted: boolean; aborted: boolean; timedOut: boolean; estopLatched: boolean; reasons: string[] }
export interface Observation {
  id: string; sessionId: string; experimentId: string; deviceId?: string; deviceType?: DeviceType; source: SessionMode; adapter: "esp32" | "simulator"; command: HardwareCommand; phase: "monitoring" | "diagnostic" | "verification"; capturedAt: string; deviceUptimeMs?: number; elapsedMs: number; measurements: Measurement[]; series?: MeasurementSeries[]; sensorHealth: SensorHealth[]; operation: OperationResult; projectContextDigest: string; calibrationReference?: string;
}

export type EvidenceState = "INSUFFICIENT_EVIDENCE" | "NORMAL" | "OUTLIER" | "CIRCUIT_MISMATCH" | "EXCESS_NOISE" | "COMMUNICATION_FAILURE" | "SENSOR_FAILURE_POSSIBLE";
export type ConfidenceLabel = "UNKNOWN" | "LOW" | "MEDIUM" | "HIGH";
export type HypothesisStatus = "UNTESTED" | "PLAUSIBLE" | "SUPPORTED" | "WEAKENED";
export type VerificationStatus = "NOT_RUN" | "PENDING" | "PASSED" | "FAILED";
export const agentStates = ["IDLE", "INITIALIZING", "WAITING_FOR_USER_STIMULUS", "RECORDING", "ANALYZING", "SELECTING_NEXT_EXPERIMENT", "WAITING_FOR_INTERVENTION", "POST_INTERVENTION_VERIFY", "DIAGNOSIS_READY", "CONFIRMED", "INCONCLUSIVE"] as const;
export type AgentState = (typeof agentStates)[number];
export type SignalQuality = "WAITING" | "GOOD" | "NOISY" | "INVALID";
export interface ActiveExperimentState {
  experimentId: string;
  deviceId: string;
  phase: "diagnostic" | "verification";
  startedAt: string;
  prompt: string;
  statusMessage: string;
  notBefore?: string;
  baseline?: number;
  currentValue?: number;
  delta?: number;
  sampleCount: number;
  probeReads: number;
  maximumProbeReads: number;
  stimulusDetected: boolean;
  signalQuality: SignalQuality;
}
export interface ObservationAssessment { observationId: string; deviceId?: string; valid: boolean; mean?: number; stddev?: number; comparisons: string[] }
export interface ReferenceSummary { deviceIds: string[]; collectedTrials: number; requiredTrials: number; meanRaw: number; stddevRaw: number; rangeRaw: [number, number] }
export interface SubjectSummary { deviceId: string; collectedTrials: number; requiredTrials: number; meanRaw: number; stddevRaw: number; normalizedResponse: number; referenceDeviationFraction: number }
export interface HypothesisEvidence { id: "sensor_variation" | "wiring_issue" | "resistor_mismatch" | "sensor_degradation" | "stimulus_inconsistency"; label: string; status: HypothesisStatus; reasons: string[]; limitations: string[] }
export interface CorrectionRecommendation { id: string; deviceId: string; kind: "resistor_substitution" | "manual_check"; observedProblem: string; referenceBehavior: string; candidateModification: string; reason: string; calculation: string; expectedEffect: string; parameters: Record<string, number | string>; safetyConstraints: string[]; verificationProcedure: string; confidence: ConfidenceLabel }
export interface EvidenceView { state: EvidenceState; confidence: ConfidenceLabel; observations: ObservationAssessment[]; reference?: ReferenceSummary; subject?: SubjectSummary; hypotheses: HypothesisEvidence[]; recommendations: CorrectionRecommendation[]; verificationStatus: VerificationStatus; consecutiveVerificationPasses: number; projectLevelChecks: string[]; limitations: string[] }

export const lifecycleStates = ["READY", "INVESTIGATING", "AWAITING_INTERVENTION", "VERIFYING", "CONFIRMED", "CONCLUDED", "INTERRUPTED", "FAILED", "ESTOPPED"] as const;
export type LifecycleState = (typeof lifecycleStates)[number];
export interface DecisionRecord { id: string; observationIds: string[]; contextDigest: string; candidateHypotheses: string[]; selectedExperimentId: string; selectedAction: ExperimentType; objective: string; rationale: string; provider: "openai" | "deterministic"; model: string; responseId?: string; createdAt: string; gatewayValidation: { accepted: boolean; reasons: string[] }; decisionSource: "openai" | "fallback" }
export interface PendingDecision { id: string; sessionVersion: number; experiment: ExperimentDefinition; objective: string; rationale: string; experimentsRemaining: number; createdAt: string }
export interface Intervention { description: string; declaredAt: string; recommendationId?: string; appliedParameters?: Record<string, number | string> }
export interface TimelineEvent { id: string; sessionId: string; at: string; type: string; summary: string; data?: Record<string, unknown> }
export interface HardwareStatus { connected: boolean; firmwareVersion: string; boardIdentity: string; protocolVersion: string; profileId: string; physicalEnabled: boolean; estopLatched: boolean; supportedCommands: HardwareCommand[]; detectedDevices: Array<{ deviceId: string; type: DeviceType; present?: boolean; identity?: string }>; limitations: string[] }
export interface DiagnosisSession {
  schemaVersion: 2; id: string; mode: SessionMode; fixture?: SimulationFixture; targetDeviceId: string; projectContext: ProjectContext; projectContextDigest: string; createdAt: string; updatedAt: string; version: number; lifecycle: LifecycleState; phase: "diagnostic" | "verification"; agentState: AgentState; activeExperiment?: ActiveExperimentState; problem?: string; hardware: HardwareStatus; observations: Observation[]; decisions: DecisionRecord[]; pendingDecision?: PendingDecision; intervention?: Intervention; experimentsExecuted: number; monitoringReads: number; verificationRuns: number; consecutiveVerificationPasses: number; evidence: EvidenceView; timeline: TimelineEvent[]; fallbackUsed: boolean; failureReason?: string;
}
export interface DiagnosisReport { sessionId: string; evidenceSource: SessionMode; project: ProjectContext["project"]; targetDeviceId: string; reportedProblem?: string; evidence: EvidenceView; experiments: Observation[]; intervention?: Intervention; status: LifecycleState; timing: { machineActiveMs: number; wallClockMs: number }; agenticProof: boolean }

export const DEFAULT_LIMITS = { maximumExperiments: 24, fsrSampleCount: 64, fsrSampleIntervalMs: 10, sensorTimeoutMs: 2_500, requiredVerificationPasses: 2 } as const;
export function measurement<T extends MeasurementValue>(observation: Observation, channel: string): T | undefined { return observation.measurements.find((entry) => entry.channel === channel && entry.quality === "valid")?.value as T | undefined }
export function deviceById(context: ProjectContext, id: string): DeviceContext | undefined { return context.components.find((device) => device.id === id) }
