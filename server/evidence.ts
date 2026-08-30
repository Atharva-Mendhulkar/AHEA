import { randomUUID } from "node:crypto";
import type { ConfidenceLabel, DiagnosticConclusion, EvidenceState, EvidenceStatement, EvidenceView, HypothesisEvidence, Observation, ObservationAssessment, ProjectContext, Recommendation, SignalClassification } from "../shared/domain.js";
import { measurement, targetById } from "../shared/domain.js";

function operationValid(observation: Observation): boolean {
  return observation.operation.accepted && !observation.operation.aborted && !observation.operation.timedOut && !observation.operation.estopLatched && observation.operation.cleanupSucceeded && observation.targetHealth.every((entry) => entry.healthy) && observation.measurements.every((entry) => entry.quality === "valid");
}
function inRange(value: number | undefined, expected: number, tolerance: number): boolean { return value !== undefined && Math.abs(value - expected) <= tolerance; }

export function assessObservation(observation: Observation, context: ProjectContext): ObservationAssessment {
  const target = targetById(context, observation.targetId);
  if (!target || !operationValid(observation)) return { observationId: observation.id, planId: observation.planId, valid: false, classification: "INVALID", summary: "The operation or measurement failed validation and cannot support a diagnosis.", limitations: observation.limitations };
  if (target.type === "hc_sr04") {
    const distance = measurement<number>(observation, "distance_cm"); const timeoutRate = measurement<number>(observation, "timeout_rate"); const deviation = measurement<number>(observation, "distance_stddev_cm"); const progression = measurement<boolean>(observation, "progression_consistent");
    const inDistanceRange = distance === undefined || target.expected.distanceCm === undefined || (distance >= target.expected.distanceCm[0] && distance <= target.expected.distanceCm[1]);
    const withinBounds = inDistanceRange && (timeoutRate === undefined || timeoutRate <= target.expected.maximumTimeoutRate) && (deviation === undefined || deviation <= target.expected.maximumStddevCm) && progression !== false;
    return { observationId: observation.id, planId: observation.planId, valid: true, classification: withinBounds ? "VALID" : "MALFORMED", summary: withinBounds ? "HC-SR04 timing behavior satisfies the declared profile bounds." : "HC-SR04 timing, variance, progression, or declared distance bounds were not satisfied.", limitations: observation.limitations };
  }
  if (target.type === "mpu6050") {
    const identity = measurement<boolean>(observation, "identity_valid"); const noise = measurement<number>(observation, "stationary_noise_g"); const motion = measurement<boolean>(observation, "motion_detected"); const axes = measurement<boolean>(observation, "axis_consistent");
    const withinBounds = identity !== false && (noise === undefined || noise <= target.expected.maximumStationaryNoiseG) && motion !== false && axes !== false;
    return { observationId: observation.id, planId: observation.planId, valid: true, classification: withinBounds ? "VALID" : "MALFORMED", summary: withinBounds ? "MPU6050 identity and response satisfy the declared profile bounds." : "MPU6050 identity, stationary noise, motion, or axis behavior is outside declared bounds.", limitations: observation.limitations };
  }
  if (target.type === "dht11") {
    const checksum = measurement<boolean>(observation, "checksum_valid"); const temperature = measurement<number>(observation, "temperature_c"); const humidity = measurement<number>(observation, "humidity_percent"); const validRate = measurement<number>(observation, "valid_rate"); const staleRate = measurement<number>(observation, "stale_rate");
    const temperatureValid = temperature === undefined || target.expected.temperatureC === undefined || (temperature >= target.expected.temperatureC[0] && temperature <= target.expected.temperatureC[1]);
    const humidityValid = humidity === undefined || target.expected.humidityPercent === undefined || (humidity >= target.expected.humidityPercent[0] && humidity <= target.expected.humidityPercent[1]);
    const withinBounds = checksum !== false && temperatureValid && humidityValid && (validRate === undefined || validRate >= 1 - target.expected.maximumInvalidRate) && (staleRate === undefined || staleRate < 1);
    return { observationId: observation.id, planId: observation.planId, valid: true, classification: withinBounds ? "VALID" : "MALFORMED", summary: withinBounds ? "DHT11 response and readings satisfy the declared profile bounds." : "DHT11 checksum, valid rate, stale rate, temperature, or humidity is outside declared bounds.", limitations: observation.limitations };
  }
  const sourcePresent = measurement<boolean>(observation, "source_present");
  const destinationPresent = measurement<boolean>(observation, "destination_present");
  const sourceFrequency = measurement<number>(observation, "source_frequency_hz");
  const destinationFrequency = measurement<number>(observation, "destination_frequency_hz");
  const sourceDuty = measurement<number>(observation, "source_duty_percent");
  const destinationDuty = measurement<number>(observation, "destination_duty_percent");
  const correlation = measurement<number>(observation, "endpoint_correlation");
  const expected = target.expected;
  const frequencyTolerance = expected.frequencyHz * expected.frequencyToleranceFraction;
  const sourceTimingValid = sourcePresent === true && (sourceFrequency === undefined || inRange(sourceFrequency, expected.frequencyHz, frequencyTolerance)) && (sourceDuty === undefined || inRange(sourceDuty, expected.dutyPercent, expected.dutyTolerancePercent));
  const destinationTimingValid = destinationPresent === true && (destinationFrequency === undefined || inRange(destinationFrequency, expected.frequencyHz, frequencyTolerance)) && (destinationDuty === undefined || inRange(destinationDuty, expected.dutyPercent, expected.dutyTolerancePercent));

  let classification: SignalClassification = "INVALID";
  let summary = "The registered capture did not provide enough signal information.";
  if (observation.planId.includes("inspect-stimulus")) {
    const sourceStatic = measurement<boolean>(observation, "source_static_sequence_valid");
    const destinationStatic = measurement<boolean>(observation, "destination_static_sequence_valid");
    classification = sourceStatic === true && destinationStatic === true ? "VALID" : sourceStatic === true ? "MISSING" : "MALFORMED";
    summary = sourceStatic === true ? (destinationStatic === true ? "Both nodes followed the registered static sequence." : "The source followed the static sequence but the destination did not.") : "The source did not follow the registered static stimulus sequence.";
  } else if (observation.planId.includes("observe-destination")) {
    classification = destinationPresent === false ? "MISSING" : destinationTimingValid ? "VALID" : "MALFORMED";
    summary = classification === "VALID" ? "The destination carried the registered waveform within configured bounds." : classification === "MISSING" ? "No destination transitions were captured." : "Destination transitions were present but outside timing or duty bounds.";
  } else if (observation.planId.includes("observe-source")) {
    classification = sourcePresent === false ? "MISSING" : sourceTimingValid ? "VALID" : "MALFORMED";
    summary = classification === "VALID" ? "The source carried the registered waveform within configured bounds." : classification === "MISSING" ? "No source transitions were captured." : "Source transitions were present but outside timing or duty bounds.";
  } else {
    if (sourcePresent === false || !sourceTimingValid) classification = "MALFORMED";
    else if (destinationPresent === false) classification = "MISSING";
    else if (!destinationTimingValid || (correlation !== undefined && correlation < expected.minimumCorrelation)) classification = "MALFORMED";
    else classification = "VALID";
    summary = classification === "VALID" ? "Source and destination agree within registered bounds." : classification === "MISSING" ? "The source is valid while the destination signal is missing." : "Endpoint timing or correlation is outside registered bounds.";
  }
  return { observationId: observation.id, planId: observation.planId, valid: true, classification, summary, limitations: observation.limitations };
}

