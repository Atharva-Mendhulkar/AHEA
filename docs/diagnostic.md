# AHEA diagnostic methods

## HC-SR04 ultrasonic sensor

Treat the HC-SR04 as an independent DUT. Do not use it to prove servo motion or another sensor's health.

1. Verify VCC, GND, trigger wiring, and the protected Echo path.
2. Confirm the Echo output is level-shifted before it reaches the ESP32 input.
3. Use a flat target, a declared distance, and fixed alignment.
4. Measure echo timing, timeout rate, repeated-reading variance, and whether readings progress in the expected direction as the target moves.

| Observation | Diagnosis | Exact next action |
| --- | --- | --- |
| No echo / repeated timeout | power, wiring, target, or Echo-level interface issue | Check 5 V, GND, D26 trigger, D35 protected Echo, and target position before replacing the sensor. |
| High variance at a fixed target | alignment, multipath, loose wiring, or supply noise | Re-align a flat target, clear secondary reflectors, and inspect wiring/decoupling. |
| Readings do not follow target movement | geometry, blind-zone, or sensor response issue | Test outside the 2 cm blind zone with a flat target normal to the sensing cone. |
| Stable readings but fixed offset | baseline/calibration offset | Record the offset against a declared reference; do not claim accuracy without that reference. |

Distance is `echo_us × 0.0343 / 2`. Temperature, target material, angle, beam width, and reflections affect the result. A timeout alone is not proof that the sensor is dead.
