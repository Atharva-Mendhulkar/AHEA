# AHEA Product Requirements

## Product definition and positioning

AHEA is an open-source, ESP32-S3-centered framework for evidence-driven diagnosis of physical computing systems. It combines declared project intent, firmware-advertised capabilities, agent-selected bounded experiments, a fail-closed safety gateway, physical observations, deterministic evidence, human intervention, and physical verification.

The product does not promise autonomous root-cause discovery. It reaches an evidence-supported diagnosis or reports that the evidence is inconclusive. The agent chooses among safe semantic experiments; it does not control raw hardware operations or decide what measurements prove.

The MVP has three layers:

1. The core framework provides the reusable investigation, safety, evidence, provenance, intervention, and verification machinery.
2. The required proof is a protected ESP32-S3 waveform-loopback fixture that works without an external sensor.
3. HC-SR04, MPU6050, and DHT11 diagnostics are optional demonstration profiles that reuse the core interfaces.

The primary investigation loop is:

`PROJECT CONTEXT → OBSERVE → FORM/UPDATE HYPOTHESES → SELECT ELIGIBLE EXPERIMENT → SAFETY VALIDATE → EXECUTE → MEASURE → EVALUATE EVIDENCE → CONCLUDE OR RECOMMEND → HUMAN INTERVENTION IF NEEDED → PHYSICAL VERIFICATION`

## Responsibility boundaries

| Component | Owns | Must not own |
|---|---|---|
| Project context | Intended behavior, fixture/profile identity, allowed procedures, constraints, declared references, and success bounds | Runtime measurements or post-hoc changes within a session |
| Firmware and reviewed hardware profile | Board identity, fixed bindings, capability advertisement, registered plans, low-level execution, timeouts, cleanup, and electrical limits | Diagnosis, confidence, or intervention approval |
| Safety gateway | Eligibility, context/profile matching, budgets, mode, plan parameters, setup requirements, and fail-closed rejection | Scientific interpretation or free-form plan creation |
| Agent | Selection of one opaque eligible experiment ID and a presentation-safe rationale tied to current evidence | Pins, registers, waveform values, timing values, ADC settings, bus bytes, evidence rules, confidence, lifecycle, or verification counters |
| Adapter | Transport and normalized operation results | Reclassifying simulation as physical or interpreting evidence |
| Evidence engine | Deterministic observations, inferences, hypothesis states, confidence labels, recommendations, and verification outcomes | Fabricating measurements or changing configured thresholds during a session |
| Human operator | Setup confirmation, controlled physical input, and every physical intervention | Overriding provenance, safety rejection, or verification rules |
| Dashboard | Faithful presentation and collection of explicit operator declarations | Hidden calculations, probability claims, or client-owned state transitions |

All state-changing decisions and observations are appended to the audit timeline. Backend state is authoritative.

## Verified ESP32-S3 capabilities and limitations

The core may use ESP32-S3 capabilities that are verified by the selected board and reviewed firmware profile: 3.3 V digital GPIO input/output, hardware timers, bounded waveform generation, edge/timing capture, I²C controller operations, and ADC sampling where a profile explicitly enables it.

The following claim boundaries are mandatory:

- ESP32-S3 GPIO is not 5 V tolerant. No signal above the reviewed input limits may be connected directly to a GPIO.
- ESP32-S3 has no native DAC. PWM or digitally generated waveforms must never be described as true analog output.
- ESP32-S3 ADC results are noisy, attenuation-dependent, board-dependent, and not laboratory-grade. Every ADC observation must state its configured attenuation/range and limitations.
- Native measurements alone cannot establish current, resistance, impedance, negative voltage, mechanical behavior, or exact component failure. Such claims require suitable reviewed external circuitry or instruments.
- A waveform generated and measured by the same ESP32-S3 establishes internal consistency against the ESP32 timebase. It is not independent frequency calibration.
- Digital agreement at the source and destination nodes supports continuity and signal-path conclusions only within the registered fixture, thresholds, sampling resolution, and tested conditions.

