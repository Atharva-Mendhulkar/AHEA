# Hardware Engineer Build Guide

This document is the complete physical-build handoff for the Hardware Agent motor demonstrator. Do not enable motor commands until every required value and bench check below is complete.

## Deliverable

Build one low-voltage motor test fixture containing:

- ESP32-S3 development board
- MPU6050 breakout rigidly attached to the motor body or mount
- INA219 breakout in the motor-supply path
- L298N motor driver
- 3–6 V brushed DC hobby motor
- Separate current-limited motor supply
- USB connection for ESP32 data/power
- Normally-open momentary emergency-stop button wired active-low
- Breadboard or secured terminal connections and jumper wires
- Common ground between ESP32, driver logic, sensors, and motor supply
- An accessible motor lead that can be disconnected and restored during the demo

Also provide the completed configuration and measured calibration worksheet in this document to the software operator.

## Required electrical topology

```text
Motor supply +  ── INA219 VIN+ / VIN- ── L298N motor supply
Motor supply -  ──────────────────────── common ground

ESP32 GPIO ── L298N IN1
ESP32 GPIO ── L298N IN2
ESP32 GPIO ── L298N ENA
L298N OUT1 / OUT2 ── motor

ESP32 SDA/SCL ── MPU6050 and INA219 I2C bus
ESP32 E-stop GPIO ── button ── ground
```

Place INA219 so it measures the motor-driver supply current associated with the tested channel. Record whether driver quiescent current is included in `Iidle`; calibration handles it consistently.

Do not power the motor from ESP32 3.3 V, 5 V, USB, or a GPIO. Use a separately current-limited motor supply appropriate for the motor. Connect grounds only after checking polarity.

## Wiring worksheet

Complete these values from the actual board labels and schematic. Do not select strapping, USB, flash, PSRAM, or otherwise reserved pins.

| Function | Selected value | Verified by |
|---|---:|---|
| ESP32-S3 board model |  |  |
| I2C SDA GPIO |  |  |
| I2C SCL GPIO |  |  |
| L298N IN1 GPIO |  |  |
| L298N IN2 GPIO |  |  |
| L298N ENA GPIO |  |  |
| Active-low E-stop GPIO |  |  |
| Motor rated voltage |  |  |
| Motor supply voltage |  |  |
| Supply current limit |  |  |
| Fuse rating, if used |  |  |

Expected I2C addresses:

- INA219: `0x40`
- MPU6050: `0x68`

## Firmware-limit worksheet

Measure before choosing limits. The values must protect the weakest element: motor, driver, wiring, connector, and supply.

| Limit | Selected value | Basis |
|---|---:|---|
| Fixed pulse duration, ms |  |  |
| Fixed PWM duty, % |  |  |
| Firmware current trip, mA |  |  |
| Cooldown, ms |  |  |
| Activations per boot |  |  |
| Cumulative on-time per boot, ms |  |  |

Copy the approved values into `firmware/include/hardware_config.h`, assign all pins, and change `HARDWARE_CONFIGURED` to `1`. Firmware refuses every motor activation while configuration is incomplete.

## Assembly procedure

1. Leave USB and motor power disconnected.
2. Check the motor supply polarity and set its current limit conservatively.
3. Wire the L298N logic and motor channel with ENA disabled.
4. Insert INA219 in the motor-supply path with correct polarity.
5. Wire the shared I2C bus and confirm breakout voltage compatibility.
6. Attach MPU6050 rigidly to the motor housing or common mount. A loose sensor invalidates motion evidence.
7. Wire the E-stop button from the configured input to ground. Firmware uses the internal pull-up.
8. Verify continuity and absence of shorts with a meter.
9. Connect USB only. Confirm motor outputs remain LOW at boot.
10. Run I2C scan and confirm only the expected addresses are required.
11. Connect the current-limited motor supply with ENA still inactive.
12. Test the physical E-stop before enabling a diagnostic pulse.

## Healthy calibration

Calibrate before introducing the fault and without moving the sensor or wiring:

1. Keep the motor inactive and capture `Iidle` and `Mbase`.
2. Approve one known-good fixed activation.
3. Capture `Ihealthy` and `Mhealthy`.
4. Confirm there was no trip and sensor errors did not exceed 5%.
5. Record the values below.

| Measurement | Value | Unit |
|---|---:|---|
| `Iidle` |  | mA |
| `Ihealthy` |  | mA |
| `Mbase` |  | g RMS |
| `Mhealthy` |  | g RMS |

## Fault injection

After calibration, turn off motor power and disconnect one motor lead at the designated accessible connection. Do not tell the agent which fault was introduced. Restore power only after confirming the loose conductor cannot short another node.

For repair, turn off motor power, reconnect the same lead securely, inspect it, restore power, and tell the dashboard that the intervention is complete.

## Mandatory bench tests

Do not mark physical safety verified until all checks pass:

- Outputs remain LOW during boot, reset, and malformed requests.
- Unknown commands and any non-empty `args` object are rejected.
- A pulse ends at the configured firmware timeout with Node disconnected.
- A serial disconnect cannot extend a pulse.
- Pressing physical E-stop during a pulse immediately disables outputs.
- E-stop remains latched until physical reset.
- Disconnecting either sensor during activation stops the motor.
- Current above the configured trip stops the motor.
- Cooldown and per-boot budgets reject excess activations.
- Healthy calibration repeats consistently.
- Disconnected lead produces absent motion signature and near-idle current.
- Reconnection produces healthy current and motion twice.

## Handoff approval

| Check | Name/date |
|---|---|
| Wiring independently inspected |  |
| GPIO assignments approved |  |
| Electrical limits approved |  |
| Current-limited supply or fuse present |  |
| Physical E-stop tested |  |
| Timeout with serial disconnected tested |  |
| Calibration captured |  |
| Five complete physical rehearsals passed |  |

INA219 supervision is software-based and has sampling latency. It does not replace a fuse, current-limited supply, proper wiring, or operator supervision.
