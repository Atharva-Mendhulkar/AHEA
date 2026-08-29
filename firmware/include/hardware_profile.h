#pragma once

// SAFE-DISABLED SHIPPING PROFILE.
// Replace only after a documented pin/electrical review and never commit live
// secrets or operator-specific serial paths here.
namespace ahea::profile {
constexpr bool PHYSICAL_ENABLED = false;
constexpr const char* PROFILE_ID = "SAFE_DISABLED";
constexpr const char* BOARD_IDENTITY = "UNREVIEWED_ESP32S3";
constexpr int MOTOR_ENABLE_PIN = -1;
constexpr int MOTOR_IN1_PIN = -1;
constexpr int MOTOR_IN2_PIN = -1;
constexpr int ESTOP_PIN = 0;
constexpr int PWM_CHANNEL = 0;
constexpr int PWM_FREQUENCY_HZ = 20000;
constexpr int PWM_RESOLUTION_BITS = 8;
constexpr int PWM_DUTY = 90;
constexpr unsigned long PULSE_DURATION_MS = 350;
constexpr unsigned long HARD_TIMEOUT_MS = 500;
constexpr unsigned long COOLDOWN_MS = 2000;
constexpr float ABSOLUTE_CURRENT_LIMIT_MA = 750.0F;
constexpr unsigned int MAX_SESSION_ACTIVATIONS = 6;
constexpr unsigned int MAX_DIAGNOSTIC_ACTIVATIONS = 2;
constexpr unsigned int MAX_VERIFICATION_ACTIVATIONS = 4;
}  // namespace ahea::profile
