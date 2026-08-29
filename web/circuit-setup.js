import { assemblySteps, cameraViews, components, connectedPinRows, validateCircuit, wires } from "./circuit-model.js";

const $ = (selector) => document.querySelector(selector);
const makeSvg = (tag, attributes = {}) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
};
const state = { completed: -1, active: null, phase: "idle", automatic: false, paused: false, token: 0, inspection: false, selectedNet: null };
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const validation = validateCircuit();

function holeCoordinates(id) {
  const rail = id.match(/^([TB])([+-])(\d+)$/);
  if (rail) return { x: 190 + Number(rail[3]) * 15, y: rail[1] === "T" ? (rail[2] === "+" ? 184 : 198) : (rail[2] === "+" ? 692 : 706) };
  const strip = id.match(/^([A-J])(\d+)$/);
  if (!strip) return null;
  const rowIndex = "ABCDE".includes(strip[1]) ? "ABCDE".indexOf(strip[1]) : "FGHIJ".indexOf(strip[1]) + 5;
  return { x: 190 + Number(strip[2]) * 15, y: 255 + rowIndex * 38 + (rowIndex >= 5 ? 28 : 0) };
}

function wireTone(wire) {
  if (wire.signal === "ground" || wire.voltage === "0 V") return "ground";
  if (wire.voltage.startsWith("5 V") || wire.voltage === "0–5 V") return "power";
  if (wire.signal.includes("I²C")) return "i2c";
  if (wire.signal.includes("ADC") || wire.signal.includes("analog") || wire.signal.includes("filter")) return "analog";
  return "logic";
}

function renderBreadboard() {
  const layer = $("#breadboard-layer");
  const image = makeSvg("image", { href: "/assets/fritzing/breadboard.svg", x: 170, y: 168, width: 1135, height: 570, preserveAspectRatio: "none", class: "fritzing-breadboard" });
  const board = makeSvg("g", { class: "breadboard-overlay", "data-step": 0 });
  board.append(image);
  board.append(makeSvg("rect", { x: 178, y: 173, width: 1120, height: 548, rx: 14, class: "breadboard-outline" }));
  for (let column = 1; column <= 63; column += 1) {
    for (const row of "ABCDEFGHIJ") {
      const id = row + column; const point = holeCoordinates(id);
      const hole = makeSvg("circle", { cx: point.x, cy: point.y, r: 3.15, class: "breadboard-hole", "data-hole": id });
      const title = makeSvg("title"); title.textContent = id + " · five-hole terminal group, column " + column; hole.append(title); board.append(hole);
    }
    for (const id of ["T+" + column, "T-" + column, "B+" + column, "B-" + column]) {
      const point = holeCoordinates(id);
      const hole = makeSvg("circle", { cx: point.x, cy: point.y, r: 2.8, class: "breadboard-hole rail-hole " + (id.includes("+") ? "positive" : "negative"), "data-hole": id });
      const title = makeSvg("title"); title.textContent = id + " · " + (column <= 25 ? "left" : "right") + " rail segment"; hole.append(title); board.append(hole);
    }
  }
  [["A–E", 203, 350], ["CENTER TRENCH", 203, 461], ["F–J", 203, 565], ["5 V", 1160, 187], ["GND", 1160, 202]].forEach(([text, x, y]) => {
    const label = makeSvg("text", { x, y, class: "board-label" }); label.textContent = text; board.append(label);
  });
  layer.append(board);
}

function renderWires() {
  const layer = $("#wire-layer");
  for (const wire of wires) {
    const group = makeSvg("g", { class: "wire-group", "data-step": wire.step, "data-wire": wire.id, "data-net": wire.net });
    const points = wire.route.map((point) => point[0] + "," + point[1]).join(" ");
    group.append(makeSvg("polyline", { points, class: "wire-casing" }));
    group.append(makeSvg("polyline", { points, class: "circuit-wire " + wireTone(wire), "marker-end": wire.direction === "out" ? "url(#wire-arrow)" : "" }));
    for (const point of [wire.route[0], wire.route.at(-1)]) group.append(makeSvg("circle", { cx: point[0], cy: point[1], r: 4.2, class: "wire-terminal" }));
    const title = makeSvg("title"); title.textContent = wire.from + " → " + wire.to + " · " + wire.voltage + " · " + wire.signal; group.append(title);
    group.addEventListener("click", () => inspectWire(wire)); layer.append(group);
  }
}