Use **baseline characterization** when no trusted external reference exists. Use **project calibration** only when a declared procedure supplies independent distance, orientation, environmental, or other ground truth. Every resulting observation must name the reference procedure, or explicitly state that no independent reference exists.

## Generic capability and experiment model

The core data model is capability-first rather than sensor-first.

A firmware capability advertisement includes:

- board, firmware, and hardware-profile identities;
- a registry version and digest;
- semantic capability IDs and fixed logical bindings;
- registered experiment plan IDs with purpose, prerequisites, duration, measurement schema, units, and cleanup behavior;
- reviewed ranges and immutable parameters;
- mode support, budgets, incompatibilities, and safety requirements; and
- limitations and the claims each plan can and cannot support.

An experiment request contains only a session ID, opaque registered plan ID, expected state/version, and any gateway-defined confirmation token. It does not accept raw pins, waveform parameters, timing, ADC configuration, I²C addresses/registers/bytes, or arbitrary bus operations from the agent or UI.

An experiment result contains the registered plan and binding identities, operation status, measurements or series with units and quality, start/end timing, cleanup status, provenance, and limitations. Transport success is distinct from a valid measurement.

Profile modules may add capability descriptors, plans, measurement schemas, eligibility predicates, and deterministic evidence rules. They must not replace or bypass the agent loop, gateway, provenance model, lifecycle, confidence vocabulary, intervention boundary, or confirmation rules.

## Project-context model

Project context is versioned, schema-validated, and immutable for the life of a session. Every observation and decision includes its digest. At minimum it declares:

- project ID, name, diagnostic goal, and expected behavior;
- required core or optional profile module;
- exact board and reviewed hardware/firmware profile;
- logical nodes/devices and fixed binding identities;
- allowed registered experiment plans;
- expected ranges, tolerances, and deterministic pass/fail rules;
- required operator setup or stimulus procedures;
- independent reference procedures, if any;
- experiment, time, retry, and verification budgets;
- physical or simulation mode; and
- known limitations and prohibited claims.

The default MVP context is the protected ESP32-S3 loopback demonstration. It contains no external sensor dependency. Each optional sensor demonstration has a separate context and must be explicitly selected.

Context changes require a new version and a new session. Missing, stale, mismatched, or unreviewed context fails closed.

## Agentic experiment-selection model

The backend computes eligible next experiments from current lifecycle state, accepted evidence, unresolved hypotheses, capability registry, project context, safety prerequisites, and remaining budgets. The agent receives opaque experiment IDs with semantic descriptions and selects one. A deterministic selector is required for tests and for operation when a model is unavailable.

Selection must be evidence-dependent. The same session cannot follow a fixed script regardless of observations. The audit record stores the eligible set, selected ID, evidence references, and a short presentation-safe rationale; it does not expose private chain-of-thought.

The gateway revalidates the selected experiment immediately before execution. Unknown IDs, stale decisions, exhausted budgets, incompatible modes, unconfirmed setups, invalid state transitions, and any attempt to inject low-level parameters are rejected.

The agent may stop with `CONCLUDED_NORMAL` when evidence supports expected behavior, with `INCONCLUSIVE` when safe eligible experiments cannot resolve the evidence, or with `DIAGNOSIS_READY` when evidence supports a repair claim. It must not invent a fault or modification to force progress.

## Deterministic evidence and confidence

Measurement interpretation is implemented as versioned deterministic rules. The model cannot create measurements, change thresholds, calculate confidence, declare sufficiency, or increment verification counters.

Every result is visibly separated into:

- `OBSERVED`: accepted measurements, operation outcomes, units, quality, conditions, and limitations;
- `INFERENCE`: rule-derived meaning and evidence for or against named hypotheses;
- `RECOMMENDATION`: a bounded human action, its basis, safety constraints, expected effect, and verification procedure;
- `VERIFICATION`: post-intervention physical results, threshold checks, consecutive-pass count, and final outcome.

