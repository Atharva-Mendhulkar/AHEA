import type { CalibrationProfile, HardwareCommand, HardwareStatus, Observation } from "../../shared/domain.js";

export interface ExecuteContext {
  sessionId: string;
  experimentId: string;
  calibration: CalibrationProfile;
}

export interface HardwareAdapter {
  readonly source: "physical" | "simulation";
  readonly name: "esp32" | "simulator";
  preflight(): Promise<HardwareStatus>;
  execute(command: HardwareCommand, context: ExecuteContext): Promise<Observation>;
  declareIntervention(): void;
  close(): Promise<void>;
}