function latestFor(assessments: ObservationAssessment[], fragment: string): ObservationAssessment | undefined { return [...assessments].reverse().find((entry) => entry.planId.includes(fragment)); }
function statement(prefix: string, assessment: ObservationAssessment): EvidenceStatement { return { id: `${prefix}:${assessment.observationId}`, text: assessment.summary, observationIds: [assessment.observationId], limitations: assessment.limitations } }

function loopbackState(assessments: ObservationAssessment[]): EvidenceState {
  const diagnostic = assessments.filter((entry) => !entry.planId.includes("verify-path"));
  const destinationCaptures = diagnostic.filter((entry) => entry.planId.includes("observe-destination") || entry.planId.includes("compare-endpoints") || entry.planId.includes("measure-timing") || entry.planId.includes("repeat-synchronized"));
  if (destinationCaptures.some((entry) => entry.classification === "VALID") && destinationCaptures.some((entry) => entry.classification === "MISSING")) return "CONFLICTING_EVIDENCE";
  const latestRepeat = latestFor(diagnostic, "repeat-synchronized");
  if (latestRepeat) return latestRepeat.classification === "VALID" ? "NORMAL" : latestRepeat.classification === "MISSING" ? "PATH_OPEN_SUPPORTED" : latestRepeat.classification === "CONFLICTING" ? "CONFLICTING_EVIDENCE" : "SOURCE_MALFORMED";
  const compare = latestFor(diagnostic, "compare-endpoints");
  if (compare) return compare.classification === "VALID" ? "NORMAL" : compare.classification === "MISSING" ? "PATH_OPEN_SUPPORTED" : compare.classification === "CONFLICTING" ? "CONFLICTING_EVIDENCE" : "DESTINATION_MALFORMED";
  const timing = latestFor(diagnostic, "measure-timing");
  if (timing) return timing.classification === "VALID" ? "NORMAL" : timing.classification === "CONFLICTING" ? "CONFLICTING_EVIDENCE" : "SIGNAL_PATH_FAULT_SUPPORTED";
  const inspect = latestFor(diagnostic, "inspect-stimulus");
  if (inspect) return inspect.classification === "VALID" ? "NORMAL" : inspect.classification === "MISSING" ? "PATH_OPEN_SUPPORTED" : "SOURCE_MALFORMED";
  const source = latestFor(diagnostic, "observe-source");
  const destination = latestFor(diagnostic, "observe-destination");
  if (source && source.classification !== "VALID") return "SOURCE_MALFORMED";
  if (destination?.classification === "MISSING") return "DESTINATION_MISSING";
  if (destination?.classification === "MALFORMED") return "DESTINATION_MALFORMED";
  return "INSUFFICIENT_EVIDENCE";
}