Backend-owned confidence labels are `UNKNOWN`, `POSSIBLE`, `LIKELY`, and `HIGH_CONFIDENCE`. They map to explicit evidence conditions, not numeric probabilities. The UI must not show percentages, probability-like progress, or model-generated confidence.

Conflicting, insufficient, invalid, or low-quality evidence weakens claims and may require a synchronized repeat or an `INCONCLUSIVE` result. Absence of evidence is not evidence of health. A result applies only to the registered conditions tested.

`CONFIRMED` means that an evidence-supported diagnosis was followed by a declared human intervention and the required passing physical verification. It does not mean every component is universally healthy, nor that the exact microscopic failure mechanism is known.

## Core loopback demonstration

The required MVP proof uses this reviewed 3.3 V ESP32-S3 fixture with a common ground:

```text
GPIO4 stimulus ── 1 kΩ ── source node ── removable jumper ── destination node ── 100 kΩ ── GND
                              │                                  │
                            4.7 kΩ                             4.7 kΩ
                              │                                  │
                     GPIO5 source observer              GPIO6 destination observer
```

The two observer inputs are separate physical observation paths. The removable source-to-destination jumper is the reproducible hidden fault: installed represents an intact path; removed represents an open path. Fault setup is performed outside the agent's evidence view and recorded by the test harness/operator for later scoring.

The mandatory initial stimulus plan is a registered 1 kHz, 50% duty-cycle square wave for 500 ms. GPIO4 must be driven low before an experiment is armed and returned low on success, error, timeout, abort, disconnect, and restart. Additional frequency, static-level, waveform, duty/timing, and synchronized endpoint-correlation checks are allowed only as separate registry-defined plans with immutable reviewed parameters.

The first observation is at the destination node. Subsequent eligibility branches on accepted evidence:

- Missing destination signal makes source verification eligible.
- Valid source plus missing destination makes synchronized endpoint comparison eligible and strengthens a path-open hypothesis.
- Malformed destination with valid source makes duty/timing measurement eligible.
- Malformed source and destination makes stimulus/profile investigation eligible.
- Valid source and destination weakens hardware-path hypotheses and may conclude normal.
- Conflicting or marginal evidence makes a synchronized repeat eligible; if bounded repeats cannot resolve it, the session stops inconclusive.

The agent must demonstrably adapt its choice among registered frequency, waveform, timing, and endpoint-correlation experiments. Simulator fixtures and deterministic tests must prove that distinct evidence states produce distinct eligible sets and selections.

The loopback can support a diagnosis such as “the registered signal is present at the source node and absent at the destination node under the tested conditions.” It cannot, without more evidence, identify an exact damaged component or provide independent timebase calibration.

## HC-SR04 optional profile

HC-SR04 is an optional profile, not an MVP dependency. It exposes registered plans for trigger/echo presence, bounded echo timing, timeout rate, repeated-measurement variance, distance progression against declared operator steps, and alignment checks.

Its 5 V Echo output must pass through a reviewed level interface. The documented default divider is 8.2 kΩ from Echo to the ESP32 input node and 10 kΩ from that node to ground; its resistor values, grounding, wiring, and measured/reviewed input level must be recorded in the physical profile before enablement. Direct Echo-to-GPIO connection is prohibited.

Distance derived from echo time is subject to beam width, target material and angle, multipath, blind zone, environment-dependent speed of sound, timer resolution, and fixture alignment. Repeated readings without trusted ground truth are baseline characterization. Distance accuracy is project calibration only when the context declares a traceable distance and alignment procedure.

Rules may support timing-path, timeout, instability, or progression conclusions. They must not claim exact sensor failure from a timeout alone.

## MPU6050 optional profile

MPU6050 is an optional profile. It exposes registered plans for I²C presence and identity, stationary baseline, bounded motion response, bias, noise, drift, and axis-consistency checks.

All I²C pull-ups connected to ESP32-S3 pins must terminate at 3.3 V. A breakout board's regulator claim does not establish safe pull-up voltage; the actual pull-up topology and rail must be reviewed. Addresses, registers, bus rate, ranges, and sample timing stay in the firmware registry and cannot be supplied by the agent.

