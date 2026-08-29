# AHEA five-DUT hardware demo

This is the physical demonstration for the diagnostic-first AHEA project. Test one device under test (DUT) at a time; a reading from one DUT is never evidence about another DUT.

## Bench wiring

Use an ESP32-S3, a common ground rail, and separate disconnect points for every DUT.

| DUT | ESP32-S3 connection | Power/support requirement | Demonstration result |
| --- | --- | --- | --- |
| MPU6050 | SDA → D21, SCL → D22 | 3.3 V, GND, 4.7 kOhm I2C pull-ups if absent on module, 100 nF/4.7 uF nearby | I2C presence and acceleration magnitude near 1 g at rest |
| DHT11 | DATA → D27 | 3.3 V, GND, 1 kOhm data pull-up, 100 nF nearby | Valid temperature/humidity read |
| Voltage divider | ADC node → D34 | 30 kOhm VIN→D34, 7.5 kOhm D34→GND; VIN must be ≤16.5 V | calculated input voltage and ADC stability |
| INA219 | SDA → D21, SCL → D22 | 3.3 V, GND, known 0.1 Ohm shunt, load in VIN+ to VIN- path | bus, shunt, current, and power readings |
| Servo | signal → D25 | independent regulated 5 V supply and common ground; never use ESP32 3.3 V | bounded PWM sweep plus visual response check |

Before powering the board, verify continuity of the common ground, the divider ratio `Vout/Vin = R2/(R1+R2)`, and that the maximum divider output is safely below 3.3 V. The INA219 shunt check follows `I = Vshunt/Rshunt`.

## Make a reviewed profile

The committed [hardware_profile.h](../firmware/include/hardware_profile.h) contains this ESP32 DevKit pin map. Physical sensor reads are enabled. Servo actuation remains disabled. After verifying the separate servo supply and mechanical travel, change:

```cpp
constexpr bool SERVO_ACTUATION_ENABLED = true;
```

Keep the servo disabled for the first four DUT demonstrations. Enable it only after confirming its separate 5 V rail, shared ground, safe mechanical travel, and selected PWM pin. Give `PROFILE_ID` and `BOARD_IDENTITY` real values so the serial evidence identifies the actual bench.

## Flash and run

```bash
pio run -d firmware -t upload
pio device monitor -d firmware -b 115200
```

Send one newline-terminated JSON command at a time. First arm the reviewed profile:

```json
{"id":"hello-1","cmd":"hello","args":{}}
{"id":"arm-1","cmd":"arm_session","args":{}}
{"id":"i2c-1","cmd":"scan_i2c","args":{}}
```

Then demonstrate each independent diagnostic:

```json
{"id":"mpu-1","cmd":"sample_mpu6050","args":{"deviceId":"mpu6050"}}
{"id":"dht-1","cmd":"sample_dht11","args":{"deviceId":"dht11"}}
{"id":"voltage-1","cmd":"sample_voltage","args":{"deviceId":"voltage_sensor"}}
{"id":"ina-1","cmd":"sample_ina219","args":{"deviceId":"ina219"}}
```

After the reviewed servo enablement only:

```json
{"id":"servo-1","cmd":"exercise_servo","args":{"deviceId":"servo"}}
```

The servo command sweeps fixed 1000 and 2000 microsecond pulses and returns to centre. It reports that a command was issued, not that the servo is healthy: observe the response and compare it with the 300–600 ms target.

## What to say during the demo

- MPU6050 absent: inspect 3.3 V, GND, SDA/SCL, and 4.7 kOhm pull-ups.
- DHT11 invalid: inspect the 1 kOhm pull-up, decoupling, and data wiring.
- Voltage result wrong or noisy: recalculate/measure the divider resistors and inspect joints and ground.
- INA219 absent or wrong: inspect its I2C wiring, shunt value, calibration, and decoupling.
- Servo powered with valid PWM but no/slow movement: replace the servo after verifying the 5 V rail and signal wire.

Use `{"id":"stop-1","cmd":"abort","args":{}}` to latch the emergency stop. Reset the board to clear that latch.
