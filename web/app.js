import { createResistorAsset } from "./resistor.js";

const $ = (selector) => document.querySelector(selector);
const state = { session: null, events: null, loopRunning: false, loopToken: 0 };
const ACTIVE_STATES = new Set(["INITIALIZING", "WAITING_FOR_USER_STIMULUS", "RECORDING", "ANALYZING", "SELECTING_NEXT_EXPERIMENT", "POST_INTERVENTION_VERIFY"]);

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
function toast(message) { const node = $("#toast"); node.textContent = message; node.classList.add("show"); setTimeout(() => node.classList.remove("show"), 3500); }
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function formatNumber(value, unit = "") { if (typeof value !== "number") return "—"; const number = Number.isInteger(value) ? String(value) : value.toFixed(Math.abs(value) < 10 ? 3 : 1); return `${number}${unit ? ` ${unit}` : ""}`; }
function device(session, id = session.targetDeviceId) { return session.projectContext.components.find((item) => item.id === id); }
function primaryChannel(type) { return ({ fsr: "adc_mean", mpu6050: "acceleration_magnitude_g", dht11: "temperature_c", hc_sr04: "distance_cm" })[type]; }
function latestObservation(session, predicate = () => true) { return [...session.observations].reverse().find(predicate); }
function terminal(session) { return ["CONFIRMED", "CONCLUDED", "FAILED", "INTERRUPTED", "ESTOPPED"].includes(session.lifecycle); }

function agentCopy(session) {
  const active = session.activeExperiment; const target = device(session, active?.deviceId || session.targetDeviceId); const references = session.projectContext.expectedBehavior.referenceDeviceIds.length;
  const trials = session.projectContext.procedures.fsrStimulus.trialsPerDevice;
  const completedReferences = session.projectContext.expectedBehavior.referenceDeviceIds.filter((id) => session.observations.filter((item) => item.phase === "diagnostic" && item.deviceId === id).length >= trials).length;
  switch (session.agentState) {
    case "IDLE": return { label: "Ready to investigate", message: `I’ll compare ${target?.label || session.targetDeviceId} against ${references} known-good sensors.`, detail: "Ready to collect physical evidence." };
    case "INITIALIZING": return { label: "Preparing experiment", message: active?.statusMessage || `I’m preparing a bounded measurement for ${target?.label || "the sensor"}.`, detail: "Checking the configured sensor channel and capturing a clean baseline." };
    case "WAITING_FOR_USER_STIMULUS": return { label: "Waiting for physical input", message: active?.prompt || "Apply the requested input now.", detail: active?.statusMessage || "I’m watching for a meaningful response." };
    case "RECORDING": return { label: "Recording physical response", message: active?.stimulusDetected ? "Signal detected. Keep the input steady." : "Collecting enough signal…", detail: "I’ll stop automatically when this bounded sample is trustworthy." };
    case "ANALYZING": return { label: "Analyzing response", message: "That’s enough data. I’m comparing it with the known-good reference range.", detail: "Checking stability, deviation, sensor health, and competing explanations." };
    case "SELECTING_NEXT_EXPERIMENT": {
      const next = device(session, session.pendingDecision?.experiment.targetDeviceId); const isReference = next?.role === "reference";
      return { label: "Choosing the next measurement", message: isReference ? `I need a comparable response from ${next.label} (${Math.min(completedReferences + 1, references)} of ${references} references).` : `I need another bounded response from ${next?.label || "the configured sensor"}.`, detail: "Move to the named sensor. I’ll capture its baseline and detect the response automatically." };
    }
    case "WAITING_FOR_INTERVENTION": return { label: "Adjustment recommended", message: "The evidence supports a bounded physical adjustment.", detail: "Nothing changes automatically. Disconnect power, make the declared change, then tell me to verify it." };
    case "POST_INTERVENTION_VERIFY": return { label: "Repair recorded", message: "I’ll verify the adjustment against the original reference range now.", detail: "The verification run uses the same bounded measurement and requires consecutive passing evidence." };
    case "CONFIRMED": return { label: "Adjustment verified", message: `${session.targetDeviceId.toUpperCase()} now falls within the known-good range.`, detail: session.mode === "simulation" ? "Simulation passed. Physical confirmation is still required." : "The required consecutive physical verification checks passed." };
    case "DIAGNOSIS_READY": return session.evidence.state === "NORMAL"
      ? { label: "Sensor check complete", message: `${session.targetDeviceId.toUpperCase()} is behaving within the expected range.`, detail: "No hardware modification is justified. The original problem is more likely elsewhere in the project." }
      : { label: "Diagnosis ready", message: "The available evidence is sufficient for this conclusion.", detail: "Review the measured deviation and the next safe action below." };
    case "INCONCLUSIVE": return { label: "Evidence is insufficient", message: session.failureReason || "I couldn’t collect a trustworthy response within the bounded window.", detail: "Check the connection or stimulus, then retry without changing the safety limits." };
    default: return { label: "Agent paused", message: "The investigation is waiting.", detail: "No hardware operation is active." };
  }
}

