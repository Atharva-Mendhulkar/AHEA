import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DiagnosisReport, ProfileKind } from "../shared/domain.js";
import { builtInModules } from "../server/modules.js";
import { defaultSimulationPaths, loadSimulationModel, validatePhysicalReport } from "../server/simulation/catalog.js";

const command = process.argv[2];
const argument = process.argv[3];
const kinds: ProfileKind[] = ["loopback", "hc_sr04", "mpu6050", "dht11"];

async function reports(): Promise<DiagnosisReport[]> {
  try {
    const names = (await readdir(defaultSimulationPaths.captureDir)).filter((name) => name.endsWith(".json"));
    return Promise.all(names.map(async (name) => validatePhysicalReport(JSON.parse(await readFile(path.join(defaultSimulationPaths.captureDir, name), "utf8")))));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function importCapture(source: string) {
  const raw = await readFile(path.resolve(source), "utf8"); const report = validatePhysicalReport(JSON.parse(raw));
  const id = process.argv[4] ?? `${report.profile.kind}-${report.sessionId}`;
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(id)) throw new Error("Capture ID may contain only letters, numbers, dot, underscore, and hyphen.");
  await mkdir(defaultSimulationPaths.captureDir, { recursive: true });
  await writeFile(path.join(defaultSimulationPaths.captureDir, `${id}.json`), JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`Imported ${report.experiments.length} physical observations as ${id}.`);
}

function corpusStats(all: DiagnosisReport[], kind: ProfileKind) {
  const selected = all.filter((report) => report.profile.kind === kind);
  const counts = Object.fromEntries(builtInModules[kind].planIds.map((planId) => [planId, selected.flatMap((report) => report.experiments).filter((entry) => entry.planId === planId && entry.operation.accepted).length]));
  return { sessions: new Set(selected.filter((report) => report.experiments.some((entry) => entry.operation.accepted)).map((report) => report.sessionId)).size, captures: selected.reduce((sum, report) => sum + report.experiments.filter((entry) => entry.operation.accepted).length, 0), counts };
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0; const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

function derivedParameters(all: DiagnosisReport[], kind: ProfileKind, fallback: Record<string, number>): Record<string, number> {
  const observations = all.filter((report) => report.profile.kind === kind).flatMap((report) => report.experiments).filter((entry) => entry.operation.accepted);
  const measurements = (channel: string) => observations.flatMap((entry) => entry.measurements.filter((item) => item.channel === channel && item.quality === "valid" && typeof item.value === "number").map((item) => item.value as number));
  const samples = (channel: string) => observations.flatMap((entry) => entry.series.filter((item) => item.channel === channel).flatMap((item) => item.values)).filter(Number.isFinite);
  if (kind === "loopback") {
    const frequencies = measurements("source_frequency_hz"); const duties = measurements("source_duty_percent"); const averageFrequency = frequencies.reduce((sum, value) => sum + value, 0) / Math.max(frequencies.length, 1);
    return { ...fallback, frequencyJitterFraction: averageFrequency ? standardDeviation(frequencies) / averageFrequency : fallback.frequencyJitterFraction!, dutyJitterPercent: standardDeviation(duties) || fallback.dutyJitterPercent! };
  }
  if (kind === "hc_sr04") return { ...fallback, distanceNoiseCm: standardDeviation(samples("distance_cm")) || fallback.distanceNoiseCm!, timeoutRate: measurements("timeout_rate").reduce((sum, value) => sum + value, 0) / Math.max(measurements("timeout_rate").length, 1) };
  if (kind === "mpu6050") return { ...fallback, accelNoiseG: standardDeviation(samples("accel_x")) || fallback.accelNoiseG!, gyroNoiseDps: standardDeviation(samples("gyro_x")) || fallback.gyroNoiseDps!, gyroBiasDps: Math.abs(samples("gyro_x").reduce((sum, value) => sum + value, 0) / Math.max(samples("gyro_x").length, 1)) };
  const validFrames = samples("valid_frame"); return { ...fallback, humidityNoisePercent: standardDeviation(samples("humidity")) || fallback.humidityNoisePercent!, frameFailureRate: validFrames.length ? 1 - validFrames.reduce((sum, value) => sum + value, 0) / validFrames.length : fallback.frameFailureRate!, lagSamples: fallback.lagSamples! };
}

async function calibrate() {
  const all = await reports();
  for (const kind of kinds) {
    const model = loadSimulationModel(kind); const stats = corpusStats(all, kind);
    const qualified = stats.sessions >= 3 && Object.values(stats.counts).every((count) => count >= 20);
    const output = { schemaVersion: model.schemaVersion, id: model.id, version: model.version, profileKind: model.profileKind, parameters: qualified ? derivedParameters(all, kind, model.parameters) : model.parameters, calibration: { status: qualified ? "esp32s3_calibrated" : "model_only", captureCount: stats.captures, sessionCount: stats.sessions } };
    await writeFile(path.join(defaultSimulationPaths.modelDir, `${kind}.json`), JSON.stringify(output, null, 2) + "\n", "utf8");
    console.log(`${kind}: ${qualified ? "ESP32-S3 calibrated" : "Model only"}; ${stats.sessions} sessions, ${stats.captures} observations.`);
  }
}

async function validateModels() {
  const all = await reports(); let failures = 0;
  for (const kind of kinds) {
    const model = loadSimulationModel(kind); const stats = corpusStats(all, kind);
    const qualified = stats.sessions >= 3 && Object.values(stats.counts).every((count) => count >= 20);
    if (model.calibration.status === "esp32s3_calibrated" && !qualified) { failures += 1; console.error(`${kind}: calibration claim lacks 20 captures per plan across 3 sessions.`); }
    else console.log(`${kind}: valid (${model.calibration.status}, digest ${model.digest.slice(0, 12)}).`);
  }
  if (failures) process.exitCode = 1;
}

if (command === "import") {
  if (!argument) throw new Error("Usage: npm run simulation:capture:import -- report.json [capture-id]");
  await importCapture(argument);
} else if (command === "calibrate") await calibrate();
else if (command === "validate") await validateModels();
else throw new Error("Expected import, calibrate, or validate command.");
