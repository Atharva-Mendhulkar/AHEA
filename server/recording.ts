import type { DeviceContext, Observation, SignalQuality } from "../shared/domain.js";
import { measurement } from "../shared/domain.js";

export interface SignalAssessment {
  value?: number;
  delta?: number;
  sampleCount: number;
  stimulusDetected: boolean;
  sufficient: boolean;
  quality: SignalQuality;
  message: string;
}

export function primaryChannel(device: DeviceContext): string {
  return ({ fsr: "adc_mean", mpu6050: "acceleration_magnitude_g", dht11: "temperature_c", hc_sr04: "distance_cm", servo: "", relay: "" })[device.type];
}

export function stimulusPrompt(device: DeviceContext, verification = false): string {
  const again = verification ? " again" : "";
  switch (device.type) {
    case "fsr": return `Apply pressure to ${device.label}${again}.`;
    case "hc_sr04": return "Place a flat obstacle approximately 20 cm from the ultrasonic sensor.";
    case "dht11": return "No physical action required. I’m collecting environmental readings.";
    case "mpu6050": return "Keep the MPU6050 still while I measure its baseline motion.";
    case "servo": return "Move the connected mechanism only when the agent requests it.";
    case "relay": return "No physical action is available for this disabled relay profile.";
  }
}

export function baselinePrompt(device: DeviceContext): string {
  switch (device.type) {
    case "fsr": return `Release pressure from ${device.label} while I capture its baseline.`;
    case "hc_sr04": return "Keep the sensing path clear while I capture the starting distance.";
    case "dht11": return "I’m checking the current environmental reading before analysis.";
    case "mpu6050": return "Keep the MPU6050 still while I capture its baseline.";
    case "servo": return "No baseline is available for this disabled actuator.";
    case "relay": return "No baseline is available for this disabled actuator.";
  }
}

export function assessSignal(device: DeviceContext, observation: Observation, baseline?: number): SignalAssessment {
  const value = measurement<number>(observation, primaryChannel(device));
  const sampleCount = observation.series?.find((series) => series.deviceId === device.id)?.values.length ?? (value === undefined ? 0 : 1);
  const valid = observation.operation.accepted && !observation.operation.timedOut && observation.sensorHealth.every((health) => health.healthy) && value !== undefined;
  if (!valid) return { value, sampleCount, stimulusDetected: false, sufficient: false, quality: "INVALID", message: "I can’t trust this reading yet. Check the connection and keep the sensor available." };

  const delta = baseline === undefined ? undefined : value - baseline;
  if (device.type === "dht11") return { value, delta, sampleCount, stimulusDetected: true, sufficient: true, quality: "GOOD", message: "Environmental reading is valid. That’s enough data for this check." };
  if (device.type === "mpu6050") return { value, delta, sampleCount, stimulusDetected: true, sufficient: sampleCount >= 32, quality: "GOOD", message: "The motion sample is stable enough to analyze." };
  if (device.type === "hc_sr04") {
    const detected = delta !== undefined && Math.abs(delta) >= 5;
    return { value, delta, sampleCount, stimulusDetected: detected, sufficient: detected && sampleCount >= 10, quality: detected ? "GOOD" : "WAITING", message: detected ? "Obstacle response detected. That’s enough data." : "Move the obstacle into position; I’m watching the distance response." };
  }
  if (device.type === "fsr") {
    const noise = measurement<number>(observation, "adc_stddev") ?? 0;
    const noisy = noise > device.expected.maximumSampleStddevRaw;
    const threshold = Math.max(60, device.circuit.adcMaximumRaw * 0.04);
    const detected = delta !== undefined && Math.abs(delta) >= threshold;
    if (noisy) return { value, delta, sampleCount, stimulusDetected: detected, sufficient: false, quality: "NOISY", message: "I’m seeing unstable readings. Hold the pressure more consistently." };
    return { value, delta, sampleCount, stimulusDetected: detected, sufficient: detected && sampleCount >= 32, quality: detected ? "GOOD" : "WAITING", message: detected ? "Signal detected. That’s enough data for this sample." : `Apply pressure to ${device.label}; I’m waiting for a meaningful response.` };
  }
  return { value, delta, sampleCount, stimulusDetected: false, sufficient: false, quality: "INVALID", message: "This device has no safe sensing experiment." };
}