function resizeCanvas(canvas, height = Math.max(canvas.clientHeight, 180)) {
  const ratio = window.devicePixelRatio || 1; const width = Math.max(canvas.clientWidth, 320);
  canvas.width = width * ratio; canvas.height = height * ratio;
  const context = canvas.getContext("2d"); context.scale(ratio, ratio); context.clearRect(0, 0, width, height);
  return { context, width, height };
}
function colors() { const css = getComputedStyle(document.documentElement); return { foreground: css.getPropertyValue("--foreground").trim(), muted: css.getPropertyValue("--muted-foreground").trim(), border: css.getPropertyValue("--border").trim(), accent: css.getPropertyValue("--accent").trim(), success: css.getPropertyValue("--success").trim(), warning: css.getPropertyValue("--warning").trim() }; }
function samplesFor(session, deviceId, phase) {
  return session.observations
    .filter((item) => item.deviceId === deviceId && item.phase === phase)
    .sort((left, right) => new Date(left.capturedAt).getTime() - new Date(right.capturedAt).getTime())
    .flatMap((item) => (item.series || []).filter((series) => series.deviceId === deviceId).flatMap((series) => series.values))
    .filter((value) => Number.isFinite(value));
}
function plotLine(context, points, x, y, color, width = 2.25, dash = []) {
  if (!points.length) return;
  context.save(); context.strokeStyle = color; context.lineWidth = width; context.lineJoin = "round"; context.lineCap = "round"; context.setLineDash(dash); context.beginPath();
  points.forEach((value, index) => index ? context.lineTo(x(index, points.length), y(value)) : context.moveTo(x(index, points.length), y(value)));
  if (points.length === 1) { context.beginPath(); context.fillStyle = color; context.arc(x(0, 1), y(points[0]), 3.5, 0, Math.PI * 2); context.fill(); } else context.stroke();
  context.restore();
}
function resistorVisual(resistanceOhms) {
  const asset = createResistorAsset(resistanceOhms); if (!asset) return "";
  return `<figure class="resistor-visual"><img src="${asset.src}" alt="${escapeHtml(asset.alt)}" width="190" height="58"><figcaption>${escapeHtml(asset.caption)}</figcaption></figure>`;
}
function drawLiveGraph(session) {
  const canvas = $("#state-graph"); const { context, width, height } = resizeCanvas(canvas); const palette = colors(); const active = session.activeExperiment; const target = device(session, active?.deviceId || session.targetDeviceId); const channel = target ? primaryChannel(target.type) : undefined;
  const started = active ? new Date(active.startedAt).getTime() : 0;
  const observations = session.observations.filter((item) => item.deviceId === target?.id && new Date(item.capturedAt).getTime() >= started);
  const points = observations.flatMap((item) => item.series?.find((series) => series.channel === channel || series.deviceId === target?.id)?.values || item.measurements.filter((entry) => entry.channel === channel && typeof entry.value === "number").map((entry) => entry.value));
  $("#graph-title").textContent = `${target?.label || "Sensor"} live response`; $("#graph-mode").textContent = session.mode === "physical" ? "Live · ESP32" : "Live · simulation";
  if (!points.length) { $("#graph-empty").hidden = false; $("#graph-legend").innerHTML = ""; return; }
  $("#graph-empty").hidden = true;
  const baseline = active?.baseline; const reference = session.evidence.reference; const values = [...points, ...(baseline === undefined ? [] : [baseline]), ...(reference ? [reference.rangeRaw[0], reference.rangeRaw[1]] : [])];
  const min = Math.min(...values); const max = Math.max(...values); const pad = Math.max((max - min) * .16, 1); const low = min - pad; const high = max + pad; const x = (index) => 18 + index / Math.max(points.length - 1, 1) * (width - 36); const y = (value) => height - 24 - (value - low) / Math.max(high - low, 1) * (height - 48);
  if (reference) { context.fillStyle = "rgba(22, 121, 75, .12)"; const top = y(reference.rangeRaw[1]); context.fillRect(0, top, width, Math.max(y(reference.rangeRaw[0]) - top, 2)); }
  if (baseline !== undefined) { context.setLineDash([5, 5]); context.strokeStyle = palette.muted; context.beginPath(); context.moveTo(0, y(baseline)); context.lineTo(width, y(baseline)); context.stroke(); context.setLineDash([]); }
  context.strokeStyle = palette.accent; context.lineWidth = 2.5; context.lineJoin = "round"; context.lineCap = "round"; context.beginPath(); points.forEach((value, index) => index ? context.lineTo(x(index), y(value)) : context.moveTo(x(index), y(value))); context.stroke();
  context.fillStyle = palette.accent; context.beginPath(); context.arc(x(points.length - 1), y(points.at(-1)), 4, 0, Math.PI * 2); context.fill();
  $("#graph-legend").innerHTML = `<span><i class="legend-line live"></i>Live response</span>${baseline === undefined ? "" : '<span><i class="legend-line baseline"></i>Baseline</span>'}${reference ? '<span><i class="legend-band"></i>Reference range</span>' : ""}`;
}
function drawComparisonGraph(session, verification = false) {
  const canvas = $("#state-graph"); const { context, width, height } = resizeCanvas(canvas); const palette = colors(); const reference = session.evidence.reference; const subject = session.evidence.subject;
  if (!reference || !subject) { $("#graph-empty").hidden = false; return; }
  $("#graph-empty").hidden = true;
  const tolerance = session.projectContext.expectedBehavior.toleranceFraction; const low = reference.meanRaw * (1 - tolerance); const high = reference.meanRaw * (1 + tolerance);
  const beforePoints = samplesFor(session, session.targetDeviceId, "diagnostic"); const afterPoints = samplesFor(session, session.targetDeviceId, "verification"); const observedPoints = verification && afterPoints.length ? afterPoints : beforePoints;
  const verificationObservation = latestObservation(session, (item) => item.phase === "verification" && item.deviceId === session.targetDeviceId); const after = verificationObservation?.measurements.find((item) => item.channel === "adc_mean" && typeof item.value === "number")?.value;
  const fallbackValue = verification && typeof after === "number" ? after : subject.meanRaw; const plottedPoints = observedPoints.length ? observedPoints : [fallbackValue];
  const top = 28; const right = 14; const bottom = 28; const left = width < 430 ? 36 : 44; const plotWidth = Math.max(width - left - right, 1); const plotHeight = Math.max(height - top - bottom, 1);
  const maximum = Math.max(high, reference.meanRaw, ...plottedPoints, ...(verification ? beforePoints : []), 1) * 1.1; const x = (index, count) => count <= 1 ? left + plotWidth / 2 : left + index / (count - 1) * plotWidth; const y = (value) => top + (1 - value / maximum) * plotHeight; const referenceY = y(reference.meanRaw);
  context.font = `${width < 430 ? 9 : 10}px ui-monospace, SFMono-Regular, Consolas, monospace`; context.textBaseline = "middle";
  [0, .5, 1].forEach((position) => { const value = maximum * position; const rowY = y(value); context.strokeStyle = palette.border; context.lineWidth = 1; context.beginPath(); context.moveTo(left, rowY); context.lineTo(width - right, rowY); context.stroke(); context.fillStyle = palette.muted; context.textAlign = "right"; context.fillText(Math.round(value).toString(), left - 6, rowY); });
  context.save(); context.globalAlpha = .1; context.fillStyle = palette.success; context.fillRect(left, y(high), plotWidth, Math.max(y(low) - y(high), 2)); context.restore();
  if (plottedPoints.length > 1) { context.save(); context.globalAlpha = .14; context.fillStyle = palette.warning; context.beginPath(); context.moveTo(x(0, plottedPoints.length), referenceY); plottedPoints.forEach((value, index) => context.lineTo(x(index, plottedPoints.length), y(value))); context.lineTo(x(plottedPoints.length - 1, plottedPoints.length), referenceY); context.closePath(); context.fill(); context.restore(); }
  context.strokeStyle = palette.success; context.lineWidth = 1.75; context.setLineDash([6, 4]); context.beginPath(); context.moveTo(left, referenceY); context.lineTo(width - right, referenceY); context.stroke(); context.setLineDash([]);
  context.fillStyle = palette.success; context.textAlign = "right"; context.textBaseline = "bottom"; context.fillText(`${reference.meanRaw.toFixed(1)} ADC`, width - right, referenceY - 4);
  if (verification && beforePoints.length) plotLine(context, beforePoints, x, y, palette.warning, 1.4, [4, 4]);
  plotLine(context, plottedPoints, x, y, verification ? palette.accent : palette.warning, 2.3);
  context.fillStyle = palette.muted; context.textAlign = "left"; context.textBaseline = "alphabetic"; context.fillText("samples / stimulus progression", left, height - 7);
  const displayedDeviation = Math.abs(fallbackValue - reference.meanRaw) / Math.max(reference.meanRaw, 1);
  $("#graph-title").textContent = verification ? "Before vs after adjustment" : "Expected vs observed"; $("#graph-mode").textContent = `${(displayedDeviation * 100).toFixed(1)}% deviation`;
  $("#graph-legend").innerHTML = `<span><i class="legend-line reference"></i>Reference</span><span><i class="legend-line subject"></i>Observed</span><span><i class="legend-band"></i>Allowed range ±${(tolerance * 100).toFixed(0)}%</span><span><i class="legend-area deviation"></i>Deviation</span>${verification && beforePoints.length ? '<span><i class="legend-line before"></i>Before adjustment</span>' : ""}`;
}
function renderGraph(session) {
  const comparisonStates = new Set(["ANALYZING", "WAITING_FOR_INTERVENTION", "DIAGNOSIS_READY", "CONFIRMED"]);
  if (comparisonStates.has(session.agentState) && session.evidence.reference && session.evidence.subject) drawComparisonGraph(session, session.phase === "verification" || session.agentState === "CONFIRMED");
  else drawLiveGraph(session);
}

