#include <Arduino.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <Wire.h>
#include "hardware_profile.h"
#include "safety_state.h"

namespace {
constexpr const char* FIRMWARE_VERSION = "2.0.0";
constexpr const char* PROTOCOL_VERSION = "2.0";
constexpr uint8_t MPU6050_ADDRESS = 0x68;
constexpr uint16_t FSR_SAMPLE_COUNT = 64;
constexpr uint16_t FSR_SAMPLE_INTERVAL_MS = 10;
ahea::SafetyMachine safety(ahea::profile::OPERATION_TIMEOUT_MS, ahea::profile::MAX_SESSION_OPERATIONS);
DHT dht(ahea::profile::DHT11_PIN, DHT11);
String line_buffer;
String last_request_id;
String last_response;

template <typename T>
void addMeasurement(JsonArray measurements, const char* channel, T value, const char* unit, const String& device_id, bool valid = true) {
  JsonObject item = measurements.add<JsonObject>(); item["channel"] = channel; item["value"] = value; item["unit"] = unit; item["deviceId"] = device_id; item["quality"] = valid ? "valid" : "invalid";
}
void addHealth(JsonArray health, const String& device_id, bool healthy, float error_rate, const char* detail = nullptr) {
  JsonObject item = health.add<JsonObject>(); item["deviceId"] = device_id; item["healthy"] = healthy; item["errorRate"] = error_rate; if (detail) item["detail"] = detail;
}
JsonDocument success(const String& id, bool accepted = true, uint32_t elapsed_ms = 0) {
  JsonDocument response; response["id"] = id; response["ok"] = true; response["error"] = nullptr;
  JsonObject data = response["data"].to<JsonObject>(); data["deviceUptimeMs"] = millis(); data["elapsedMs"] = elapsed_ms; data["measurements"].to<JsonArray>(); data["series"].to<JsonArray>(); data["sensorHealth"].to<JsonArray>();
  JsonObject operation = data["operation"].to<JsonObject>(); operation["accepted"] = accepted; operation["aborted"] = false; operation["timedOut"] = safety.timedOut(); operation["estopLatched"] = safety.estopLatched(); operation["reasons"].to<JsonArray>(); return response;
}
void send(JsonDocument& response) { String output; serializeJson(response, output); Serial.println(output); last_request_id = response["id"].as<String>(); last_response = output; }
void sendError(const String& id, const char* code, const char* message) { JsonDocument response; response["id"] = id; response["ok"] = false; response["data"] = nullptr; JsonObject error = response["error"].to<JsonObject>(); error["code"] = code; error["message"] = message; send(response); }
bool i2cPresent(uint8_t address) { Wire.beginTransmission(address); return Wire.endTransmission() == 0; }
int fsrPin(const String& device_id) {
  if (device_id == "fsr1") return ahea::profile::FSR_ADC_PINS[0]; if (device_id == "fsr2") return ahea::profile::FSR_ADC_PINS[1]; if (device_id == "fsr3") return ahea::profile::FSR_ADC_PINS[2]; if (device_id == "fsr4") return ahea::profile::FSR_ADC_PINS[3]; if (device_id == "fsr5") return ahea::profile::FSR_ADC_PINS[4]; return -1;
}
bool beginRead(const String& id) { const auto result = safety.start(ahea::OperationClass::Read, millis()); if (result != ahea::StartResult::Accepted) { sendError(id, "SAFETY_REJECTED", "Firmware safety state rejected the bounded read."); return false; } return true; }

void sendHello(const String& id) {
  JsonDocument response = success(id, true, 1); JsonArray measurements = response["data"]["measurements"].as<JsonArray>();
  addMeasurement(measurements, "firmware_version", FIRMWARE_VERSION, "semver", "firmware"); addMeasurement(measurements, "board_identity", ahea::profile::BOARD_IDENTITY, "id", "firmware"); addMeasurement(measurements, "protocol_version", PROTOCOL_VERSION, "semver", "firmware"); addMeasurement(measurements, "profile_id", ahea::profile::PROFILE_ID, "id", "firmware"); addMeasurement(measurements, "physical_enabled", ahea::profile::PHYSICAL_ENABLED, "boolean", "firmware");
  addHealth(response["data"]["sensorHealth"].as<JsonArray>(), "firmware", true, 0); send(response);
}
void scanI2c(const String& id) {
  const uint32_t started = millis(); const bool present = i2cPresent(MPU6050_ADDRESS);
  JsonDocument response = success(id, true, millis() - started); addMeasurement(response["data"]["measurements"].as<JsonArray>(), "mpu6050_present", present, "boolean", "mpu6050"); addHealth(response["data"]["sensorHealth"].as<JsonArray>(), "mpu6050", present, present ? 0 : 1); send(response);
}
void identifyMpu(const String& id) {
  if (!beginRead(id)) return; const uint32_t started = millis(); Wire.beginTransmission(MPU6050_ADDRESS); Wire.write(0x75); bool ok = Wire.endTransmission(false) == 0 && Wire.requestFrom(MPU6050_ADDRESS, static_cast<uint8_t>(1)) == 1; int identity = ok ? Wire.read() : -1; safety.finish();
  JsonDocument response = success(id, ok, millis() - started); addMeasurement(response["data"]["measurements"].as<JsonArray>(), "who_am_i", identity, "register", "mpu6050", ok); addHealth(response["data"]["sensorHealth"].as<JsonArray>(), "mpu6050", ok, ok ? 0 : 1); send(response);
}
bool readMpu(float& ax, float& ay, float& az, float& gx, float& gy, float& gz) {
  Wire.beginTransmission(MPU6050_ADDRESS); Wire.write(0x3B); if (Wire.endTransmission(false) != 0 || Wire.requestFrom(MPU6050_ADDRESS, static_cast<uint8_t>(14)) != 14) return false;
  auto read16 = []() { return static_cast<int16_t>((Wire.read() << 8) | Wire.read()); };
  ax = read16() / 16384.0F; ay = read16() / 16384.0F; az = read16() / 16384.0F; read16(); gx = read16() / 131.0F; gy = read16() / 131.0F; gz = read16() / 131.0F; return true;
}
void sampleMpu(const String& id, const String& device_id) {
  if (!beginRead(id)) return; const uint32_t started = millis(); float ax=0, ay=0, az=0, gx=0, gy=0, gz=0; const bool ok = readMpu(ax, ay, az, gx, gy, gz); safety.finish();
  JsonDocument response = success(id, ok, millis() - started); JsonArray values = response["data"]["measurements"].as<JsonArray>(); addMeasurement(values, "accel_x_g", ax, "g", device_id, ok); addMeasurement(values, "accel_y_g", ay, "g", device_id, ok); addMeasurement(values, "accel_z_g", az, "g", device_id, ok); addMeasurement(values, "gyro_x_dps", gx, "deg/s", device_id, ok); addMeasurement(values, "gyro_y_dps", gy, "deg/s", device_id, ok); addMeasurement(values, "gyro_z_dps", gz, "deg/s", device_id, ok); addHealth(response["data"]["sensorHealth"].as<JsonArray>(), device_id, ok, ok ? 0 : 1); send(response);
}
void sampleDht(const String& id, const String& device_id) {
  if (!beginRead(id)) return; const uint32_t started = millis(); const float humidity = dht.readHumidity(); const float temperature = dht.readTemperature(); const bool ok = isfinite(humidity) && isfinite(temperature); safety.finish();
  JsonDocument response = success(id, ok, millis() - started); addMeasurement(response["data"]["measurements"].as<JsonArray>(), "temperature_c", temperature, "C", device_id, ok); addMeasurement(response["data"]["measurements"].as<JsonArray>(), "humidity_percent", humidity, "%", device_id, ok); addHealth(response["data"]["sensorHealth"].as<JsonArray>(), device_id, ok, ok ? 0 : 1, ok ? nullptr : "DHT11 checksum or timing failure."); send(response);
}
void measureDistance(const String& id, const String& device_id) {
  if (!ahea::profile::HC_SR04_ECHO_PROTECTION_REVIEWED) return sendError(id, "ECHO_PROTECTION_REQUIRED", "HC-SR04 echo protection is not reviewed.");
  if (!beginRead(id)) return; const uint32_t started = millis(); digitalWrite(ahea::profile::HC_SR04_TRIGGER_PIN, LOW); delayMicroseconds(2); digitalWrite(ahea::profile::HC_SR04_TRIGGER_PIN, HIGH); delayMicroseconds(10); digitalWrite(ahea::profile::HC_SR04_TRIGGER_PIN, LOW); const unsigned long duration = pulseIn(ahea::profile::HC_SR04_ECHO_PIN, HIGH, 30000); const bool ok = duration > 0; const float distance = duration * 0.0343F / 2.0F; safety.finish();
  JsonDocument response = success(id, ok, millis() - started); response["data"]["operation"]["timedOut"] = !ok; addMeasurement(response["data"]["measurements"].as<JsonArray>(), "distance_cm", distance, "cm", device_id, ok); addHealth(response["data"]["sensorHealth"].as<JsonArray>(), device_id, ok, ok ? 0 : 1, ok ? nullptr : "Echo timeout."); send(response);
}
void sampleFsr(const String& id, const String& device_id, const String& plan_id) {
  if (plan_id != "fsr-standard-v1" && plan_id != "fsr-standard-v1-verify") return sendError(id, "UNKNOWN_PLAN", "Only registered FSR sampling plans are accepted.");
  const int pin = fsrPin(device_id); if (pin < 0) return sendError(id, "UNKNOWN_BINDING", "FSR device is not bound in the reviewed firmware profile.");
  if (!beginRead(id)) return; const uint32_t started = millis(); float sum = 0; float square_sum = 0; uint16_t values[FSR_SAMPLE_COUNT]; bool ok = true;
  for (uint16_t index = 0; index < FSR_SAMPLE_COUNT; index++) { if (!safety.tick(millis())) { ok = false; break; } const uint16_t value = analogRead(pin); values[index] = value; sum += value; square_sum += static_cast<float>(value) * value; delay(FSR_SAMPLE_INTERVAL_MS); }
  const float average = sum / FSR_SAMPLE_COUNT; const float variance = max(0.0F, square_sum / FSR_SAMPLE_COUNT - average * average); const float deviation = sqrtf(variance); safety.finish();
  JsonDocument response = success(id, ok, millis() - started); JsonArray measurements = response["data"]["measurements"].as<JsonArray>(); addMeasurement(measurements, "adc_mean", average, "adc_raw", device_id, ok); addMeasurement(measurements, "adc_stddev", deviation, "adc_raw", device_id, ok); addMeasurement(measurements, "normalized_response", average / 4095.0F, "ratio", device_id, ok); JsonObject series = response["data"]["series"].as<JsonArray>().add<JsonObject>(); series["channel"] = "adc_raw"; series["unit"] = "adc_raw"; series["deviceId"] = device_id; series["sampleIntervalMs"] = FSR_SAMPLE_INTERVAL_MS; JsonArray trace = series["values"].to<JsonArray>(); for (uint16_t value : values) trace.add(value); addHealth(response["data"]["sensorHealth"].as<JsonArray>(), device_id, ok, ok ? 0 : 1); send(response);
}

void processCommand(const String& line) {
  JsonDocument request; if (deserializeJson(request, line) != DeserializationError::Ok || !request["id"].is<const char*>() || !request["cmd"].is<const char*>() || !request["args"].is<JsonObject>()) return sendError("unknown", "MALFORMED_REQUEST", "Expected id, cmd, and args object.");
  const String id = request["id"].as<String>(); if (id == last_request_id) { Serial.println(last_response); return; }
  const String command = request["cmd"].as<String>(); JsonObject args = request["args"].as<JsonObject>(); for (JsonPair pair : args) if (String(pair.key().c_str()) != "deviceId" && String(pair.key().c_str()) != "planId") return sendError(id, "UNSAFE_ARGUMENT", "Only deviceId and registered planId are accepted.");
  const String device_id = args["deviceId"] | ""; const String plan_id = args["planId"] | "";
  if (command == "hello") return sendHello(id);
  if (command == "abort") { safety.emergencyStop(); JsonDocument response = success(id, true, 0); response["data"]["operation"]["aborted"] = true; send(response); return; }
  if (command == "arm_session") { if (!safety.arm(ahea::profile::PHYSICAL_ENABLED)) return sendError(id, "ARM_REJECTED", "Physical profile is disabled or faulted."); JsonDocument response = success(id, true, 0); send(response); return; }
  if (!ahea::profile::PHYSICAL_ENABLED) return sendError(id, "PROFILE_DISABLED", "Physical operations are disabled.");
  if (command == "scan_i2c") return scanI2c(id); if (command == "identify_mpu6050") return identifyMpu(id); if (command == "sample_mpu6050") return sampleMpu(id, device_id); if (command == "sample_dht11") return sampleDht(id, device_id); if (command == "measure_distance") return measureDistance(id, device_id); if (command == "sample_fsr") return sampleFsr(id, device_id, plan_id); sendError(id, "UNKNOWN_COMMAND", "Command is not supported.");
}
}  // namespace

void setup() {
  Serial.begin(115200); Wire.begin();
  if constexpr (ahea::profile::PHYSICAL_ENABLED) { if (ahea::profile::DHT11_PIN >= 0) dht.begin(); if (ahea::profile::HC_SR04_TRIGGER_PIN >= 0) pinMode(ahea::profile::HC_SR04_TRIGGER_PIN, OUTPUT); if (ahea::profile::HC_SR04_ECHO_PIN >= 0) pinMode(ahea::profile::HC_SR04_ECHO_PIN, INPUT); Wire.beginTransmission(MPU6050_ADDRESS); Wire.write(0x6B); Wire.write(0); Wire.endTransmission(); }
}
void loop() { while (Serial.available()) { const char character = static_cast<char>(Serial.read()); if (character == '\n') { if (!line_buffer.isEmpty()) processCommand(line_buffer); line_buffer = ""; } else if (line_buffer.length() < 1024) line_buffer += character; else { line_buffer = ""; safety.fault(); } } }
