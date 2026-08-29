# Contributing to AHEA

Thanks for helping make hardware diagnosis safer and more reproducible.

Start with the [phased roadmap](docs/roadmap.md). Choose work from the earliest incomplete phase unless a maintainer has explicitly approved a later-phase dependency.

## Development setup

1. Install Node.js 22+, npm, and optionally PlatformIO.
2. Run `npm install`.
3. Copy `.env.example` to `.env`; an OpenAI key is optional.
4. Run `npm run check` before submitting a change.
5. For firmware work, also run `npm run firmware:test` and `npm run firmware:build`.

## Design invariants

- The model selects semantic actions; it never owns electrical parameters, confidence, lifecycle, or verification counters.
- The coordinator owns state transitions, approval freshness, budgets, and the audit trail.
- The evidence engine remains deterministic and side-effect free.
- Adapters preserve provenance and never combine physical and simulated evidence.
- Firmware independently fails safe and bounds every physical operation.
- Physical mode remains disabled unless a reviewed ESP32-S3 binding/electrical profile and matching capability registry are present.
- User-visible rationales must be concise explanations, not private chain-of-thought.

## Change guidance

- Add shared wire/domain changes under `shared/` first and validate them at every trust boundary.
- Keep adapter-specific behavior under `server/adapters/`.
- Add evidence rules to `server/evidence.ts` with focused unit tests.
- Add lifecycle or budget behavior to `server/coordinator.ts` with transition tests.
- Do not introduce arbitrary GPIO, PWM, voltage, current, duration, serial, shell, or model-controlled safety settings.
- Preserve existing audit data compatibility or document the migration.

## Testing expectations

- Every safety regression needs a failing test before or with the fix.
- Simulator changes must cover intact, open-path, malformed-destination, stimulus-fault, conflicting-evidence, and verification-failure branches.
- OpenAI-dependent tests stay opt-in and must record response IDs; deterministic tests must not require a network connection.
- Physical claims require documented hardware-in-loop results and must not be inferred from simulator results.

## Commit and review checklist

- Keep commits focused and explain the behavior change.
- Confirm generated data, `.env`, keys, serial paths, and build outputs are not committed.
- Include tests and documentation for public interface changes.
- Call out any impact on safety, evidence classification, activation budgets, calibration, or provenance.
