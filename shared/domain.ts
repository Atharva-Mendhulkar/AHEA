export const sessionModes = ["physical", "simulation"] as const;
export type SessionMode = (typeof sessionModes)[number];

export const hardwareCommands = [
  "scan_i2c",
  "sample_motion",
  "motor_motion_probe",
  "motor_current_probe",
  "verify_motor",
  "emergency_stop",
] as const;
export type HardwareCommand = (typeof hardwareCommands)[number];
export type MotorCommand = Extract<HardwareCommand, "motor_motion_probe" | "motor_current_probe" | "verify_motor">;

export const agentActions = [
  ...hardwareCommands,
  "request_intervention",
  "report_fault_not_reproduced",
  "request_sensor_recovery",
] as const;
export type AgentAction = (typeof agentActions)[number];

export type MeasurementValue = number | boolean | string;
export interface Measurement {
  name: string;
  value: MeasurementValue;
  unit: string;
  sensor: "mpu6050" | "ina219" | "firmware";
  quality: "valid" | "invalid";
}

export interface SensorHealth {
  sensor: "mpu6050" | "ina219" | "firmware";
  healthy: boolean;
  errorRate: number;
  detail?: string;
}

export interface SafetyResult {
  activationAccepted: boolean;
  tripped: boolean;
  estopLatched: boolean;
  timeout: boolean;
  reasons: string[];
}

export interface MeasurementSeries {
  name: "motion_rms_g" | "current_ma";
  unit: "g" | "mA";
  sensor: "mpu6050" | "ina219";
  sampleIntervalMs: number;
  values: number[];
}

export interface Observation {
  id: string;
  sessionId: string;
  experimentId: string;
  source: SessionMode;
  adapter: "esp32" | "simulator";
  command: HardwareCommand;
  capturedAt: string;
  deviceUptimeMs?: number;
  elapsedMs: number;
  measurements: Measurement[];
  series?: MeasurementSeries[];
  sensorHealth: SensorHealth[];
  safety: SafetyResult;
  calibrationId: string;
}

export interface CalibrationProfile {
  id: string;
  projectId: string;
  profileId: string;
  boardIdentity: string;
  firmwareVersion: string;
  sensorIdentities: { motion: string; current: string };
  capturedAt: string;
  sampleCounts: { inactive: number; healthy: number };
  sensorErrorRates: { inactive: number; healthy: number };
  idleCurrentMa: number;
  healthyCurrentMa: number;
  baseMotionRmsG: number;
  healthyMotionRmsG: number;
  thresholds: {
    motionMultiplier: number;
    healthyMotionFraction: number;
    motionNoiseFloorG: number;
    idleCurrentMarginMa: number;
    currentNoiseFloorMa: number;
    healthyCurrentLowFraction: number;
    healthyCurrentHighFraction: number;
    maximumSensorErrorRate: number;
  };
}

export type ConfidenceLabel = "UNKNOWN" | "POSSIBLE" | "LIKELY" | "HIGH CONFIDENCE" | "CONFIRMED";
export interface HypothesisEvidence {
  hypothesis: "open_motor_path" | "mechanical_stall" | "driver_control_failure" | "motion_sensor_mounting_failure";
  support: number;
  confidence: ConfidenceLabel;
  reasons: string[];
  limitations: string[];
}

export interface ObservationEvidence {
  observationId: string;
  command: HardwareCommand;
  valid: boolean;
  motionDetected?: boolean;
  motionThresholdG?: number;
  currentMeanMa?: number;
  nearIdleThresholdMa?: number;
  healthyCurrentRangeMa?: [number, number];
  verificationPass?: boolean;
  comparisons: string[];
}

export interface EvidenceView {
  calibrationId: string;
  observations: ObservationEvidence[];
  hypotheses: HypothesisEvidence[];
  evidenceState: "INSUFFICIENT" | "MOTION_ABSENT" | "OPEN_PATH_SUPPORTED" | "STALL_SUPPORTED" | "HEALTHY" | "INVALID";
  confidenceLabel: ConfidenceLabel;
  consecutiveVerificationPasses: number;
  limitations: string[];
}

export const lifecycleStates = [
  "SETUP",
  "READY",
  "INVESTIGATING",
  "AWAITING_INTERVENTION",
  "VERIFYING",
  "CONFIRMED",
  "INTERRUPTED",
  "FAILED",
  "ESTOPPED",
] as const;
export type LifecycleState = (typeof lifecycleStates)[number];

export interface DecisionRecord {
  id: string;
  observationIds: string[];
  contextDigest: string;
  candidateHypotheses: string[];
  selectedAction: AgentAction;
  objective: string;
  rationale: string;
  provider: "openai" | "deterministic";
  model: string;
  responseId?: string;
  createdAt: string;
  gatewayValidation: { accepted: boolean; reasons: string[] };
  decisionSource: "openai" | "fallback";
}

export interface PendingDecision {
  id: string;
  sessionVersion: number;
  action: MotorCommand;
  objective: string;
  rationale: string;
  fixedParameters: { durationMs: number; currentLimitMa: number; cooldownMs: number };
  activationsRemaining: number;
  cooldownReadyAt?: string;
  createdAt: string;
}

export interface Intervention {
  description: string;
  declaredAt: string;
}

export interface TimelineEvent {
  id: string;
  sessionId: string;
  at: string;
  type: string;
  summary: string;
  data?: Record<string, unknown>;
}

export interface HardwareStatus {
  connected: boolean;
  firmwareVersion: string;
  boardIdentity: string;
  protocolVersion: string;
  profileId: string;
  physicalEnabled: boolean;
  estopLatched: boolean;
  supportedCommands: HardwareCommand[];
  detectedI2c: string[];
}

export interface DiagnosisSession {
  id: string;
  mode: SessionMode;
  fixture?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  lifecycle: LifecycleState;
  problem?: string;
  hardware: HardwareStatus;
  calibration: CalibrationProfile;
  observations: Observation[];
  decisions: DecisionRecord[];
  pendingDecision?: PendingDecision;
  intervention?: Intervention;
  diagnosticActivations: number;
  verificationActivations: number;
  totalActivations: number;
  consecutiveVerificationPasses: number;
  lastActivationAt?: string;
  evidence: EvidenceView;
  timeline: TimelineEvent[];
  fallbackUsed: boolean;
  failureReason?: string;
}

export interface DiagnosisReport {
  sessionId: string;
  evidenceSource: SessionMode;
  reportedProblem?: string;
  conditionDiagnosed: string;
  confidence: ConfidenceLabel;
  calibrationId: string;
  experiments: Observation[];
  intervention?: Intervention;
  verificationResults: ObservationEvidence[];
  limitations: string[];
  status: LifecycleState;
  timing: { machineActiveMs: number; wallClockMs: number };
  agenticProof: boolean;
}

export const DEFAULT_LIMITS = {
  pulseDurationMs: 350,
  cooldownMs: 2_000,
  currentLimitMa: 750,
  diagnosticActivations: 2,
  verificationActivations: 4,
  totalActivations: 6,
} as const;

export function isMotorCommand(command: HardwareCommand | AgentAction): command is MotorCommand {
  return command === "motor_motion_probe" || command === "motor_current_probe" || command === "verify_motor";
}

export function measurement<T extends MeasurementValue>(observation: Observation, name: string): T | undefined {
  return observation.measurements.find((entry) => entry.name === name && entry.quality === "valid")?.value as T | undefined;
}
