const $ = (selector) => document.querySelector(selector);
let session;
let eventSource;

const labels = {
  open_or_unenergized_motor_path: "Open / unenergized motor path",
  mechanical_stall: "Mechanical stall",
  driver_control_failure: "Driver / control failure",
  motion_sensor_or_mounting_failure: "Motion sensor / mounting failure"
};

$("#mode").addEventListener("change", async () => {
  const physical = $("#mode").value === "physical";
  $("#fixtureGroup").hidden = physical;
  $("#portGroup").hidden = !physical;
  if (physical) await loadPorts();
});

$("#connect").addEventListener("click", () => act("/api/session", {
  mode: $("#mode").value,
  fixture: $("#fixture").value,
  port: $("#port").value
}, true).then(connectEvents));
$("#calibrate").addEventListener("click", () => act("/api/session/calibration"));
$("#diagnose").addEventListener("click", () => act("/api/session/diagnosis", { problem: $("#problem").value }));
$("#repair").addEventListener("click", () => act("/api/session/intervention", { kind: "motor_lead_reconnected" }));
$("#estop").addEventListener("click", () => act("/api/session/emergency-stop"));

async function act(url, body = {}, create = false) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed.");
    render(data);
    return data;
  } catch (error) {
    toast(error.message);
    if (create) throw error;
  }
}

function connectEvents() {
  eventSource?.close();
  eventSource = new EventSource("/api/session/events");
  eventSource.onmessage = (event) => render(JSON.parse(event.data));
}

async function loadPorts() {
  const response = await fetch("/api/ports");
  const { ports } = await response.json();
  $("#port").innerHTML = ports.length
    ? ports.map((item) => `<option value="${escapeHtml(item.path)}">${escapeHtml(item.path)}</option>`).join("")
    : '<option value="">No serial ports found</option>';
}

function render(next) {
  if (!next) return;
  session = next;
  const modeBadge = $("#modeBadge");
  modeBadge.textContent = next.mode === "physical" ? "PHYSICAL EVIDENCE" : "SIMULATION — NOT PHYSICAL EVIDENCE";
  modeBadge.className = `mode ${next.mode}`;
  const agentBadge = $("#agentBadge");
  agentBadge.textContent = next.fallbackMode ? "DETERMINISTIC FALLBACK" : "AZURE AGENT";
  agentBadge.className = `mode ${next.fallbackMode ? "simulation" : "physical"}`;
  $("#phase").textContent = next.phase.replaceAll("_", " ");
  $("#status").textContent = next.statusMessage;
  $("#confidence").textContent = next.diagnosis.confidence;
  $("#estop").disabled = next.emergencyStopLatched;
  $("#calibrate").disabled = !["CREATED", "READY"].includes(next.phase);
  $("#diagnose").disabled = next.phase !== "READY" || !next.calibration;
  $("#repair").disabled = next.phase !== "AWAITING_REPAIR";
  renderCalibration(next.calibration);
  renderPending(next.pendingExperiment);
  renderHypotheses(next.diagnosis.hypothesisSupport);
  renderDecision(next.decisions.at(-1));
  renderEvidence(next);
  renderTimeline(next);
  renderReport(next);
}

function renderCalibration(calibration) {
  if (!calibration) {
    $("#calibration").className = "empty";
    $("#calibration").textContent = "No healthy baseline captured.";
    return;
  }
  $("#calibration").className = "";
  $("#calibration").innerHTML = [
    ["Iidle", `${calibration.idleCurrentMa} mA`],
    ["Ihealthy", `${calibration.healthyCurrentMa} mA`],
    ["Mbase", `${calibration.baselineMotionRmsG} g RMS`],
    ["Mhealthy", `${calibration.healthyMotionRmsG} g RMS`]
  ].map(([name, value]) => `<div class="cal-row"><span>${name}</span><strong>${value}</strong></div>`).join("");
}

