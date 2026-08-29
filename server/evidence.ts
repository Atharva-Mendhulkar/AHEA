import type { EvidenceView, FsrDeviceContext, HypothesisEvidence, Observation, ObservationAssessment, ProjectContext, ReferenceSummary, SubjectSummary } from "../shared/domain.js";
import { deviceById, measurement } from "../shared/domain.js";
import { recommendResistor } from "./tuning.js";

function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1) }
function stddev(values: number[]): number { const average = mean(values); return Math.sqrt(mean(values.map((value) => (value - average) ** 2))) }

function assessObservation(observation: Observation, context: ProjectContext): ObservationAssessment {
  const device = observation.deviceId ? deviceById(context, observation.deviceId) : undefined;
  const sampleMean = measurement<number>(observation, "adc_mean");
  const sampleStddev = measurement<number>(observation, "adc_stddev");
  const healthValid = observation.sensorHealth.every((health) => health.healthy && health.errorRate <= (device?.type === "fsr" ? device.expected.maximumInvalidSampleRate : 0.05));
  const valid = observation.operation.accepted && !observation.operation.aborted && !observation.operation.timedOut && !observation.operation.estopLatched && healthValid && observation.measurements.every((item) => item.quality === "valid");
  const comparisons: string[] = [];
  if (sampleMean !== undefined) comparisons.push(`Mean ${sampleMean.toFixed(1)} ADC counts.`);
  if (sampleStddev !== undefined) comparisons.push(`Sample standard deviation ${sampleStddev.toFixed(1)} ADC counts.`);
  if (!valid) comparisons.push("Observation is invalid and cannot advance diagnosis.");
  return { observationId: observation.id, deviceId: observation.deviceId, valid, mean: sampleMean, stddev: sampleStddev, comparisons };
}

function validMeans(observations: Observation[], assessments: ObservationAssessment[], deviceId: string, phase: "diagnostic" | "verification"): number[] {
  return observations.flatMap((observation) => {
    if (observation.deviceId !== deviceId || observation.phase !== phase || observation.command !== "sample_fsr") return [];
    const assessment = assessments.find((item) => item.observationId === observation.id);
    return assessment?.valid && assessment.mean !== undefined ? [assessment.mean] : [];
  });
}

function hypotheses(state: EvidenceView["state"], hasRecommendation: boolean): HypothesisEvidence[] {
  const outlier = state === "OUTLIER" || state === "CIRCUIT_MISMATCH";
  const noisy = state === "EXCESS_NOISE";
  const communication = state === "COMMUNICATION_FAILURE" || state === "SENSOR_FAILURE_POSSIBLE";
  return [
    { id: "sensor_variation", label: "Component variation", status: outlier ? "PLAUSIBLE" : state === "NORMAL" ? "WEAKENED" : "UNTESTED", reasons: outlier ? ["The subject is stable but differs from agreeing references."] : [], limitations: ["Variation across pressure ranges has not been characterized."] },
    { id: "wiring_issue", label: "Wiring issue", status: communication ? "SUPPORTED" : outlier ? "PLAUSIBLE" : "WEAKENED", reasons: communication ? ["The configured channel produced invalid or failed reads."] : outlier ? ["A connection problem can shift an ADC response."] : [], limitations: [] },
    { id: "resistor_mismatch", label: "Divider resistor mismatch", status: hasRecommendation ? "SUPPORTED" : outlier ? "PLAUSIBLE" : "WEAKENED", reasons: hasRecommendation ? ["A bounded divider calculation found an allowed candidate closer to the reference target."] : [], limitations: ["The circuit model must match the physical topology."] },
    { id: "sensor_degradation", label: "Sensor degradation", status: communication || outlier ? "PLAUSIBLE" : "WEAKENED", reasons: outlier ? ["Persistent localized deviation is compatible with sensor degradation."] : [], limitations: ["Electrical compensation cannot prove the sensor is healthy."] },
    { id: "stimulus_inconsistency", label: "Stimulus inconsistency", status: noisy ? "SUPPORTED" : outlier ? "PLAUSIBLE" : "WEAKENED", reasons: noisy ? ["Within-trial variance exceeds the configured stability bound."] : [], limitations: ["The manual pressure protocol is not a calibrated force source."] },
  ];
}