function componentBody(component, group) {
  if (component.id === "esp32") {
    group.append(makeSvg("rect", { x: component.x, y: component.y, width: component.w, height: component.h, rx: 10, class: "esp-board" }));
    group.append(makeSvg("rect", { x: 696, y: 286, width: 108, height: 88, rx: 4, class: "esp-module" }));
    group.append(makeSvg("rect", { x: 717, y: 535, width: 66, height: 32, rx: 4, class: "usb-port" }));
    const a = makeSvg("text", { x: 750, y: 338, "text-anchor": "middle", class: "component-mark" }); a.textContent = "ESP32-S3"; group.append(a);
    const b = makeSvg("text", { x: 750, y: 357, "text-anchor": "middle", class: "component-submark" }); b.textContent = "DEVKITC-1 V1.1"; group.append(b); return;
  }
  if (component.asset) {
    group.append(makeSvg("rect", { x: component.x - 4, y: component.y - 4, width: component.w + 8, height: component.h + 8, rx: 8, class: "part-mount" }));
    group.append(makeSvg("image", { href: component.asset, x: component.x, y: component.y, width: component.w, height: component.h, preserveAspectRatio: "xMidYMid meet", class: "fritzing-part" })); return;
  }
  if (component.id.startsWith("r_")) {
    group.append(makeSvg("line", { x1: component.x, y1: component.y + 11, x2: component.x + component.w, y2: component.y + 11, class: "component-lead" }));
    group.append(makeSvg("rect", { x: component.x + 15, y: component.y + 2, width: component.w - 30, height: 18, rx: 7, class: "resistor-body" }));
    const text = makeSvg("text", { x: component.x + component.w / 2, y: component.y - 4, "text-anchor": "middle", class: "passive-label" }); text.textContent = component.part.split(" ·")[0]; group.append(text); return;
  }
  if (component.id.startsWith("c_")) {
    const electrolytic = component.id === "c_servo_bulk";
    group.append(makeSvg("rect", { x: component.x, y: component.y, width: component.w, height: component.h, rx: electrolytic ? 10 : 5, class: electrolytic ? "electrolytic-body" : "ceramic-body" }));
    const text = makeSvg("text", { x: component.x + component.w / 2, y: component.y - 5, "text-anchor": "middle", class: "passive-label" }); text.textContent = component.part.split(" ·")[0]; group.append(text);
    if (electrolytic) { const plus = makeSvg("text", { x: component.x + 5, y: component.y + 16, class: "polarity-mark" }); plus.textContent = "+"; group.append(plus); } return;
  }
  if (component.id.startsWith("d_")) {
    group.append(makeSvg("line", { x1: component.x, y1: component.y + 11, x2: component.x + component.w, y2: component.y + 11, class: "component-lead" }));
    group.append(makeSvg("path", { d: "M" + (component.x + 24) + " " + (component.y + 3) + "L" + (component.x + 41) + " " + (component.y + 11) + "L" + (component.x + 24) + " " + (component.y + 19) + "Z", class: "diode-body" }));
    group.append(makeSvg("line", { x1: component.x + 43, y1: component.y + 2, x2: component.x + 43, y2: component.y + 20, class: "diode-band" })); return;
  }
  group.append(makeSvg("rect", { x: component.x, y: component.y, width: component.w, height: component.h, rx: 9, class: "custom-part " + component.id }));
  const label = makeSvg("text", { x: component.x + component.w / 2, y: component.y + component.h / 2, "text-anchor": "middle", class: "component-mark" });
  label.textContent = component.id === "dht11" ? "DHT11" : component.id === "voltage" ? "0–25 V SENSOR" : "5 V / 3 A"; group.append(label);
}

