import { pathToFileURL } from "node:url";
import { appConfig } from "./config.js";
import { JsonStore } from "./store.js";
import { GeminiDecisionClient } from "./agent.js";
import { Coordinator } from "./coordinator.js";
import { createApp } from "./app.js";

export function buildApplication() {
  const store = new JsonStore(appConfig.dataDir);
  const agent = new GeminiDecisionClient(appConfig.model);
  const coordinator = new Coordinator({
    store,
    agent,
    serialPath: appConfig.serialPath,
    physicalEnabled: appConfig.physicalEnabled,
  });
  return { app: createApp(coordinator), coordinator };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { app } = buildApplication();
  app.listen(appConfig.port, () => {
    console.log(`AHEA Hardware Agent listening on http://localhost:${appConfig.port}`);
    if (!appConfig.physicalEnabled) console.log("Physical mode is safe-disabled; use simulation mode.");
  });
}
