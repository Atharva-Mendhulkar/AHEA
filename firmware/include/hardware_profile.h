#pragma once

// Reviewed ESP32 DevKit bench profile. Never power a servo from a GPIO.
namespace ahea::profile {
constexpr bool PHYSICAL_ENABLED = true;
constexpr const char* PROFILE_ID = "esp32-devkit-ahea-five-dut-v1";
constexpr const char* BOARD_IDENTITY = "ESP32_DEVKIT";
constexpr int I2C_SDA_PIN = 21;
constexpr int I2C_SCL_PIN = 22;
constexpr uint8_t MPU6050_ADDRESS = 0x68;
constexpr uint8_t INA219_I2C_ADDRESS = 0x40;
constexpr int DHT11_PIN = 27;
constexpr int VOLTAGE_ADC_PIN = 34;
constexpr int SERVO_PWM_PIN = 25;
constexpr int HC_SR04_TRIGGER_PIN = 26;
constexpr int HC_SR04_ECHO_PIN = 35;
// HC-SR04 Echo is 5 V; use equal 10 kOhm resistors for a safe 2.5 V GPIO level.
constexpr bool HC_SR04_ECHO_PROTECTION_REVIEWED = true;
// Use these exact resistors: 30 kOhm from VIN to GPIO34, 7.5 kOhm from GPIO34 to GND.
// This 5:1 divider is only safe for an input at or below 16.5 V.
constexpr float VOLTAGE_DIVIDER_R1_OHMS = 30000.0F;
constexpr float VOLTAGE_DIVIDER_R2_OHMS = 7500.0F;
constexpr float ADC_REFERENCE_VOLTS = 3.3F;
constexpr float INA219_SHUNT_OHMS = 0.1F;
constexpr unsigned long OPERATION_TIMEOUT_MS = 3000;
constexpr unsigned int MAX_SESSION_OPERATIONS = 24;
constexpr bool SERVO_ACTUATION_ENABLED = false;
constexpr int SERVO_MIN_US = 1000;
constexpr int SERVO_MAX_US = 2000;
}  // namespace ahea::profile