function renderComponents() {
  const layer = $("#component-layer");
  for (const component of components) {
    const group = makeSvg("g", { class: "circuit-component", "data-component": component.id, "data-step": component.step, tabindex: 0, role: "group", "aria-label": component.name + ". " + component.purpose });
    componentBody(component, group);
    for (const pin of component.pins) {
      const pinGroup = makeSvg("g", { class: "component-pin " + (pin.used ? "used" : "unused"), "data-ref": component.id + "." + pin.id, tabindex: 0, role: "button", "aria-label": component.name + " " + pin.label + ", " + (pin.used ? "connected" : "unused") });
      pinGroup.append(makeSvg("circle", { cx: pin.x, cy: pin.y, r: component.id === "esp32" ? 4.1 : 5.2 }));
      const onLeft = component.id === "esp32" && pin.x < 700;
      const label = makeSvg("text", { x: pin.x + (component.id === "esp32" ? (onLeft ? 10 : -10) : 0), y: pin.y + (component.id === "esp32" ? 2.5 : 15), "text-anchor": component.id === "esp32" ? (onLeft ? "start" : "end") : "middle" });
      label.textContent = component.id === "esp32" ? pin.header + " " + pin.label : pin.label; pinGroup.append(label);
      const title = makeSvg("title"); title.textContent = component.name + " · " + (pin.header || "pin") + " " + pin.label + " · " + (pin.used ? "connected" : "unused"); pinGroup.append(title);
      pinGroup.addEventListener("click", (event) => { event.stopPropagation(); inspectPin(component, pin); });
      pinGroup.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); inspectPin(component, pin); } });
      group.append(pinGroup);
    }
    const caption = makeSvg("text", { x: component.x, y: component.y - 10, class: "part-caption" }); caption.textContent = component.name; group.append(caption); layer.append(group);
  }
}

function renderTable(filter = "") {
  const rows = connectedPinRows();
  const query = filter.trim().toLowerCase();
  const visible = rows.filter((row) => !query || Object.values(row).some((value) => String(value).toLowerCase().includes(query)));
  $("#connection-table").innerHTML = visible.map((row) => '<tr data-wire="' + row.wireId + '" tabindex="0"><td>' + row.component + '</td><td><code>' + row.physicalPin + '</code></td><td>' + row.function + '</td><td>' + row.connectsTo + '</td><td>' + row.voltage + '</td><td>' + row.signalType + '</td></tr>').join("");
  $("#table-count").textContent = visible.length + " / " + rows.length + " paths";
  document.querySelectorAll("#connection-table tr").forEach((row) => {
    const action = () => inspectWire(wires.find((wire) => wire.id === row.dataset.wire));
    row.addEventListener("click", action);
    row.addEventListener("keydown", (event) => { if (event.key === "Enter") action(); });
  });
}

function inspectWire(wire) {
  if (!wire) return;
  state.inspection = true;
  state.selectedNet = wire.net;
  $("#pin-inspection-toggle").setAttribute("aria-pressed", "true");
  $("#pin-inspector").hidden = false;
  $("#inspector-title").textContent = wire.net.replaceAll("_", " ");
  $("#inspector-pin").textContent = wire.from;
  $("#inspector-voltage").textContent = wire.voltage;
  $("#inspector-signal").textContent = wire.signal + " · " + wire.direction;
  $("#inspector-path").textContent = wire.from + " → " + wire.to;
  $("#inspector-purpose").textContent = "Every highlighted segment belongs to this electrical net. Crossings without a terminal dot are not junctions.";
  renderState();
}

