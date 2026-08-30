import type { Measurement, MeasurementSeries, ProfileKind, SimulationScenario } from "../../shared/domain.js";
import type { SimulationModel } from "./catalog.js";
import { stream } from "./random.js";

export interface GeneratedCapture { measurements: Measurement[]; series: MeasurementSeries[]; healthy: boolean; detail?: string }
interface GenerateInput { kind: ProfileKind; planId: string; phase: string; ordinal: number; targetId: string; seed: string; scenario: SimulationScenario; model: SimulationModel; interventionDeclared: boolean }
const round = (value: number, digits = 4) => Number(value.toFixed(digits));
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
const sd = (values: number[]) => { const average = mean(values); return Math.sqrt(mean(values.map((value) => (value - average) ** 2))); };
const measurement = (targetId: string, channel: string, value: number | boolean | string, unit: string, valid = true): Measurement => ({ targetId, channel, value, unit, quality: valid ? "valid" : "invalid" });
const series = (targetId: string, channel: string, unit: string, sampleIntervalUs: number, values: number[]): MeasurementSeries => ({ targetId, channel, unit, sampleIntervalUs, values: values.map((value) => round(value, 5)) });

function digitalSummary(values: number[], intervalUs: number) {
  const rises: number[] = []; for (let index = 1; index < values.length; index += 1) if (values[index - 1] === 0 && values[index] === 1) rises.push(index);
  const periods = rises.slice(1).map((value, index) => (value - rises[index]!) * intervalUs);
  return { present: rises.length > 1, frequency: periods.length ? 1_000_000 / mean(periods) : 0, duty: mean(values) * 100 };
}

function loopback(input: GenerateInput): GeneratedCapture {
  const { planId, targetId, seed, phase, ordinal, scenario, interventionDeclared } = input; const random = stream(seed, planId, phase, ordinal, "waveform");
  const repaired = interventionDeclared && scenario.condition !== "verification_failure";
  const open = (scenario.condition === "open_path" || scenario.condition === "verification_failure") && !repaired;
  const distorted = scenario.condition === "distorted_signal" && !repaired; const stimulusFault = scenario.condition === "stimulus_fault"; const conflicting = scenario.condition === "conflicting";
  if (planId.includes("static")) {
    const sourceValues = stimulusFault ? [0,0,0] : [0,1,0]; const destinationValues = open ? [0,0,0] : [...sourceValues];
    return { measurements: [measurement(targetId,"source_static_sequence_valid",!stimulusFault,"boolean"),measurement(targetId,"destination_static_sequence_valid",!open&&!stimulusFault,"boolean")], series: [series(targetId,"source_level","logic",100000,sourceValues),series(targetId,"destination_level","logic",100000,destinationValues)], healthy: true };
  }
  const nominalHz = planId.includes("500hz") ? 500 : 1000; const intervalUs = 125; const samples = 400; const sourceHz = stimulusFault ? 0 : nominalHz * (1 + random.normal(0, input.model.parameters.frequencyJitterFraction)); const destinationHz = distorted ? nominalHz * .72 : sourceHz; const sourceDuty = 50 + random.normal(0,input.model.parameters.dutyJitterPercent); const destinationDuty = distorted ? 68 : sourceDuty;
  const wave = (frequency: number, duty: number) => Array.from({length:samples},(_,index) => frequency > 0 && ((index * intervalUs) % (1_000_000/frequency)) < (1_000_000/frequency)*(duty/100) ? 1 : 0);
  const sourceValues = wave(sourceHz,sourceDuty); let destinationValues = open || (conflicting && planId.includes("compare")) ? sourceValues.map(()=>0) : wave(destinationHz,destinationDuty);
  if (distorted) destinationValues = destinationValues.map((value,index)=>random.next()<.035 ? 1-value : value);
  const source = digitalSummary(sourceValues,intervalUs); const destination = digitalSummary(destinationValues,intervalUs); const correlation = mean(sourceValues.map((value,index)=>value===destinationValues[index]?1:0)); const capturedDestination = destination;
  const values: Measurement[]=[]; const addSource=()=>values.push(measurement(targetId,"source_present",source.present,"boolean"),measurement(targetId,"source_frequency_hz",round(source.frequency,2),"Hz"),measurement(targetId,"source_duty_percent",round(source.duty,2),"%")); const addDestination=()=>values.push(measurement(targetId,"destination_present",capturedDestination.present,"boolean"),measurement(targetId,"destination_frequency_hz",round(capturedDestination.frequency,2),"Hz"),measurement(targetId,"destination_duty_percent",round(capturedDestination.duty,2),"%"));
  if (planId.includes("observe-destination")) addDestination(); else if(planId.includes("observe-source")) addSource(); else {addSource();addDestination();values.push(measurement(targetId,"endpoint_correlation",capturedDestination.present?round(correlation,4):0,"ratio"));}
  const outputSeries: MeasurementSeries[]=[]; if(!planId.includes("observe-destination"))outputSeries.push(series(targetId,"source_level","logic",intervalUs,sourceValues)); if(!planId.includes("observe-source"))outputSeries.push(series(targetId,"destination_level","logic",intervalUs,destinationValues));
  return {measurements:values,series:outputSeries,healthy:true};
}

