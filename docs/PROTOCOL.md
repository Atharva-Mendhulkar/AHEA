# ESP32 Serial Protocol

Transport is newline-delimited JSON at 115200 baud. Exactly one non-emergency operation may be active.

## Request

```json
{"id":"exp-03","cmd":"motor_current_probe","args":{}}
```

`args` must be an empty object. This prevents callers from changing physical parameters.

## Commands

| Command | Activates motor | Purpose |
|---|---:|---|
| `hello` | No | Firmware identity and capabilities |
| `scan_i2c` | No | Detect `0x40` and `0x68` |
| `sample_motion` | No | Idle current and motion baseline |
| `motor_motion_probe` | Yes | Diagnostic motion evidence |
| `motor_current_probe` | Yes | Diagnostic current evidence |
| `verify_motor` | Yes | Combined post-repair evidence |
| `emergency_stop` | Stops | Latch motor disabled until reset |

## Response

```json
{
  "requestId": "exp-03",
  "ok": true,
  "elapsedMs": 503,
  "activationAccepted": true,
  "tripped": false,
  "measurements": [
    {
      "name": "current_mean_ma",
      "value": 2.4,
      "unit": "mA",
      "sensor": "INA219",
      "health": {"healthy": true, "errorRate": 0}
    }
  ]
}
```

The laptop adds session-level provenance. Firmware reports only facts it owns: request correlation, execution state, elapsed time, measurements, and sensor health.

## Errors

| Code | Meaning |
|---|---|
| `MALFORMED_REQUEST` | Required request structure was not valid |
| `ARGUMENTS_FORBIDDEN` | Caller attempted to supply parameters |
| `UNKNOWN_COMMAND` | Command is outside the allowlist |
| `HARDWARE_NOT_CONFIGURED` | Fail-closed profile is incomplete |
| `BUSY` | An operation is already active |
| `COOLDOWN_ACTIVE` | Minimum off-time has not elapsed |
| `FIRMWARE_BUDGET_EXHAUSTED` | Count or cumulative on-time limit reached |
| `E_STOP_LATCHED` | Physical reset required |
| `CURRENT_SENSOR_FAILURE` | INA219 failed during activation |
| `MOTION_SENSOR_FAILURE` | MPU6050 failed during motion collection |
| `OVERCURRENT` | Configured current threshold exceeded |

Malformed input, sensor failure, and unknown commands leave motor outputs LOW.