function confidenceFor(state: EvidenceState, assessments: ObservationAssessment[]): ConfidenceLabel {
  if (state === "INSUFFICIENT_EVIDENCE" || state === "CONFLICTING_EVIDENCE") return "UNKNOWN";
  if (state === "DESTINATION_MISSING" || state === "DESTINATION_MALFORMED" || state === "SOURCE_MALFORMED" || state === "SENSOR_ANOMALY") return "POSSIBLE";
  if (state === "SIGNAL_PATH_FAULT_SUPPORTED") return "LIKELY";
  if ((state === "PATH_OPEN_SUPPORTED" || state === "NORMAL") && assessments.some((entry) => entry.planId.includes("compare-endpoints") || entry.planId.includes("repeat-synchronized"))) return "HIGH_CONFIDENCE";
  return "LIKELY";
}

function hypothesesFor(state: EvidenceState): HypothesisEvidence[] {
  return [
    { id: "path_open", label: "Open source-to-destination path", status: state === "PATH_OPEN_SUPPORTED" ? "SUPPORTED" : state === "DESTINATION_MISSING" ? "POSSIBLE" : state === "NORMAL" ? "WEAKENED" : "UNTESTED", reasons: state === "PATH_OPEN_SUPPORTED" ? ["A synchronized capture found a valid source and missing destination."] : state === "DESTINATION_MISSING" ? ["The first destination capture had no transitions."] : [], limitations: ["The conclusion applies only to the registered fixture and tested conditions."] },
    { id: "signal_path_distortion", label: "Signal-path distortion", status: state === "SIGNAL_PATH_FAULT_SUPPORTED" ? "SUPPORTED" : state === "DESTINATION_MALFORMED" ? "POSSIBLE" : state === "NORMAL" ? "WEAKENED" : "UNTESTED", reasons: state === "SIGNAL_PATH_FAULT_SUPPORTED" ? ["Source timing was valid while destination timing remained outside bounds."] : [], limitations: ["Native digital capture cannot identify an exact damaged component."] },
    { id: "stimulus_or_profile", label: "Stimulus or profile fault", status: state === "SOURCE_MALFORMED" ? "POSSIBLE" : state === "NORMAL" ? "WEAKENED" : "UNTESTED", reasons: state === "SOURCE_MALFORMED" ? ["The source node did not reproduce the registered stimulus."] : [], limitations: ["Independent timebase calibration is unavailable."] },
    { id: "capture_conflict", label: "Conflicting capture", status: state === "CONFLICTING_EVIDENCE" ? "SUPPORTED" : "WEAKENED", reasons: state === "CONFLICTING_EVIDENCE" ? ["Accepted observations disagree under registered conditions."] : [], limitations: [] },
  ];
}