Stationary offsets, short-term noise, and internally consistent motion responses are baseline characterization unless a declared external orientation or motion reference is used. Gravity-based orientation checks must state alignment and motion assumptions. Observed motion is not proof of another mechanism's movement, and identity/read success is not proof that every axis is accurate.

## DHT11 optional profile

DHT11 is an optional profile. It exposes registered plans for response timing, checksum/error behavior, repeated valid-read rate, stale readings, temperature, and humidity.

A DHT11 data line must not place a 5 V pull-up on an ESP32-S3 GPIO. Physical enablement requires a verified 3.3 V-compatible sensor configuration or a reviewed level shifter. Power, pull-up rail/value, pin binding, minimum read interval, and timing plan are fixed in the reviewed profile.

Readings without an independent environmental reference are baseline characterization. Temperature or humidity accuracy is project calibration only when the context declares a trusted reference instrument and comparison procedure. Valid checksums show protocol consistency, not environmental accuracy; stale values, self-heating, response lag, placement, and the DHT11's limited resolution must remain visible limitations.

## Firmware protocol and safety boundary

On connection, firmware returns a versioned `hello` response containing board identity, firmware build identity, physical/simulation capability, hardware-profile identity, registry digest, fixed bindings, registered plans, limits, and safety state. The backend refuses a session when these do not match project context.

Execution uses semantic plan IDs. The firmware and gateway both reject:

- arbitrary or unregistered pins and bindings;
- caller-supplied waveform frequency, duty, shape, amplitude, or duration;
- arbitrary timing, capture, timeout, or retry values;
- arbitrary ADC pin, attenuation, width, range, or sampling settings;
- arbitrary I²C addresses, registers, bytes, clock rates, or bus operations;
- unknown plans, duplicate/replayed commands, overlapping operations, stale session versions, and exhausted budgets; and
- operations whose profile, setup review, or mode is not enabled.

Every plan has a deadline, abort behavior, and safe cleanup. For the loopback, cleanup always drives GPIO4 low. A watchdog, transport loss, malformed request, or emergency stop must leave registered outputs in their declared safe state. Firmware reports cleanup success separately from measurement success.

Firmware never authorizes a physical repair. All component, jumper, wiring, orientation, placement, or environmental changes are human-only interventions performed after the backend reaches `DIAGNOSIS_READY` and presents a bounded procedure.

## Observation provenance

Every accepted observation records:

- unique observation, session, experiment, and command IDs;
- project-context version and digest;
- board identity, firmware build, hardware-profile ID, capability-registry version and digest;
- registered plan ID and resolved logical/physical binding identities;
- mode (`physical` or `simulation`), adapter identity, and source fixture when simulated;
- start/end wall-clock and monotonic timestamps, sequence number, and duration;
- measurements/series, units, sampling metadata, quality flags, missing/invalid samples, and operation status;
- required operator setup or stimulus declaration;
- gateway validation record, applicable safety limits, abort/timeout state, and cleanup outcome; and
- plan, measurement, synchronization, reference, and claim limitations.

Only gateway-accepted diagnostic or verification observations may update evidence. Monitoring data may support a live display but is tagged `monitoring` and cannot affect hypotheses, confidence, recommendations, verification, or experiment budgets intended for controlled evidence.

Provenance is immutable and append-only. Physical and simulated observations cannot be merged into one evidence chain, and a mode cannot change within a session.

## Intervention and verification lifecycle

The lifecycle has three honest investigation outcomes:

```text
INVESTIGATING
├── CONCLUDED_NORMAL
├── INCONCLUSIVE
└── DIAGNOSIS_READY
        ↓
   INTERVENTION
        ↓
   VERIFYING
        ↓
   CONFIRMED / FAILED_VERIFICATION
```

`CONCLUDED_NORMAL` means the tested behavior met the declared bounds; it does not assert universal health. `INCONCLUSIVE` records what remains unresolved and why. Neither state requests a modification merely to create a verification path.

