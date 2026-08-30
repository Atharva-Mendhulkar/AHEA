const $ = (selector) => document.querySelector(selector);
const state = {
  contexts: {}, simulationCatalog: null, session: null, events: null,
  automation: { timer: null, ticker: null, decisionId: null, deadline: 0, paused: false, executing: false },
};
const simulationActionWindowMs = 4000;
let graphFrame;

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const body = await response.json(); if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`); return body;
}
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }
function toast(message) { const node = $("#toast"); node.textContent = message; node.classList.add("show"); setTimeout(() => node.classList.remove("show"), 3500); }
function formatState(value) { return String(value || "—").replaceAll("_", " "); }
function terminal(session) { return ["CONCLUDED_NORMAL", "INCONCLUSIVE", "CONFIRMED", "FAILED_VERIFICATION", "INTERRUPTED", "ESTOPPED"].includes(session.lifecycle); }
function setMetric(selector, value) {
  const node = $(selector); const text = String(value ?? "—"); node.title = text;
  node.innerHTML = escapeHtml(text).replaceAll("_", "_<wbr>").replaceAll(".", ".<wbr>");
}

function updateProfile() {
  const kind = $("#profile").value; const context = state.contexts[kind]; if (!context) return;
  $("#project-context").value = JSON.stringify(context, null, 2);
  const scenario = state.simulationCatalog?.scenarios?.[kind];
  $("#simulation-condition").innerHTML = (scenario?.conditions || ["normal"]).map((value) => `<option value="${value}">${formatState(value)}</option>`).join("");
  const captures = state.simulationCatalog?.captures?.filter((entry) => entry.profileKind === kind) || [];
  $("#replay-capture").innerHTML = captures.length ? captures.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.id)} · ${entry.plans.length} plans</option>`).join("") : `<option value="">No imported captures</option>`;
  updateScenarioControl();
  $("#problem").value = kind === "loopback" ? "The destination waveform is missing. Determine whether the protected path is open." : `Characterize the ${context.project.name} profile and report whether the bounded evidence is normal or inconclusive.`;
  updateModeGuidance();
}

function updateScenarioControl() {
  const controls = state.simulationCatalog?.scenarios?.[$("#profile").value]?.controls || [];
  $("#scenario-controls").innerHTML = controls.map((control) => `<label class="field">${escapeHtml(control.label)}<input data-scenario-key="${escapeHtml(control.key)}" type="number" min="${control.minimum}" max="${control.maximum}" step="${control.step}" value="${control.defaultValue}"><small>${control.minimum} to ${control.maximum}</small></label>`).join("");
}

function updateSimulationEngine() {
  const simulation = $("#mode").value === "simulation"; const replay = $("#simulation-engine").value === "replay";
  $("#simulation-fields").classList.toggle("hidden", !simulation); $("#generated-fields").classList.toggle("hidden", replay); $("#seed-field").classList.toggle("hidden", replay); $("#replay-field").classList.toggle("hidden", !replay);
  updateModeGuidance();
}

function updateModeGuidance() {
  const physical = $("#mode").value === "physical";
  $("#create-session").textContent = physical ? "Connect ESP32-S3 and create session" : "Create evidence session";
  $("#mode-guidance").innerHTML = physical
    ? "<strong>Physical mode.</strong> AHEA will connect to the configured ESP32-S3 and run registered hardware captures."
    : "<strong>Simulation mode.</strong> Use generated or replayed evidence without controlling physical hardware.";
}

function copyFor(session) {
  if (session.lifecycle === "DIAGNOSIS_READY") return ["Diagnosis ready", "The evidence supports a bounded human repair.", "Review the recommendation and safety constraints before declaring a change."];
  if (session.lifecycle === "CONCLUDED_NORMAL") return ["Concluded normal", "The tested behavior met the declared bounds.", "No modification was invented; this conclusion applies only to the registered conditions."];
  if (session.lifecycle === "INCONCLUSIVE") return ["Investigation inconclusive", session.failureReason || "The bounded evidence cannot support a repair claim.", "Review limitations and the audit trail."];
  if (session.lifecycle === "CONFIRMED") return ["Repair confirmed", "Two consecutive physical verification runs passed.", "Confirmation applies only to the declared plan and conditions."];
  if (session.lifecycle === "FAILED_VERIFICATION") return ["Verification failed", session.failureReason, "Open a new investigation before attempting another repair."];
  if (session.lifecycle === "VERIFYING") return ["Verifying intervention", "A fresh post-intervention run is ready.", "Two consecutive physical passes are required for confirmation."];
  if (session.pendingDecision) return [session.agentState === "IDLE" ? "Ready to investigate" : "Experiment selected", session.pendingDecision.experiment.label, session.pendingDecision.rationale];
  return ["Preparing", "The backend is evaluating the next safe action.", "Evidence rules and lifecycle remain deterministic."];
}

