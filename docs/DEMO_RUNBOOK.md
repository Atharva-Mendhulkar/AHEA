# Demo Runbook

## Preparation

1. Complete the hardware handoff and safety checklist.
2. Start the server with Azure credentials configured.
3. Select **Physical ESP32-S3** and connect the serial port.
4. Confirm INA219 `0x40` and MPU6050 `0x68` are detected.
5. With the motor healthy, capture calibration and approve the known-good pulse.
6. Turn off motor power, disconnect the designated lead, secure it, and restore power.

## Timed diagnosis

1. Enter: “The motor is supposed to run, but nothing is moving. Diagnose it.”
2. Start diagnosis and show the four competing hypotheses.
3. Approve `motor_motion_probe`.
4. Show: expected motor-induced motion signature absent.
5. Highlight the Azure decision record selecting `motor_current_probe` from that observation.
6. Approve the current probe.
7. Show current near `Iidle`, compared with `Ihealthy`.
8. Show backend result: **HIGH CONFIDENCE — open or otherwise unenergized motor path**.
9. Turn off motor power, reconnect the lead, restore power, and declare the intervention.
10. Approve verification one.
11. Approve verification two after cooldown.
12. Finish on the backend-owned `CONFIRMED` report.

Do not say that the motor definitely was not rotating or that the lead was proven broken before repair. The motion sensor detects an indirect physical signature, and low current does not uniquely locate an electrical break.

## Safety demonstration

Demonstrate E-stop and serial-loss timeout separately from the main diagnosis. Reset the ESP32 afterward because E-stop is deliberately latched.

## Simulator backup

Select Simulation and the disconnected fixture. The banner must remain visible in recordings. Simulation is a development and backup demonstration, not physical evidence.
