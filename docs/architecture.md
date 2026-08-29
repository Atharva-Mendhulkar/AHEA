# Architecture

## Runtime flow

```text
Immutable project context + firmware capability registry
                         ↓
        evidence-dependent eligible experiments
                         ↓
          agent selects one opaque experiment ID
                         ↓
             safety gateway revalidates
                         ↓
             simulator or ESP32-S3 adapter
                         ↓
        provenance-complete physical observation
                         ↓
              deterministic evidence rules
                         ↓
 normal / inconclusive / diagnosis → human change → verification
```

The core model is capability-first. A profile contributes registered plans, measurement schemas, eligibility predicates, and deterministic evidence rules. Optional sensor profiles cannot replace the gateway, provenance rules, lifecycle, or confirmation threshold.

## Ownership

- Project context owns intent, expected bounds, procedures, allowed plans, and budgets.
- Firmware owns fixed bindings, immutable plan parameters, deadlines, output cleanup, and capability advertisement.
- The coordinator owns mode isolation, state transitions, eligibility, freshness, counters, and audit events.
- The agent chooses among eligible opaque IDs and provides only a short evidence-linked rationale.
- Adapters normalize results without changing their physical or simulation provenance.
- The evidence engine produces `OBSERVED`, `INFERENCE`, `RECOMMENDATION`, and `VERIFICATION` data with backend-owned confidence labels.
- The human owns setup confirmation and every physical intervention.

## Lifecycle

```text
INVESTIGATING
├── CONCLUDED_NORMAL
├── INCONCLUSIVE
└── DIAGNOSIS_READY → INTERVENTION → VERIFYING → CONFIRMED / FAILED_VERIFICATION
```

Only a supported repair claim enters intervention. Simulation can exercise verification logic but ends without physical confirmation.

## Persistence and events

Sessions use schema version 3. Earlier session files remain untouched and are rejected rather than reinterpreted. State snapshots are written atomically, timeline events are append-only NDJSON, and SSE publishes snapshots and new audit events.