export function deriveEvidence(observations: Observation[], context: ProjectContext, targetDeviceId: string, interventionDeclared: boolean): EvidenceView {
  const assessments = observations.map((observation) => assessObservation(observation, context));
  const trials = context.procedures.fsrStimulus.trialsPerDevice;
  const referenceIds = context.expectedBehavior.referenceDeviceIds;
  const referenceDeviceMeans = referenceIds.flatMap((deviceId) => {
    const values = validMeans(observations, assessments, deviceId, "diagnostic");
    return values.length >= trials ? [mean(values.slice(-trials))] : [];
  });
  const collectedReferenceTrials = referenceIds.reduce((sum, deviceId) => sum + validMeans(observations, assessments, deviceId, "diagnostic").length, 0);
  const subjectValues = validMeans(observations, assessments, targetDeviceId, "diagnostic");
  const reference: ReferenceSummary | undefined = referenceDeviceMeans.length === referenceIds.length ? {
    deviceIds: referenceIds,
    collectedTrials: collectedReferenceTrials,
    requiredTrials: referenceIds.length * trials,
    meanRaw: mean(referenceDeviceMeans),
    stddevRaw: stddev(referenceDeviceMeans),
    rangeRaw: [Math.min(...referenceDeviceMeans), Math.max(...referenceDeviceMeans)],
  } : undefined;
  const target = deviceById(context, targetDeviceId);
  const subjectMean = subjectValues.length >= trials ? mean(subjectValues.slice(-trials)) : undefined;
  const subject: SubjectSummary | undefined = reference && subjectMean !== undefined && target?.type === "fsr" ? {
    deviceId: targetDeviceId,
    collectedTrials: subjectValues.length,
    requiredTrials: trials,
    meanRaw: subjectMean,
    stddevRaw: stddev(subjectValues.slice(-trials)),
    normalizedResponse: subjectMean / target.circuit.adcMaximumRaw,
    referenceDeviationFraction: Math.abs(subjectMean - reference.meanRaw) / Math.max(reference.meanRaw, 1),
  } : undefined;

  const relevant = observations.filter((item) => item.command === "sample_fsr" && item.phase !== "monitoring");
  const hasInvalid = relevant.some((observation) => !assessments.find((item) => item.observationId === observation.id)?.valid);
  const hasNoise = relevant.some((observation) => {
    const device = observation.deviceId ? deviceById(context, observation.deviceId) : undefined;
    const assessment = assessments.find((item) => item.observationId === observation.id);
    return device?.type === "fsr" && assessment?.stddev !== undefined && assessment.stddev > device.expected.maximumSampleStddevRaw;
  });
  let state: EvidenceView["state"] = "INSUFFICIENT_EVIDENCE";
  let confidence: EvidenceView["confidence"] = "UNKNOWN";
  if (hasInvalid) { state = "COMMUNICATION_FAILURE"; confidence = "LOW"; }
  else if (hasNoise) { state = "EXCESS_NOISE"; confidence = "LOW"; }
  else if (reference && subject) {
    state = subject.referenceDeviationFraction <= context.expectedBehavior.toleranceFraction ? "NORMAL" : "OUTLIER";
    confidence = context.procedures.fsrStimulus.kind === "repeatable_manual" ? "MEDIUM" : "HIGH";
  }

  const recommendations = state === "OUTLIER" && reference && subject && target?.type === "fsr" ? recommendResistor(context, target as FsrDeviceContext, reference, subject) : [];
  if (recommendations.length > 0) state = "CIRCUIT_MISMATCH";

  const verificationObservations = observations.filter((item) => item.deviceId === targetDeviceId && item.phase === "verification" && item.command === "sample_fsr");
  let consecutiveVerificationPasses = 0;
  if (reference && target?.type === "fsr") for (const observation of verificationObservations) {
    const assessment = assessments.find((item) => item.observationId === observation.id);
    const pass = assessment?.valid && assessment.mean !== undefined && assessment.stddev !== undefined && assessment.stddev <= target.expected.maximumSampleStddevRaw && Math.abs(assessment.mean - reference.meanRaw) / Math.max(reference.meanRaw, 1) <= context.expectedBehavior.toleranceFraction;
    consecutiveVerificationPasses = pass ? consecutiveVerificationPasses + 1 : 0;
  }
  const verificationStatus = !interventionDeclared ? "NOT_RUN" : verificationObservations.length === 0 ? "PENDING" : consecutiveVerificationPasses >= 2 ? "PASSED" : "FAILED";

  return {
    state, confidence, observations: assessments, reference, subject, hypotheses: hypotheses(state, recommendations.length > 0), recommendations, verificationStatus, consecutiveVerificationPasses,
    projectLevelChecks: state === "NORMAL" ? ["Confirm the application maps this physical channel to the intended sensor ID.", "Compare the application threshold and scaling against the measured normalized response.", "Check whether mounting or pressure transfer differs at the reported problem location.", "Inspect filtering and downstream event logic before changing hardware."] : [],
    limitations: ["FSR ADC response is relative and does not directly measure force.", "The manual stimulus is not a calibrated force source.", "A resistor recommendation is valid only for the declared divider topology and sampled pressure region."],
  };
}
