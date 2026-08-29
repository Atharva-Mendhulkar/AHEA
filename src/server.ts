import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AzureAgentSelector } from "./agent/azure.js";
import { SerialHardwareAdapter } from "./adapters/serial.js";
import { SimulatorAdapter, type SimulatorFixture } from "./adapters/simulator.js";
import { loadConfig } from "./config.js";
import { ExperimentCoordinator } from "./coordinator.js";

const config = loadConfig();
const app = express();
const publicDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
let coordinator: ExperimentCoordinator | undefined;

app.use(express.json({ limit: "32kb" }));
app.use(express.static(publicDirectory));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, azureConfigured: Boolean(config.azure) });
});

app.get("/api/ports", async (_request, response) => {
  response.json({ ports: await SerialHardwareAdapter.listPorts() });
});

app.post("/api/session", async (request, response) => {
  if (coordinator) await coordinator.close();
  const mode = request.body?.mode;
  const fixture = request.body?.fixture as SimulatorFixture | undefined;
  if (mode !== "physical" && mode !== "simulation") throw new Error("Mode must be physical or simulation.");
  if (fixture && !["disconnected", "healthy", "stalled", "sensor_failure"].includes(fixture)) {
    throw new Error("Unknown simulator fixture.");
  }
  const adapter = mode === "physical"
    ? await SerialHardwareAdapter.connect(String(request.body?.port ?? ""), config.serialBaudRate)
    : new SimulatorAdapter(fixture ?? "disconnected");
  const primaryAgent = config.azure ? new AzureAgentSelector(config.azure) : undefined;
  coordinator = new ExperimentCoordinator({
    adapter,
    ...(primaryAgent ? { primaryAgent } : {}),
    motorCooldownMs: config.motorCooldownMs,
    activationBudget: config.maxDiagnosticActivations,
    ...(mode === "simulation" ? { fixture: fixture ?? "disconnected" } : {})
  });
  await coordinator.scanHardware();
  response.status(201).json(coordinator.snapshot());
});

app.get("/api/session", (_request, response) => {
  response.json(requireCoordinator().snapshot());
});

app.get("/api/session/events", (request, response) => {
  const active = requireCoordinator();
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders();
  const send = (snapshot: unknown) => response.write(`data: ${JSON.stringify(snapshot)}\n\n`);
  send(active.snapshot());
  const unsubscribe = active.subscribe(send);
  request.on("close", unsubscribe);
});

app.post("/api/session/calibration", async (_request, response) => {
  response.json(await requireCoordinator().startCalibration());
});

app.post("/api/session/diagnosis", async (request, response) => {
  response.json(await requireCoordinator().startDiagnosis(String(request.body?.problem ?? "")));
});

app.post("/api/session/experiments/:id/approve", async (request, response) => {
  response.json(await requireCoordinator().approveExperiment(request.params.id));
});

app.post("/api/session/intervention", async (request, response) => {
  if (request.body?.kind !== "motor_lead_reconnected") throw new Error("Unsupported intervention.");
  response.json(await requireCoordinator().declareIntervention("motor_lead_reconnected"));
});

app.post("/api/session/emergency-stop", async (_request, response) => {
  response.json(await requireCoordinator().emergencyStop());
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  response.status(400).json({ error: message });
});

function requireCoordinator(): ExperimentCoordinator {
  if (!coordinator) throw new Error("Create a session first.");
  return coordinator;
}

const server = app.listen(config.port, () => {
  process.stdout.write(`Hardware Agent listening on http://localhost:${config.port}\n`);
});

async function shutdown(): Promise<void> {
  if (coordinator) await coordinator.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
