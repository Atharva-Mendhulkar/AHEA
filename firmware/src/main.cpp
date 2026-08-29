#include <Arduino.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_INA219.h>
#include <esp_task_wdt.h>
#include "hardware_profile.h"
#include "safety_state.h"

namespace {
constexpr char FIRMWARE_VERSION[] = "0.1.0";
constexpr char PROTOCOL_VERSION[] = "1.0";
constexpr uint8_t MPU6050_ADDRESS = 0x68;
constexpr uint8_t INA219_ADDRESS = 0x40;

ahea::SafetyMachine safety(
    ahea::profile::PULSE_DURATION_MS,
    ahea::profile::HARD_TIMEOUT_MS,
    ahea::profile::COOLDOWN_MS,
    ahea::profile::MAX_SESSION_ACTIVATIONS,
    ahea::profile::MAX_DIAGNOSTIC_ACTIVATIONS,
    ahea::profile::MAX_VERIFICATION_ACTIVATIONS);
Adafruit_INA219 ina219(INA219_ADDRESS);

String line_buffer;
String active_id;
String active_command;
String last_request_id;
String last_response;
bool ina_ready = false;
bool mpu_ready = false;
uint32_t active_started_ms = 0;
uint32_t samples = 0;
uint32_t sensor_errors = 0;
float current_sum_ma = 0;
float current_peak_ma = 0;
double accel_square_sum = 0;

void motorOff() {
  if constexpr (ahea::profile::PHYSICAL_ENABLED) {
    ledcWrite(ahea::profile::PWM_CHANNEL, 0);
    digitalWrite(ahea::profile::MOTOR_IN1_PIN, LOW);
    digitalWrite(ahea::profile::MOTOR_IN2_PIN, LOW);
  }
}

void motorOn() {
  if constexpr (ahea::profile::PHYSICAL_ENABLED) {
    digitalWrite(ahea::profile::MOTOR_IN1_PIN, HIGH);
    digitalWrite(ahea::profile::MOTOR_IN2_PIN, LOW);
    ledcWrite(ahea::profile::PWM_CHANNEL, ahea::profile::PWM_DUTY);
  }
}

bool i2cPresent(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

bool readAccelerationMagnitude(float& magnitude_g) {
  Wire.beginTransmission(MPU6050_ADDRESS);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(MPU6050_ADDRESS, static_cast<uint8_t>(6)) != 6) return false;
  int16_t x = static_cast<int16_t>((Wire.read() << 8) | Wire.read());
  int16_t y = static_cast<int16_t>((Wire.read() << 8) | Wire.read());
  int16_t z = static_cast<int16_t>((Wire.read() << 8) | Wire.read());
  const float gx = x / 16384.0F;
  const float gy = y / 16384.0F;
  const float gz = z / 16384.0F;
  // Remove the static 1 g gravity component. Calibration supplies the final
  // backend threshold; this firmware value is only the bounded probe summary.
  magnitude_g = fabsf(sqrtf(gx * gx + gy * gy + gz * gz) - 1.0F);
  return true;
}

void addMeasurement(JsonArray measurements, const char* name, JsonVariantConst value,
                    const char* unit, const char* sensor, bool valid) {
  JsonObject item = measurements.add<JsonObject>();
  item["name"] = name;
  item["value"] = value;
  item["unit"] = unit;
  item["sensor"] = sensor;
  item["quality"] = valid ? "valid" : "invalid";
}

template <typename T>
void addMeasurement(JsonArray measurements, const char* name, T value,
                    const char* unit, const char* sensor, bool valid) {
  JsonObject item = measurements.add<JsonObject>();
  item["name"] = name;
  item["value"] = value;
  item["unit"] = unit;
  item["sensor"] = sensor;
  item["quality"] = valid ? "valid" : "invalid";
}

void addHealth(JsonArray health, const char* sensor, bool healthy, float error_rate, const char* detail = nullptr) {
  JsonObject item = health.add<JsonObject>();
  item["sensor"] = sensor;
  item["healthy"] = healthy;
  item["errorRate"] = error_rate;
  if (detail) item["detail"] = detail;
}

String serializeResponse(JsonDocument& response) {
  String output;
  serializeJson(response, output);
  return output;
}

void sendError(const String& id, const char* code, const char* message) {
  motorOff();
  JsonDocument response;
  response["id"] = id;
  response["ok"] = false;
  response["data"] = nullptr;
  JsonObject error = response["error"].to<JsonObject>();
  error["code"] = code;
  error["message"] = message;
  String output = serializeResponse(response);
  Serial.println(output);
  last_request_id = id;
  last_response = output;
}

JsonDocument baseSuccess(const String& id, bool activation_accepted, uint32_t elapsed_ms) {
  JsonDocument response;
  response["id"] = id;
  response["ok"] = true;
  response["error"] = nullptr;
  JsonObject data = response["data"].to<JsonObject>();
  data["deviceUptimeMs"] = millis();
  data["elapsedMs"] = elapsed_ms;
  data["measurements"].to<JsonArray>();
  data["sensorHealth"].to<JsonArray>();
  JsonObject result = data["safety"].to<JsonObject>();
  result["activationAccepted"] = activation_accepted;
  result["tripped"] = safety.tripped();
  result["estopLatched"] = safety.estopLatched();
  result["timeout"] = safety.timedOut();
  JsonArray reasons = result["reasons"].to<JsonArray>();
  if (safety.estopLatched()) reasons.add("EMERGENCY_STOP_LATCHED");
  if (safety.timedOut()) reasons.add("HARD_TIMEOUT");
  if (safety.tripped() && !safety.timedOut()) reasons.add("CURRENT_OR_SENSOR_SAFETY_TRIP");
  return response;
}

void sendAndRemember(JsonDocument& response) {
  String output = serializeResponse(response);
  Serial.println(output);
  last_request_id = response["id"].as<String>();
  last_response = output;
}

void sendHello(const String& id) {
  JsonDocument response = baseSuccess(id, false, 1);
  JsonArray measurements = response["data"]["measurements"].as<JsonArray>();
  addMeasurement(measurements, "firmware_version", FIRMWARE_VERSION, "semver", "firmware", true);
  addMeasurement(measurements, "board_identity", ahea::profile::BOARD_IDENTITY, "id", "firmware", true);
  addMeasurement(measurements, "protocol_version", PROTOCOL_VERSION, "semver", "firmware", true);
  addMeasurement(measurements, "profile_id", ahea::profile::PROFILE_ID, "id", "firmware", true);
  addMeasurement(measurements, "physical_enabled", ahea::profile::PHYSICAL_ENABLED, "boolean", "firmware", true);
  addMeasurement(measurements, "pulse_duration_ms", ahea::profile::PULSE_DURATION_MS, "ms", "firmware", true);
  addMeasurement(measurements, "current_limit_ma", ahea::profile::ABSOLUTE_CURRENT_LIMIT_MA, "mA", "firmware", true);
  addHealth(response["data"]["sensorHealth"].as<JsonArray>(), "firmware", true, 0);
  sendAndRemember(response);
}

void sendScan(const String& id) {
  const bool mpu = i2cPresent(MPU6050_ADDRESS);
  const bool ina = i2cPresent(INA219_ADDRESS);
  JsonDocument response = baseSuccess(id, false, 2);
  JsonArray measurements = response["data"]["measurements"].as<JsonArray>();
  addMeasurement(measurements, "mpu6050_present", mpu, "boolean", "firmware", true);
  addMeasurement(measurements, "ina219_present", ina, "boolean", "firmware", true);
  JsonArray health = response["data"]["sensorHealth"].as<JsonArray>();
  addHealth(health, "mpu6050", mpu, mpu ? 0 : 1);
  addHealth(health, "ina219", ina, ina ? 0 : 1);
  sendAndRemember(response);
}

void sendMotionSample(const String& id) {
  float magnitude = 0;
  const bool ok = readAccelerationMagnitude(magnitude);
  JsonDocument response = baseSuccess(id, false, 2);
  addMeasurement(response["data"]["measurements"].as<JsonArray>(), "acceleration_rms_g", magnitude,
                 "g", "mpu6050", ok);
  addHealth(response["data"]["sensorHealth"].as<JsonArray>(), "mpu6050", ok, ok ? 0 : 1);
  sendAndRemember(response);
}

const char* startResultCode(ahea::StartResult result) {
  switch (result) {
    case ahea::StartResult::NotArmed: return "NOT_ARMED";
    case ahea::StartResult::Busy: return "OVERLAP";
    case ahea::StartResult::Cooldown: return "COOLDOWN";
    case ahea::StartResult::BudgetExhausted: return "BUDGET_EXHAUSTED";
    case ahea::StartResult::DiagnosticBudgetExhausted: return "DIAGNOSTIC_BUDGET_EXHAUSTED";
    case ahea::StartResult::VerificationBudgetExhausted: return "VERIFICATION_BUDGET_EXHAUSTED";
    case ahea::StartResult::SensorUnhealthy: return "SENSOR_UNHEALTHY";
    case ahea::StartResult::Estopped: return "ESTOPPED";
    default: return "ACCEPTED";
  }
}

void startProbe(const String& id, const String& command) {
  const bool needs_motion = command != "motor_current_probe";
  const bool needs_current = command != "motor_motion_probe";
  const bool sensors_healthy = (!needs_motion || mpu_ready) && (!needs_current || ina_ready);
  const ahea::ProbeKind kind = command == "verify_motor"
      ? ahea::ProbeKind::Verification
      : command == "motor_current_probe" ? ahea::ProbeKind::Current : ahea::ProbeKind::Motion;
  const ahea::StartResult result = safety.start(kind, millis(), sensors_healthy);
  if (result != ahea::StartResult::Accepted) {
    sendError(id, startResultCode(result), "Firmware safety state rejected the activation.");
    return;
  }
  active_id = id;
  active_command = command;
  active_started_ms = millis();
  samples = 0;
  sensor_errors = 0;
  current_sum_ma = 0;
  current_peak_ma = 0;
  accel_square_sum = 0;
  motorOn();
}

void finishProbe() {
  motorOff();
  const float error_rate = samples == 0 ? 1.0F : static_cast<float>(sensor_errors) / samples;
  const bool healthy = samples > 0 && error_rate <= 0.05F;
  const float current_mean = samples == 0 ? 0 : current_sum_ma / samples;
  const float acceleration_rms = samples == 0 ? 0 : sqrt(accel_square_sum / samples);
  JsonDocument response = baseSuccess(active_id, true, millis() - active_started_ms);
  JsonArray measurements = response["data"]["measurements"].as<JsonArray>();
  JsonArray health = response["data"]["sensorHealth"].as<JsonArray>();
  if (active_command != "motor_current_probe") {
    addMeasurement(measurements, "acceleration_rms_g", acceleration_rms, "g", "mpu6050", healthy);
    addMeasurement(measurements, "expected_motion_signature_detected", acceleration_rms >= 0.05F, "boolean", "mpu6050", healthy);
    addHealth(health, "mpu6050", healthy, error_rate);
  }
  if (active_command != "motor_motion_probe") {
    addMeasurement(measurements, "current_mean_ma", current_mean, "mA", "ina219", healthy);
    addMeasurement(measurements, "current_peak_ma", current_peak_ma, "mA", "ina219", healthy);
    addHealth(health, "ina219", healthy, error_rate);
  }
  sendAndRemember(response);
  active_id = "";
  active_command = "";
}

void processCommand(const String& line) {
  JsonDocument request;
  if (deserializeJson(request, line) != DeserializationError::Ok ||
      !request["id"].is<const char*>() || !request["cmd"].is<const char*>() ||
      !request["args"].is<JsonObject>() || request["args"].size() != 0) {
    motorOff();
    sendError("unknown", "MALFORMED_REQUEST", "Expected id, cmd, and empty args object.");
    return;
  }
  const String id = request["id"].as<String>();
  const String command = request["cmd"].as<String>();
  if (id == last_request_id) {
    Serial.println(last_response);
    return;
  }
  if (command == "emergency_stop") {
    motorOff();
    safety.emergencyStop();
    JsonDocument response = baseSuccess(id, false, 0);
    addHealth(response["data"]["sensorHealth"].as<JsonArray>(), "firmware", true, 0);
    sendAndRemember(response);
    active_id = "";
    return;
  }
  if (!active_id.isEmpty()) {
    sendError(id, "OVERLAP", "Another operation is active.");
    return;
  }
  if (command == "hello") return sendHello(id);
  if (command == "scan_i2c") return sendScan(id);
  if (command == "sample_motion") return sendMotionSample(id);
  if (command == "arm_session" || command == "arm_calibration") {
    const bool armed = safety.arm(ahea::profile::PHYSICAL_ENABLED, digitalRead(ahea::profile::ESTOP_PIN) == HIGH);
    if (!armed) return sendError(id, "ARM_REJECTED", "Profile invalid, faulted, or emergency stop active.");
    JsonDocument response = baseSuccess(id, false, 0);
    addHealth(response["data"]["sensorHealth"].as<JsonArray>(), "firmware", true, 0);
    return sendAndRemember(response);
  }
  if (command == "motor_motion_probe" || command == "motor_current_probe" || command == "verify_motor") {
    return startProbe(id, command);
  }
  sendError(id, "UNKNOWN_COMMAND", "Command is not supported.");
}
}  // namespace