function recommendationFor(state: EvidenceState, targetId: string, confidence: ConfidenceLabel, observationIds: string[]): Recommendation[] {
  if (state !== "PATH_OPEN_SUPPORTED" && state !== "SIGNAL_PATH_FAULT_SUPPORTED") return [];
  const open = state === "PATH_OPEN_SUPPORTED";
  return [{ id: open ? "restore-loopback-jumper-v1" : "inspect-loopback-path-v1", targetId, kind: open ? "restore_loopback_path" : "inspect_signal_path", action: open ? "Power down the fixture, install or reseat the removable source-to-destination jumper, inspect the connection, then restore power." : "Power down the fixture and inspect or reseat the source-to-destination connection before restoring power.", basis: open ? "The registered source waveform was valid while the destination was absent in synchronized capture." : "The source waveform was valid while destination timing remained outside bounds.", expectedEffect: "The destination should match the source within the registered frequency, duty, and correlation bounds.", safetyConstraints: ["A human must perform the change.", "Power down before changing the jumper or wiring.", "Use 3.3 V logic only and retain the registered protection resistors."], verificationPlanId: "loopback.verify-path.1khz.v1", confidence }];
}

function sensorAdjustments(kind: ProjectContext["profile"]["kind"]): string[] {
  if (kind === "hc_sr04") return ["Verify the 8.2 kOhm / 10 kOhm Echo divider and common ground.", "Use stable power and align a flat target inside the sensing cone.", "Repeat the timing, variance, and distance-progression checks."];
  if (kind === "mpu6050") return ["Verify the I2C address and that SDA/SCL pull-ups terminate at 3.3 V.", "Mount the sensor firmly and keep it still for the baseline capture.", "Repeat identity, stationary-noise, and directed-axis checks."];
  return ["Verify the data pull-up terminates at 3.3 V and all grounds are common.", "Wait at least two seconds between readings and keep placement stable.", "Repeat response, environment, and valid-rate checks."];
}

function conclusionFor(state: EvidenceState, assessments: ObservationAssessment[], context: ProjectContext, recommendations: Recommendation[]): DiagnosticConclusion {
  const observationIds = assessments.map((entry) => entry.observationId);
  const sensor = context.profile.kind !== "loopback";
  if (state === "NORMAL") return {
    disposition: "READY_TO_USE",
    headline: sensor ? "Sensor is completely OK for the tested profile." : "Signal path is completely OK for the tested profile.",
    summary: "All registered checks completed within their declared bounds. This conclusion applies only to the tested setup and conditions.",
    adjustments: [], observationIds,
  };
  if (recommendations.length) return {
    disposition: "ADJUST_AND_RETEST",
    headline: "The setup can be used after the recommended adjustment and a passing retest.",
    summary: "The evidence supports a bounded practical fix. Apply it only with power removed, then run the registered verification plan.",
    adjustments: [recommendations[0]!.action, ...recommendations[0]!.safetyConstraints], observationIds,
  };
  if (state === "SENSOR_ANOMALY") {
    const hardFailure = assessments.some((entry) => !entry.valid || entry.classification === "INVALID");
    return hardFailure ? {
      disposition: "DO_NOT_USE",
      headline: "Sensor failed the registered checks and cannot be used in this setup.",
      summary: "Do not bypass the failed checks. Rule out power, wiring, and interface faults; replace the sensor if it still fails the complete retest.",
      adjustments: sensorAdjustments(context.profile.kind), observationIds,
    } : {
      disposition: "ADJUST_AND_RETEST",
      headline: "Sensor can be used after these adjustments and a passing retest.",
      summary: "The sensor responded, but one or more measured behaviors were outside the declared bounds.",
      adjustments: sensorAdjustments(context.profile.kind), observationIds,
    };
  }
  if (state === "INSUFFICIENT_EVIDENCE") return { disposition: "PENDING", headline: "Testing is not complete.", summary: "No use decision is available until the registered experiment sequence finishes.", adjustments: [], observationIds };
  return {
    disposition: "INCONCLUSIVE",
    headline: sensor ? "No safe sensor decision: do not use it until it passes a complete retest." : "No safe use decision can be made from the current evidence.",
    summary: "The observations are incomplete or conflicting, so a repair or normal-use claim would be unsafe.",
    adjustments: sensor ? sensorAdjustments(context.profile.kind) : [], observationIds,
  };
}

