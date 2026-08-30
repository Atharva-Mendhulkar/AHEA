import type { ExperimentDefinition, Observation } from "../shared/domain.js";
import { measurement } from "../shared/domain.js";
import { SerialAdapter } from "../server/adapters/serial.js";
import { physicalLoopbackProjectContext, projectContextDigest } from "../server/config.js";
import { deriveEvidence } from "../server/evidence.js";

const serialPath = process.argv[2] ?? process.env.AHEA_SERIAL_PATH;
if (!serialPath) throw new Error("Provide the serial path as the first argument or AHEA_SERIAL_PATH.");
const expectedState = process.argv[3] ?? "open";
if (expectedState !== "open" && expectedState !== "intact") throw new Error("Expected fixture state must be 'open' or 'intact'.");

const context = physicalLoopbackProjectContext;
const adapter = new SerialAdapter(serialPath, true, context);
const observations: Observation[] = [];
const sessionId = `loopback-${expectedState}-hardware-smoke`;

async function execute(planId: string): Promise<void> {
  const plan = status.registry.plans.find((entry) => entry.id === planId);
  if (!plan) throw new Error(`The reviewed loopback plan ${planId} was not advertised.`);
  const experiment: ExperimentDefinition = {
    id: `${sessionId}-${plan.type}`,
    type: plan.type,
    label: plan.label,
    description: plan.description,
    targetId: context.primaryTargetId,
    planId: plan.id,
    command: plan.command,
    phase: "diagnostic",
    requiresSetupConfirmation: true,
    budgetClass: plan.budgetClass,
    evidenceReferences: observations.map((entry) => entry.id),
  };
  observations.push(await adapter.execute(experiment, {
    sessionId,
    projectContextDigest: projectContextDigest(context),
    phase: "diagnostic",
    setupDeclaration: `Operator confirmed the reviewed 2 kOhm / 10 kOhm loopback fixture with the jumper ${expectedState}.`,
    gatewayValidation: { accepted: true, checkedAt: new Date().toISOString(), reasons: [] },
  }));
}

let status;
try {
  status = await adapter.preflight();
  await adapter.armSession?.();
  await execute("loopback.observe-destination.1khz.v1");
  await execute("loopback.observe-source.1khz.v1");
  await execute("loopback.compare-endpoints.1khz.v1");

  const evidence = deriveEvidence(observations, context, context.primaryTargetId, false, "physical");
  const expectedEvidence = expectedState === "open" ? "PATH_OPEN_SUPPORTED" : "NORMAL";
  const passed = evidence.state === expectedEvidence;
  console.log(JSON.stringify({
    passed,
    expectedFixtureState: expectedState,
    connected: status.connected,
    boardIdentity: status.boardIdentity,
    hardwareProfileId: status.profileId,
    evidenceState: evidence.state,
    confidence: evidence.confidence,
    conclusion: evidence.conclusion,
    captures: observations.map((entry) => ({
      planId: entry.planId,
      sourcePresent: measurement<boolean>(entry, "source_present"),
      destinationPresent: measurement<boolean>(entry, "destination_present"),
      sourceFrequencyHz: measurement<number>(entry, "source_frequency_hz"),
      destinationFrequencyHz: measurement<number>(entry, "destination_frequency_hz"),
      endpointCorrelation: measurement<number>(entry, "endpoint_correlation"),
      operation: entry.operation,
    })),
  }, null, 2));
  if (!passed) process.exitCode = 2;
} finally {
  await adapter.close();
}
