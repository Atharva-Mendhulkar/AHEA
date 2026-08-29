#pragma once

// Copy validated values into hardware_config.h. Motor commands fail closed while
// HARDWARE_CONFIGURED is 0. Do not guess GPIO assignments or safety limits.
#define HARDWARE_CONFIGURED 0

#define I2C_SDA_PIN -1
#define I2C_SCL_PIN -1
#define MOTOR_IN1_PIN -1
#define MOTOR_IN2_PIN -1
#define MOTOR_ENABLE_PIN -1
#define EMERGENCY_STOP_PIN -1

#define MOTOR_PULSE_MS 500
#define MOTOR_DUTY_PERCENT 50
#define MOTOR_CURRENT_TRIP_MA 0.0F
#define MOTOR_COOLDOWN_MS 2000
#define MAX_ACTIVATIONS_PER_BOOT 6
#define MAX_CUMULATIVE_ON_TIME_MS 3000
