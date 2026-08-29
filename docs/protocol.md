# USB serial protocol

Transport is newline-delimited JSON at 115200 baud. Runtime requests contain an opaque request ID and a registered plan identity only:

```json
{"id":"exp-3","cmd":"execute_plan","args":{"targetId":"loopback-path","planId":"loopback.compare-endpoints.1khz.v1"}}
```

The only commands are `hello`, `arm_session`, `execute_plan`, and `abort`. Unknown arguments are rejected. Callers cannot provide pins, waveform values, timing, ADC settings, I²C addresses/registers/bytes, or arbitrary bus operations.

`hello` returns board, firmware, protocol, and hardware-profile identities plus the versioned capability registry and digest. Before arming, the backend compares every required plan's type, bindings, phases, budget class, duration, fixed parameters, measurement channels/units, and cleanup behavior with its reviewed definition. A missing or altered field fails closed.

A successful plan response includes:

- plan and binding identities;
- firmware, board, profile, and registry identities;
- monotonic start/end time and sequence number;
- typed measurements and bounded series;
- target health and operation status;
- explicit cleanup success; and
- measurement and claim limitations.

Firmware rejects malformed input, unknown plans or bindings, duplicates, overlapping operations, disabled profiles, timeouts, exhausted budgets, and latched emergency stops. The loopback stimulus is driven low on success, error, timeout, abort, disconnect handling, and restart.
