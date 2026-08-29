#pragma once

// SAFE-DISABLED TEMPLATE. Replace only after the board, wiring, ADC divider,
// HC-SR04 echo protection, and power arrangement have been reviewed.
namespace ahea::profile {
constexpr bool PHYSICAL_ENABLED = false;
constexpr const char* PROFILE_ID = "esp32-fsr-safe-disabled-v1";
constexpr const char* BOARD_IDENTITY = "UNREVIEWED_ESP32_OR_ESP32S3";
constexpr int DHT11_PIN = -1;
constexpr int HC_SR04_TRIGGER_PIN = -1;
constexpr int HC_SR04_ECHO_PIN = -1;
constexpr bool HC_SR04_ECHO_PROTECTION_REVIEWED = false;
constexpr int FSR_ADC_PINS[5] = {-1, -1, -1, -1, -1};
constexpr unsigned long OPERATION_TIMEOUT_MS = 3000;
constexpr unsigned int MAX_SESSION_OPERATIONS = 24;
constexpr bool SERVO_ACTUATION_ENABLED = false;
constexpr bool RELAY_ACTUATION_ENABLED = false;
}  // namespace ahea::profile