function hc(input: GenerateInput): GeneratedCapture {
  const {targetId,planId,seed,phase,ordinal,scenario}=input; const random=stream(seed,planId,phase,ordinal,"ultrasonic"); const count=planId.includes("echo-timing")?8:12; const base=scenario.distanceCm??25; const fault=scenario.condition==="sensor_fault"; const timeout=scenario.condition==="timeout"; const noisy=scenario.condition==="noisy"; const distances=Array.from({length:count},(_,index)=> planId.includes("progression")?base+index*4+random.normal(0,.35):base+random.normal(0,noisy?3:(input.model.parameters.distanceNoiseCm??.22))); const valid=distances.map(()=>!timeout&&random.next()>(fault?.7:(input.model.parameters.timeoutRate??.005))); const observed=distances.filter((_,index)=>valid[index]); const outputSeries=[series(targetId,"distance_cm","cm",60000,distances.map((value,index)=>valid[index]?value:0)),series(targetId,"valid_echo","logic",60000,valid.map(Number))]; let values:Measurement[];
  if(planId.includes("variance")) values=[measurement(targetId,"distance_stddev_cm",round(sd(observed),3),"cm",observed.length>0)]; else if(planId.includes("progression")) values=[measurement(targetId,"progression_consistent",observed.length>2&&observed.at(-1)!-observed[0]!>2,"boolean",observed.length>0)]; else values=[measurement(targetId,"distance_cm",round(mean(observed),3),"cm",observed.length>0),measurement(targetId,"timeout_rate",round(1-observed.length/count,3),"ratio")];
  return {measurements:values,series:outputSeries,healthy:observed.length>0&&!fault,detail:fault?"Seeded simulated sensor fault.":undefined};
}

