import type { DiagnosisSession, DeviceContext, DeviceType, ExperimentDefinition, HardwareCommand, ProjectContext } from "../shared/domain.js";

export interface DeviceModule {
  type: DeviceType;
  capabilities: string[];
  commands: HardwareCommand[];
  claims: string[];
  limitations: string[];
}

export const builtInModules: Record<DeviceType, DeviceModule> = {
  mpu6050: { type: "mpu6050", capabilities: ["i2c_identity", "bounded_acceleration", "bounded_gyroscope", "motion_features"], commands: ["scan_i2c", "identify_mpu6050", "sample_mpu6050"], claims: ["Motion or orientation signature at the sensor."], limitations: ["Does not prove shaft rotation or remote object movement."] },
  dht11: { type: "dht11", capabilities: ["temperature", "humidity", "checksum", "timeout"], commands: ["sample_dht11"], claims: ["Reading validity, stability, and configured-range agreement."], limitations: ["Does not establish calibrated environmental truth without a reference."] },
  hc_sr04: { type: "hc_sr04", capabilities: ["echo_timing", "distance_estimate", "timeout", "variance"], commands: ["measure_distance"], claims: ["Distance estimate stability in the reviewed setup."], limitations: ["Requires reviewed 5 V echo protection and controlled target geometry."] },
  fsr: { type: "fsr", capabilities: ["adc_sampling", "mean", "variance", "reference_comparison", "bounded_resistor_analysis"], commands: ["sample_fsr"], claims: ["Relative response under an equivalent declared stimulus."], limitations: ["Does not measure force or resistance without an explicit circuit model."] },
  servo: { type: "servo", capabilities: ["bounded_pwm_extension"], commands: [], claims: ["No physical MVP claim."], limitations: ["Position cannot be measured without an observer; actuation is disabled."] },
  relay: { type: "relay", capabilities: ["bounded_digital_extension"], commands: [], claims: ["No physical MVP claim."], limitations: ["A driver/flyback circuit and external observer are required; actuation is disabled."] },
};

export interface SensorGuidance { title: string; steps: string[]; expectedSignal: string; caution: string }
export function guidanceForDevice(device: DeviceContext): SensorGuidance {
  switch (device.type) {
    case "mpu6050": return { title: "Move, pause, and rotate the MPU6050", steps: ["Keep the board still for the first reading.", "Move it gently in one direction, then pause.", "Rotate it slowly through one axis and watch acceleration and gyro traces react."], expectedSignal: "Acceleration and gyro values should change during movement and settle when stationary.", caution: "This proves motion at the sensor only; it does not prove another mechanism moved." };
    case "hc_sr04": return { title: "Move a flat obstacle through the sensing cone", steps: ["Start with a flat obstacle roughly 50 cm in front of the sensor.", "Move it slowly closer to about 20 cm.", "Hold it still and check whether the distance trace stabilizes."], expectedSignal: "Reported distance should decrease as the obstacle approaches and variance should fall while it is held still.", caution: "Do not use physical HC-SR04 mode until its 5 V echo protection is reviewed." };
    case "dht11": return { title: "Create a slow environmental change", steps: ["Let the sensor settle in room air.", "Move a warm hand nearby without touching or wetting the sensor.", "Wait between readings; DHT11 updates slowly."], expectedSignal: "Temperature or humidity may move gradually while checksum/read health remains valid.", caution: "DHT11 readings are coarse and are not calibrated environmental truth." };
    case "fsr": return { title: "Apply the same repeatable pressure", steps: ["Leave the FSR unloaded for a baseline reading.", "Press the same marked area with a similar motion each time.", "Hold pressure steady through the sample window, then release."], expectedSignal: "ADC response should move during pressure and repeated trials should form a stable range.", caution: "Manual pressure is not a calibrated force; high variability weakens conclusions." };
    case "servo": return { title: "Servo monitoring is unavailable", steps: ["Attach an independent observer before enabling a future response probe."], expectedSignal: "No claim is made in this MVP.", caution: "Actuation is disabled until power and mechanical limits are reviewed." };
    case "relay": return { title: "Relay monitoring is unavailable", steps: ["Add a reviewed driver/flyback circuit and an external observable response first."], expectedSignal: "No claim is made in this MVP.", caution: "Never drive a bare 5 V relay directly from an ESP32 GPIO." };
  }
}