void setup() {
  motorOff();
  pinMode(ahea::profile::ESTOP_PIN, INPUT_PULLUP);
  if constexpr (ahea::profile::PHYSICAL_ENABLED) {
    pinMode(ahea::profile::MOTOR_ENABLE_PIN, OUTPUT);
    pinMode(ahea::profile::MOTOR_IN1_PIN, OUTPUT);
    pinMode(ahea::profile::MOTOR_IN2_PIN, OUTPUT);
    ledcSetup(ahea::profile::PWM_CHANNEL, ahea::profile::PWM_FREQUENCY_HZ, ahea::profile::PWM_RESOLUTION_BITS);
    ledcAttachPin(ahea::profile::MOTOR_ENABLE_PIN, ahea::profile::PWM_CHANNEL);
  }
  Serial.begin(115200);
  Wire.begin();
  mpu_ready = i2cPresent(MPU6050_ADDRESS);
  if (mpu_ready) {
    Wire.beginTransmission(MPU6050_ADDRESS);
    Wire.write(0x6B);
    Wire.write(0);
    mpu_ready = Wire.endTransmission() == 0;
  }
  ina_ready = ina219.begin();
  esp_task_wdt_config_t watchdog = {
    .timeout_ms = 1000,
    .idle_core_mask = 0,
    .trigger_panic = true,
  };
  esp_task_wdt_reconfigure(&watchdog);
  esp_task_wdt_add(nullptr);
}

