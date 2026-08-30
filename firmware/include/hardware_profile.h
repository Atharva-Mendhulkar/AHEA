#pragma once

// SAFE-DISABLED TEMPLATE. Set PHYSICAL_ENABLED only after reviewing the exact
// ESP32-S3 board, 3.3 V wiring, protection resistors, and optional profile.
#ifndef AHEA_MPU6050_REVIEWED_PROFILE
#define AHEA_MPU6050_REVIEWED_PROFILE 0
#endif
#ifndef AHEA_HC_SR04_REVIEWED_PROFILE
#define AHEA_HC_SR04_REVIEWED_PROFILE 0
#endif
#ifndef AHEA_LOOPBACK_REVIEWED_PROFILE
#define AHEA_LOOPBACK_REVIEWED_PROFILE 0
#endif

#if (AHEA_LOOPBACK_REVIEWED_PROFILE + AHEA_MPU6050_REVIEWED_PROFILE + AHEA_HC_SR04_REVIEWED_PROFILE) > 1
#error "Select exactly one reviewed physical profile."
#endif

namespace ahea::profile {
constexpr bool PHYSICAL_ENABLED = AHEA_LOOPBACK_REVIEWED_PROFILE == 1 || AHEA_MPU6050_REVIEWED_PROFILE == 1 || AHEA_HC_SR04_REVIEWED_PROFILE == 1;
constexpr const char* PROFILE_ID = AHEA_LOOPBACK_REVIEWED_PROFILE == 1 ? "esp32s3-n16r8-loopback-2k-10k-reviewed-v1" : AHEA_HC_SR04_REVIEWED_PROFILE == 1 ? "esp32s3-n16r8-hc-sr04-reviewed-v1" : AHEA_MPU6050_REVIEWED_PROFILE == 1 ? "esp32s3-n16r8-mpu6050-reviewed-v1" : "esp32s3-loopback-safe-disabled-v1";
constexpr const char* BOARD_IDENTITY = PHYSICAL_ENABLED ? "ESP32-S3-N16R8-CP2102" : "ESP32-S3-N16R8-CP2102-UNREVIEWED";

constexpr int LOOPBACK_STIMULUS_PIN = 4;
constexpr int LOOPBACK_SOURCE_OBSERVER_PIN = 5;
constexpr int LOOPBACK_DESTINATION_OBSERVER_PIN = 6;
constexpr int LOOPBACK_STIMULUS_SERIES_OHMS = 2000;
constexpr int LOOPBACK_OBSERVER_SERIES_OHMS = 10000;
constexpr int LOOPBACK_DESTINATION_PULLDOWN_OHMS = 10000;
constexpr bool LOOPBACK_FIXTURE_REVIEWED = AHEA_LOOPBACK_REVIEWED_PROFILE == 1;

constexpr bool HC_SR04_ENABLED = AHEA_HC_SR04_REVIEWED_PROFILE == 1;
constexpr int HC_SR04_TRIGGER_PIN = 16;
constexpr int HC_SR04_ECHO_PIN = 17;
constexpr bool HC_SR04_ECHO_DIVIDER_REVIEWED = AHEA_HC_SR04_REVIEWED_PROFILE == 1;
constexpr int HC_SR04_ECHO_UPPER_OHMS = 8200;
constexpr int HC_SR04_ECHO_LOWER_OHMS = 10000;

constexpr bool MPU6050_ENABLED = AHEA_MPU6050_REVIEWED_PROFILE == 1;
constexpr int MPU6050_SDA_PIN = 14;
constexpr int MPU6050_SCL_PIN = 13;
constexpr uint8_t MPU6050_ADDRESS = 0x68;
constexpr uint32_t MPU6050_I2C_FREQUENCY_HZ = 100000;
constexpr bool I2C_PULLUPS_AT_3V3_REVIEWED = AHEA_MPU6050_REVIEWED_PROFILE == 1;

constexpr bool DHT11_ENABLED = false;
constexpr int DHT11_PIN = -1;
constexpr bool DHT11_3V3_INTERFACE_REVIEWED = false;

constexpr unsigned long OPERATION_TIMEOUT_MS = 6000;
constexpr unsigned int WATCHDOG_TIMEOUT_SECONDS = 8;
constexpr unsigned int MAX_SESSION_OPERATIONS = 24;
}  // namespace ahea::profile