function renderStatements(selector, entries, empty) { $(selector).innerHTML = entries.length ? entries.map((entry) => `<article class="statement"><p>${escapeHtml(entry.text)}</p>${entry.observationIds?.length ? `<small>${escapeHtml(entry.observationIds.join(", "))}</small>` : ""}</article>`).join("") : `<p class="empty-copy">${escapeHtml(empty)}</p>`; }

function drawGraph(session) {
  cancelAnimationFrame(graphFrame); const canvas = $("#state-graph"); const ratio = window.devicePixelRatio || 1; const width = Math.max(canvas.clientWidth, 320); const height = Math.max(canvas.clientHeight, 190); canvas.width = width * ratio; canvas.height = height * ratio; const context = canvas.getContext("2d"); context.scale(ratio, ratio);
  const latest = [...session.observations].reverse().find((entry) => entry.series?.some((item) => item.values?.length)); const series = latest?.series?.filter((item) => item.values?.length) || []; $("#graph-mode").textContent = latest ? `${latest.source}${latest.simulation ? `/${latest.simulation.engine}` : ""} · ${latest.planId}` : "Waiting";
  if (!series.length) { $("#graph-empty").hidden = false; $("#graph-legend").innerHTML = ""; context.clearRect(0, 0, width, height); return; } $("#graph-empty").hidden = true;
  const css = getComputedStyle(document.documentElement); const colors = ["--accent", "--success", "--warning", "--danger"].map((name) => css.getPropertyValue(name).trim());
  $("#graph-legend").innerHTML = series.map((item, index) => `<span><i class="legend-line" style="background:${escapeHtml(colors[index % colors.length])}"></i>${escapeHtml(formatState(item.channel))} · ${escapeHtml(item.values.at(-1))} ${escapeHtml(item.unit)}</span>`).join("");
  const left = 18, right = 12, top = 42, bottom = 24, plotWidth = width - left - right, plotHeight = height - top - bottom; const started = performance.now();
  const paint = (now) => {
    const progress = Math.min(1, (now - started) / 420); context.clearRect(0, 0, width, height);
    series.forEach((item, seriesIndex) => {
      const minimum = item.unit === "logic" ? 0 : Math.min(...item.values); const maximum = item.unit === "logic" ? 1 : Math.max(...item.values); const padding = maximum === minimum ? Math.max(Math.abs(maximum) * .08, 1) : (maximum - minimum) * .08; const low = minimum - padding; const high = maximum + padding;
      const visible = Math.max(1, Math.ceil(item.values.length * progress)); context.strokeStyle = colors[seriesIndex % colors.length]; context.lineWidth = 2.2; context.lineJoin = "round"; context.beginPath();
      item.values.slice(0, visible).forEach((value, index) => { const x = left + index / Math.max(item.values.length - 1, 1) * plotWidth; const y = top + (high - value) / Math.max(high - low, 1) * plotHeight; index ? context.lineTo(x, y) : context.moveTo(x, y); }); context.stroke();
    });
    if (progress < 1) graphFrame = requestAnimationFrame(paint);
  };
  graphFrame = requestAnimationFrame(paint);
}

function renderMeasurements(session) {
  const latest = session.observations.at(-1); const measurements = latest?.measurements || [];
  $("#live-measurements").innerHTML = measurements.length ? measurements.slice(0, 6).map((entry) => {
    const value = `${entry.value}${entry.unit ? ` ${entry.unit}` : ""}`;
    return `<div class="live-measurement" title="${escapeHtml(`${entry.channel}: ${value}`)}"><span>${escapeHtml(formatState(entry.channel))}</span><strong>${escapeHtml(value)}</strong></div>`;
  }).join("") : `<p class="empty-copy">Live measurements will appear after the first capture.</p>`;
}

function clearAutomationTimers() {
  clearTimeout(state.automation.timer); clearInterval(state.automation.ticker);
  state.automation.timer = null; state.automation.ticker = null; state.automation.deadline = 0;
}

