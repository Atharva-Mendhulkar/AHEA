import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { DiagnosisReport, Observation, ProfileKind, SimulationRequest, SimulationSpecification } from "../../shared/domain.js";
import { registeredPlans } from "../modules.js";

export interface SimulationModel {
  schemaVersion: 1;
  id: string;
  version: string;
  profileKind: ProfileKind;
  parameters: Record<string, number>;
  calibration: { status: "model_only" | "esp32s3_calibrated"; captureCount: number; sessionCount: number };
}

export interface ReplayCapture {
  id: string;
  path: string;
  digest: string;
  report: DiagnosisReport;
}

export interface SimulationPaths { modelDir?: string; captureDir?: string }
export const defaultSimulationPaths = {
  modelDir: path.resolve(process.cwd(), "config/simulation-models"),
  captureDir: path.resolve(process.cwd(), "data/simulation-captures"),
};

export function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

function modelPath(kind: ProfileKind, paths: SimulationPaths): string {
  return path.join(paths.modelDir ?? defaultSimulationPaths.modelDir, `${kind}.json`);
}

export function loadSimulationModel(kind: ProfileKind, paths: SimulationPaths = {}): SimulationModel & { digest: string } {
  const value = JSON.parse(readFileSync(modelPath(kind, paths), "utf8")) as SimulationModel;
  if (value.schemaVersion !== 1 || value.profileKind !== kind || !value.id || !value.version || !value.parameters || !value.calibration) throw new Error(`Simulation model ${kind} is invalid.`);
  return { ...value, digest: digest({ id: value.id, version: value.version, profileKind: value.profileKind, parameters: value.parameters, calibration: value.calibration }) };
}

function isPhysicalObservation(value: unknown): value is Observation {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<Observation>;
  return entry.source === "physical" && entry.adapter === "esp32" && typeof entry.planId === "string" && Array.isArray(entry.measurements) && Array.isArray(entry.series);
}

export function validatePhysicalReport(value: unknown): DiagnosisReport {
  const report = value as DiagnosisReport;
  if (!report || typeof report !== "object" || report.evidenceSource !== "physical" || !report.sessionId || !report.profile || !Array.isArray(report.experiments) || !report.experiments.length || !report.experiments.every(isPhysicalObservation)) throw new Error("Input must be a physical diagnosis report containing ESP32 observations.");
  const first = report.experiments[0]!;
  if (!report.experiments.every((entry) => entry.sessionId === report.sessionId && entry.targetType === report.profile.kind && entry.projectContextDigest === first.projectContextDigest && entry.registryDigest === first.registryDigest && entry.boardIdentity === first.boardIdentity && entry.hardwareProfileId === first.hardwareProfileId)) throw new Error("Physical report contains mixed or inconsistent observation provenance.");
  for (const observation of report.experiments) {
    const plan = registeredPlans.find((entry) => entry.id === observation.planId && entry.targetType === report.profile.kind);
    if (!plan || !plan.measurements.every((descriptor) => observation.measurements.some((entry) => entry.channel === descriptor.channel && entry.unit === descriptor.unit)) || !observation.series.every((entry) => plan.series.some((descriptor) => descriptor.channel === entry.channel && descriptor.unit === entry.unit && descriptor.sampleIntervalUs === entry.sampleIntervalUs && entry.values.length <= descriptor.maximumSamples))) throw new Error(`Physical report observation ${observation.id} does not match the current registered plan.`);
  }
  return report;
}

export function loadReplayCapture(id: string, paths: SimulationPaths = {}): ReplayCapture {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(id)) throw new Error("Replay capture ID contains unsafe characters.");
  const capturePath = path.join(paths.captureDir ?? defaultSimulationPaths.captureDir, `${id}.json`);
  const raw = readFileSync(capturePath, "utf8");
  const report = validatePhysicalReport(JSON.parse(raw));
  return { id, path: capturePath, digest: createHash("sha256").update(raw).digest("hex"), report };
}

export function listReplayCaptures(paths: SimulationPaths = {}): Array<{ id: string; profileKind: ProfileKind; sourceSessionId: string; originDigest: string; plans: string[] }> {
  const directory = paths.captureDir ?? defaultSimulationPaths.captureDir;
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => name.endsWith(".json")).flatMap((name) => {
    try {
      const capture = loadReplayCapture(name.slice(0, -5), paths);
      return [{ id: capture.id, profileKind: capture.report.profile.kind, sourceSessionId: capture.report.sessionId, originDigest: capture.digest, plans: [...new Set(capture.report.experiments.map((entry) => entry.planId))] }];
    } catch { return []; }
  });
}

