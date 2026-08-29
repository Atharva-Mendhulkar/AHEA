import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSessionSchema, executeDecisionSchema, interventionSchema, problemSchema } from "../shared/schemas.js";
import { defaultProjectContext } from "./config.js";
import { Coordinator, DomainError } from "./coordinator.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp(coordinator: Coordinator) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.use((_request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  app.get("/api/health", (_request, response) => response.json({ ok: true }));

  app.post("/api/sessions", asyncRoute(async (request, response) => {
    const input = createSessionSchema.parse(request.body);
    const session = await coordinator.createSession(input.mode, input.fixture, input.projectContext, input.targetDeviceId);
    response.status(201).json(session);
  }));

  app.get("/api/sessions/:id", asyncRoute(async (request, response) => {
    response.json(await coordinator.getSession(String(request.params.id)));
  }));

  app.post("/api/sessions/:id/problem", asyncRoute(async (request, response) => {
    const { problem } = problemSchema.parse(request.body);
    response.json(await coordinator.submitProblem(String(request.params.id), problem));
  }));

  app.post("/api/sessions/:id/investigation/start", asyncRoute(async (request, response) => {
    response.json(await coordinator.startInvestigation(String(request.params.id)));
  }));

  app.post("/api/sessions/:id/investigation/advance", asyncRoute(async (request, response) => {
    response.json(await coordinator.advanceInvestigation(String(request.params.id)));
  }));

  app.get("/api/sessions/:id/devices/:deviceId/guidance", asyncRoute(async (request, response) => {
    response.json(await coordinator.deviceGuidance(String(request.params.id), String(request.params.deviceId)));
  }));

  app.post("/api/sessions/:id/devices/:deviceId/live-reading", asyncRoute(async (request, response) => {
    response.json(await coordinator.captureLiveReading(String(request.params.id), String(request.params.deviceId)));
  }));

  app.get("/api/sessions/:id/pending-decision", asyncRoute(async (request, response) => {
    const session = await coordinator.getSession(String(request.params.id));
    response.json({ pendingDecision: session.pendingDecision ?? null, lifecycle: session.lifecycle, version: session.version });
  }));

  app.post("/api/sessions/:id/decisions/:decisionId/execute", asyncRoute(async (request, response) => {
    const { expectedVersion, setupConfirmed } = executeDecisionSchema.parse(request.body);
    response.json(await coordinator.executePending(String(request.params.id), String(request.params.decisionId), expectedVersion, setupConfirmed));
  }));

  app.post("/api/sessions/:id/interventions", asyncRoute(async (request, response) => {
    const { description, recommendationId } = interventionSchema.parse(request.body);
    response.json(await coordinator.declareIntervention(String(request.params.id), description, recommendationId));
  }));

  app.post("/api/sessions/:id/emergency-stop", asyncRoute(async (request, response) => {
    response.json(await coordinator.emergencyStop(String(request.params.id)));
  }));

  app.get("/api/sessions/:id/report", asyncRoute(async (request, response) => {
    response.json(await coordinator.report(String(request.params.id)));
  }));

  app.get("/api/sessions/:id/events", asyncRoute(async (request, response) => {
    const session = await coordinator.getSession(String(request.params.id));
    response.status(200);
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();
    response.write(`event: snapshot\ndata: ${JSON.stringify(session)}\n\n`);
    const listener = (event: unknown) => response.write(`event: timeline\ndata: ${JSON.stringify(event)}\n\n`);
    coordinator.events.on(session.id, listener);
    const keepAlive = setInterval(() => response.write(": keepalive\n\n"), 15_000);
    request.on("close", () => {
      clearInterval(keepAlive);
      coordinator.events.off(session.id, listener);
    });
  }));

  app.get("/api/project-context/default", (_request, response) => response.json(defaultProjectContext));

  app.use(express.static(path.resolve(here, "../web")));
  app.get("/{*path}", (request, response, next) => {
    if (request.path.startsWith("/api/")) return next();
    response.sendFile(path.resolve(here, "../web/index.html"));
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof DomainError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    if (error && typeof error === "object" && "issues" in error) {
      response.status(400).json({ error: "Invalid request.", details: (error as { issues: unknown }).issues });
      return;
    }
    console.error(error);
    response.status(500).json({ error: "Internal server error." });
  });

  return app;
}

function asyncRoute(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };
}