function mpu(input: GenerateInput): GeneratedCapture {
  const {targetId,planId,seed,phase,ordinal,scenario}=input; const random=stream(seed,planId,phase,ordinal,"imu"); const fault=scenario.condition==="sensor_fault"; if(planId.includes("identity")){const valid=!fault;return{measurements:[measurement(targetId,"identity_valid",valid,"boolean",valid)],series:[series(targetId,"i2c_response","logic",20000,[0,valid?1:0,valid?1:0,0])],healthy:valid};}
  const count=50, moving=planId.includes("motion-axis"), amplitude=scenario.motionAmplitudeG??1.25; const noise=scenario.condition==="noisy"?.12:(input.model.parameters.accelNoiseG??.012); const drift=input.model.parameters.gyroBiasDps??.32; const gyroNoise=input.model.parameters.gyroNoiseDps??.18;
  const ax=Array.from({length:count},(_,i)=> (moving?amplitude*Math.sin(Math.PI*i/(count-1)):0)+random.normal(0,noise)); const ay=ax.map(()=>random.normal(0,noise)); const az=ax.map((_,i)=>1-(moving?.12*Math.sin(Math.PI*i/(count-1)):0)+random.normal(0,noise)); const gx=ax.map(()=>random.normal(drift,gyroNoise)); const gy=ax.map(()=>random.normal(0,gyroNoise)); const gz=ax.map(()=>random.normal(0,gyroNoise)); const magnitude=ax.map((value,i)=>Math.sqrt(value**2+ay[i]!**2+az[i]!**2));
  const values=moving?[measurement(targetId,"motion_detected",Math.max(...ax)>1.15,"boolean",!fault),measurement(targetId,"axis_consistent",Math.max(...ax)>Math.max(...ay.map(Math.abs)),"boolean",!fault)]:[measurement(targetId,"stationary_noise_g",round(sd(magnitude),4),"g",!fault),measurement(targetId,"drift_dps",round(mean(gx.map((v,i)=>Math.sqrt(v*v+gy[i]!**2+gz[i]!**2))),4),"deg/s",!fault)];
  const outputSeries=[series(targetId,"accel_x","g",20000,ax),series(targetId,"accel_y","g",20000,ay),series(targetId,"accel_z","g",20000,az)];
  if(!moving) outputSeries.push(series(targetId,"gyro_x","deg/s",20000,gx),series(targetId,"gyro_y","deg/s",20000,gy),series(targetId,"gyro_z","deg/s",20000,gz));
  return{measurements:values,series:outputSeries,healthy:!fault};
}

function dht(input: GenerateInput): GeneratedCapture {
  const {targetId,planId,seed,phase,ordinal,scenario}=input; const random=stream(seed,planId,phase,ordinal,"dht"); const fault=scenario.condition==="sensor_fault"||scenario.condition==="timeout"; const count=planId.includes("valid-rate")?3:1; const temperature=scenario.temperatureC??27; const humidity=scenario.humidityPercent??54; const lag=input.model.parameters.lagSamples??2; const temperatures=Array.from({length:count},(_,i)=>Math.round((temperature+(1-Math.exp(-i/lag))*random.normal(0,.3))*10)/10); const humidities=Array.from({length:count},()=>Math.round(humidity+random.normal(0,input.model.parameters.humidityNoisePercent??.3))); const valid=temperatures.map(()=>!fault&&random.next()>(input.model.parameters.frameFailureRate??.01)); const stale=temperatures.map((value,index)=>index>0&&value===temperatures[index-1]&&humidities[index]===humidities[index-1]); const output=[series(targetId,"temperature","C",2000000,temperatures),series(targetId,"humidity","%",2000000,humidities),series(targetId,"valid_frame","logic",2000000,valid.map(Number))]; let values:Measurement[];
  if(planId.includes("response")) values=[measurement(targetId,"checksum_valid",valid[0]!,"boolean",valid[0]),measurement(targetId,"response_time_us",round(80+random.normal(0,3),1),"us",valid[0])]; else if(planId.includes("valid-rate")) values=[measurement(targetId,"valid_rate",mean(valid.map(Number)),"ratio"),measurement(targetId,"stale_rate",mean(stale.slice(1).map(Number)),"ratio")]; else values=[measurement(targetId,"temperature_c",temperatures.at(-1)!,"C",valid.at(-1)),measurement(targetId,"humidity_percent",humidities.at(-1)!,"%",valid.at(-1))];
  return{measurements:values,series:output,healthy:valid.some(Boolean),detail:fault?"Seeded simulated DHT response failure.":undefined};
}

export function generateCapture(input: GenerateInput): GeneratedCapture { if(input.kind==="loopback")return loopback(input);if(input.kind==="hc_sr04")return hc(input);if(input.kind==="mpu6050")return mpu(input);return dht(input); }