function updateAutomationStatus() {
  const status = $("#auto-run-status"); const toggle = $("#auto-run-toggle");
  if (!state.session || state.session.mode !== "simulation") return;
  if (state.automation.executing) status.textContent = "Capturing data…";
  else if (state.automation.paused) status.textContent = "Automation paused";
  else if (state.automation.deadline) status.textContent = `Automatic capture in ${Math.max(1, Math.ceil((state.automation.deadline - Date.now()) / 1000))}s`;
  else status.textContent = "Automatic capture";
  toggle.textContent = state.automation.paused ? "Resume automation" : "Pause automation";
  toggle.disabled = state.automation.executing;
}

function syncSimulationAutomation(session) {
  const eligible = session.mode === "simulation" && session.pendingDecision && session.agentState !== "IDLE" && !terminal(session) && session.lifecycle !== "DIAGNOSIS_READY";
  if (!eligible) {
    clearAutomationTimers(); state.automation.decisionId = null;
    return;
  }
  if (state.automation.executing || state.automation.paused || state.automation.decisionId === session.pendingDecision.id) { updateAutomationStatus(); return; }
  clearAutomationTimers(); state.automation.decisionId = session.pendingDecision.id; state.automation.deadline = Date.now() + simulationActionWindowMs;
  updateAutomationStatus(); state.automation.ticker = setInterval(updateAutomationStatus, 250);
  state.automation.timer = setTimeout(() => executeSelected({ automatic: true, decisionId: session.pendingDecision.id }), simulationActionWindowMs);
}

function toggleSimulationAutomation() {
  if (!state.session || state.session.mode !== "simulation") return;
  state.automation.paused = !state.automation.paused; clearAutomationTimers(); state.automation.decisionId = null;
  updateAutomationStatus(); if (!state.automation.paused) syncSimulationAutomation(state.session);
}

