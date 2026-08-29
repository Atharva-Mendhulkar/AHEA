import type { ExperimentDefinition } from "../shared/domain.js";
import { measurement } from "../shared/domain.js";
import { SerialAdapter } from "../server/adapters/serial.js";
import { optionalProjectContexts, projectContextDigest } from "../server/config.js";

const serialPath = process.argv[2] ?? process.env.AHEA_SERIAL_PATH;
if (!serialPath) throw new Error("Provide the serial path as the first argument or AHEA_SERIAL_PATH.");

const context = optionalProjectContexts.mpu6050;
const adapter = new SerialAdapter(serialPath, true, context);

try {
  const status = await adapter.preflight();
  await adapter.armSession?.();
  const plan = status.registry.plans.find((entry) => entry.id === "mpu6050.identity.v1");
  if (!plan) throw new Error("The reviewed MPU6050 identity plan was not advertised.");

  const experiment: ExperimentDefinition = {
    id: "mpu6050-hardware-smoke",
    type: plan.type,
    label: plan.label,
    description: plan.description,
    targetId: "imu",
    planId: plan.id,
    command: plan.command,
    phase: "diagnostic",
    requiresSetupConfirmation: true,
    budgetClass: plan.budgetClass,
    evidenceReferences: [],
  };
  const observation = await adapter.execute(experiment, {
    sessionId: "mpu6050-hardware-smoke",
    projectContextDigest: projectContextDigest(context),
    phase: "diagnostic",
    setupDeclaration: "Operator confirmed 3.3 V I2C wiring and AD0 grounded.",
    gatewayValidation: { accepted: true, checkedAt: new Date().toISOString(), reasons: [] },
  });
  const identityValid = measurement<boolean>(observation, "identity_valid") === true;
  console.log(JSON.stringify({
    connected: status.connected,
    boardIdentity: status.boardIdentity,
    firmwareVersion: status.firmwareVersion,
    protocolVersion: status.protocolVersion,
    hardwareProfileId: status.profileId,
    registryDigest: status.registry.digest,
    planId: observation.planId,
    identityValid,
    operation: observation.operation,
    targetHealth: observation.targetHealth,
  }, null, 2));
  if (!identityValid || !observation.operation.accepted) process.exitCode = 2;
} finally {
  await adapter.close();
}
