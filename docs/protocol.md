# USB serial protocol

Transport is newline-delimited JSON at 115200 baud. Every request has an opaque ID, a bounded command, and an empty argument object.

```json
{"id":"exp-3","cmd":"motor_current_probe","args":{}}
```

```json
{
  "id": "exp-3",
  "ok": true,
  "data": {
    "deviceUptimeMs": 18352,
    "elapsedMs": 350,
    "measurements": [
      {"name":"current_mean_ma","value":2.4,"unit":"mA","sensor":"ina219","quality":"valid"}
    ],
    "sensorHealth": [
      {"sensor":"ina219","healthy":true,"errorRate":0}
    ],
    "safety": {
      "activationAccepted": true,
      "tripped": false,
      "estopLatched": false,
      "timeout": false,
      "reasons": []
    }
  },
  "error": null
}
```

Supported public commands are `scan_i2c`, `sample_motion`, `motor_motion_probe`, `motor_current_probe`, `verify_motor`, and `emergency_stop`. `hello` and session/calibration arming are coordinator-only protocol operations.

Unknown commands, non-empty arguments, duplicates, overlap, cooldown, exhausted budgets, unhealthy required sensors, an invalid profile, and latched e-stop fail closed. Duplicate request IDs return the cached response and never repeat an activation.
