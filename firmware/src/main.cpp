#include <Arduino.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_INA219.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <esp_task_wdt.h>
#include "hardware_config.h"

namespace {
constexpr char FIRMWARE_VERSION[] = "0.1.0";
constexpr uint8_t MPU6050_ADDRESS = 0x68;
constexpr uint8_t INA219_ADDRESS = 0x40;
constexpr size_t SAMPLE_INTERVAL_MS = 10;

Adafruit_MPU6050 mpu;
Adafruit_INA219 ina219(INA219_ADDRESS);
bool mpuReady = false;
bool inaReady = false;
volatile bool emergencyStopLatched = false;
bool operationActive = false;
uint32_t activationCount = 0;
uint32_t cumulativeOnTimeMs = 0;
uint32_t lastActivationEndedAt = 0;

struct ProbeSummary {
  bool ok = false;
  bool activationAccepted = false;
  bool tripped = false;
  float accelerationRmsG = 0;
  float baselineRmsG = 0;
  float currentMeanMa = 0;
  float currentPeakMa = 0;
  float busVoltageV = 0;
  float motionErrorRate = 0;
  float currentErrorRate = 0;
  bool hasMotion = false;
  bool hasCurrent = false;
  uint32_t elapsedMs = 0;
  String errorCode;
  String errorMessage;
};

void IRAM_ATTR emergencyStopInterrupt() {
  emergencyStopLatched = true;
  if (HARDWARE_CONFIGURED) {
    digitalWrite(MOTOR_ENABLE_PIN, LOW);
    digitalWrite(MOTOR_IN1_PIN, LOW);
    digitalWrite(MOTOR_IN2_PIN, LOW);
  }
}

void motorOff() {
  if (!HARDWARE_CONFIGURED) return;
  analogWrite(MOTOR_ENABLE_PIN, 0);
  digitalWrite(MOTOR_ENABLE_PIN, LOW);
  digitalWrite(MOTOR_IN1_PIN, LOW);
  digitalWrite(MOTOR_IN2_PIN, LOW);
}

bool devicePresent(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

void addMeasurement(
  JsonArray measurements,
  const char* name,
  float value,
  const char* unit,
  const char* sensor,
  float errorRate
) {
  JsonObject item = measurements.add<JsonObject>();
  item["name"] = name;
  item["value"] = value;
  item["unit"] = unit;
  item["sensor"] = sensor;
  JsonObject health = item["health"].to<JsonObject>();
  health["healthy"] = errorRate <= 0.05F;
  health["errorRate"] = errorRate;
}

void sendResponse(
  const String& id,
  bool ok,
  uint32_t elapsedMs,
  bool activationAccepted,
  bool tripped,
  const ProbeSummary* summary = nullptr,
  const char* errorCode = nullptr,
  const char* errorMessage = nullptr,
  bool includeAddresses = false
) {
  JsonDocument response;
  response["requestId"] = id;
  response["ok"] = ok;
  response["elapsedMs"] = elapsedMs;
  response["activationAccepted"] = activationAccepted;
  response["tripped"] = tripped;
  JsonArray measurements = response["measurements"].to<JsonArray>();
  if (summary != nullptr) {
    if (summary->hasMotion) {
      addMeasurement(measurements, "acceleration_rms_g", summary->accelerationRmsG, "g", "MPU6050", summary->motionErrorRate);
      addMeasurement(measurements, "baseline_rms_g", summary->baselineRmsG, "g", "MPU6050", summary->motionErrorRate);
    }
    if (summary->hasCurrent) {
      addMeasurement(measurements, "current_mean_ma", summary->currentMeanMa, "mA", "INA219", summary->currentErrorRate);
      addMeasurement(measurements, "current_peak_ma", summary->currentPeakMa, "mA", "INA219", summary->currentErrorRate);
      addMeasurement(measurements, "bus_voltage_v", summary->busVoltageV, "V", "INA219", summary->currentErrorRate);
    }
  }
  if (includeAddresses) {
    JsonArray addresses = response["detectedAddresses"].to<JsonArray>();
    if (inaReady) addresses.add("0x40");
    if (mpuReady) addresses.add("0x68");
    response["firmwareVersion"] = FIRMWARE_VERSION;
  }
  if (errorCode != nullptr) {
    JsonObject error = response["error"].to<JsonObject>();
    error["code"] = errorCode;
    error["message"] = errorMessage;
  }
  serializeJson(response, Serial);
  Serial.println();
}

bool validHardwareConfiguration() {
  return HARDWARE_CONFIGURED &&
    I2C_SDA_PIN >= 0 && I2C_SCL_PIN >= 0 &&
    MOTOR_IN1_PIN >= 0 && MOTOR_IN2_PIN >= 0 && MOTOR_ENABLE_PIN >= 0 &&
    EMERGENCY_STOP_PIN >= 0 &&
    MOTOR_PULSE_MS > 0 && MOTOR_DUTY_PERCENT > 0 && MOTOR_DUTY_PERCENT <= 100 &&
    MOTOR_CURRENT_TRIP_MA > 0 && MAX_ACTIVATIONS_PER_BOOT > 0;
}

bool mayActivate(ProbeSummary& summary) {
  if (!validHardwareConfiguration()) {
    summary.errorCode = "HARDWARE_NOT_CONFIGURED";
    summary.errorMessage = "Validated pins and motor safety limits are required.";
    return false;
  }
  if (emergencyStopLatched) {
    summary.errorCode = "E_STOP_LATCHED";
    summary.errorMessage = "Physical reset is required.";
    return false;
  }
  if (!mpuReady || !inaReady) {
    summary.errorCode = "SENSOR_UNAVAILABLE";
    summary.errorMessage = "Both MPU6050 and INA219 must be healthy.";
    return false;
  }
  if (operationActive) {
    summary.errorCode = "BUSY";
    summary.errorMessage = "Another operation is active.";
    return false;
  }
  if (activationCount >= MAX_ACTIVATIONS_PER_BOOT ||
      cumulativeOnTimeMs + MOTOR_PULSE_MS > MAX_CUMULATIVE_ON_TIME_MS) {
    summary.errorCode = "FIRMWARE_BUDGET_EXHAUSTED";
    summary.errorMessage = "Physical reset is required to clear the activation budget.";
    return false;
  }
  if (lastActivationEndedAt > 0 && millis() - lastActivationEndedAt < MOTOR_COOLDOWN_MS) {
    summary.errorCode = "COOLDOWN_ACTIVE";
    summary.errorMessage = "Motor cooldown has not elapsed.";
    return false;
  }
  return true;
}

void serviceSerialDuringPulse() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  JsonDocument request;
  DeserializationError parseError = deserializeJson(request, line);
  const String id = request["id"] | "unknown";
  if (!parseError && request["cmd"] == "emergency_stop") {
    emergencyStopLatched = true;
    motorOff();
    sendResponse(id, true, 0, false, true);
  } else {
    motorOff();
    sendResponse(id, false, 0, false, false, nullptr, "BUSY", "Only emergency_stop is accepted during a pulse.");
  }
}

ProbeSummary runProbe(bool collectMotion, bool collectDiagnosticCurrent) {
  ProbeSummary summary;
  const uint32_t started = millis();
  if (!mayActivate(summary)) return summary;

  operationActive = true;
  summary.hasMotion = collectMotion;
  summary.hasCurrent = collectDiagnosticCurrent;
  summary.activationAccepted = true;
  digitalWrite(MOTOR_IN1_PIN, HIGH);
  digitalWrite(MOTOR_IN2_PIN, LOW);
  analogWrite(MOTOR_ENABLE_PIN, map(MOTOR_DUTY_PERCENT, 0, 100, 0, 255));

  uint32_t sampleCount = 0;
  uint32_t motionErrors = 0;
  uint32_t currentErrors = 0;
  double squaredAccelerationSum = 0;
  double currentSum = 0;

  while (millis() - started < MOTOR_PULSE_MS) {
    esp_task_wdt_reset();
    serviceSerialDuringPulse();
    if (emergencyStopLatched || digitalRead(EMERGENCY_STOP_PIN) == LOW) {
      emergencyStopLatched = true;
      summary.tripped = true;
      summary.errorCode = "E_STOP_LATCHED";
      summary.errorMessage = "Emergency stop activated.";
      break;
    }

    sampleCount++;
    if (!devicePresent(INA219_ADDRESS)) {
      currentErrors++;
      summary.tripped = true;
      summary.errorCode = "CURRENT_SENSOR_FAILURE";
      summary.errorMessage = "INA219 stopped responding during activation.";
      break;
    }
    const float current = ina219.getCurrent_mA();
    if (!isfinite(current)) {
      currentErrors++;
      summary.tripped = true;
      summary.errorCode = "CURRENT_SENSOR_FAILURE";
      summary.errorMessage = "INA219 returned an invalid reading.";
      break;
    }
    currentSum += current;
    summary.currentPeakMa = max(summary.currentPeakMa, current);
    summary.busVoltageV = ina219.getBusVoltage_V();
    if (current > MOTOR_CURRENT_TRIP_MA) {
      summary.tripped = true;
      summary.errorCode = "OVERCURRENT";
      summary.errorMessage = "Firmware current threshold exceeded.";
      break;
    }

    if (collectMotion) {
      if (!devicePresent(MPU6050_ADDRESS)) {
        motionErrors++;
        summary.tripped = true;
        summary.errorCode = "MOTION_SENSOR_FAILURE";
        summary.errorMessage = "MPU6050 stopped responding during activation.";
        break;
      }
      sensors_event_t acceleration, gyro, temperature;
      mpu.getEvent(&acceleration, &gyro, &temperature);
      const double magnitudeG = sqrt(
        acceleration.acceleration.x * acceleration.acceleration.x +
        acceleration.acceleration.y * acceleration.acceleration.y +
        acceleration.acceleration.z * acceleration.acceleration.z
      ) / SENSORS_GRAVITY_STANDARD;
      const double dynamicG = magnitudeG - 1.0;
      squaredAccelerationSum += dynamicG * dynamicG;
    }
    delay(SAMPLE_INTERVAL_MS);
  }

  motorOff();
  summary.elapsedMs = millis() - started;
  lastActivationEndedAt = millis();
  cumulativeOnTimeMs += summary.elapsedMs;
  activationCount++;
  operationActive = false;
  summary.motionErrorRate = sampleCount == 0 ? 1 : static_cast<float>(motionErrors) / sampleCount;
  summary.currentErrorRate = sampleCount == 0 ? 1 : static_cast<float>(currentErrors) / sampleCount;
  if (collectMotion && sampleCount > motionErrors) {
    summary.accelerationRmsG = sqrt(squaredAccelerationSum / (sampleCount - motionErrors));
  }
  if (collectDiagnosticCurrent && sampleCount > currentErrors) {
    summary.currentMeanMa = currentSum / (sampleCount - currentErrors);
  } else {
    summary.currentMeanMa = 0;
    summary.currentPeakMa = 0;
    summary.busVoltageV = 0;
  }
  summary.ok = summary.errorCode.isEmpty();
  return summary;
}

ProbeSummary sampleIdle() {
  ProbeSummary summary;
  summary.hasMotion = true;
  summary.hasCurrent = true;
  const uint32_t started = millis();
  constexpr uint32_t durationMs = 300;
  uint32_t samples = 0;
  uint32_t motionErrors = 0;
  uint32_t currentErrors = 0;
  double squaredAccelerationSum = 0;
  double currentSum = 0;
  motorOff();
  while (millis() - started < durationMs) {
    if (!devicePresent(MPU6050_ADDRESS)) motionErrors++;
    else {
      sensors_event_t acceleration, gyro, temperature;
      mpu.getEvent(&acceleration, &gyro, &temperature);
      const double magnitudeG = sqrt(
        acceleration.acceleration.x * acceleration.acceleration.x +
        acceleration.acceleration.y * acceleration.acceleration.y +
        acceleration.acceleration.z * acceleration.acceleration.z
      ) / SENSORS_GRAVITY_STANDARD;
      const double dynamicG = magnitudeG - 1.0;
      squaredAccelerationSum += dynamicG * dynamicG;
    }
    if (!devicePresent(INA219_ADDRESS)) currentErrors++;
    else currentSum += ina219.getCurrent_mA();
    samples++;
    delay(SAMPLE_INTERVAL_MS);
  }
  summary.elapsedMs = millis() - started;
  summary.motionErrorRate = samples == 0 ? 1 : static_cast<float>(motionErrors) / samples;
  summary.currentErrorRate = samples == 0 ? 1 : static_cast<float>(currentErrors) / samples;
  if (samples > motionErrors) summary.baselineRmsG = sqrt(squaredAccelerationSum / (samples - motionErrors));
  if (samples > currentErrors) summary.currentMeanMa = currentSum / (samples - currentErrors);
  summary.ok = summary.motionErrorRate <= 0.05F && summary.currentErrorRate <= 0.05F;
  if (!summary.ok) {
    summary.errorCode = "SENSOR_HEALTH_INVALID";
    summary.errorMessage = "Idle calibration exceeded the sensor error limit.";
  }
  return summary;
}

void scanSensors() {
  mpuReady = devicePresent(MPU6050_ADDRESS) && mpu.begin(MPU6050_ADDRESS, &Wire);
  inaReady = devicePresent(INA219_ADDRESS) && ina219.begin(&Wire);
}

void handleCommand(const String& line) {
  const uint32_t started = millis();
  JsonDocument request;
  DeserializationError parseError = deserializeJson(request, line);
  const String id = request["id"] | "unknown";
  if (parseError || !request["cmd"].is<const char*>() || !request["args"].is<JsonObjectConst>()) {
    motorOff();
    sendResponse(id, false, millis() - started, false, false, nullptr, "MALFORMED_REQUEST", "Expected id, cmd, and an args object.");
    return;
  }
  JsonObjectConst args = request["args"].as<JsonObjectConst>();
  if (args.size() != 0) {
    motorOff();
    sendResponse(id, false, millis() - started, false, false, nullptr, "ARGUMENTS_FORBIDDEN", "Hardware commands accept no model-controlled parameters.");
    return;
  }
  const String command = request["cmd"].as<String>();
  if (command == "emergency_stop") {
    emergencyStopLatched = true;
    motorOff();
    sendResponse(id, true, millis() - started, false, true);
    return;
  }
  if (emergencyStopLatched) {
    sendResponse(id, false, millis() - started, false, true, nullptr, "E_STOP_LATCHED", "Physical reset is required.");
    return;
  }
  if (command == "hello" || command == "scan_i2c") {
    scanSensors();
    sendResponse(id, true, millis() - started, false, false, nullptr, nullptr, nullptr, true);
    return;
  }
  if (command == "sample_motion") {
    ProbeSummary summary = sampleIdle();
    sendResponse(id, summary.ok, summary.elapsedMs, false, summary.tripped, &summary,
      summary.ok ? nullptr : summary.errorCode.c_str(), summary.ok ? nullptr : summary.errorMessage.c_str());
    return;
  }

  ProbeSummary summary;
  if (command == "motor_motion_probe") summary = runProbe(true, false);
  else if (command == "motor_current_probe") summary = runProbe(false, true);
  else if (command == "verify_motor") summary = runProbe(true, true);
  else {
    motorOff();
    sendResponse(id, false, millis() - started, false, false, nullptr, "UNKNOWN_COMMAND", "Command is not in the firmware allowlist.");
    return;
  }
  sendResponse(id, summary.ok, summary.elapsedMs, summary.activationAccepted, summary.tripped, &summary,
    summary.ok ? nullptr : summary.errorCode.c_str(), summary.ok ? nullptr : summary.errorMessage.c_str());
}
}  // namespace

void setup() {
  Serial.begin(115200);
  Serial.setTimeout(25);
  if (HARDWARE_CONFIGURED) {
    pinMode(MOTOR_IN1_PIN, OUTPUT);
    pinMode(MOTOR_IN2_PIN, OUTPUT);
    pinMode(MOTOR_ENABLE_PIN, OUTPUT);
    pinMode(EMERGENCY_STOP_PIN, INPUT_PULLUP);
    motorOff();
    attachInterrupt(digitalPinToInterrupt(EMERGENCY_STOP_PIN), emergencyStopInterrupt, FALLING);
    Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
    scanSensors();
  }
}

void loop() {
  esp_task_wdt_reset();
  if (HARDWARE_CONFIGURED && digitalRead(EMERGENCY_STOP_PIN) == LOW) {
    emergencyStopLatched = true;
    motorOff();
  }
  if (Serial.available()) {
    const String line = Serial.readStringUntil('\n');
    if (!line.isEmpty()) handleCommand(line);
  }
  delay(1);
}
