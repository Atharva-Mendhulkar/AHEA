import type { ExperimentDefinition } from "../shared/domain.js";
import { measurement, targetById } from "../shared/domain.js";
import { SerialAdapter } from "../server/adapters/serial.js";
import { optionalProjectContexts, projectContextDigest } from "../server/config.js";

const serialPath = process.argv[2] ?? process.env.AHEA_SERIAL_PATH;
if (!serialPath) throw new Error("Provide the serial path as the first argument or AHEA_SERIAL_PATH.");

const context = optionalProjectContexts.hc_sr04;
const target = targetById(context, context.primaryTargetId);
if (!target || target.type !== "hc_sr04") throw new Error("The reviewed HC-SR04 target is unavailable.");
const adapter = new SerialAdapter(serialPath, true, context);

try {
  const status = await adapter.preflight();
  await adapter.armSession?.();
  const plan = status.registry.plans.find((entry) => entry.id === "hc-sr04.echo-timing.v1");
  if (!plan) throw new Error("The reviewed HC-SR04 echo timing plan was not advertised.");

  const experiment: ExperimentDefinition = {
    id: "hc-sr04-hardware-smoke",
    type: plan.type,
    label: plan.label,
    description: plan.description,
    targetId: target.id,
    planId: plan.id,
    command: plan.command,
    phase: "diagnostic",
    requiresSetupConfirmation: true,
    budgetClass: plan.budgetClass,
    evidenceReferences: [],
  };
  const observation = await adapter.execute(experiment, {
    sessionId: "hc-sr04-hardware-smoke",
    projectContextDigest: projectContextDigest(context),
    phase: "diagnostic",
    setupDeclaration: "Operator confirmed GPIO16 Trigger and the reviewed 8.2 kOhm / 10 kOhm Echo divider into GPIO17.",
    gatewayValidation: { accepted: true, checkedAt: new Date().toISOString(), reasons: [] },
  });
  const distanceCm = measurement<number>(observation, "distance_cm");
  const timeoutRate = measurement<number>(observation, "timeout_rate");
  const withinRange = distanceCm !== undefined && target.expected.distanceCm !== undefined && distanceCm >= target.expected.distanceCm[0] && distanceCm <= target.expected.distanceCm[1];
  const passed = observation.operation.accepted && observation.operation.cleanupSucceeded && withinRange && timeoutRate !== undefined && timeoutRate <= target.expected.maximumTimeoutRate;
  console.log(JSON.stringify({
    passed,
    connected: status.connected,
    boardIdentity: status.boardIdentity,
    firmwareVersion: status.firmwareVersion,
    protocolVersion: status.protocolVersion,
    hardwareProfileId: status.profileId,
    registryDigest: status.registry.digest,
    planId: observation.planId,
    distanceCm,
    timeoutRate,
    operation: observation.operation,
    targetHealth: observation.targetHealth,
  }, null, 2));
  if (!passed) process.exitCode = 2;
} finally {
  await adapter.close();
}
