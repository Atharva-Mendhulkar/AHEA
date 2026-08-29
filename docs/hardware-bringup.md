# Physical sensor bring-up

Physical mode is not enabled by the committed profile.

Before changing `PHYSICAL_ENABLED`:

1. Identify the exact ESP32/ESP32-S3 board and ADC limitations.
2. Assign every logical binding in `hardware_profile.h` to a reviewed pin.
3. Record the actual FSR divider topology, resistor units/value, supply, ADC attenuation, and safe ADC maximum.
4. Confirm DHT11 voltage and pull-up wiring.
5. Add and verify an HC-SR04 echo divider or level shifter before connecting its 5 V echo output.
6. Keep servo and relay actuation disabled; neither has an approved power/driver profile.
7. Build and flash firmware, then confirm `hello` identities match project context.
8. Exercise each sensor command individually and retain raw serial evidence.
9. Test malformed input, unknown device/plan IDs, duplicate IDs, timeout, USB disconnect, and abort behavior.
10. Run the full FSR reference/outlier/intervention/verification procedure and report manual-stimulus limitations.

Do not copy the simulation example's 10 kΩ divider into physical context unless inspection confirms it. Physical testing has not been completed in this repository.