function renderAnalysis(session) {
  const evidence = session.evidence; const visible = ["ANALYZING", "WAITING_FOR_INTERVENTION", "DIAGNOSIS_READY", "CONFIRMED", "INCONCLUSIVE"].includes(session.agentState) && evidence.state !== "INSUFFICIENT_EVIDENCE";
  $("#analysis-view").classList.toggle("hidden", !visible);
  if (!visible) return;
  const reference = evidence.reference; const subject = evidence.subject; const deviation = subject && reference ? subject.meanRaw - reference.meanRaw : undefined; const stateTitle = evidence.verificationStatus === "PASSED" ? "Adjustment verified" : evidence.state === "NORMAL" ? "Sensor response is healthy" : "A repeatable response deviation is present";
  $("#analysis-summary").innerHTML = `<p class="eyebrow">Agent assessment</p><h3>${escapeHtml(stateTitle)}</h3><p>${escapeHtml(evidence.state === "NORMAL" ? `${session.targetDeviceId.toUpperCase()} falls inside the configured known-good tolerance.` : subject && reference ? `${session.targetDeviceId.toUpperCase()} responds consistently, but its mean is ${Math.abs(subject.referenceDeviationFraction * 100).toFixed(1)}% ${deviation < 0 ? "below" : "above"} the reference mean.` : "The current evidence identifies a measurement problem that must be resolved before tuning.")}</p>`;
  $("#evidence-facts").innerHTML = reference && subject ? [["Expected", `${reference.meanRaw.toFixed(1)} ± ${(reference.meanRaw * session.projectContext.expectedBehavior.toleranceFraction).toFixed(1)} ADC`], ["Reference spread", `${reference.rangeRaw[0].toFixed(1)}–${reference.rangeRaw[1].toFixed(1)}`], ["Observed", `${subject.meanRaw.toFixed(1)} ADC`], ["Deviation", `${deviation >= 0 ? "+" : ""}${deviation.toFixed(1)} ADC · ${(subject.referenceDeviationFraction * 100).toFixed(1)}%`], ["Reference coverage", `${reference.deviceIds.length} sensors`], ["Signal stability", subject.stddevRaw <= (device(session)?.expected.maximumSampleStddevRaw || 0) ? "Good" : "Unstable"]].map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("") : `<p>${escapeHtml(evidence.limitations[0] || "Evidence is incomplete.")}</p>`;
  const strength = { SUPPORTED: "HIGH", PLAUSIBLE: "MEDIUM", WEAKENED: "LOW", UNTESTED: "UNTESTED" }; $("#hypotheses").innerHTML = evidence.hypotheses.map((item) => `<div class="hypothesis"><div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.reasons[0] || item.limitations[0] || "Not supported by current evidence.")}</small></div><span class="hypothesis-status" data-status="${item.status}">${strength[item.status]}</span></div>`).join("");
  const projectChecks = $("#project-checks"); projectChecks.classList.toggle("hidden", evidence.state !== "NORMAL"); projectChecks.innerHTML = evidence.state === "NORMAL" ? `<p class="eyebrow">Likely project-level causes</p><h3>The sensor itself is unlikely to be the problem</h3><ol>${evidence.projectLevelChecks.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>` : "";
  const recommendation = evidence.recommendations[0];
  if (!recommendation) { $("#recommendation").innerHTML = ""; return; }
  const resistorValues = recommendation.candidateModification.match(/[\d,.]+\s*(?:k\s*)?Ω/gi) || []; const recommendedOhms = Number(recommendation.parameters.resistorOhms); const currentDevice = device(session, recommendation.deviceId); const currentOhms = currentDevice?.type === "fsr" ? currentDevice.circuit.fixedResistorOhms : undefined;
  const adjustment = resistorValues.length >= 2
    ? `<div class="adjustment-visual"><div class="resistor-change"><span>${escapeHtml(resistorValues[0])}</span><i aria-hidden="true">→</i><strong>${escapeHtml(resistorValues[1])}</strong></div>${Number.isFinite(recommendedOhms) && recommendedOhms !== currentOhms ? resistorVisual(recommendedOhms) : ""}</div>`
    : `<h3 class="recommendation-value">${escapeHtml(recommendation.candidateModification)}</h3>`;
  $("#recommendation").innerHTML = `<article class="recommendation-card"><header class="recommendation-header"><p class="eyebrow">Jugaad opportunity</p><span class="badge" data-tone="warning">${escapeHtml(recommendation.confidence)} confidence</span></header><div class="recommendation-change"><span class="recommendation-kicker">Recommended adjustment</span>${adjustment}<p>${escapeHtml(recommendation.reason)}</p></div><div class="recommendation-details"><p><span>Expected effect</span>${escapeHtml(recommendation.expectedEffect)}</p><p><span>Trade-off</span>This compensates for the sampled response but does not prove the FSR is healthy across its full range.</p><p><span>Verification</span>${escapeHtml(recommendation.verificationProcedure)}</p></div></article>`;
}

