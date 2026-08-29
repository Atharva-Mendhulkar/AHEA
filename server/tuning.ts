import type { CorrectionRecommendation, FsrDeviceContext, ProjectContext, ReferenceSummary, SubjectSummary } from "../shared/domain.js";

export interface CandidatePrediction { resistorOhms: number; predictedRaw: number; deviationFraction: number; dividerCurrentMilliamps: number }

export function rankResistorCandidates(context: ProjectContext, device: FsrDeviceContext, reference: ReferenceSummary, subject: SubjectSummary): CandidatePrediction[] {
  const { topology, fixedResistorOhms, supplyMillivolts, adcMaximumMillivolts, adcMaximumRaw } = device.circuit;
  if (topology === "unknown" || !fixedResistorOhms || !supplyMillivolts || !adcMaximumMillivolts || context.constraints.allowedResistorOhms.length === 0) return [];
  const observedMv = subject.meanRaw / adcMaximumRaw * adcMaximumMillivolts;
  if (observedMv <= 0 || observedMv >= supplyMillivolts) return [];
  const fsrOhms = topology === "fsr_to_vcc"
    ? fixedResistorOhms * (supplyMillivolts / observedMv - 1)
    : fixedResistorOhms * observedMv / (supplyMillivolts - observedMv);
  if (!Number.isFinite(fsrOhms) || fsrOhms <= 0) return [];

  return context.constraints.allowedResistorOhms.flatMap((candidate) => {
    const predictedMv = topology === "fsr_to_vcc"
      ? supplyMillivolts * candidate / (fsrOhms + candidate)
      : supplyMillivolts * fsrOhms / (candidate + fsrOhms);
    const currentMa = supplyMillivolts / (fsrOhms + candidate);
    if (predictedMv <= 0 || predictedMv > adcMaximumMillivolts || (context.constraints.maximumDividerCurrentMilliamps !== undefined && currentMa > context.constraints.maximumDividerCurrentMilliamps)) return [];
    const predictedRaw = predictedMv / adcMaximumMillivolts * adcMaximumRaw;
    return [{ resistorOhms: candidate, predictedRaw, deviationFraction: Math.abs(predictedRaw - reference.meanRaw) / Math.max(reference.meanRaw, 1), dividerCurrentMilliamps: currentMa }];
  }).sort((left, right) => left.deviationFraction - right.deviationFraction);
}

export function recommendResistor(context: ProjectContext, device: FsrDeviceContext, reference: ReferenceSummary, subject: SubjectSummary): CorrectionRecommendation[] {
  const ranked = rankResistorCandidates(context, device, reference, subject);
  const best = ranked[0];
  if (!best || best.resistorOhms === device.circuit.fixedResistorOhms || best.deviationFraction >= subject.referenceDeviationFraction) return [];
  return [{
    id: `resistor-${device.id}-${best.resistorOhms}`,
    deviceId: device.id,
    kind: "resistor_substitution",
    observedProblem: `${device.id} averaged ${subject.meanRaw.toFixed(1)} ADC counts, ${(subject.referenceDeviationFraction * 100).toFixed(1)}% from the reference mean.`,
    referenceBehavior: `Reference sensors averaged ${reference.meanRaw.toFixed(1)} ADC counts under the declared manual stimulus.`,
    candidateModification: `Replace the declared ${device.circuit.fixedResistorOhms} Ω divider resistor with ${best.resistorOhms} Ω.`,
    reason: "This is the allowed, electrically bounded candidate whose divider-model prediction is closest to the reference target.",
    calculation: `Predicted response ${best.predictedRaw.toFixed(1)} ADC counts; predicted deviation ${(best.deviationFraction * 100).toFixed(1)}%; divider current ${best.dividerCurrentMilliamps.toFixed(3)} mA.`,
    expectedEffect: "Move the response at the sampled pressure toward the known-good reference range; behavior across other pressures is not established.",
    parameters: { resistorOhms: best.resistorOhms, predictedRaw: Number(best.predictedRaw.toFixed(2)) },
    safetyConstraints: ["Use only the reviewed divider topology and supply.", "Disconnect power before replacing the resistor.", "Human approval and post-change measurement are required."],
    verificationProcedure: "Repeat the same manual stimulus for the configured number of trials and compare the normalized response with the unchanged references.",
    confidence: "MEDIUM",
  }];
}
