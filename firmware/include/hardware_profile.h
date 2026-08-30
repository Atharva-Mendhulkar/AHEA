#pragma once

// Reviewed ESP32 DevKit bench profile. Never power a servo from a GPIO.
namespace ahea::profile {
constexpr bool PHYSICAL_ENABLED = true;
constexpr const char* PROFILE_ID = "esp32-devkit-hc-sr04-reviewed-v1";
constexpr const char* BOARD_IDENTITY = "ESP32_DEVKIT";
constexpr int LOOPBACK_STIMULUS_PIN = 4;
constexpr int LOOPBACK_SOURCE_OBSERVER_PIN = 5;
constexpr int LOOPBACK_DESTINATION_OBSERVER_PIN = 6;
constexpr bool LOOPBACK_FIXTURE_REVIEWED = false;
constexpr int I2C_SDA_PIN = 21;
constexpr int I2C_SCL_PIN = 22;
constexpr uint8_t MPU6050_ADDRESS = 0x68;
constexpr int MPU6050_SDA_PIN = 21;
constexpr int MPU6050_SCL_PIN = 22;
constexpr uint32_t MPU6050_I2C_FREQUENCY_HZ = 100000;
constexpr bool MPU6050_ENABLED = false;
constexpr bool I2C_PULLUPS_AT_3V3_REVIEWED = true;
constexpr uint8_t INA219_I2C_ADDRESS = 0x40;
constexpr int DHT11_PIN = 27;
constexpr bool DHT11_ENABLED = false;
constexpr bool DHT11_3V3_INTERFACE_REVIEWED = false;
constexpr int VOLTAGE_ADC_PIN = 34;
constexpr int SERVO_PWM_PIN = 25;
constexpr int HC_SR04_TRIGGER_PIN = 18;
constexpr int HC_SR04_ECHO_PIN = 19;
constexpr bool HC_SR04_ENABLED = true;
// This bench sensor is powered at 3.3 V and its Echo is verified 3.3 V logic.
constexpr bool HC_SR04_ECHO_PROTECTION_REVIEWED = true;
constexpr bool HC_SR04_ECHO_DIRECT_3V3_REVIEWED = true;
// The existing firmware gate uses these fields for a reviewed Echo interface;
// this direct 3.3 V wiring has no external divider.
constexpr bool HC_SR04_ECHO_DIVIDER_REVIEWED = true;
constexpr int HC_SR04_ECHO_UPPER_OHMS = 8200;
constexpr int HC_SR04_ECHO_LOWER_OHMS = 10000;
// Use these exact resistors: 30 kOhm from VIN to GPIO34, 7.5 kOhm from GPIO34 to GND.
// This 5:1 divider is only safe for an input at or below 16.5 V.
constexpr float VOLTAGE_DIVIDER_R1_OHMS = 30000.0F;
constexpr float VOLTAGE_DIVIDER_R2_OHMS = 7500.0F;
constexpr float ADC_REFERENCE_VOLTS = 3.3F;
constexpr float INA219_SHUNT_OHMS = 0.1F;
constexpr unsigned long OPERATION_TIMEOUT_MS = 3000;
constexpr unsigned int MAX_SESSION_OPERATIONS = 24;
constexpr unsigned int WATCHDOG_TIMEOUT_SECONDS = 8;
constexpr bool SERVO_ACTUATION_ENABLED = false;
constexpr int SERVO_MIN_US = 1000;
constexpr int SERVO_MAX_US = 2000;
}  // namespace ahea::profile
