const $ = (selector) => document.querySelector(selector);
const state = { contexts: {}, session: null, events: null };
const loopbackFixtures = ["loopback_open", "loopback_intact", "loopback_distorted", "loopback_stimulus_fault", "loopback_conflicting", "loopback_verification_failure"];
const sensorFixtures = ["sensor_normal", "sensor_fault"];

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const body = await response.json(); if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`); return body;
}
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }
function toast(message) { const node = $("#toast"); node.textContent = message; node.classList.add("show"); setTimeout(() => node.classList.remove("show"), 3500); }
function formatState(value) { return String(value || "—").replaceAll("_", " "); }
function terminal(session) { return ["CONCLUDED_NORMAL", "INCONCLUSIVE", "CONFIRMED", "FAILED_VERIFICATION", "INTERRUPTED", "ESTOPPED"].includes(session.lifecycle); }

function updateProfile() {
  const kind = $("#profile").value; const context = state.contexts[kind]; if (!context) return;
  $("#project-context").value = JSON.stringify(context, null, 2);
  const fixtures = kind === "loopback" ? loopbackFixtures : sensorFixtures;
  $("#fixture").innerHTML = fixtures.map((value) => `<option value="${value}">${formatState(value)}</option>`).join("");
  $("#problem").value = kind === "loopback" ? "The destination waveform is missing. Determine whether the protected path is open." : `Characterize the ${context.project.name} profile and report whether the bounded evidence is normal or inconclusive.`;
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
  const canvas = $("#state-graph"); const ratio = window.devicePixelRatio || 1; const width = Math.max(canvas.clientWidth, 320); const height = Math.max(canvas.clientHeight, 190); canvas.width = width * ratio; canvas.height = height * ratio; const context = canvas.getContext("2d"); context.scale(ratio, ratio); context.clearRect(0, 0, width, height);
  const latest = [...session.observations].reverse().find((entry) => entry.series?.length); const series = latest?.series?.[0]; $("#graph-mode").textContent = latest ? `${latest.source} · ${latest.planId}` : "Waiting";
  if (!series?.values?.length) {
    const latestMeasurement = latest?.measurements?.find((entry) => typeof entry.value === "number");
    if (!latestMeasurement) { $("#graph-empty").hidden = false; return; }
    series = { values: [Number(latestMeasurement.value)], channel: latestMeasurement.channel, unit: latestMeasurement.unit };
    $("#graph-mode").textContent = `${latest.source} · ${latest.planId} · ${latestMeasurement.channel}`;
  }
  $("#graph-empty").hidden = true;
  const css = getComputedStyle(document.documentElement); context.strokeStyle = css.getPropertyValue("--accent").trim(); context.lineWidth = 2.2; const numeric = series.values.map(Number); const low = Math.min(...numeric); const high = Math.max(...numeric); const span = high - low || Math.max(Math.abs(high), 1); context.beginPath(); numeric.forEach((value, index) => { const x = index / Math.max(numeric.length - 1, 1) * width; const y = height - 28 - ((value - low) / span) * (height - 56); index ? context.lineTo(x, y) : context.moveTo(x, y); }); context.stroke();
}

function render(session) {
  state.session = session; $("#setup").classList.add("hidden"); $("#workspace").classList.remove("hidden");
  $("#mode-badge").textContent = session.mode; $("#mode-badge").dataset.tone = session.mode === "simulation" ? "warning" : "success"; $("#connection-badge").textContent = session.hardware.connected ? "Connected" : "Disconnected";
  $("#project-name").textContent = session.projectContext.project.name; $("#problem-summary").textContent = session.problem || session.projectContext.project.goal; $("#lifecycle-pill").textContent = formatState(session.lifecycle); $("#lifecycle-pill").dataset.state = session.lifecycle.toLowerCase();
  $("#agent-source").textContent = session.fallbackUsed ? "Deterministic selector" : "Model selector"; $("#agent-console").dataset.agentState = session.agentState;
  const [label, message, detail] = copyFor(session); $("#agent-state-label").textContent = label; $("#agent-message").textContent = message; $("#agent-detail").textContent = detail;
  $("#agent-orb").className = `agent-orb ${terminal(session) ? "complete" : session.lifecycle === "READY" ? "idle" : "active"}`;
  $("#evidence-badge").textContent = formatState(session.evidence.state); $("#selected-plan").textContent = session.pendingDecision?.experiment.planId || "—"; $("#evidence-state").textContent = formatState(session.evidence.state); $("#confidence-inline").textContent = session.evidence.confidence; $("#experiment-count").textContent = `${session.experimentsExecuted} / ${session.projectContext.constraints.maximumExperiments}`; $("#verification-count").textContent = `${session.evidence.verification.consecutivePasses} / ${session.evidence.verification.requiredConsecutivePasses}`; $("#registry-digest").textContent = session.hardware.registry.digest.slice(0, 10);
  renderStatements("#observed", session.evidence.observed, "No controlled observation yet."); renderStatements("#inference", session.evidence.inferences, "No inference until evidence is sufficient.");
  $("#hypotheses").innerHTML = session.evidence.hypotheses.length ? session.evidence.hypotheses.map((entry) => `<div class="hypothesis"><div><strong>${escapeHtml(entry.label)}</strong><small>${escapeHtml(entry.reasons[0] || entry.limitations[0] || "No supporting evidence yet.")}</small></div><span class="hypothesis-status" data-status="${entry.status}">${entry.status}</span></div>`).join("") : `<p class="empty-copy">This optional profile reports deterministic observations without a repair hypothesis.</p>`;
  $("#verification").innerHTML = `<article class="statement"><p>${escapeHtml(session.evidence.verification.summary)}</p><small>${escapeHtml(session.evidence.verification.status)}</small></article>`;
  const recommendation = session.evidence.recommendations[0]; $("#recommendation").innerHTML = recommendation ? `<article class="recommendation-card"><header class="recommendation-header"><p class="eyebrow">RECOMMENDATION</p><span class="badge" data-tone="warning">${recommendation.confidence}</span></header><h3>${escapeHtml(recommendation.action)}</h3><p>${escapeHtml(recommendation.basis)}</p><div class="recommendation-details"><p><span>Expected effect</span>${escapeHtml(recommendation.expectedEffect)}</p><p><span>Verification plan</span>${escapeHtml(recommendation.verificationPlanId)}</p><p><span>Safety</span>${escapeHtml(recommendation.safetyConstraints.join(" "))}</p></div></article>` : "";
  $("#context-title").textContent = session.projectContext.profile.moduleId; $("#context-facts").innerHTML = [["Target", session.targetId], ["Profile", session.projectContext.profile.kind], ["Context", session.projectContextDigest.slice(0, 12)], ["Reference", session.projectContext.procedures.reference?.kind || "none"]].map(([key, value]) => `<div><span>${key}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  $("#hardware-title").textContent = session.hardware.boardIdentity; $("#hardware-health").classList.toggle("online", session.hardware.connected); $("#hardware-facts").innerHTML = [["Firmware", session.hardware.firmwareVersion], ["Protocol", session.hardware.protocolVersion], ["Profile", session.hardware.profileId], ["Mode", session.mode]].map(([key, value]) => `<div><span>${key}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  $("#plan-list").innerHTML = session.hardware.registry.plans.map((entry) => `<div class="plan-row"><span>${escapeHtml(entry.label)}</span><code>${escapeHtml(entry.id)}</code></div>`).join("");
  $("#event-count").textContent = session.timeline.length; $("#timeline").innerHTML = [...session.timeline].reverse().map((event) => `<div class="timeline-item"><time>${new Date(event.at).toLocaleTimeString()}</time><div><strong>${escapeHtml(event.type.replaceAll(".", " "))}</strong><p>${escapeHtml(event.summary)}</p></div></div>`).join("");
  $("#start-investigation").classList.toggle("hidden", !(session.lifecycle === "INVESTIGATING" && session.agentState === "IDLE")); $("#execute-action").classList.toggle("hidden", !session.pendingDecision || session.agentState === "IDLE"); $("#intervention-action").classList.toggle("hidden", session.lifecycle !== "DIAGNOSIS_READY"); $("#download-report").disabled = session.observations.length === 0; $("#estop").disabled = terminal(session) || session.lifecycle === "READY";
  drawGraph(session);
}

async function createSession(event) {
  event.preventDefault();
  try { const context = JSON.parse($("#project-context").value); const session = await api("/api/sessions", { method: "POST", body: JSON.stringify({ mode: $("#mode").value, fixture: $("#mode").value === "simulation" ? $("#fixture").value : undefined, projectContext: context }) }); const submitted = await api(`/api/sessions/${session.id}/problem`, { method: "POST", body: JSON.stringify({ problem: $("#problem").value }) }); render(submitted); $("#setup-confirmed").checked = submitted.mode === "simulation"; connectEvents(submitted.id); } catch (error) { toast(error.message); }
}
async function startInvestigation() { try { render(await api(`/api/sessions/${state.session.id}/investigation/start`, { method: "POST", body: "{}" })); } catch (error) { toast(error.message); } }
async function executeSelected() { try { const pending = state.session.pendingDecision; if (!pending) return; const updated = await api(`/api/sessions/${state.session.id}/decisions/${pending.id}/execute`, { method: "POST", body: JSON.stringify({ expectedVersion: state.session.version, setupConfirmed: $("#setup-confirmed").checked, setupDeclaration: "Operator confirmed the declared fixture and safe power state." }) }); render(updated); $("#setup-confirmed").checked = updated.mode === "simulation"; } catch (error) { toast(error.message); } }
async function declareIntervention() { try { const recommendation = state.session.evidence.recommendations[0]; if (!recommendation) return; render(await api(`/api/sessions/${state.session.id}/interventions`, { method: "POST", body: JSON.stringify({ description: $("#intervention").value, recommendationId: recommendation.id, safetyConfirmed: $("#safety-confirmed").checked }) })); } catch (error) { toast(error.message); } }
async function stopSession() { try { render(await api(`/api/sessions/${state.session.id}/emergency-stop`, { method: "POST", body: "{}" })); } catch (error) { toast(error.message); } }
async function downloadReport() { try { const report = await api(`/api/sessions/${state.session.id}/report`); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" })); link.download = `ahea-${state.session.id}.json`; link.click(); URL.revokeObjectURL(link.href); } catch (error) { toast(error.message); } }
function connectEvents(id) { state.events?.close(); state.events = new EventSource(`/api/sessions/${id}/events`); state.events.addEventListener("snapshot", (event) => render(JSON.parse(event.data))); state.events.addEventListener("timeline", async () => { try { render(await api(`/api/sessions/${id}`)); } catch {} }); }
function toggleTheme() { const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = next; document.documentElement.classList.toggle("dark", next === "dark"); localStorage.setItem("ahea-theme", next); if (state.session) drawGraph(state.session); }

$("#start-form").addEventListener("submit", createSession); $("#profile").addEventListener("change", updateProfile); $("#mode").addEventListener("change", () => $("#fixture-field").classList.toggle("hidden", $("#mode").value !== "simulation")); $("#start-investigation").addEventListener("click", startInvestigation); $("#execute").addEventListener("click", executeSelected); $("#declare").addEventListener("click", declareIntervention); $("#estop").addEventListener("click", stopSession); $("#download-report").addEventListener("click", downloadReport); $("#theme-toggle").addEventListener("click", toggleTheme); $("#brand-home").addEventListener("click", () => state.events?.close()); window.addEventListener("resize", () => state.session && drawGraph(state.session));
api("/api/project-contexts").then((contexts) => { state.contexts = contexts; updateProfile(); }).catch((error) => toast(error.message));
