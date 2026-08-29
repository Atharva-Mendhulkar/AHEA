import type { ExperimentDefinition, HardwareStatus, Observation } from "../../shared/domain.js";

export interface ExecuteContext { sessionId: string; projectContextDigest: string; phase: "monitoring" | "diagnostic" | "verification" }
export interface HardwareAdapter {
  readonly source: "physical" | "simulation";
  readonly name: "esp32" | "simulator";
  preflight(): Promise<HardwareStatus>;
  armSession?(): Promise<void>;
  execute(experiment: ExperimentDefinition, context: ExecuteContext): Promise<Observation>;
  declareIntervention(): void;
  close(): Promise<void>;
}