function inspectPin(component, pin) {
  const ref = component.id + "." + pin.id;
  const related = wires.filter((wire) => wire.from === ref || wire.to === ref);
  state.inspection = true;
  state.selectedNet = related[0]?.net || null;
  $("#pin-inspection-toggle").setAttribute("aria-pressed", "true");
  $("#pin-inspector").hidden = false;
  $("#inspector-title").textContent = component.name;
  $("#inspector-pin").textContent = (pin.header ? pin.header + " · " : "") + pin.label;
  $("#inspector-voltage").textContent = related[0]?.voltage || "Not connected";
  $("#inspector-signal").textContent = related.map((wire) => wire.signal).join(", ") || "Unused pin";
  $("#inspector-path").textContent = related.length ? related.map((wire) => wire.from + " → " + wire.to).join(" · ") : "No physical wire fitted";
  $("#inspector-purpose").textContent = pin.used ? component.purpose : "This exposed header pin is deliberately unused and remains visibly unconnected.";
  renderState();
}

function closeInspection() {
  state.inspection = false;
  state.selectedNet = null;
  $("#pin-inspection-toggle").setAttribute("aria-pressed", "false");
  $("#pin-inspector").hidden = true;
  renderState();
}

function renderState() {
  const finished = state.completed === assemblySteps.length - 1 && validation.valid;
  const activeIndex = state.active ?? Math.min(state.completed + 1, assemblySteps.length - 1);
  const activeStep = assemblySteps[activeIndex];
  const count = state.completed + 1;
  document.querySelectorAll("[data-step]").forEach((node) => {
    const step = Number(node.dataset.step);
    node.classList.toggle("is-visible", step <= state.completed || step === state.active);
    node.classList.toggle("is-entering", step === state.active && state.phase === "placing");
    node.classList.toggle("is-drawing", step === state.active && state.phase === "wiring");
    node.classList.toggle("is-verifying", step === state.active && state.phase === "verifying");
  });
  document.querySelectorAll(".wire-group").forEach((node) => {
    node.classList.toggle("is-inspected", state.inspection && node.dataset.net === state.selectedNet);
    node.classList.toggle("is-dimmed", state.inspection && node.dataset.net !== state.selectedNet);
  });
  $("#active-kicker").textContent = finished ? "System assembled" : String(activeIndex + 1).padStart(2, "0") + " / " + activeStep.id;
  $("#circuit-title").textContent = finished ? "Verified diagnostic harness" : activeStep.title;
  $("#assembly-state").textContent = finished ? "Ready" : state.paused ? "Paused" : "Assembling";
  $("#assembly-state").dataset.state = finished ? "confirmed" : state.paused ? "interrupted" : "assembling";
  $("#sequence-badge").textContent = count + " / " + assemblySteps.length;
  const progress = Math.round(count / assemblySteps.length * 100);
  $("#progress-label").textContent = progress + "%";
  $("#progress-bar").style.width = progress + "%";
  $(".assembly-progress").setAttribute("aria-valuenow", String(progress));
  $("#step-label").textContent = "Step " + String(activeIndex + 1).padStart(2, "0") + " of " + String(assemblySteps.length).padStart(2, "0");
  $("#sequence-note").textContent = finished ? "Static topology and every physical endpoint passed deterministic validation." : activeStep.detail;
  $("#verification-count").textContent = validation.valid ? validation.checked.wires + " / " + validation.checked.wires : "0 / " + validation.checked.wires;
  $("#ready-banner").classList.toggle("is-visible", finished);
  $("#circuit-stage").classList.toggle("is-ready", finished);
  $("#assembly-timeline").innerHTML = assemblySteps.map((step, index) => {
    const status = index <= state.completed ? "complete" : index === activeIndex ? "active" : "pending";
    const detail = status === "complete" ? step.detail : status === "active" ? (state.phase === "wiring" ? "Routing physical conductors" : state.phase === "verifying" ? "Checking net continuity" : "Next to assemble") : "Pending";
    return '<li data-status="' + status + '"><span class="timeline-index">' + String(index + 1).padStart(2, "0") + '</span><span class="timeline-marker"></span><div><strong>' + step.title + '</strong><small>' + detail + '</small></div></li>';
  }).join("");
  const busy = state.active !== null;
  $("#previous-step").disabled = busy || state.completed < 0 || state.automatic;
  $("#next-step").disabled = busy || finished || state.automatic || !validation.valid;
  $("#auto-build").disabled = finished || !validation.valid;
  $("#auto-build").textContent = state.automatic ? (state.paused ? "Resume automatic build" : "Pause automatic build") : "Build automatically";
  $("#restart-build").disabled = state.completed < 0 && !busy;
  $("#skip-build").disabled = finished || !validation.valid;
  $("#estop").disabled = !state.automatic;
}