function renderSidebar(session) {
  const references = session.projectContext.expectedBehavior.referenceDeviceIds; const subject = device(session); const controlled = session.observations.filter((item) => item.phase !== "monitoring"); const controlledIds = new Set(controlled.map((item) => item.id)); const valid = session.evidence.observations.filter((item) => item.valid && controlledIds.has(item.observationId)).length;
  $("#context-title").textContent = session.projectContext.project.name;
  $("#context-facts").innerHTML = [["Goal", session.projectContext.project.goal], ["Sensors", `${references.length + session.projectContext.expectedBehavior.subjectDeviceIds.length} FSR channels`], ["References", references.map((id) => id.toUpperCase()).join(", ")], ["Subject", subject?.label || session.targetDeviceId], ["Tolerance", `±${(session.projectContext.expectedBehavior.toleranceFraction * 100).toFixed(0)}%`]].map(([label, value]) => `<div><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  $("#hardware-title").textContent = session.hardware.boardIdentity; $("#hardware-health").dataset.healthy = String(session.hardware.connected); $("#hardware-facts").innerHTML = [["Source", session.mode], ["Adapter", session.mode === "physical" ? "ESP32 serial" : "Deterministic simulator"], ["Profile", session.hardware.profileId], ["Detected", `${session.hardware.detectedDevices.filter((item) => item.present !== false).length} configured devices`]].map(([label, value]) => `<div><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  $("#evidence-count").textContent = `${controlled.length} controlled sample${controlled.length === 1 ? "" : "s"}`; $("#confidence").textContent = session.evidence.confidence; $("#evidence-progress").innerHTML = `<div><span>Valid observations</span><strong>${valid}</strong></div><div><span>Reference coverage</span><strong>${session.evidence.reference ? "Complete" : "Collecting"}</strong></div><div><span>Verification</span><strong>${session.evidence.verificationStatus.replaceAll("_", " ")}</strong></div>`;
  const timeline = [...session.timeline].reverse().slice(0, 9); $("#timeline").innerHTML = timeline.map((event) => `<div class="timeline-item"><time>${new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><div><strong>${escapeHtml(event.type.split(".").at(-1).replaceAll("_", " "))}</strong><p>${escapeHtml(event.summary)}</p></div></div>`).join(""); $("#event-count").textContent = String(session.timeline.length);
}

function render(session) {
  state.session = session; $("#setup").classList.add("hidden"); $("#workspace").classList.remove("hidden");
  $("#mode-badge").textContent = session.mode; $("#connection-badge").textContent = session.hardware.connected ? "Connected" : "Disconnected"; $("#connection-badge").dataset.tone = session.hardware.connected ? "success" : "danger";
  $("#project-name").textContent = session.projectContext.project.name; $("#problem-summary").textContent = session.problem || session.projectContext.project.goal; $("#lifecycle-pill").textContent = session.agentState.replaceAll("_", " "); $("#lifecycle-pill").dataset.state = session.agentState.toLowerCase();
  const latestDecision = session.decisions.at(-1); $("#agent-source").textContent = latestDecision?.decisionSource === "openai" ? "OpenAI-selected experiment" : "Deterministic fallback";
  const copy = agentCopy(session); $("#agent-state-label").textContent = copy.label; $("#agent-message").textContent = copy.message; $("#agent-detail").textContent = copy.detail; $("#agent-console").dataset.agentState = session.agentState; $("#agent-orb").className = `agent-orb ${ACTIVE_STATES.has(session.agentState) ? "active" : session.agentState === "CONFIRMED" ? "complete" : "idle"}`;
  $("#evidence-badge").textContent = session.evidence.state.replaceAll("_", " "); $("#evidence-badge").dataset.tone = session.evidence.state === "NORMAL" ? "success" : session.evidence.state === "INSUFFICIENT_EVIDENCE" ? "neutral" : "warning";
  const active = session.activeExperiment; const target = device(session, active?.deviceId || session.targetDeviceId); const channel = target ? primaryChannel(target.type) : undefined; const observation = latestObservation(session, (item) => item.deviceId === target?.id); const reading = observation?.measurements.find((item) => item.channel === channel && typeof item.value === "number");
  const resultState = ["ANALYZING", "WAITING_FOR_INTERVENTION", "DIAGNOSIS_READY", "CONFIRMED"].includes(session.agentState) && session.evidence.reference && session.evidence.subject;
  const controlledSamples = session.observations.filter((item) => item.phase !== "monitoring").reduce((total, item) => total + (item.series || []).reduce((count, series) => count + series.values.length, 0), 0);
  const metricLabels = resultState ? ["Current", "Reference", "Deviation", "Signal", "Samples", "Verification"] : ["Current", "Baseline", "Change", "Elapsed", "Samples", "Signal"];
  ["current-label", "baseline-label", "delta-label", "elapsed-label", "samples-label", "signal-label"].forEach((id, index) => { $(`#${id}`).textContent = metricLabels[index]; });
  if (resultState) {
    const subject = session.evidence.subject; const reference = session.evidence.reference; const verificationObservation = latestObservation(session, (item) => item.phase === "verification" && item.deviceId === session.targetDeviceId); const verifiedMean = verificationObservation?.measurements.find((item) => item.channel === "adc_mean" && typeof item.value === "number")?.value; const verifiedStddev = verificationObservation?.measurements.find((item) => item.channel === "adc_stddev" && typeof item.value === "number")?.value; const current = session.agentState === "CONFIRMED" && typeof verifiedMean === "number" ? verifiedMean : subject.meanRaw; const deviation = current - reference.meanRaw; const deviationFraction = Math.abs(deviation) / Math.max(reference.meanRaw, 1); const direction = deviation < 0 ? "below" : "above"; const signalStddev = typeof verifiedStddev === "number" ? verifiedStddev : subject.stddevRaw;
    $("#current-value").textContent = formatNumber(current, "ADC"); $("#baseline-value").textContent = formatNumber(reference.meanRaw, "ADC"); $("#delta-value").textContent = `${(deviationFraction * 100).toFixed(1)}% ${direction}`; $("#elapsed-time").textContent = signalStddev <= (device(session)?.expected.maximumSampleStddevRaw || 0) ? "good" : "unstable"; $("#sample-count").textContent = String(controlledSamples); $("#signal-quality").textContent = session.evidence.verificationStatus.replaceAll("_", " ").toLowerCase();
  } else {
    $("#current-value").textContent = formatNumber(active?.currentValue ?? reading?.value, reading?.unit); $("#baseline-value").textContent = formatNumber(active?.baseline, reading?.unit); $("#delta-value").textContent = active?.delta === undefined ? "—" : `${active.delta >= 0 ? "+" : ""}${formatNumber(active.delta, reading?.unit)}`; $("#elapsed-time").textContent = active ? `${Math.max(0, (Date.now() - new Date(active.startedAt).getTime()) / 1000).toFixed(1)} s` : "0.0 s"; $("#sample-count").textContent = String(active?.sampleCount || 0); $("#signal-quality").textContent = (active?.signalQuality || "WAITING").toLowerCase();
  }
  $("#start-investigation").classList.toggle("hidden", session.agentState !== "IDLE"); $("#retry-investigation").classList.toggle("hidden", session.agentState !== "INCONCLUSIVE" || !session.pendingDecision); $("#intervention-action").classList.toggle("hidden", session.agentState !== "WAITING_FOR_INTERVENTION"); $("#download-report").classList.toggle("hidden", !["DIAGNOSIS_READY", "CONFIRMED", "INCONCLUSIVE"].includes(session.agentState)); $("#estop").disabled = !ACTIVE_STATES.has(session.agentState);
  renderGraph(session); renderAnalysis(session); renderSidebar(session);
}

async function runAgentLoop() {
  if (state.loopRunning || !state.session) return; state.loopRunning = true; const token = ++state.loopToken;
  try {
    while (state.session && ACTIVE_STATES.has(state.session.agentState) && token === state.loopToken) {
      const delay = ({ INITIALIZING: 650, WAITING_FOR_USER_STIMULUS: 900, RECORDING: 400, ANALYZING: 850, SELECTING_NEXT_EXPERIMENT: 650, POST_INTERVENTION_VERIFY: 700 })[state.session.agentState] || 700;
      await wait(delay); if (token !== state.loopToken) break;
      render(await api(`/api/sessions/${state.session.id}/investigation/advance`, { method: "POST", body: "{}" }));
    }
  } catch (error) { toast(error.message); }
  finally { state.loopRunning = false; }
}
function connectEvents(id) { state.events?.close(); state.events = new EventSource(`/api/sessions/${id}/events`); state.events.addEventListener("timeline", async () => { if (state.loopRunning) return; try { render(await api(`/api/sessions/${id}`)); } catch (error) { toast(error.message); } }); }
function refreshTargets(context) { const targets = context.expectedBehavior?.subjectDeviceIds || []; $("#target-device").innerHTML = targets.map((id) => { const item = context.components.find((component) => component.id === id); return `<option value="${escapeHtml(id)}">${escapeHtml(item?.label || id)} · suspect</option>`; }).join(""); }

function applyTheme(theme) { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle("dark", theme === "dark"); localStorage.setItem("ahea-theme", theme); $("#theme-toggle").setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme"); if (state.session) renderGraph(state.session); }
applyTheme(document.documentElement.dataset.theme);
$("#theme-toggle").addEventListener("click", async (event) => {
  const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) { applyTheme(theme); return; }
  const x = event.clientX; const y = event.clientY; const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const transition = document.startViewTransition(() => applyTheme(theme)); await transition.ready;
  document.documentElement.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] }, { duration: 460, easing: "cubic-bezier(.2,.8,.2,1)", pseudoElement: "::view-transition-new(root)" });
});
$("#brand-home").addEventListener("click", (event) => { if (state.session && ACTIVE_STATES.has(state.session.agentState) && !confirm("Leave this active investigation? The current bounded read will stop advancing.")) event.preventDefault(); });
$("#mode").addEventListener("change", (event) => { $("#fixture-field").classList.toggle("hidden", event.target.value === "physical"); });
$("#project-context").addEventListener("change", () => { try { refreshTargets(JSON.parse($("#project-context").value)); } catch { /* Server validation provides the actionable error. */ } });
$("#start-form").addEventListener("submit", async (event) => { event.preventDefault(); try { const projectContext = JSON.parse($("#project-context").value); let session = await api("/api/sessions", { method: "POST", body: JSON.stringify({ mode: $("#mode").value, fixture: $("#mode").value === "simulation" ? $("#fixture").value : undefined, targetDeviceId: $("#target-device").value, projectContext }) }); session = await api(`/api/sessions/${session.id}/problem`, { method: "POST", body: JSON.stringify({ problem: $("#problem").value }) }); render(session); connectEvents(session.id); } catch (error) { toast(error.message); } });
async function startInvestigation() { try { render(await api(`/api/sessions/${state.session.id}/investigation/start`, { method: "POST", body: "{}" })); void runAgentLoop(); } catch (error) { toast(error.message); } }
$("#start-investigation").addEventListener("click", startInvestigation); $("#retry-investigation").addEventListener("click", startInvestigation);
$("#declare").addEventListener("click", async () => { const recommendationId = state.session?.evidence.recommendations[0]?.id; if (!state.session || !recommendationId) return; try { render(await api(`/api/sessions/${state.session.id}/interventions`, { method: "POST", body: JSON.stringify({ description: $("#intervention").value, recommendationId }) })); void runAgentLoop(); } catch (error) { toast(error.message); } });
$("#estop").addEventListener("click", async () => { if (!state.session || !confirm("Stop all active hardware operations and end this investigation?")) return; state.loopToken += 1; try { render(await api(`/api/sessions/${state.session.id}/emergency-stop`, { method: "POST", body: "{}" })); } catch (error) { toast(error.message); } });
$("#download-report").addEventListener("click", async () => { try { const report = await api(`/api/sessions/${state.session.id}/report`); const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `ahea-report-${state.session.id}.json`; anchor.click(); URL.revokeObjectURL(url); } catch (error) { toast(error.message); } });
window.addEventListener("resize", () => { if (state.session) renderGraph(state.session); });
api("/api/project-context/default").then((context) => { $("#project-context").value = JSON.stringify(context, null, 2); refreshTargets(context); }).catch((error) => toast(error.message));