function renderPending(pending) {
  const box = $("#pending");
  if (!pending) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<strong>Approval required: ${escapeHtml(pending.tool)}</strong><br>
    Fixed pulse: ${pending.durationMs} ms · Emergency stop available<br><br>
    <button id="approve">Approve bounded activation</button>`;
  $("#approve").addEventListener("click", () => act(`/api/session/experiments/${pending.id}/approve`));
}

function renderHypotheses(support) {
  $("#hypotheses").innerHTML = Object.entries(support)
    .map(([name, confidence]) => `<li>${labels[name]} — <strong>${confidence}</strong></li>`).join("");
}

function renderDecision(decision) {
  if (!decision) return;
  const action = decision.action.kind === "run_experiment" ? decision.action.tool : decision.action.kind;
  $("#nextAction").textContent = action.replaceAll("_", " ");
  $("#rationale").textContent = decision.rationale;
}

function renderEvidence(state) {
  const observations = state.observations.filter((item) => item.measurements.length);
  if (!observations.length) return;
  $("#evidence").className = "evidence-list";
  $("#evidence").innerHTML = observations.flatMap((observation) =>
    observation.measurements.map((value) => `<div class="evidence-item">
      <span class="tag">${observation.provenance.source.toUpperCase()}</span>
      <strong>${value.value} ${value.unit}</strong>
      <span>${value.name.replaceAll("_", " ")}</span>
      <small>Source: ${observation.provenance.deviceId} / ${value.sensor}</small>
      <small>Experiment: ${observation.experimentId}</small>
      <small>Sensor errors: ${(value.health.errorRate * 100).toFixed(1)}%</small>
      <small>Calibration: ${observation.calibrationId || "pending"}</small>
    </div>`)
  ).join("");
}

function renderTimeline(state) {
  const entries = [
    ...state.observations.map((item) => ({ at: item.capturedAt, html: `<span class="tag">OBSERVATION</span>${item.tool}: ${item.classification.join(", ")}` })),
    ...state.decisions.map((item) => ({ at: item.createdAt, html: `<span class="tag">${item.mode.toUpperCase()} DECISION</span>${escapeHtml(item.objective)}<br><small>Inputs: ${escapeHtml(item.inputObservationIds.join(", ") || "project context")} · ${item.validation.allowed ? "allowed" : "rejected"}</small>` }))
  ].sort((a, b) => a.at.localeCompare(b.at));
  $("#timeline").innerHTML = entries.map((entry) => `<li>${entry.html}</li>`).join("");
}

function renderReport(state) {
  const card = $("#reportCard");
  if (state.diagnosis.confidence !== "CONFIRMED") { card.hidden = true; return; }
  card.hidden = false;
  const beforeCurrent = state.observations.find((item) => item.tool === "motor_current_probe")?.measurements.find((item) => item.name === "current_mean_ma");
  const verifications = state.observations.filter((item) => item.tool === "verify_motor" && item.purpose === "verification");
  const verificationText = verifications.map((observation, index) => {
    const current = observation.measurements.find((item) => item.name === "current_mean_ma");
    return `<li>Verification ${index + 1}: motion signature detected; current ${current?.value ?? "—"} ${current?.unit ?? ""}</li>`;
  }).join("");
  $("#report").innerHTML = `<h2>Confirmed: motor power path was restored after the declared intervention.</h2>
    <p><strong>Evidence source:</strong> ${state.mode === "physical" ? "ESP32-S3 hardware" : "simulated adapter (not physical evidence)"}</p>
    <p><strong>Before repair:</strong> expected motion signature absent; current ${beforeCurrent?.value ?? "—"} ${beforeCurrent?.unit ?? ""}; healthy baseline ${state.calibration?.healthyCurrentMa ?? "—"} mA.</p>
    <ul>${verificationText}</ul>
    <p><strong>Limitation:</strong> pre-repair evidence identified an open or unenergized path condition, not the exact break location.</p>`;
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 4000);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}