function render(session) {
  state.session = session; $("#setup").classList.add("hidden"); $("#workspace").classList.remove("hidden");
  $("#mode-badge").textContent = session.mode; $("#mode-badge").dataset.tone = session.mode === "simulation" ? "warning" : "success"; $("#connection-badge").textContent = session.hardware.connected ? "Connected" : "Disconnected";
  $("#project-name").textContent = session.projectContext.project.name; $("#problem-summary").textContent = session.problem || session.projectContext.project.goal; $("#lifecycle-pill").textContent = formatState(session.lifecycle); $("#lifecycle-pill").dataset.state = session.lifecycle.toLowerCase();
  $("#agent-source").textContent = session.fallbackUsed ? "Deterministic selector" : "Model selector"; $("#agent-console").dataset.agentState = session.agentState;
  const [label, message, detail] = copyFor(session); $("#agent-state-label").textContent = label; $("#agent-message").textContent = message; $("#agent-detail").textContent = detail;
  $("#agent-orb").className = `agent-orb ${terminal(session) ? "complete" : session.lifecycle === "READY" ? "idle" : "active"}`;
  $("#evidence-badge").textContent = formatState(session.evidence.state); setMetric("#selected-plan", session.pendingDecision?.experiment.planId || "—"); setMetric("#evidence-state", session.evidence.state); setMetric("#confidence-inline", session.evidence.confidence); setMetric("#experiment-count", `${session.experimentsExecuted} / ${session.projectContext.constraints.maximumExperiments}`); setMetric("#verification-count", `${session.evidence.verification.consecutivePasses} / ${session.evidence.verification.requiredConsecutivePasses}`); setMetric("#registry-digest", session.hardware.registry.digest.slice(0, 10)); $("#registry-digest").title = session.hardware.registry.digest;
  renderStatements("#observed", session.evidence.observed, "No controlled observation yet."); renderStatements("#inference", session.evidence.inferences, "No inference until evidence is sufficient.");
  $("#hypotheses").innerHTML = session.evidence.hypotheses.length ? session.evidence.hypotheses.map((entry) => { const explanation = entry.reasons[0] || entry.limitations[0] || "No supporting evidence yet."; return `<article class="hypothesis" title="${escapeHtml(explanation)}"><div><strong>${escapeHtml(entry.label)}</strong><small>${escapeHtml(explanation)}</small></div><span class="hypothesis-status" data-status="${entry.status}">${entry.status}</span></article>`; }).join("") : `<p class="empty-copy">This optional profile reports deterministic observations without a repair hypothesis.</p>`;
  const recommendation = session.evidence.recommendations[0]; const verification = session.evidence.verification; const verificationTone = verification.status === "PASSED" ? "success" : verification.status === "FAILED" ? "danger" : verification.status === "PENDING" || verification.status === "SIMULATED_PASS" ? "warning" : ""; const repairClaim = recommendation ? (verification.status === "NOT_RUN" ? "Repair claim not yet verified." : verification.summary) : "No repair claim requires verification."; const remainingPasses = Math.max(0, verification.requiredConsecutivePasses - verification.consecutivePasses); const nextRequirement = session.lifecycle === "DIAGNOSIS_READY" ? "Next: declare the completed human intervention before verification." : session.lifecycle === "VERIFYING" ? `Next: ${remainingPasses} consecutive physical passing run${remainingPasses === 1 ? "" : "s"} required.` : "";
  $("#verification").innerHTML = `<div class="verification-summary"><div class="verification-count"><strong>${verification.consecutivePasses} / ${verification.requiredConsecutivePasses}</strong><span>passes</span></div><span class="badge"${verificationTone ? ` data-tone="${verificationTone}"` : ""}>${escapeHtml(formatState(verification.status))}</span><p class="verification-copy"><strong>Repair claim:</strong> ${escapeHtml(repairClaim)}</p>${nextRequirement ? `<p class="verification-next">${escapeHtml(nextRequirement)}</p>` : ""}</div>`;
  const evidenceConclusion = session.evidence.conclusion || { disposition: terminal(session) ? "INCONCLUSIVE" : "PENDING", headline: session.evidence.inferences.at(-1)?.text || session.failureReason || message, summary: "This legacy session does not contain a structured use verdict.", adjustments: [], observationIds: session.evidence.assessments.map((entry) => entry.observationId) };
  const failedAfterAdjustment = session.lifecycle === "FAILED_VERIFICATION"; const displayDisposition = failedAfterAdjustment ? "DO_NOT_USE" : evidenceConclusion.disposition; const conclusion = failedAfterAdjustment ? "The adjustment failed verification. Do not use this setup." : evidenceConclusion.headline; const conclusionTone = displayDisposition === "READY_TO_USE" ? "success" : displayDisposition === "DO_NOT_USE" ? "danger" : "warning";
  const jugaadTitle = displayDisposition === "READY_TO_USE" ? "No Jugaad needed" : displayDisposition === "DO_NOT_USE" ? "No unsafe Jugaad" : displayDisposition === "ADJUST_AND_RETEST" ? "Apply these adjustments, then retest" : "Retest before attempting an adjustment";
  const jugaadSteps = evidenceConclusion.adjustments.length ? `<ul class="jugaad-steps">${evidenceConclusion.adjustments.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ul>` : `<p>${displayDisposition === "READY_TO_USE" ? "Use the device as-is within the tested profile and stated limitations." : "Collect a complete, consistent evidence set before changing hardware."}</p>`;
  $("#recommendation").innerHTML = recommendation ? `<article class="recommendation-card"><header class="recommendation-header"><p class="eyebrow">JUGAAD / PRACTICAL ADJUSTMENT</p><span class="badge" data-tone="warning">${recommendation.confidence}</span></header><div class="recommendation-change"><h3>${escapeHtml(recommendation.action)}</h3><p><strong>Evidence:</strong> ${escapeHtml(recommendation.basis)}</p></div><div class="recommendation-details"><p><span>Expected effect</span>${escapeHtml(recommendation.expectedEffect)}</p><p><span>Verification</span><b title="${escapeHtml(recommendation.verificationPlanId)}">${escapeHtml(recommendation.verificationPlanId)}</b></p><p><span>Safety</span>${escapeHtml(recommendation.safetyConstraints.join(" "))}</p></div></article>` : `<article class="recommendation-card jugaad-card" data-tone="${conclusionTone}"><header class="recommendation-header"><p class="eyebrow">JUGAAD / PRACTICAL ADJUSTMENT</p><span class="badge" data-tone="${conclusionTone}">${escapeHtml(formatState(displayDisposition))}</span></header><div class="recommendation-change"><h3>${escapeHtml(jugaadTitle)}</h3>${jugaadSteps}</div></article>`;
  const repairVerified = session.lifecycle === "CONFIRMED" && verification.status === "PASSED";
  const hasOutcome = !repairVerified && (Boolean(recommendation) || terminal(session)); const conclusionReferences = evidenceConclusion.observationIds;
  $("#outcome-region").classList.toggle("hidden", !hasOutcome); $("#diagnostic-workspace").classList.toggle("outcome-ready", hasOutcome); $("#recommendation-region").classList.toggle("hidden", !hasOutcome);
  $("#conclusion-card").dataset.tone = conclusionTone; $("#conclusion").textContent = conclusion; $("#conclusion-confidence").textContent = formatState(displayDisposition); $("#conclusion-confidence").dataset.tone = conclusionTone; $("#conclusion-basis").textContent = `${evidenceConclusion.summary} ${conclusionReferences.length ? `Supported by ${conclusionReferences.length} accepted observation${conclusionReferences.length === 1 ? "" : "s"}. ` : ""}Confidence: ${formatState(session.evidence.confidence)}.`;
  $("#context-title").textContent = session.projectContext.profile.moduleId; $("#context-facts").innerHTML = [["Target", session.targetId], ["Profile", session.projectContext.profile.kind], ["Context", session.projectContextDigest.slice(0, 12)], ["Reference", session.projectContext.procedures.reference?.kind || "none"]].map(([key, value]) => `<div><span>${key}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  $("#hardware-title").textContent = session.hardware.boardIdentity; $("#hardware-health").classList.toggle("online", session.hardware.connected); $("#hardware-facts").innerHTML = [["Firmware", session.hardware.firmwareVersion], ["Protocol", session.hardware.protocolVersion], ["Profile", session.hardware.profileId], ["Mode", session.mode], ...(session.simulation ? [["Engine", session.simulation.engine], ["Seed", session.simulation.seed], ["Calibration", formatState(session.simulation.calibration.status)]] : [])].map(([key, value]) => `<div><span>${key}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  $("#plan-list").innerHTML = session.hardware.registry.plans.map((entry) => `<div class="plan-row"><span>${escapeHtml(entry.label)}</span><code>${escapeHtml(entry.id)}</code></div>`).join("");
  $("#event-count").textContent = session.timeline.length; $("#timeline").innerHTML = [...session.timeline].reverse().map((event) => `<div class="timeline-item"><time>${new Date(event.at).toLocaleTimeString()}</time><div><strong>${escapeHtml(event.type.replaceAll(".", " "))}</strong><p>${escapeHtml(event.summary)}</p></div></div>`).join("");
  const pendingPrompt = session.pendingDecision?.experiment.operatorPrompt || "Confirm the declared setup before capture."; $("#operator-prompt").textContent = pendingPrompt; $("#confirmation-label").textContent = session.pendingDecision?.experiment.confirmationLabel || "Fixture matches the declared setup"; $("#simulation-prompt-note").hidden = session.mode !== "simulation";
  $("#start-investigation").classList.toggle("hidden", session.mode === "simulation" || !(session.lifecycle === "INVESTIGATING" && session.agentState === "IDLE")); $("#execute-action").classList.toggle("hidden", !session.pendingDecision || session.agentState === "IDLE"); $("#physical-execution-controls").classList.toggle("hidden", session.mode === "simulation"); $("#auto-run-status").classList.toggle("hidden", session.mode !== "simulation"); $("#auto-run-toggle").classList.toggle("hidden", session.mode !== "simulation"); $("#intervention-action").classList.toggle("hidden", session.lifecycle !== "DIAGNOSIS_READY"); $("#download-report").disabled = session.observations.length === 0; $("#estop").disabled = terminal(session) || session.lifecycle === "READY";
  renderMeasurements(session); drawGraph(session); syncSimulationAutomation(session);
}

async function createSession(event) {
  event.preventDefault();
  try {
    clearAutomationTimers(); state.automation = { timer: null, ticker: null, decisionId: null, deadline: 0, paused: false, executing: false };
    const context = JSON.parse($("#project-context").value); const mode = $("#mode").value; let simulation;
    if (mode === "simulation") { const engine = $("#simulation-engine").value; const controls = Object.fromEntries([...document.querySelectorAll("[data-scenario-key]")].map((input) => [input.dataset.scenarioKey, Number(input.value)])); simulation = engine === "replay" ? { engine, replayCaptureId: $("#replay-capture").value } : { engine, seed: $("#simulation-seed").value || undefined, scenario: { condition: $("#simulation-condition").value, ...controls } }; }
    const session = await api("/api/sessions", { method: "POST", body: JSON.stringify({ mode, simulation, projectContext: context }) }); let submitted = await api(`/api/sessions/${session.id}/problem`, { method: "POST", body: JSON.stringify({ problem: $("#problem").value }) });
    if (submitted.mode === "simulation") submitted = await api(`/api/sessions/${submitted.id}/investigation/start`, { method: "POST", body: "{}" });
    render(submitted); $("#setup-confirmed").checked = false; connectEvents(submitted.id);
  } catch (error) { toast(error.message); }
}
async function startInvestigation() { try { render(await api(`/api/sessions/${state.session.id}/investigation/start`, { method: "POST", body: "{}" })); } catch (error) { toast(error.message); } }
async function executeSelected({ automatic = false, decisionId } = {}) {
  const pending = state.session?.pendingDecision; if (!pending || (decisionId && pending.id !== decisionId) || state.automation.executing) return;
  const simulationAutomatic = automatic && state.session.mode === "simulation";
  try {
    const confirmed = simulationAutomatic || $("#setup-confirmed").checked; if (!confirmed) throw new Error("Complete and confirm the operator action before capture.");
    if (simulationAutomatic) { clearAutomationTimers(); state.automation.executing = true; updateAutomationStatus(); }
    const prompt = pending.experiment.operatorPrompt || "Declared fixture setup completed."; const declaration = simulationAutomatic ? `Scripted simulation action window completed: ${prompt}` : `${prompt} Operator confirmed completion.`;
    const updated = await api(`/api/sessions/${state.session.id}/decisions/${pending.id}/execute`, { method: "POST", body: JSON.stringify({ expectedVersion: state.session.version, setupConfirmed: confirmed, setupDeclaration: declaration }) });
    state.automation.executing = false; state.automation.decisionId = null; render(updated); $("#setup-confirmed").checked = false;
  } catch (error) {
    state.automation.executing = false; if (simulationAutomatic) state.automation.paused = true; updateAutomationStatus(); toast(error.message);
  }
}
async function declareIntervention() { try { const recommendation = state.session.evidence.recommendations[0]; if (!recommendation) return; render(await api(`/api/sessions/${state.session.id}/interventions`, { method: "POST", body: JSON.stringify({ description: $("#intervention").value, recommendationId: recommendation.id, safetyConfirmed: $("#safety-confirmed").checked }) })); } catch (error) { toast(error.message); } }
async function stopSession() { clearAutomationTimers(); state.automation.paused = true; try { render(await api(`/api/sessions/${state.session.id}/emergency-stop`, { method: "POST", body: "{}" })); } catch (error) { toast(error.message); } }
async function downloadReport() { try { const report = await api(`/api/sessions/${state.session.id}/report`); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" })); link.download = `ahea-${state.session.id}.json`; link.click(); URL.revokeObjectURL(link.href); } catch (error) { toast(error.message); } }
function connectEvents(id) { state.events?.close(); state.events = new EventSource(`/api/sessions/${id}/events`); state.events.addEventListener("snapshot", (event) => render(JSON.parse(event.data))); state.events.addEventListener("timeline", async () => { try { render(await api(`/api/sessions/${id}`)); } catch {} }); }
function toggleTheme() { const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = next; document.documentElement.classList.toggle("dark", next === "dark"); localStorage.setItem("ahea-theme", next); if (state.session) drawGraph(state.session); }

$("#start-form").addEventListener("submit", createSession); $("#profile").addEventListener("change", updateProfile); $("#mode").addEventListener("change", updateSimulationEngine); $("#simulation-engine").addEventListener("change", updateSimulationEngine); $("#simulation-condition").addEventListener("change", updateScenarioControl); $("#start-investigation").addEventListener("click", startInvestigation); $("#execute").addEventListener("click", () => executeSelected()); $("#auto-run-toggle").addEventListener("click", toggleSimulationAutomation); $("#declare").addEventListener("click", declareIntervention); $("#estop").addEventListener("click", stopSession); $("#download-report").addEventListener("click", downloadReport); $("#theme-toggle").addEventListener("click", toggleTheme); $("#brand-home").addEventListener("click", () => { clearAutomationTimers(); state.events?.close(); }); window.addEventListener("resize", () => state.session && drawGraph(state.session));
Promise.all([api("/api/project-contexts"), api("/api/simulation/catalog")]).then(([contexts, catalog]) => { state.contexts = contexts; state.simulationCatalog = catalog; updateProfile(); updateSimulationEngine(); }).catch((error) => toast(error.message));