export function buildMonitoringExperiment(context: ProjectContext, deviceId: string, ordinal: number, purpose: "monitor" | "baseline" | "stimulus" = "monitor"): ExperimentDefinition | undefined {
  const device = context.components.find((item) => item.id === deviceId);
  if (!device || device.type === "servo" || device.type === "relay") return undefined;
  const command: Record<Exclude<DeviceType, "servo" | "relay">, HardwareCommand> = { mpu6050: "sample_mpu6050", dht11: "sample_dht11", hc_sr04: "measure_distance", fsr: "sample_fsr" };
  return { id: `${purpose}:${device.id}:${ordinal}`, type: command[device.type], label: `Live ${device.label} reading`, description: guidanceForDevice(device).expectedSignal, targetDeviceId: device.id, command: command[device.type], planId: device.type === "fsr" ? "fsr-standard-v1" : `${device.type}-monitor-v1`, phase: "monitoring", requiresApproval: false, requiresSetupConfirmation: false, budgetClass: device.type === "hc_sr04" ? "timed_io" : "read" };
}

function experiment(session: DiagnosisSession, type: ExperimentDefinition["type"], targetDeviceId: string | undefined, extra: Partial<ExperimentDefinition> = {}): ExperimentDefinition {
  const ordinal = session.observations.filter((item) => item.deviceId === targetDeviceId && item.phase === session.phase).length + 1;
  const labels: Partial<Record<ExperimentDefinition["type"], string>> = {
    sample_fsr: "Sample FSR response", verify_sensor: "Verify corrected FSR", request_intervention: "Apply recommended resistor", request_manual_check: "Inspect setup manually", conclude_normal: "Conclude within tolerance",
  };
  return {
    id: `${type}:${targetDeviceId ?? "project"}:${session.phase}:${ordinal}`,
    type,
    label: labels[type] ?? type.replaceAll("_", " "),
    description: type === "sample_fsr" || type === "verify_sensor" ? "Measure a bounded response window after the requested physical stimulus is detected." : "Use the deterministic evidence already collected.",
    targetDeviceId,
    command: type === "sample_fsr" || type === "verify_sensor" ? "sample_fsr" : undefined,
    planId: type === "verify_sensor" ? "fsr-standard-v1-verify" : "fsr-standard-v1",
    phase: session.phase,
    requiresApproval: type === "sample_fsr" || type === "verify_sensor",
    requiresSetupConfirmation: type === "sample_fsr" || type === "verify_sensor",
    budgetClass: type === "sample_fsr" || type === "verify_sensor" ? "read" : "read",
    ...extra,
  };
}

export function buildEligibleExperiments(session: DiagnosisSession): ExperimentDefinition[] {
  if (["CONFIRMED", "CONCLUDED", "INTERRUPTED", "FAILED", "ESTOPPED"].includes(session.lifecycle)) return [];
  if (session.phase === "verification") return [experiment(session, "verify_sensor", session.targetDeviceId)];

  const trials = session.projectContext.procedures.fsrStimulus.trialsPerDevice;
  const diagnosticCount = (deviceId: string) => session.observations.filter((item) => item.phase === "diagnostic" && item.command === "sample_fsr" && item.deviceId === deviceId).length;
  if (diagnosticCount(session.targetDeviceId) < trials) return [experiment(session, "sample_fsr", session.targetDeviceId, { referenceDeviceIds: session.projectContext.expectedBehavior.referenceDeviceIds })];
  for (const deviceId of session.projectContext.expectedBehavior.referenceDeviceIds) {
    if (diagnosticCount(deviceId) < trials) return [experiment(session, "sample_fsr", deviceId)];
  }
  if (session.evidence.state === "NORMAL") return [experiment(session, "conclude_normal", session.targetDeviceId)];
  if (session.evidence.recommendations.length > 0) {
    const recommendation = session.evidence.recommendations[0]!;
    return [experiment(session, "request_intervention", session.targetDeviceId, { recommendationId: recommendation.id })];
  }
  return [experiment(session, "request_manual_check", session.targetDeviceId)];
}
