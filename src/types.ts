export type EvidenceSource = "physical" | "simulation";
export type SensorName = "MPU6050" | "INA219" | "ESP32-S3";
export type ExperimentTool =
  | "scan_i2c"
  | "sample_motion"
  | "motor_motion_probe"
  | "motor_current_probe"
  | "verify_motor"
  | "emergency_stop";

export type ActivatingTool = Extract<
  ExperimentTool,
  "motor_motion_probe" | "motor_current_probe" | "verify_motor"
>;

export type Hypothesis =
  | "open_or_unenergized_motor_path"
  | "mechanical_stall"
  | "driver_control_failure"
  | "motion_sensor_or_mounting_failure";

export type ConfidenceLabel =
  | "UNKNOWN"
  | "POSSIBLE"
  | "LIKELY"
  | "HIGH CONFIDENCE"
  | "CONFIRMED";

export interface SensorHealth {
  healthy: boolean;
  errorRate: number;
}

export interface RawMeasurement {
  name:
    | "acceleration_rms_g"
    | "baseline_rms_g"
    | "current_mean_ma"
    | "current_peak_ma"
    | "bus_voltage_v";
  value: number;
  unit: "g" | "mA" | "V";
  sensor: SensorName;
  health: SensorHealth;
}

export interface AdapterResult {
  requestId: string;
  ok: boolean;
  elapsedMs: number;
  measurements: RawMeasurement[];
  activationAccepted: boolean;
  tripped: boolean;
  detectedAddresses?: string[];
  firmwareVersion?: string;
  error?: { code: string; message: string };
}

export interface AdapterIdentity {
  source: EvidenceSource;
  adapter: "esp32" | "simulator";
  deviceId: string;
  firmwareVersion: string;
}

export interface HardwareAdapter {
  readonly identity: AdapterIdentity;
  execute(tool: ExperimentTool, requestId: string): Promise<AdapterResult>;
  close(): Promise<void>;
}

export interface CalibrationProfile {
  id: string;
  source: EvidenceSource;
  createdAt: string;
  idleCurrentMa: number;
  healthyCurrentMa: number;
  baselineMotionRmsG: number;
  healthyMotionRmsG: number;
}

export interface EvidenceObservation extends AdapterResult {
  observationId: string;
  experimentId: string;
  sessionId: string;
  capturedAt: string;
  tool: ExperimentTool;
  purpose: "calibration" | "diagnosis" | "verification" | "system";
  provenance: AdapterIdentity;
  calibrationId?: string;
  classification: string[];
}

export type AgentAction =
  | { kind: "run_experiment"; tool: ActivatingTool }
  | { kind: "request_repair" }
  | { kind: "report_not_reproduced" }
  | { kind: "request_sensor_recovery" }
  | { kind: "finish" };

export interface AgentDecision {
  action: AgentAction;
  candidateHypotheses: Hypothesis[];
  objective: string;
  rationale: string;
  providerResponseId?: string;
}

export interface AgentDecisionRecord extends AgentDecision {
  decisionId: string;
  createdAt: string;
  mode: "azure" | "fallback" | "test";
  deployment: string;
  inputObservationIds: string[];
  validation: { allowed: boolean; reason: string };
}

export interface AgentSelector {
  readonly mode: "azure" | "fallback" | "test";
  readonly deployment: string;
  decide(context: AgentContext): Promise<AgentDecision>;
}

export interface AgentContext {
  problem: string;
  observations: EvidenceObservation[];
  calibration?: CalibrationProfile;
  confidence: ConfidenceLabel;
  evidenceState: string;
  interventionDeclared: boolean;
  consecutiveVerificationPasses: number;
}

export type SessionPhase =
  | "CREATED"
  | "CALIBRATING"
  | "READY"
  | "DIAGNOSING"
  | "AWAITING_APPROVAL"
  | "AWAITING_REPAIR"
  | "VERIFYING"
  | "CONFIRMED"
  | "STOPPED"
  | "ERROR";

export interface PendingExperiment {
  id: string;
  tool: ActivatingTool;
  purpose: "calibration" | "diagnosis" | "verification";
  createdAt: string;
  durationMs: number;
}

export interface DiagnosisState {
  evidenceState: string;
  confidence: ConfidenceLabel;
  hypothesisSupport: Record<Hypothesis, ConfidenceLabel>;
  consecutiveVerificationPasses: number;
}

export interface SessionSnapshot {
  id: string;
  mode: EvidenceSource;
  fixture?: string;
  phase: SessionPhase;
  problem: string;
  calibration?: CalibrationProfile;
  observations: EvidenceObservation[];
  decisions: AgentDecisionRecord[];
  pendingExperiment?: PendingExperiment;
  diagnosis: DiagnosisState;
  intervention?: { kind: "motor_lead_reconnected"; declaredAt: string };
  activationsUsed: number;
  activationBudget: number;
  emergencyStopLatched: boolean;
  fallbackMode: boolean;
  statusMessage: string;
}