export function legacyFixtureRequest(fixture: string, kind: ProfileKind): SimulationRequest {
  const conditions: Record<string, SimulationSpecification["scenario"]["condition"]> = {
    loopback_intact: "normal", loopback_open: "open_path", loopback_distorted: "distorted_signal", loopback_stimulus_fault: "stimulus_fault",
    loopback_conflicting: "conflicting", loopback_verification_failure: "verification_failure", sensor_normal: "normal", sensor_fault: "sensor_fault",
  };
  const condition = conditions[fixture] ?? (kind === "loopback" ? "open_path" : "normal");
  return { engine: "generated", seed: `legacy:${fixture}`, scenario: { condition } };
}

export function resolveSimulation(request: SimulationRequest, kind: ProfileKind, paths: SimulationPaths = {}): SimulationSpecification {
  const scenario = request.scenario ?? { condition: "normal" as const };
  const allowed = { loopback: ["normal","open_path","distorted_signal","stimulus_fault","conflicting","verification_failure"], hc_sr04: ["normal","noisy","timeout","sensor_fault"], mpu6050: ["normal","noisy","sensor_fault"], dht11: ["normal","noisy","timeout","sensor_fault"] } as const;
  if (!(allowed[kind] as readonly string[]).includes(scenario.condition)) throw new Error(`Scenario condition ${scenario.condition} is not valid for ${kind}.`);
  const suppliedControls = Object.keys(scenario).filter((key) => key !== "condition"); const acceptedControls = { loopback: [], hc_sr04: ["distanceCm"], mpu6050: ["motionAmplitudeG"], dht11: ["temperatureC","humidityPercent"] }[kind];
  if (suppliedControls.some((key) => !acceptedControls.includes(key as never))) throw new Error(`Scenario contains a control that is not valid for ${kind}.`);
  const seed = request.seed ?? `ahea-${randomBytes(12).toString("hex")}`;
  const model = loadSimulationModel(kind, paths);
  const base: SimulationSpecification = {
    engine: request.engine, seed, scenario, scenarioDigest: digest(scenario), model: { id: model.id, version: model.version, profileKind: kind },
    calibration: { ...model.calibration, digest: model.digest },
  };
  if (request.engine === "replay") {
    const capture = loadReplayCapture(request.replayCaptureId!, paths);
    if (capture.report.profile.kind !== kind) throw new Error("Replay capture profile does not match the selected project profile.");
    base.replay = { captureId: capture.id, originDigest: capture.digest, sourceSessionId: capture.report.sessionId };
    base.seed = `replay:${capture.digest.slice(0, 24)}`;
  }
  return base;
}

export function simulationCatalog(paths: SimulationPaths = {}) {
  const kinds: ProfileKind[] = ["loopback", "hc_sr04", "mpu6050", "dht11"];
  return {
    engines: ["generated", "replay"],
    conditions: ["normal", "open_path", "distorted_signal", "stimulus_fault", "conflicting", "verification_failure", "sensor_fault", "noisy", "timeout"],
    scenarios: {
      loopback: { conditions: ["normal","open_path","distorted_signal","stimulus_fault","conflicting","verification_failure"], controls: [] },
      hc_sr04: { conditions: ["normal","noisy","timeout","sensor_fault"], controls: [{ key: "distanceCm", label: "Target distance (cm)", minimum: 2, maximum: 400, step: 0.1, defaultValue: 25 }] },
      mpu6050: { conditions: ["normal","noisy","sensor_fault"], controls: [{ key: "motionAmplitudeG", label: "Motion amplitude (g)", minimum: 0, maximum: 8, step: 0.05, defaultValue: 1.25 }] },
      dht11: { conditions: ["normal","noisy","timeout","sensor_fault"], controls: [{ key: "temperatureC", label: "Temperature (C)", minimum: -20, maximum: 80, step: 0.1, defaultValue: 27 }, { key: "humidityPercent", label: "Humidity (%)", minimum: 0, maximum: 100, step: 1, defaultValue: 54 }] },
    },
    models: kinds.map((kind) => { const model = loadSimulationModel(kind, paths); return { id: model.id, version: model.version, profileKind: kind, calibration: { ...model.calibration, digest: model.digest } }; }),
    captures: listReplayCaptures(paths),
  };
}
