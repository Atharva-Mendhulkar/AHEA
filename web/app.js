const state = {
  session: null,
  events: null,
  cooldownTimer: null,
  activeView: "evidence",
  viewAnimation: null,
  plotFrames: new Map(),
  plotKeys: new Map(),
  plotResizeFrame: null,
};
const $ = (selector) => document.querySelector(selector);
const labels = {
  motor_motion_probe: "Motor motion probe",
  motor_current_probe: "Motor current probe",
  verify_motor: "Motor verification pulse",
};

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("ahea-theme", theme);
  const next = theme === "dark" ? "Light" : "Dark";
  $("#theme-label").textContent = `${next} mode`;
  $("#theme-toggle").setAttribute("aria-label", `Switch to ${next.toLowerCase()} mode`);
  $("#theme-toggle").setAttribute("aria-pressed", String(theme === "dark"));
  state.plotKeys.clear();
  if (state.session) renderPlots(state.session);
}

function setBusy(button, busy, busyLabel) {
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));
  button.textContent = busy ? busyLabel : button.dataset.label;
}

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

function switchView(view, updateHistory = true) {
  const names = ["evidence", "hypotheses", "timeline", "report"];
  if (!names.includes(view)) view = "evidence";
  const previous = state.activeView;
  state.activeView = view;
  document.querySelectorAll(".section-tab").forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".workspace-page").forEach((page) => {
    page.hidden = page.dataset.page !== view;
  });
  const page = $(`#view-${view}`);
  state.viewAnimation?.cancel();
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches && page && previous !== view) {
    const direction = names.indexOf(view) >= names.indexOf(previous) ? 1 : -1;
    state.viewAnimation = page.animate(
      [
        { opacity: 0, transform: `translateX(${direction * 14}px) scale(.995)` },
        { opacity: 1, transform: "translateX(0) scale(1)" },
      ],
      { duration: 280, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
  }
  if (view === "evidence" && state.session) renderPlots(state.session);
  if (updateHistory && location.hash !== `#${view}`) history.pushState({ view }, "", `#${view}`);
}

function latestSeries(session, name) {
  for (const observation of [...session.observations].reverse()) {
    const series = observation.series?.find((candidate) => candidate.name === name);
    if (series) return { observationId: observation.id, ...series };
  }
  return null;
}

function renderPlots(session) {
  drawPlot("motion", latestSeries(session, "motion_rms_g"));
  drawPlot("current", latestSeries(session, "current_ma"));
}

function drawPlot(kind, series) {
  const canvas = $(`#${kind}-plot`);
  const empty = $(`#${kind}-empty`);
  const reading = $(`#${kind}-reading`);
  const duration = $(`#${kind}-duration`);
  const previousFrame = state.plotFrames.get(kind);
  if (previousFrame) cancelAnimationFrame(previousFrame);
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width < 2 || bounds.height < 2) {
    state.plotKeys.delete(kind);
    return;
  }
  if (!series?.values?.length) {
    empty.hidden = false;
    reading.textContent = `— ${kind === "motion" ? "g" : "mA"}`;
    duration.textContent = "—";
    const context = canvas.getContext("2d");
    context?.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  empty.hidden = true;
  duration.textContent = `${series.values.length * series.sampleIntervalMs} ms`;
  const theme = document.documentElement.dataset.theme;
  const key = `${series.observationId}:${theme}:${canvas.clientWidth}`;
  const animate = state.plotKeys.get(kind) !== key && !matchMedia("(prefers-reduced-motion: reduce)").matches;
  state.plotKeys.set(kind, key);
  const started = performance.now();
  const totalDuration = Math.max(360, series.values.length * series.sampleIntervalMs);

  const frame = (now) => {
    const progress = animate ? Math.min(1, (now - started) / totalDuration) : 1;
    const visibleCount = Math.max(1, Math.ceil(series.values.length * progress));
    paintPlot(canvas, series.values.slice(0, visibleCount), kind, series.values);
    const current = series.values[visibleCount - 1];
    reading.textContent = `${formatReading(current, series.unit)} ${series.unit}`;
    if (progress < 1) state.plotFrames.set(kind, requestAnimationFrame(frame));
    else state.plotFrames.delete(kind);
  };
  state.plotFrames.set(kind, requestAnimationFrame(frame));
}

function paintPlot(canvas, values, kind, fullSeries = values) {
  const bounds = canvas.getBoundingClientRect();
  const ratio = Math.min(devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(bounds.width * ratio));
  const height = Math.max(1, Math.round(bounds.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, width, height);
  if (!values.length) return;
  const styles = getComputedStyle(document.documentElement);
  const color = kind === "motion" ? styles.getPropertyValue("--accent").trim() : styles.getPropertyValue("--success").trim();
  const minimum = Math.min(...fullSeries);
  const maximum = Math.max(...fullSeries);
  const padding = Math.max((maximum - minimum) * .18, kind === "motion" ? .005 : 2);
  const low = minimum - padding;
  const high = maximum + padding;
  const inset = 10 * ratio;
  const plotWidth = Math.max(1, width - inset * 2);
  const plotHeight = Math.max(1, height - inset * 2);
  const xStep = plotWidth / Math.max(1, fullSeries.length - 1);
  context.beginPath();
  context.lineWidth = 1.6 * ratio;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.strokeStyle = color;
  values.forEach((value, index) => {
    const x = inset + index * xStep;
    const y = inset + (1 - ((value - low) / Math.max(.0001, high - low))) * plotHeight;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  const x = inset + (values.length - 1) * xStep;
  const y = inset + (1 - ((values.at(-1) - low) / Math.max(.0001, high - low))) * plotHeight;
  context.save();
  context.globalAlpha = .2;
  context.strokeStyle = color;
  context.setLineDash([2 * ratio, 4 * ratio]);
  context.beginPath();
  context.moveTo(x, inset);
  context.lineTo(x, height - inset);
  context.stroke();
  context.restore();
  context.fillStyle = color;
  context.beginPath();
  context.arc(x, y, 2.8 * ratio, 0, Math.PI * 2);
  context.fill();
}

function formatReading(value, unit) {
  if (typeof value !== "number") return "—";
  return unit === "mA" ? value.toFixed(1) : value.toFixed(3);
}

function render(session) {
  state.session = session;
  $("#setup").classList.add("hidden");
  $("#workspace").classList.remove("hidden");
  const physical = session.mode === "physical";
  $("#mode-badge").textContent = physical ? "Physical" : "Simulation";
  $("#mode-badge").dataset.tone = physical ? "warning" : "info";
  $("#connection-badge").textContent = session.hardware.connected ? "Connected" : "Disconnected";
  $("#connection-badge").dataset.tone = session.hardware.connected ? "success" : "neutral";
  $("#lifecycle").textContent = session.lifecycle.replaceAll("_", " ");
  $("#lifecycle-pill").textContent = session.lifecycle.replaceAll("_", " ");
  $("#lifecycle-pill").dataset.state = session.lifecycle.toLowerCase();
  $("#problem-summary").textContent = session.problem || "Investigating the reported hardware behavior.";
  $("#budget").textContent = `${session.totalActivations} / 6`;
  $("#verification").textContent = `${session.consecutiveVerificationPasses} / 2 consecutive`;
  const latestDecision = session.decisions.at(-1);
  $("#agent-source").textContent = latestDecision ? latestDecision.decisionSource.toUpperCase() : "—";
  $("#agent-proof").textContent = latestDecision?.decisionSource === "openai" ? "Provider response recorded" : latestDecision ? "Fallback; not agentic proof" : "Not yet evaluated";
  $("#estop").disabled = session.lifecycle === "ESTOPPED" || session.lifecycle === "CONFIRMED";

  const observation = [...session.observations].reverse().find((item) => item.command !== "sample_motion");
  const observationEvidence = observation && session.evidence.observations.find((item) => item.observationId === observation.id);
  $("#observation-source").textContent = observation ? `${observation.source} · ${observation.adapter}` : "No source";
  $("#observation-source").dataset.tone = observation ? (observation.source === "physical" ? "warning" : "info") : "neutral";
  $("#observation-title").textContent = observation
    ? observation.command === "motor_motion_probe"
      ? (observationEvidence?.motionDetected ? "Expected motion signature detected" : "Expected motion signature not detected")
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
    ["Fixed pulse", `${pending.fixedParameters.durationMs} ms`],
    ["Current trip", `${pending.fixedParameters.currentLimitMa} mA`],
    ["Cooldown", cooldownMs > 0 ? `Ready in ${(cooldownMs / 1000).toFixed(1)} s` : "Ready"],
    ["Activations remaining", pending.activationsRemaining],
    ["Evidence source", session.mode],
  ].map(([key, value]) => `<span>${escapeHtml(key)}<strong>${escapeHtml(value)}</strong></span>`).join("") : "";
  $("#approve").disabled = !pending || cooldownMs > 0;
  $("#approve").setAttribute("aria-busy", "false");
  $("#approve").textContent = cooldownMs > 0 ? `Cooldown · ${(cooldownMs / 1000).toFixed(1)} s` : "Approve bounded activation";
  clearTimeout(state.cooldownTimer);
  if (pending && cooldownMs > 0) {
    state.cooldownTimer = setTimeout(async () => {
      try { render(await api(`/api/sessions/${session.id}`)); } catch (error) { toast(error.message); }
    }, cooldownMs + 50);
  }
  $("#declare").disabled = session.lifecycle !== "AWAITING_INTERVENTION";

  $("#confidence").textContent = session.evidence.confidenceLabel;
  $("#confidence").dataset.tone = session.evidence.confidenceLabel === "CONFIRMED" ? "success" : session.evidence.confidenceLabel === "UNKNOWN" ? "neutral" : "warning";
  $("#hypotheses").innerHTML = session.evidence.hypotheses.map((item) => `
    <div class="hypothesis">
      <div><strong>${escapeHtml(item.hypothesis.replaceAll("_", " "))}</strong><br><small>${escapeHtml(item.reasons[0] || "No valid supporting evidence yet.")}</small></div>
      <div class="score-wrap"><div class="score-track"><div class="score-bar" style="width:${Math.max(0, Math.min(100, item.support))}%"></div></div><span class="score">${item.support}</span></div>
    </div>
  `).join("");

  $("#hardware-facts").innerHTML = [
    ["Board", session.hardware.boardIdentity],
    ["Firmware", session.hardware.firmwareVersion],
    ["Profile", session.hardware.profileId],
    ["Calibration", session.calibration.id],
    ["Sensors", session.hardware.detectedI2c.join(", ") || "None"],
    ["E-stop", session.hardware.estopLatched ? "Latched" : "Ready"],
  ].map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd title="${escapeHtml(value)}">${escapeHtml(value)}</dd></div>`).join("");

  $("#timeline").innerHTML = [...session.timeline].reverse().map((event) => `
    <li><strong>${escapeHtml(event.summary)}</strong><time>${new Date(event.at).toLocaleTimeString()} · ${escapeHtml(event.type)}</time></li>
  `).join("");
  $("#event-count").textContent = `${session.timeline.length} ${session.timeline.length === 1 ? "event" : "events"}`;

  const terminal = ["CONFIRMED", "FAILED", "INTERRUPTED", "ESTOPPED"].includes(session.lifecycle);
  $("#report-title").textContent = session.lifecycle === "CONFIRMED" ? "CONFIRMED: motor power path restored" : terminal ? session.lifecycle : "Investigation in progress";
  $("#download-report").disabled = !terminal;
  $("#report").innerHTML = `
    <p><strong>Source:</strong> ${escapeHtml(session.mode)}</p>
    <p><strong>Calibration:</strong> ${escapeHtml(session.calibration.id)}</p>
    <p><strong>Evidence state:</strong> ${escapeHtml(session.evidence.evidenceState.replaceAll("_", " "))}</p>
    ${session.failureReason ? `<p><strong>Outcome:</strong> ${escapeHtml(session.failureReason)}</p>` : ""}
    <p class="report-limitations"><strong>Limitations:</strong> ${escapeHtml(session.evidence.limitations.join(" "))}</p>`;
  renderPlots(session);
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

document.querySelectorAll(".section-tab").forEach((tab) => {
  tab.addEventListener("click", () => switchView(tab.dataset.view));
  tab.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll(".section-tab")];
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(tabs.indexOf(tab) + direction + tabs.length) % tabs.length];
    next.focus();
    switchView(next.dataset.view);
  });
});
window.addEventListener("popstate", () => switchView(location.hash.slice(1) || "evidence", false));
window.addEventListener("resize", () => {
  cancelAnimationFrame(state.plotResizeFrame);
  state.plotResizeFrame = requestAnimationFrame(() => {
    state.plotKeys.clear();
    if (state.session && state.activeView === "evidence") renderPlots(state.session);
  });
});

$("#theme-toggle").addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

$("#start-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = event.submitter || event.currentTarget.querySelector("button[type='submit']");
  setBusy(submit, true, "Starting…");
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
    switchView(location.hash.slice(1) || "evidence", false);
    connectEvents(session.id);
  } catch (error) { toast(error.message); }
  finally { setBusy(submit, false, ""); }
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
  setBusy($("#approve"), true, "Executing…");
  try {
    render(await api(`/api/sessions/${session.id}/decisions/${pending.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion: session.version }),
    }));
  } catch (error) { toast(error.message); render(session); }
});

$("#declare").addEventListener("click", async () => {
  setBusy($("#declare"), true, "Declaring…");
  try {
    render(await api(`/api/sessions/${state.session.id}/interventions`, {
      method: "POST",
      body: JSON.stringify({ description: $("#intervention").value }),
    }));
  } catch (error) { toast(error.message); }
  finally { if (state.session?.lifecycle === "AWAITING_INTERVENTION") setBusy($("#declare"), false, ""); }
});

$("#estop").addEventListener("click", async () => {
  try {
    render(await api(`/api/sessions/${state.session.id}/emergency-stop`, { method: "POST", body: "{}" }));
  } catch (error) { toast(error.message); }
});

$("#download-report").addEventListener("click", async () => {
  try {
    const report = await api(`/api/sessions/${state.session.id}/report`);
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ahea-report-${state.session.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (error) { toast(error.message); }
});

setTheme(document.documentElement.dataset.theme);