void loop() {
  esp_task_wdt_reset();
  if (digitalRead(ahea::profile::ESTOP_PIN) == LOW) {
    motorOff();
    safety.emergencyStop();
  }
  while (Serial.available()) {
    const char character = static_cast<char>(Serial.read());
    if (character == '\n') {
      if (!line_buffer.isEmpty()) processCommand(line_buffer);
      line_buffer = "";
    } else if (line_buffer.length() < 1024) {
      line_buffer += character;
    } else {
      line_buffer = "";
      motorOff();
      safety.fault();
    }
  }

  if (!active_id.isEmpty() && !safety.motorEnabled()) {
    finishProbe();
  } else if (!active_id.isEmpty() && safety.motorEnabled()) {
    float current_ma = ina_ready ? ina219.getCurrent_mA() : 0;
    float acceleration_g = 0;
    const bool motion_ok = active_command == "motor_current_probe" || readAccelerationMagnitude(acceleration_g);
    // INA219 remains mandatory for trip monitoring during every motor pulse.
    const bool current_ok = ina_ready && isfinite(current_ma);
    samples++;
    if (!motion_ok || !current_ok) sensor_errors++;
    if (current_ok) {
      current_sum_ma += current_ma;
      current_peak_ma = max(current_peak_ma, current_ma);
    }
    if (motion_ok) accel_square_sum += acceleration_g * acceleration_g;
    if (!motion_ok || !current_ok) {
      safety.fault();
      motorOff();
      finishProbe();
    } else if (!safety.tick(millis(), current_ma, ahea::profile::ABSOLUTE_CURRENT_LIMIT_MA,
                     digitalRead(ahea::profile::ESTOP_PIN) == LOW)) {
      finishProbe();
    }
  }
}