async function delay(duration, token) {
  if (reducedMotion) return;
  let elapsed = 0;
  let previous = performance.now();
  while (elapsed < duration) {
    await new Promise((resolve) => setTimeout(resolve, 32));
    if (token !== state.token) throw new DOMException("cancelled", "AbortError");
    const now = performance.now();
    if (!state.paused) elapsed += now - previous;
    previous = now;
  }
}

async function assemble(index, token = state.token) {
  state.active = index;
  state.phase = "placing";
  renderState();
  await delay(assemblySteps[index].placementMs, token);
  state.phase = "wiring";
  renderState();
  await delay(820, token);
  state.phase = "verifying";
  renderState();
  await delay(300, token);
  state.completed = index;
  state.active = null;
  state.phase = "idle";
  renderState();
}

async function automaticBuild() {
  if (state.automatic) {
    state.paused = !state.paused;
    renderState();
    return;
  }
  state.automatic = true;
  state.paused = false;
  const token = ++state.token;
  renderState();
  try {
    while (state.completed < assemblySteps.length - 1 && token === state.token) {
      await assemble(state.completed + 1, token);
      await delay(300, token);
    }
  } catch (error) {
    if (error.name !== "AbortError") throw error;
  } finally {
    if (token === state.token) {
      state.automatic = false;
      state.paused = false;
      renderState();
    }
  }
}

function cancel() {
  state.token += 1;
  state.active = null;
  state.automatic = false;
  state.paused = false;
  state.phase = "idle";
}

function restart() {
  cancel();
  state.completed = -1;
  closeInspection();
}

renderBreadboard();
renderWires();
renderComponents();
renderTable();
$("#camera-view").innerHTML = cameraViews.map((view) => '<option value="' + view.id + '">' + view.label + '</option>').join("");
$("#camera-view").addEventListener("change", (event) => {
  const view = cameraViews.find((item) => item.id === event.target.value);
  if (view) $("#circuit-svg").setAttribute("viewBox", view.viewBox);
});
$("#connection-filter").addEventListener("input", (event) => renderTable(event.target.value));
$("#pin-inspection-toggle").addEventListener("click", () => {
  if (state.inspection) closeInspection();
  else {
    state.inspection = true;
    $("#pin-inspector").hidden = false;
    $("#pin-inspection-toggle").setAttribute("aria-pressed", "true");
  }
});
$("#close-inspector").addEventListener("click", closeInspection);
$("#next-step").addEventListener("click", async () => {
  if (state.active !== null) return;
  const token = ++state.token;
  try { await assemble(state.completed + 1, token); } catch (error) { if (error.name !== "AbortError") throw error; }
});
$("#previous-step").addEventListener("click", () => { if (state.completed >= 0) { state.completed -= 1; renderState(); } });
$("#auto-build").addEventListener("click", () => void automaticBuild());
$("#restart-build").addEventListener("click", restart);
$("#skip-build").addEventListener("click", () => { cancel(); state.completed = assemblySteps.length - 1; renderState(); });
$("#estop").addEventListener("click", () => { cancel(); renderState(); });
$("#theme-toggle").addEventListener("click", () => {
  const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem("ahea-theme", theme);
});
$("#validation-summary").textContent = validation.valid ? "Topology valid · " + validation.checked.pins + " pins · " + validation.checked.wires + " physical paths" : "Validation failed · " + validation.errors[0];
$("#validation-summary").dataset.valid = String(validation.valid);
renderState();