Only a repair claim enters `DIAGNOSIS_READY`. The recommendation must identify its supporting observations and inference rule, the human action, safety constraints, expected bounded effect, and a predeclared verification plan. The human explicitly records what was actually changed; the agent and firmware cannot perform or silently infer the intervention.

Verification uses new physical observations captured after that declaration. The default threshold is two consecutive passing physical verification runs under the same registered plan and declared conditions. Any failed run resets the consecutive-pass counter. Completion yields `CONFIRMED` or `FAILED_VERIFICATION`; a new investigation may be opened if further diagnosis is warranted.

Simulation may exercise the entire logical path and report a simulated verification pass, but it cannot enter physical `CONFIRMED`.

## Dashboard behavior

The dashboard is one state-aware investigation surface. It shows project/profile identity, mode, connected firmware/capability status, current lifecycle state, active registered experiment, required human action, measurements, evidence, eligible/selected experiment history, verification count, and append-only timeline.

Results are grouped and labeled as `OBSERVED`, `INFERENCE`, `RECOMMENDATION`, and `VERIFICATION`. Claims link to supporting observation IDs and show limitations. Confidence uses only `UNKNOWN`, `POSSIBLE`, `LIKELY`, or `HIGH_CONFIDENCE`; no hypothesis percentages or probability-like graphics appear.

The UI distinguishes:

- `CONCLUDED_NORMAL`: expected behavior observed within tested bounds;
- `INCONCLUSIVE`: evidence exhausted, conflicting, invalid, or insufficient;
- `DIAGNOSIS_READY`: a supported repair claim awaits human action;
- `INTERVENTION`: explicit human declaration is required;
- `VERIFYING`: post-intervention physical runs are in progress;
- `CONFIRMED`: the required physical verification runs passed; and
- `FAILED_VERIFICATION`: the declared change did not satisfy verification.

Simulation is persistently and prominently marked. The UI cannot approve its own pending action, fabricate setup confirmation, edit backend evidence, or relabel a simulated result as physical.

## Physical versus simulation mode

Physical and simulation modes use the same semantic interfaces, gateway rules, evidence rules, lifecycle logic, and report structure, but their provenance and authority remain strictly isolated.

Physical mode requires a matching reviewed board/profile, firmware-advertised registry, explicit setup checks, and real hardware observations. It ships fail-closed until those requirements are satisfied.

Simulation mode uses named, versioned fixtures and seeded/reproducible outputs. Simulator results are labeled in every observation, event, screen, and report. They validate orchestration, branching, safety rejection, evidence logic, and UI states only. They do not validate wiring, voltage levels, timing accuracy, sensor behavior, or physical repair, and can never produce physical `CONFIRMED`.

No session may mix modes, copy simulated observations into a physical evidence chain, or reuse simulated verification counters.

## MVP success criteria

The MVP is accepted when all of the following are demonstrated:

- The protected ESP32-S3 loopback operates as the required proof without any external sensor.
- Firmware advertises a versioned capability registry and only registered plans can execute.
- The default 1 kHz, 50% duty-cycle, 500 ms loopback plan leaves GPIO4 low before and after every outcome.
- Destination-first investigation selects different eligible next experiments for distinct accepted evidence, including source verification, synchronized endpoint comparison, timing/duty analysis, stimulus/profile investigation, repeat, normal conclusion, and inconclusive stop where applicable.
- Arbitrary pins, bindings, waveform parameters, timing, ADC settings, I²C/bus operations, stale decisions, and over-budget requests are rejected by automated tests.
- Physical runs produce real source-node and destination-node measurements with complete, immutable provenance and visible limitations.
- Versioned deterministic rules own evidence sufficiency, hypothesis updates, confidence labels, recommendations, and verification counters.
- Every report and dashboard state explicitly separates observation, inference, recommendation, and verification.
- Every physical modification is performed and declared by a human; the agent and firmware cannot perform it.
- `CONFIRMED` requires two consecutive passing physical verification runs after intervention; simulation cannot produce it.
- Physical and simulation observations, sessions, counters, reports, and UI labels remain strictly isolated.
- Seeded simulator fixtures prove that different evidence produces different eligible experiment sets and selections.
- HC-SR04, MPU6050, and DHT11 are optional profile demonstrations and are not required to pass the sensor-free core proof.
- Builds, schemas, deterministic tests, gateway tests, protocol tests, simulator branching tests, provenance tests, lifecycle tests, and relevant hardware-in-loop loopback tests pass.
- The default context, MVP workflow, acceptance suite, and roadmap contain no requirement for FSRs, resistor optimization, the Jugaad solver, relays, INA219, voltage modules, MOSFET demonstrations, Arduino Uno, SG90 servos, or motors.

