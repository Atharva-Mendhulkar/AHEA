# Physical ESP32-S3 bring-up

Physical mode is disabled in the committed profile.

## Pre-wiring readiness

The connected module has been identified over its CP2102 UART bridge as an ESP32-S3 N16R8 configuration:

- ESP32-S3 revision 0.2
- 16 MB QIO flash at 3.3 V
- 8 MB OPI PSRAM
- 40 MHz crystal
- serial transport at 115200 baud

The project-local PlatformIO board definition is `esp32-s3-n16r8`. The default build keeps `ARDUINO_USB_CDC_ON_BOOT=0` because AHEA communicates through the CP2102 UART bridge. Physical output remains compile-time disabled in `firmware/include/hardware_profile.h`.

The software-only readiness gate is:

```bash
npm run build
npm test
pio test -d firmware -e native
pio run -d firmware
```

Before physical enablement, these checks must pass and the firmware must continue to advertise no unreviewed plans. The backend validates the protocol version, board/profile identities, registry payload digest, complete plan set, fixed parameters, bindings, phases, budgets, measurement channels/units, and cleanup declarations.

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

After steps 1–7 are physically inspected, replace the `UNREVIEWED` board identity with the recorded fixture identity, assign a new reviewed profile ID in both firmware and project context, and only then set `PHYSICAL_ENABLED` and `LOOPBACK_FIXTURE_REVIEWED`. Never reuse the safe-disabled profile ID for an enabled build.

Use the CP2102 port to upload and start the backend:

```bash
pio run -d firmware -t upload --upload-port /dev/cu.usbserial-0001
AHEA_PHYSICAL_ENABLED=true AHEA_SERIAL_PATH=/dev/cu.usbserial-0001 npm run dev
```

The physical acceptance record must retain:

- the successful `hello` response and capability registry;
- an intact-jumper destination-first run;
- a hidden open-jumper diagnostic run;
- output-low evidence after success, malformed input, timeout, abort, disconnect, and restart; and
- two consecutive passing physical verification runs after the operator declares the intervention.

The generated and measured waveform shares the ESP32-S3 timebase and is not an independent calibration source.

## Optional profiles

- HC-SR04 on the reviewed N16R8 profile: GPIO16 through 1 kΩ to Trig. Echo through 8.2 kΩ to GPIO17, with 10 kΩ from GPIO17 to GND. Power VCC from 5 V and share GND. Never connect the 5 V Echo output directly to the ESP32-S3; verify the divider node stays below 3.3 V before flashing the profile.
- MPU6050: verify that SDA and SCL pull-ups terminate at 3.3 V regardless of breakout-board regulator claims.
- DHT11: verify a 3.3 V data pull-up or use reviewed level shifting; never expose the GPIO to a 5 V pull-up.

Record any trusted external reference as a named project-calibration procedure. Without one, label the work baseline characterization.
