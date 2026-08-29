const state = { session: null, events: null, cooldownTimer: null };
const $ = (selector) => document.querySelector(selector);
const labels = {
  motor_motion_probe: "Motor motion probe",
  motor_current_probe: "Motor current probe",
  verify_motor: "Motor verification pulse",
};

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 3500);
}

function valueText(value, unit) {
  if (typeof value === "number") return `${Number.isInteger(value) ? value : value.toFixed(3)} ${unit}`;
  return `${value}`;
}

function render(session) {
  state.session = session;
  $("#setup").classList.add("hidden");
  $("#workspace").classList.remove("hidden");
  const physical = session.mode === "physical";
  $("#mode-badge").textContent = physical ? "PHYSICAL" : "SIMULATION";
  $("#mode-badge").className = `badge ${physical ? "physical" : "simulation"}`;
  $("#connection-badge").textContent = session.hardware.connected ? "CONNECTED" : "DISCONNECTED";
  $("#connection-badge").className = `badge ${session.hardware.connected ? "connected" : "neutral"}`;
  $("#lifecycle").textContent = session.lifecycle.replaceAll("_", " ");
  $("#budget").textContent = `${session.totalActivations} / 6`;
  $("#verification").textContent = `${session.consecutiveVerificationPasses} / 2 consecutive`;
  const latestDecision = session.decisions.at(-1);
  $("#agent-source").textContent = latestDecision ? latestDecision.decisionSource.toUpperCase() : "—";
  $("#estop").disabled = session.lifecycle === "ESTOPPED" || session.lifecycle === "CONFIRMED";

  const observation = [...session.observations].reverse().find((item) => item.command !== "sample_motion");
  $("#observation-title").textContent = observation
    ? observation.command === "motor_motion_probe"
      ? (observation.measurements.find((m) => m.name === "expected_motion_signature_detected")?.value ? "Expected motion signature detected" : "Expected motion signature not detected")
      : `${labels[observation.command] || observation.command} completed`
    : "Baseline captured; ready to investigate";
  $("#measurements").innerHTML = observation?.measurements.map((item) => `
    <div class="measurement"><span>${escapeHtml(item.name.replaceAll("_", " "))}</span><strong>${escapeHtml(valueText(item.value, item.unit))}</strong></div>
  `).join("") || `<p class="rationale">No diagnostic motor observation yet.</p>`;

  const pending = session.pendingDecision;
  const cooldownMs = pending?.cooldownReadyAt ? Math.max(0, new Date(pending.cooldownReadyAt).getTime() - Date.now()) : 0;
  $("#decision-title").textContent = pending ? labels[pending.action] : latestDecision ? latestDecision.selectedAction.replaceAll("_", " ") : "No experiment pending";
  $("#decision-rationale").textContent = pending?.rationale || latestDecision?.rationale || "The coordinator is evaluating available evidence.";
  $("#approval-facts").innerHTML = pending ? [
    `Fixed pulse: ${pending.fixedParameters.durationMs} ms`,
    `Current trip: ${pending.fixedParameters.currentLimitMa} mA`,
    `Cooldown: ${cooldownMs > 0 ? `ready in ${(cooldownMs / 1000).toFixed(1)} seconds` : "ready"}`,
    `Activations remaining: ${pending.activationsRemaining}`,
    `Evidence source: ${session.mode}`,
  ].map((line) => `<span>${escapeHtml(line)}</span>`).join("") : "";
  $("#approve").disabled = !pending || cooldownMs > 0;
  clearTimeout(state.cooldownTimer);
  if (pending && cooldownMs > 0) {
    state.cooldownTimer = setTimeout(async () => {
      try { render(await api(`/api/sessions/${session.id}`)); } catch (error) { toast(error.message); }
    }, cooldownMs + 50);
  }
  $("#declare").disabled = session.lifecycle !== "AWAITING_INTERVENTION";

  $("#confidence").textContent = session.evidence.confidenceLabel;
  $("#hypotheses").innerHTML = session.evidence.hypotheses.map((item) => `
    <div class="hypothesis">
      <div><strong>${escapeHtml(item.hypothesis.replaceAll("_", " "))}</strong><br><small>${escapeHtml(item.reasons[0] || "No valid supporting evidence yet.")}</small></div>
      <div class="score">${item.support}/100</div>
    </div>
  `).join("");

  $("#timeline").innerHTML = [...session.timeline].reverse().map((event) => `
    <li><strong>${escapeHtml(event.summary)}</strong><time>${new Date(event.at).toLocaleTimeString()} · ${escapeHtml(event.type)}</time></li>
  `).join("");

  const terminal = ["CONFIRMED", "FAILED", "INTERRUPTED", "ESTOPPED"].includes(session.lifecycle);
  $("#report-title").textContent = session.lifecycle === "CONFIRMED" ? "CONFIRMED: motor power path restored" : terminal ? session.lifecycle : "Investigation in progress";
  $("#report").innerHTML = `
    <p><strong>Source:</strong> ${escapeHtml(session.mode)}</p>
    <p><strong>Calibration:</strong> ${escapeHtml(session.calibration.id)}</p>
    <p><strong>Evidence state:</strong> ${escapeHtml(session.evidence.evidenceState.replaceAll("_", " "))}</p>
    ${session.failureReason ? `<p><strong>Outcome:</strong> ${escapeHtml(session.failureReason)}</p>` : ""}
    <p class="rationale">${escapeHtml(session.evidence.limitations.join(" "))}</p>`;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value);
  return div.innerHTML;
}

function connectEvents(sessionId) {
  state.events?.close();
  state.events = new EventSource(`/api/sessions/${sessionId}/events`);
  state.events.addEventListener("timeline", async () => {
    try { render(await api(`/api/sessions/${sessionId}`)); } catch (error) { toast(error.message); }
  });
}

$("#mode").addEventListener("change", (event) => {
  $("#fixture").disabled = event.target.value === "physical";
});

$("#start-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    let session = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ mode: $("#mode").value, fixture: $("#mode").value === "simulation" ? $("#fixture").value : undefined }),
    });
    session = await api(`/api/sessions/${session.id}/problem`, {
      method: "POST",
      body: JSON.stringify({ problem: $("#problem").value }),
    });
    render(session);
    connectEvents(session.id);
  } catch (error) { toast(error.message); }
});

$("#approve").addEventListener("click", () => {
  const pending = state.session?.pendingDecision;
  if (!pending) return;
  $("#dialog-title").textContent = labels[pending.action];
  $("#dialog-facts").innerHTML = $("#approval-facts").innerHTML;
  $("#approval-dialog").showModal();
});

$("#confirm-approval").addEventListener("click", async (event) => {
  event.preventDefault();
  const session = state.session;
  const pending = session?.pendingDecision;
  if (!session || !pending) return;
  $("#approval-dialog").close();
  try {
    render(await api(`/api/sessions/${session.id}/decisions/${pending.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion: session.version }),
    }));
  } catch (error) { toast(error.message); }
});

$("#declare").addEventListener("click", async () => {
  try {
    render(await api(`/api/sessions/${state.session.id}/interventions`, {
      method: "POST",
      body: JSON.stringify({ description: $("#intervention").value }),
    }));
  } catch (error) { toast(error.message); }
});

$("#estop").addEventListener("click", async () => {
  try {
    render(await api(`/api/sessions/${state.session.id}/emergency-stop`, { method: "POST", body: "{}" }));
  } catch (error) { toast(error.message); }
});