## Non-goals

The MVP does not:

- autonomously determine a universal or microscopic root cause;
- provide laboratory-grade measurement, independent frequency calibration, or electrical quantities the reviewed hardware cannot observe;
- expose raw pin, waveform, timing, ADC, or bus control to the model or UI;
- perform physical repair or remove human responsibility for wiring and setup;
- infer that a valid protocol response proves full sensor accuracy or health;
- treat baseline characterization as calibration without an independent declared reference;
- use FSRs, resistor optimization, the Jugaad solver, relays, INA219, voltage modules, MOSFET demonstrations, Arduino Uno, SG90 servos, or motors in the MVP, default context, acceptance criteria, or roadmap; or
- include SG90 actuation: safe use requires a separate power design and a trustworthy observation of physical response, neither of which belongs in this MVP.

## Future optional capability modules

Future work may add independently reviewed modules for external reference instruments, isolated analog front ends, logic/timing references, additional digital buses, environmental reference sources, and other bounded observation methods. Each module must declare what it measures, its independent reference status, uncertainty/limitations, fixed safe plans, and required fixtures.

These modules remain optional and cannot weaken the core gateway, provenance, lifecycle, evidence, human-intervention, or physical-confirmation rules. Inclusion requires its own product decision and electrical/scientific review; the excluded MVP devices and tuning workflows are not implicitly placed on the roadmap.

## Current implementation gap assessment

The capability-first software migration is implemented. The repository now uses the protected ESP32-S3 loopback as its default context, with the three sensor demonstrations isolated as optional profiles. The remaining acceptance gap is physical hardware-in-loop evidence from a reviewed fixture; simulator and compile-time evidence do not satisfy physical acceptance criteria.

Foundations retained and generalized:

- the agent client, opaque experiment selection, and deterministic fallback;
- safety-gateway structure and fail-closed validation patterns;
- serial/simulator adapter boundary;
- provenance checks, append-only events, persistence, and session/report infrastructure;
- SSE-driven updates and the verification counter; and
- corrected lifecycle states and audit concepts.

Completed migration work:

- domain types and schemas into capability-, node-, plan-, and observation-centered models;
- coordinator target assumptions and lifecycle transitions;
- recording/sufficiency logic and monitoring-versus-evidence handling;
- deterministic evidence rules, confidence vocabulary, recommendations, and experiment eligibility;
- simulator fixtures to cover the loopback branch matrix and strict mode isolation;
- firmware protocol, capability advertisement, fixed loopback plans, GPIO cleanup, timeout/budget enforcement, and endpoint capture;
- default project and physical profiles; and
- dashboard labels, result grouping, graphs, controls, and terminal-state behavior.

Items removed from the core path:

- FSR-specific project context, schemas, simulator fixtures, evidence, coordinator targeting, and default firmware profile;
- tuning/candidate solver logic and resistor-specific UI/assets assumptions;
- Jugaad wording and adjustment presentation;
- relay/actuator placeholders and sensor-first module assumptions; and
- unsupported calibration language.

The automated acceptance suite covers schemas, the gateway, adaptive simulator branches, provenance, lifecycle, API behavior, and native firmware safety state. The ESP32-S3 firmware must build before release. Final physical acceptance still requires a reviewed board/profile, the protected fixture, retained hardware-in-loop reports for intact and hidden-open-jumper trials, and two consecutive passing physical verification runs after a declared human intervention.
