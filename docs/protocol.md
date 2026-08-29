# USB serial protocol

Transport is newline-delimited JSON at 115200 baud. Requests contain an opaque ID, a semantic command, and only a registered device/plan identity:

```json
{"id":"exp-3","cmd":"sample_fsr","args":{"deviceId":"fsr5","planId":"fsr-standard-v1"}}
```

Responses contain bounded measurements, health, and operation state:

```json
{
  "id":"exp-3",
  "ok":true,
  "data":{
    "elapsedMs":640,
    "measurements":[
      {"channel":"adc_mean","value":1432,"unit":"adc_raw","deviceId":"fsr5","quality":"valid"}
    ],
    "sensorHealth":[{"deviceId":"fsr5","healthy":true,"errorRate":0}],
    "operation":{"accepted":true,"aborted":false,"timedOut":false,"estopLatched":false,"reasons":[]}
  },
  "error":null
}
```

The five-DUT demo supports `scan_i2c`, `sample_mpu6050`, `sample_dht11`, `sample_voltage`, `sample_ina219`, `exercise_servo`, and `abort`. `hello` and `arm_session` are coordinator operations. `exercise_servo` is rejected unless the reviewed profile explicitly enables it.

Raw pins, PWM, ADC configuration, arbitrary timing, resistor values, and I²C bytes are not accepted. Firmware rejects unknown commands, bindings, plans, arguments, duplicates, overlap, timeout, disabled profiles, and exhausted budgets.
