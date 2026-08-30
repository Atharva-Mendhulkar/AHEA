import type { ExperimentDefinition, HardwareStatus, Observation } from "../../shared/domain.js";
export interface ExecuteContext { sessionId: string; projectContextDigest: string; phase: "monitoring" | "diagnostic" | "verification"; setupDeclaration?: string; gatewayValidation: { accepted: boolean; checkedAt: string; reasons: string[] } }
export interface HardwareAdapter {
  readonly source: "physical" | "simulation";
  readonly name: "esp32" | "simulator";
  preflight(): Promise<HardwareStatus>;
  armSession?(): Promise<void>;
  execute(experiment: ExperimentDefinition, context: ExecuteContext): Promise<Observation>;
  declareIntervention(): void | Promise<void>;
  close(): Promise<void>;
}
