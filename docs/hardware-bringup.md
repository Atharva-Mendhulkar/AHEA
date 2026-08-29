# Physical ESP32-S3 bring-up

Physical mode is disabled in the committed profile.

## Core loopback

Before setting `PHYSICAL_ENABLED` and `LOOPBACK_FIXTURE_REVIEWED`:

1. Confirm the exact ESP32-S3 board and its 3.3 V GPIO behavior. ESP32-S3 pins are not 5 V tolerant.
2. Connect GPIO4 through 1 kΩ to the source node.
3. Connect GPIO5 to the source node through 4.7 kΩ.
4. Add a removable jumper from source to destination.
5. Connect GPIO6 to the destination node through 4.7 kΩ.
6. Connect the destination to ground through 100 kΩ and use a common ground.
7. Confirm GPIO4 is low at boot, before arming, after every plan, after timeout, and after abort.
8. Build and flash firmware, then confirm the `hello` identities and registered plan set match project context.
9. Run intact and removed-jumper trials and retain raw protocol evidence.

The generated and measured waveform shares the ESP32-S3 timebase and is not an independent calibration source.

## Optional profiles

- HC-SR04: place 8.2 kΩ from Echo to the input node and 10 kΩ from that node to ground, then review the resulting level before enabling the profile.
- MPU6050: verify that SDA and SCL pull-ups terminate at 3.3 V regardless of breakout-board regulator claims.
- DHT11: verify a 3.3 V data pull-up or use reviewed level shifting; never expose the GPIO to a 5 V pull-up.

Record any trusted external reference as a named project-calibration procedure. Without one, label the work baseline characterization.