export function deriveEvidence(observations: Observation[], context: ProjectContext, targetId: string, interventionDeclared: boolean, mode: "physical" | "simulation"): EvidenceView {
  const controlled = observations.filter((entry) => entry.phase !== "monitoring");
  const assessments = controlled.map((entry) => assessObservation(entry, context));
  const diagnosticAssessments = assessments.filter((entry) => !entry.planId.includes("verify-path"));
  let state: EvidenceState;
  if (context.profile.kind === "loopback") state = loopbackState(diagnosticAssessments);
  else {
    const expectedPlans = context.allowedPlanIds.filter((planId) => !planId.includes("verify"));
    const complete = expectedPlans.every((planId) => controlled.some((entry) => entry.phase === "diagnostic" && entry.planId === planId));
    state = complete ? (diagnosticAssessments.every((entry) => entry.valid && entry.classification === "VALID") ? "NORMAL" : "SENSOR_ANOMALY") : "INSUFFICIENT_EVIDENCE";
  }
  const confidence = confidenceFor(state, diagnosticAssessments);
  const verificationObservations = controlled.filter((entry) => entry.phase === "verification");
  const verificationAssessments = verificationObservations.map((entry) => assessObservation(entry, context));
  let consecutivePasses = 0;
  for (const assessment of verificationAssessments) consecutivePasses = assessment.valid && assessment.classification === "VALID" ? consecutivePasses + 1 : 0;
  const required = context.constraints.requiredVerificationPasses;
  const failed = verificationAssessments.length >= required && consecutivePasses === 0;
  const status = !interventionDeclared ? "NOT_RUN" : consecutivePasses >= required ? (mode === "physical" ? "PASSED" : "SIMULATED_PASS") : failed ? "FAILED" : "PENDING";
  const recommendations = recommendationFor(state, targetId, confidence, diagnosticAssessments.map((entry) => entry.observationId));
  const conclusion = conclusionFor(state, diagnosticAssessments, context, recommendations);
  const observed = assessments.map((assessment) => statement("observed", assessment));
  const inferences: EvidenceStatement[] = state === "INSUFFICIENT_EVIDENCE" ? [] : [{ id: `inference:${state.toLowerCase()}`, text: ({ DESTINATION_MISSING: "The destination is absent; source verification is required before attributing the path.", DESTINATION_MALFORMED: "The destination waveform is outside registered bounds; source timing must be separated from path timing.", SOURCE_MALFORMED: "The source does not match the registered stimulus, so a downstream repair claim is not supported.", PATH_OPEN_SUPPORTED: "A valid source and absent destination support an open signal path under the tested conditions.", SIGNAL_PATH_FAULT_SUPPORTED: "A valid source and malformed destination support a bounded signal-path fault diagnosis.", CONFLICTING_EVIDENCE: "Accepted captures conflict; repeat synchronized capture or stop inconclusive.", NORMAL: "The tested source and destination behavior agrees with configured bounds.", SENSOR_ANOMALY: "The optional sensor profile returned an out-of-bounds or invalid result." } as Record<Exclude<EvidenceState, "INSUFFICIENT_EVIDENCE">, string>)[state as Exclude<EvidenceState, "INSUFFICIENT_EVIDENCE">], observationIds: diagnosticAssessments.map((entry) => entry.observationId), limitations: targetById(context, targetId)?.limitations ?? [] }];
  return {
    state, confidence, assessments, observed, inferences, hypotheses: context.profile.kind === "loopback" ? hypothesesFor(state) : [], recommendations, conclusion,
    verification: { status, requiredConsecutivePasses: required, consecutivePasses, observationIds: verificationObservations.map((entry) => entry.id), summary: status === "PASSED" ? "Two consecutive physical verification runs passed." : status === "SIMULATED_PASS" ? "Two simulated runs passed; physical confirmation is not available." : status === "FAILED" ? "Repeated verification did not restore the registered behavior." : interventionDeclared ? `Verification requires ${required} consecutive passing physical runs.` : "No repair claim has entered verification." },
    limitations: [...(targetById(context, targetId)?.limitations ?? []), context.procedures.reference?.kind === "project_calibration" ? `Project calibration reference: ${context.procedures.reference.procedureId}.` : "No independent reference exists; results are baseline characterization."],
  };
}
