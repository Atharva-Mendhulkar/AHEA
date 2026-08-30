#include <Arduino.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <Wire.h>
#include <math.h>
#include <mbedtls/sha256.h>
#include <esp_task_wdt.h>[]
#include "hardware_profile.h"
#include "safety_state.h"

namespace {
constexpr const char* FIRMWARE_VERSION = "3.0.0";
constexpr const char* PROTOCOL_VERSION = "3.0";
constexpr const char* REGISTRY_VERSION = "3.0.0";
String registry_digest;
ahea::SafetyMachine safety(ahea::profile::OPERATION_TIMEOUT_MS, ahea::profile::MAX_SESSION_OPERATIONS);
DHT dht(ahea::profile::DHT11_PIN, DHT11);
String line_buffer;
constexpr size_t REQUEST_HISTORY_SIZE = 32;
String request_history[REQUEST_HISTORY_SIZE];
size_t request_history_count = 0;
size_t request_history_next = 0;
uint32_t sequence_number = 0;

template <typename T>
void addMeasurement(JsonArray values, const char* channel, T value, const char* unit, const String& target_id, bool valid = true) {
  JsonObject item = values.add<JsonObject>(); item["channel"] = channel; item["value"] = value; item["unit"] = unit; item["targetId"] = target_id; item["quality"] = valid ? "valid" : "invalid";
}
void addHealth(JsonArray values, const String& target_id, bool healthy, float error_rate, const char* detail = nullptr) {
  JsonObject item = values.add<JsonObject>(); item["targetId"] = target_id; item["healthy"] = healthy; item["errorRate"] = error_rate; if (detail) item["detail"] = detail;
}
void addStringArray(JsonArray values, const char* const entries[], size_t count) { for (size_t index = 0; index < count; ++index) values.add(entries[index]); }
template <typename T>
void addSeries(JsonArray output, const char* channel, const char* unit, const String& target_id, uint32_t sample_interval_us, const T* values, size_t count) {
  JsonObject item = output.add<JsonObject>(); item["channel"] = channel; item["unit"] = unit; item["targetId"] = target_id; item["sampleIntervalUs"] = sample_interval_us; JsonArray samples = item["values"].to<JsonArray>(); for (size_t index = 0; index < count; ++index) samples.add(values[index]);
}
void addMeasurementDescriptor(JsonArray values, const char* channel, const char* unit) { JsonObject item = values.add<JsonObject>(); item["channel"] = channel; item["unit"] = unit; item["description"] = "Registered plan output."; }
void addSeriesDescriptor(JsonArray values, const char* channel, const char* unit, uint32_t interval_us, uint16_t maximum_samples) { JsonObject item = values.add<JsonObject>(); item["channel"] = channel; item["unit"] = unit; item["description"] = "Bounded samples observed during this registered plan."; item["sampleIntervalUs"] = interval_us; item["maximumSamples"] = maximum_samples; }
void addPlanSeriesDescriptors(const String& plan_id, JsonArray values) {
  if (plan_id.startsWith("loopback.")) { const uint32_t interval = plan_id.indexOf("static") >= 0 ? 100000 : 125; const uint16_t maximum = plan_id.indexOf("static") >= 0 ? 3 : 512; if (plan_id.indexOf("observe-destination") < 0) addSeriesDescriptor(values,"source_level","logic",interval,maximum); if (plan_id.indexOf("observe-source") < 0) addSeriesDescriptor(values,"destination_level","logic",interval,maximum); }
  else if (plan_id.startsWith("hc-sr04.")) { addSeriesDescriptor(values,"distance_cm","cm",60000,12); addSeriesDescriptor(values,"valid_echo","logic",60000,12); }
  else if (plan_id == "mpu6050.identity.v1") addSeriesDescriptor(values,"i2c_response","logic",20000,4);
  else if (plan_id.startsWith("mpu6050.")) { addSeriesDescriptor(values,"accel_x","g",20000,50); addSeriesDescriptor(values,"accel_y","g",20000,50); addSeriesDescriptor(values,"accel_z","g",20000,50); addSeriesDescriptor(values,"gyro_x","deg/s",20000,50); addSeriesDescriptor(values,"gyro_y","deg/s",20000,50); addSeriesDescriptor(values,"gyro_z","deg/s",20000,50); }
  else if (plan_id.startsWith("dht11.")) { addSeriesDescriptor(values,"temperature","C",2000000,3); addSeriesDescriptor(values,"humidity","%",2000000,3); addSeriesDescriptor(values,"valid_frame","logic",2000000,3); }
}
void addPlanMeasurementDescriptors(const String& plan_id, JsonArray values) {
  if (plan_id == "loopback.observe-destination.1khz.v1") { addMeasurementDescriptor(values,"destination_present","boolean"); addMeasurementDescriptor(values,"destination_frequency_hz","Hz"); addMeasurementDescriptor(values,"destination_duty_percent","%"); }
  else if (plan_id == "loopback.observe-source.1khz.v1") { addMeasurementDescriptor(values,"source_present","boolean"); addMeasurementDescriptor(values,"source_frequency_hz","Hz"); addMeasurementDescriptor(values,"source_duty_percent","%"); }
  else if (plan_id == "loopback.inspect-stimulus.static.v1") { addMeasurementDescriptor(values,"source_static_sequence_valid","boolean"); addMeasurementDescriptor(values,"destination_static_sequence_valid","boolean"); }
  else if (plan_id.startsWith("loopback.")) { addMeasurementDescriptor(values,"source_present","boolean"); addMeasurementDescriptor(values,"destination_present","boolean"); addMeasurementDescriptor(values,"source_frequency_hz","Hz"); addMeasurementDescriptor(values,"destination_frequency_hz","Hz"); addMeasurementDescriptor(values,"source_duty_percent","%"); addMeasurementDescriptor(values,"destination_duty_percent","%"); addMeasurementDescriptor(values,"endpoint_correlation","ratio"); }
  else if (plan_id == "hc-sr04.echo-timing.v1") { addMeasurementDescriptor(values,"distance_cm","cm"); addMeasurementDescriptor(values,"timeout_rate","ratio"); }
  else if (plan_id == "hc-sr04.variance.v1") addMeasurementDescriptor(values,"distance_stddev_cm","cm");
  else if (plan_id == "hc-sr04.progression.v1") addMeasurementDescriptor(values,"progression_consistent","boolean");
  else if (plan_id == "mpu6050.identity.v1") addMeasurementDescriptor(values,"identity_valid","boolean");
  else if (plan_id == "mpu6050.stationary.v1") { addMeasurementDescriptor(values,"stationary_noise_g","g"); addMeasurementDescriptor(values,"drift_dps","deg/s"); }
  else if (plan_id == "mpu6050.motion-axis.v1") { addMeasurementDescriptor(values,"motion_detected","boolean"); addMeasurementDescriptor(values,"axis_consistent","boolean"); }
  else if (plan_id == "dht11.response.v1") { addMeasurementDescriptor(values,"checksum_valid","boolean"); addMeasurementDescriptor(values,"response_time_us","us"); }
  else if (plan_id == "dht11.environment.v1") { addMeasurementDescriptor(values,"temperature_c","C"); addMeasurementDescriptor(values,"humidity_percent","%"); }
  else if (plan_id == "dht11.valid-rate.v1") { addMeasurementDescriptor(values,"valid_rate","ratio"); addMeasurementDescriptor(values,"stale_rate","ratio"); }
}

JsonDocument baseResponse(const String& id, const String& plan_id, uint32_t started_ms) {
  JsonDocument response; response["id"] = id; response["ok"] = true; response["error"] = nullptr;
  JsonObject data = response["data"].to<JsonObject>(); data["firmwareVersion"] = FIRMWARE_VERSION; data["boardIdentity"] = ahea::profile::BOARD_IDENTITY; data["protocolVersion"] = PROTOCOL_VERSION; data["hardwareProfileId"] = ahea::profile::PROFILE_ID; data["registryDigest"] = registry_digest; data["physicalEnabled"] = ahea::profile::PHYSICAL_ENABLED; data["monotonicStartedMs"] = started_ms; data["monotonicEndedMs"] = millis(); data["sequenceNumber"] = ++sequence_number; data["planId"] = plan_id; data["bindingIds"].to<JsonArray>(); data["measurements"].to<JsonArray>(); data["series"].to<JsonArray>(); data["targetHealth"].to<JsonArray>(); data["limitations"].to<JsonArray>();
  JsonObject operation = data["operation"].to<JsonObject>(); operation["accepted"] = true; operation["aborted"] = false; operation["timedOut"] = safety.timedOut(); operation["estopLatched"] = safety.estopLatched(); operation["cleanupSucceeded"] = true; operation["reasons"].to<JsonArray>();
  return response;
}
bool requestSeen(const String& id) { for (size_t index = 0; index < request_history_count; ++index) if (request_history[index] == id) return true; return false; }
void rememberRequest(const String& id) { if (id.isEmpty() || id == "unknown" || requestSeen(id)) return; request_history[request_history_next] = id; request_history_next = (request_history_next + 1) % REQUEST_HISTORY_SIZE; if (request_history_count < REQUEST_HISTORY_SIZE) request_history_count++; }
void send(JsonDocument& response) { if (response["ok"].as<bool>() && response["data"].is<JsonObject>()) response["data"]["monotonicEndedMs"] = millis(); String output; serializeJson(response, output); Serial.println(output); rememberRequest(response["id"].as<String>()); }
void safeOutputs() { if constexpr (ahea::profile::LOOPBACK_FIXTURE_REVIEWED) digitalWrite(ahea::profile::LOOPBACK_STIMULUS_PIN, LOW); if constexpr (ahea::profile::HC_SR04_ENABLED) digitalWrite(ahea::profile::HC_SR04_TRIGGER_PIN, LOW); }
void sendError(const String& id, const char* code, const char* message) { safeOutputs(); JsonDocument response; response["id"] = id; response["ok"] = false; response["data"] = nullptr; JsonObject error = response["error"].to<JsonObject>(); error["code"] = code; error["message"] = message; send(response); }

bool pollOperationControl() {
  while (Serial.available()) {
    const char character = static_cast<char>(Serial.read());
    if (character != '\n') {
      if (line_buffer.length() < 2048) { line_buffer += character; continue; }
      line_buffer = ""; safeOutputs(); safety.fault(); sendError("unknown", "REQUEST_TOO_LARGE", "Serial request exceeded 2048 bytes during an operation."); return true;
    }
    if (line_buffer.isEmpty()) continue;
    JsonDocument request; const auto parse_result = deserializeJson(request, line_buffer); line_buffer = "";
    const String id = request["id"].is<const char*>() ? request["id"].as<String>() : "unknown";
    const bool exact_abort = parse_result == DeserializationError::Ok && request.is<JsonObject>() && request.as<JsonObject>().size() == 3 &&
      !id.isEmpty() && id.length() <= 120 && request["cmd"].is<const char*>() && request["cmd"].as<String>() == "abort" &&
      request["args"].is<JsonObject>() && request["args"].as<JsonObject>().size() == 0 && !requestSeen(id);
    safeOutputs();
    if (exact_abort) {
      safety.emergencyStop(); JsonDocument response = baseResponse(id, "abort.v1", millis()); response["data"]["operation"]["aborted"] = true; send(response); return true;
    }
    safety.fault(); sendError(id, "BUSY", "Only a new, argument-free abort request is accepted while an operation is running."); return true;
  }
  return false;
}
bool continueOperation() { esp_task_wdt_reset(); if (pollOperationControl()) return false; if (safety.tick(millis())) return true; safeOutputs(); return false; }
bool waitSafely(uint32_t duration_ms) { const uint32_t started = millis(); while (static_cast<uint32_t>(millis() - started) < duration_ms) { if (!continueOperation()) return false; delay(1); } return true; }

void addPlan(JsonArray plans, const char* id, const char* capability, const char* type, const char* label, const char* description, const char* target_type, const char* const bindings[], size_t binding_count, const char* phase, const char* budget_class, uint32_t duration_ms, const char* cleanup, const char* limitation) {
  JsonObject item = plans.add<JsonObject>(); item["id"] = id; item["capabilityId"] = capability; item["type"] = type; item["label"] = label; item["description"] = description; item["targetType"] = target_type; item["command"] = "execute_plan"; JsonArray binding_values = item["bindingIds"].to<JsonArray>(); addStringArray(binding_values, bindings, binding_count); JsonArray phases = item["phases"].to<JsonArray>(); phases.add(phase); if (String(id) == "loopback.observe-destination.1khz.v1" || String(id) == "hc-sr04.echo-timing.v1" || String(id) == "mpu6050.identity.v1" || String(id) == "dht11.response.v1") phases.add("monitoring"); item["budgetClass"] = budget_class; item["requiresSetupConfirmation"] = true; item["durationMs"] = duration_ms; JsonObject parameters = item["fixedParameters"].to<JsonObject>(); JsonArray measurements = item["measurements"].to<JsonArray>(); item["limitations"].to<JsonArray>().add(limitation); item["cleanup"] = cleanup; JsonArray series = item["series"].to<JsonArray>();
  const String plan_id(id);
  if (plan_id.startsWith("loopback.")) { if (plan_id.indexOf("static") >= 0) { parameters["waveform"] = "low-high-low"; parameters["stepDurationMs"] = 100; } else { parameters["frequencyHz"] = plan_id.indexOf("500hz") >= 0 ? 500 : 1000; parameters["dutyPercent"] = 50; parameters["durationMs"] = duration_ms; } }
  else if (plan_id.startsWith("hc-sr04.")) { parameters["triggerPulseUs"] = 10; parameters["echoTimeoutUs"] = 30000; parameters["samples"] = plan_id == "hc-sr04.echo-timing.v1" ? 8 : 12; parameters["intervalMs"] = 60; }
  else if (plan_id.startsWith("mpu6050.")) { parameters["address"] = "profile-owned"; parameters["busHz"] = ahea::profile::MPU6050_I2C_FREQUENCY_HZ; if (plan_id == "mpu6050.identity.v1") parameters["register"] = "WHO_AM_I"; else { parameters["samples"] = 50; parameters["sampleIntervalMs"] = 20; } }
  else if (plan_id.startsWith("dht11.")) { if (plan_id == "dht11.valid-rate.v1") { parameters["samples"] = 3; parameters["intervalMs"] = 2000; } else parameters["minimumReadIntervalMs"] = 2000; }
  addPlanMeasurementDescriptors(plan_id, measurements);
  addPlanSeriesDescriptors(plan_id, series);
}
void populateRegistry(JsonObject registry) {
  registry["schemaVersion"] = 1; registry["registryVersion"] = REGISTRY_VERSION; registry["boardIdentity"] = ahea::profile::BOARD_IDENTITY; registry["hardwareProfileId"] = ahea::profile::PROFILE_ID; JsonArray plans = registry["plans"].to<JsonArray>();
  const char* destination_bindings[] = {"gpio4_stimulus", "gpio6_destination_observer"};
  const char* source_bindings[] = {"gpio4_stimulus", "gpio5_source_observer"};
  const char* endpoint_bindings[] = {"gpio4_stimulus", "gpio5_source_observer", "gpio6_destination_observer"};
  if constexpr (ahea::profile::LOOPBACK_FIXTURE_REVIEWED) {
  addPlan(plans, "loopback.observe-destination.1khz.v1", "digital_waveform_capture", "observe_destination", "Observe destination", "Capture the destination node at the registered waveform.", "loopback", destination_bindings, 2, "diagnostic", "bounded_output", 500, "GPIO4 low", "ESP32 timebase only; not independent calibration.");
  addPlan(plans, "loopback.observe-source.1khz.v1", "digital_waveform_capture", "observe_source", "Verify source", "Capture the source node at the registered waveform.", "loopback", source_bindings, 2, "diagnostic", "bounded_output", 500, "GPIO4 low", "ESP32 timebase only; not independent calibration.");
  addPlan(plans, "loopback.compare-endpoints.1khz.v1", "synchronized_endpoint_capture", "compare_endpoints", "Compare endpoints", "Capture source and destination together.", "loopback", endpoint_bindings, 3, "diagnostic", "bounded_output", 500, "GPIO4 low", "Correlation is bounded by digital capture resolution.");
  addPlan(plans, "loopback.measure-timing.1khz.v1", "edge_timing", "measure_timing", "Measure duty and timing", "Measure source and destination timing.", "loopback", endpoint_bindings, 3, "diagnostic", "bounded_output", 500, "GPIO4 low", "ESP32 timebase only; not independent calibration.");
  addPlan(plans, "loopback.inspect-stimulus.static.v1", "static_level_sequence", "inspect_stimulus", "Inspect stimulus profile", "Run a fixed low-high-low sequence.", "loopback", endpoint_bindings, 3, "diagnostic", "bounded_output", 300, "GPIO4 low", "Digital level check only.");
  addPlan(plans, "loopback.repeat-synchronized.500hz.v1", "synchronized_endpoint_capture", "repeat_synchronized_capture", "Repeat synchronized capture", "Repeat endpoint capture at registered 500 Hz.", "loopback", endpoint_bindings, 3, "diagnostic", "bounded_output", 500, "GPIO4 low", "ESP32 timebase only; not independent calibration.");
  addPlan(plans, "loopback.verify-path.1khz.v1", "synchronized_endpoint_capture", "verify_repair", "Verify restored path", "Verify source and destination after intervention.", "loopback", endpoint_bindings, 3, "verification", "bounded_output", 500, "GPIO4 low", "Physical verification applies only to tested conditions.");
  }
  if constexpr (ahea::profile::HC_SR04_ENABLED && ahea::profile::HC_SR04_ECHO_DIVIDER_REVIEWED && ahea::profile::HC_SR04_ECHO_UPPER_OHMS == 8200 && ahea::profile::HC_SR04_ECHO_LOWER_OHMS == 10000) { const char* bindings[] = {"hc_trigger", "hc_echo_protected"}; addPlan(plans, "hc-sr04.echo-timing.v1", "ultrasonic_echo_timing", "sensor_baseline", "Measure echo timing", "Run bounded trigger and echo timing.", "hc_sr04", bindings, 2, "diagnostic", "timed_io", 500, "Trigger low", "Requires reviewed Echo level interface."); addPlan(plans, "hc-sr04.variance.v1", "ultrasonic_variance", "sensor_consistency", "Measure distance variance", "Measure repeated echo variance.", "hc_sr04", bindings, 2, "diagnostic", "timed_io", 900, "Trigger low", "No accuracy claim without an external reference."); addPlan(plans, "hc-sr04.progression.v1", "ultrasonic_progression", "sensor_response", "Check progression", "Check declared distance progression.", "hc_sr04", bindings, 2, "diagnostic", "timed_io", 900, "Trigger low", "Geometry and alignment affect results."); }
  if constexpr (ahea::profile::MPU6050_ENABLED && ahea::profile::I2C_PULLUPS_AT_3V3_REVIEWED) { const char* bindings[] = {"i2c_sda", "i2c_scl"}; addPlan(plans, "mpu6050.identity.v1", "i2c_identity", "sensor_identity", "Read identity", "Read registered identity.", "mpu6050", bindings, 2, "diagnostic", "read", 100, "I2C idle", "Identity does not prove axis accuracy."); addPlan(plans, "mpu6050.stationary.v1", "imu_stationary_baseline", "sensor_baseline", "Stationary baseline", "Capture bias, noise, and drift.", "mpu6050", bindings, 2, "diagnostic", "read", 1000, "I2C idle", "Baseline characterization only."); addPlan(plans, "mpu6050.motion-axis.v1", "imu_motion_response", "sensor_response", "Motion and axes", "Capture motion and axis consistency.", "mpu6050", bindings, 2, "diagnostic", "read", 1000, "I2C idle", "Motion applies at the sensor only."); }
  if constexpr (ahea::profile::DHT11_ENABLED && ahea::profile::DHT11_3V3_INTERFACE_REVIEWED) { const char* bindings[] = {"dht_data_3v3"}; addPlan(plans, "dht11.response.v1", "dht_response_timing", "sensor_identity", "Check response", "Check response timing and checksum.", "dht11", bindings, 1, "diagnostic", "timed_io", 250, "Data pin released", "Checksum does not prove accuracy."); addPlan(plans, "dht11.environment.v1", "environment_reading", "sensor_baseline", "Characterize environment", "Read temperature and humidity.", "dht11", bindings, 1, "diagnostic", "timed_io", 250, "Data pin released", "Baseline characterization only."); addPlan(plans, "dht11.valid-rate.v1", "dht_consistency", "sensor_consistency", "Check valid and stale rates", "Measure valid and stale readings.", "dht11", bindings, 1, "diagnostic", "timed_io", 4500, "Data pin released", "DHT11 resolution and lag limit conclusions."); }
}

String sha256Hex(const String& payload) {
  unsigned char hash[32];
  mbedtls_sha256_ret(reinterpret_cast<const unsigned char*>(payload.c_str()), payload.length(), hash, 0);
  char encoded[65];
  for (size_t index = 0; index < sizeof(hash); ++index) snprintf(encoded + index * 2, 3, "%02x", hash[index]);
  encoded[64] = '\0';
  return String(encoded);
}

String computeRegistryDigest() {
  JsonDocument document;
  JsonObject registry = document.to<JsonObject>();
  populateRegistry(registry);
  String payload;
  serializeJson(registry, payload);
  return sha256Hex(payload);
}

void addRegistry(JsonObject data) {
  JsonObject registry = data["registry"].to<JsonObject>();
  populateRegistry(registry);
  registry["digest"] = registry_digest;
}

bool profileValid() {
  const unsigned int reviewed_profiles =
    (ahea::profile::LOOPBACK_FIXTURE_REVIEWED && ahea::profile::LOOPBACK_STIMULUS_SERIES_OHMS == 2000 && ahea::profile::LOOPBACK_OBSERVER_SERIES_OHMS == 10000 && ahea::profile::LOOPBACK_DESTINATION_PULLDOWN_OHMS == 10000 ? 1U : 0U) +
    (ahea::profile::HC_SR04_ENABLED && ahea::profile::HC_SR04_ECHO_DIVIDER_REVIEWED && ahea::profile::HC_SR04_ECHO_UPPER_OHMS == 8200 && ahea::profile::HC_SR04_ECHO_LOWER_OHMS == 10000 ? 1U : 0U) +
    (ahea::profile::MPU6050_ENABLED && ahea::profile::I2C_PULLUPS_AT_3V3_REVIEWED ? 1U : 0U) +
    (ahea::profile::DHT11_ENABLED && ahea::profile::DHT11_3V3_INTERFACE_REVIEWED ? 1U : 0U);
  return ahea::profile::PHYSICAL_ENABLED && reviewed_profiles == 1;
}
bool beginOperation(const String& id, ahea::OperationClass kind, bool enabled) { const auto result = safety.start(kind, millis(), enabled); if (result != ahea::StartResult::Accepted) { sendError(id, "SAFETY_REJECTED", "Firmware safety state rejected the registered plan."); return false; } return true; }

void sendHello(const String& id) {
  const uint32_t started = millis(); JsonDocument response = baseResponse(id, "hello", started); JsonObject data = response["data"].as<JsonObject>(); addRegistry(data); addHealth(data["targetHealth"].as<JsonArray>(), "firmware", true, 0); data["limitations"].as<JsonArray>().add("ESP32-S3 measurements are not laboratory-grade or independently timebase-calibrated."); send(response);
}

constexpr size_t LOOPBACK_SERIES_SAMPLES = 64;
struct WaveformResult { bool source_present; bool destination_present; float source_frequency; float destination_frequency; float source_duty; float destination_duty; float correlation; bool completed; uint8_t source_series[LOOPBACK_SERIES_SAMPLES]; uint8_t destination_series[LOOPBACK_SERIES_SAMPLES]; size_t series_count; };
WaveformResult captureWaveform(uint32_t frequency_hz, uint32_t duration_ms, bool capture_source, bool capture_destination) {
  const uint32_t period_us = 1000000UL / frequency_hz; const uint32_t duration_us = duration_ms * 1000UL; const uint32_t started_us = micros();
  WaveformResult result{}; bool previous_source = false, previous_destination = false; uint32_t source_rises = 0, destination_rises = 0, source_high = 0, destination_high = 0, matches = 0, samples = 0; bool completed = true; uint32_t next_series_us = 0;
  while (static_cast<uint32_t>(micros() - started_us) < duration_us) {
    if (!continueOperation()) { completed = false; break; }
    const uint32_t elapsed = micros() - started_us; const bool output_high = (elapsed % period_us) < (period_us / 2); digitalWrite(ahea::profile::LOOPBACK_STIMULUS_PIN, output_high ? HIGH : LOW);
    const bool source = capture_source ? digitalRead(ahea::profile::LOOPBACK_SOURCE_OBSERVER_PIN) == HIGH : false;
    const bool destination = capture_destination ? digitalRead(ahea::profile::LOOPBACK_DESTINATION_OBSERVER_PIN) == HIGH : false;
    if (capture_source) { if (source && !previous_source) source_rises++; if (source) source_high++; previous_source = source; }
    if (capture_destination) { if (destination && !previous_destination) destination_rises++; if (destination) destination_high++; previous_destination = destination; }
    if (capture_source && capture_destination && source == destination) matches++; samples++;
    if (result.series_count < LOOPBACK_SERIES_SAMPLES && elapsed >= next_series_us) { result.source_series[result.series_count] = source ? 1 : 0; result.destination_series[result.series_count] = destination ? 1 : 0; result.series_count++; next_series_us += 125; }
    delayMicroseconds(20);
  }
  digitalWrite(ahea::profile::LOOPBACK_STIMULUS_PIN, LOW);
  const float seconds = duration_ms / 1000.0F;
  result.source_present = capture_source && source_rises > 2; result.destination_present = capture_destination && destination_rises > 2; result.source_frequency = capture_source ? source_rises / seconds : 0; result.destination_frequency = capture_destination ? destination_rises / seconds : 0; result.source_duty = capture_source && samples ? 100.0F * source_high / samples : 0; result.destination_duty = capture_destination && samples ? 100.0F * destination_high / samples : 0; result.correlation = capture_source && capture_destination && samples ? static_cast<float>(matches) / samples : 0; result.completed = completed; return result;
}

void executeLoopback(const String& id, const String& target_id, const String& plan_id) {
  if (!ahea::profile::LOOPBACK_FIXTURE_REVIEWED) return sendError(id, "FIXTURE_REVIEW_REQUIRED", "The protected loopback fixture is not reviewed.");
  if (!beginOperation(id, ahea::OperationClass::BoundedOutput, true)) return;
  const uint32_t started = millis(); digitalWrite(ahea::profile::LOOPBACK_STIMULUS_PIN, LOW);
  if (plan_id == "loopback.inspect-stimulus.static.v1") {
    digitalWrite(ahea::profile::LOOPBACK_STIMULUS_PIN, LOW); const bool completed_low = waitSafely(100); const bool source_low = completed_low && digitalRead(ahea::profile::LOOPBACK_SOURCE_OBSERVER_PIN) == LOW; const bool destination_low = completed_low && digitalRead(ahea::profile::LOOPBACK_DESTINATION_OBSERVER_PIN) == LOW;
    if (completed_low) digitalWrite(ahea::profile::LOOPBACK_STIMULUS_PIN, HIGH); const bool completed_high = completed_low && waitSafely(100); const bool source_high = completed_high && digitalRead(ahea::profile::LOOPBACK_SOURCE_OBSERVER_PIN) == HIGH; const bool destination_high = completed_high && digitalRead(ahea::profile::LOOPBACK_DESTINATION_OBSERVER_PIN) == HIGH;
    digitalWrite(ahea::profile::LOOPBACK_STIMULUS_PIN, LOW); const bool completed_final = completed_high && waitSafely(100); const bool source_final = completed_final && digitalRead(ahea::profile::LOOPBACK_SOURCE_OBSERVER_PIN) == LOW; const bool destination_final = completed_final && digitalRead(ahea::profile::LOOPBACK_DESTINATION_OBSERVER_PIN) == LOW; safety.finish();
    const bool completed = completed_low && completed_high && completed_final; JsonDocument response = baseResponse(id, plan_id, started); JsonObject data = response["data"].as<JsonObject>(); const char* bindings[] = {"gpio4_stimulus", "gpio5_source_observer", "gpio6_destination_observer"}; addStringArray(data["bindingIds"].as<JsonArray>(), bindings, 3); addMeasurement(data["measurements"].as<JsonArray>(), "source_static_sequence_valid", source_low && source_high && source_final, "boolean", target_id, completed); addMeasurement(data["measurements"].as<JsonArray>(), "destination_static_sequence_valid", destination_low && destination_high && destination_final, "boolean", target_id, completed); const uint8_t source_sequence[] = {static_cast<uint8_t>(source_low ? 0 : 1), static_cast<uint8_t>(source_high ? 1 : 0), static_cast<uint8_t>(source_final ? 0 : 1)}; const uint8_t destination_sequence[] = {static_cast<uint8_t>(destination_low ? 0 : 1), static_cast<uint8_t>(destination_high ? 1 : 0), static_cast<uint8_t>(destination_final ? 0 : 1)}; addSeries(data["series"].as<JsonArray>(),"source_level","logic",target_id,100000,source_sequence,3); addSeries(data["series"].as<JsonArray>(),"destination_level","logic",target_id,100000,destination_sequence,3); addHealth(data["targetHealth"].as<JsonArray>(), target_id, completed, completed ? 0 : 1); data["operation"]["accepted"] = completed; data["operation"]["cleanupSucceeded"] = digitalRead(ahea::profile::LOOPBACK_STIMULUS_PIN) == LOW; data["limitations"].as<JsonArray>().add("This registered plan checks digital levels only."); send(response); return;
  }
  const bool destination_only = plan_id == "loopback.observe-destination.1khz.v1"; const bool source_only = plan_id == "loopback.observe-source.1khz.v1"; const bool repeat = plan_id == "loopback.repeat-synchronized.500hz.v1";
  const bool known = destination_only || source_only || repeat || plan_id == "loopback.compare-endpoints.1khz.v1" || plan_id == "loopback.measure-timing.1khz.v1" || plan_id == "loopback.verify-path.1khz.v1";
  if (!known) { safety.finish(); return sendError(id, "UNKNOWN_PLAN", "Loopback plan is not registered."); }
  const uint32_t frequency = repeat ? 500 : 1000; WaveformResult result = captureWaveform(frequency, 500, !destination_only, !source_only); safety.finish();
  JsonDocument response = baseResponse(id, plan_id, started); JsonObject data = response["data"].as<JsonObject>(); JsonArray bindings = data["bindingIds"].as<JsonArray>(); bindings.add("gpio4_stimulus"); if (!destination_only) bindings.add("gpio5_source_observer"); if (!source_only) bindings.add("gpio6_destination_observer"); JsonArray values = data["measurements"].as<JsonArray>();
  if (!destination_only) { addMeasurement(values, "source_present", result.source_present, "boolean", target_id); addMeasurement(values, "source_frequency_hz", result.source_frequency, "Hz", target_id); addMeasurement(values, "source_duty_percent", result.source_duty, "%", target_id); }
  if (!source_only) { addMeasurement(values, "destination_present", result.destination_present, "boolean", target_id); addMeasurement(values, "destination_frequency_hz", result.destination_frequency, "Hz", target_id); addMeasurement(values, "destination_duty_percent", result.destination_duty, "%", target_id); }
  if (!source_only && !destination_only) addMeasurement(values, "endpoint_correlation", result.correlation, "ratio", target_id);
  JsonArray captured_series = data["series"].as<JsonArray>(); if (!destination_only) addSeries(captured_series,"source_level","logic",target_id,125,result.source_series,result.series_count); if (!source_only) addSeries(captured_series,"destination_level","logic",target_id,125,result.destination_series,result.series_count);
  data["operation"]["accepted"] = result.completed; data["operation"]["cleanupSucceeded"] = digitalRead(ahea::profile::LOOPBACK_STIMULUS_PIN) == LOW; addHealth(data["targetHealth"].as<JsonArray>(), target_id, result.completed, result.completed ? 0 : 1); data["limitations"].as<JsonArray>().add("Timing is measured against the ESP32-S3 timebase, not an independent reference."); send(response);
}

bool readMpu(float& ax, float& ay, float& az, float& gx, float& gy, float& gz) { Wire.beginTransmission(ahea::profile::MPU6050_ADDRESS); Wire.write(0x3B); if (Wire.endTransmission(false) != 0 || Wire.requestFrom(ahea::profile::MPU6050_ADDRESS, static_cast<uint8_t>(14)) != 14) return false; auto read16 = []() { return static_cast<int16_t>((Wire.read() << 8) | Wire.read()); }; ax = read16()/16384.0F; ay = read16()/16384.0F; az = read16()/16384.0F; read16(); gx = read16()/131.0F; gy = read16()/131.0F; gz = read16()/131.0F; return true; }
void executeMpu(const String& id, const String& target_id, const String& plan_id) {
  if (!ahea::profile::MPU6050_ENABLED || !ahea::profile::I2C_PULLUPS_AT_3V3_REVIEWED) return sendError(id, "PROFILE_DISABLED", "MPU6050 requires reviewed 3.3 V I2C pull-ups."); if (!beginOperation(id, ahea::OperationClass::Read, true)) return; const uint32_t started = millis(); JsonDocument response = baseResponse(id, plan_id, started); JsonObject data = response["data"].as<JsonObject>(); data["bindingIds"].as<JsonArray>().add("i2c_sda"); data["bindingIds"].as<JsonArray>().add("i2c_scl"); JsonArray values = data["measurements"].as<JsonArray>(); bool ok = true;
  if (plan_id == "mpu6050.identity.v1") { Wire.beginTransmission(ahea::profile::MPU6050_ADDRESS); Wire.write(0x75); ok = Wire.endTransmission(false) == 0 && Wire.requestFrom(ahea::profile::MPU6050_ADDRESS, static_cast<uint8_t>(1)) == 1; const int identity = ok ? Wire.read() : -1; addMeasurement(values, "identity_valid", identity == 0x68, "boolean", target_id, ok); const uint8_t identity_trace[] = {0, static_cast<uint8_t>(ok), static_cast<uint8_t>(identity == 0x68), 0}; addSeries(data["series"].as<JsonArray>(),"i2c_response","logic",target_id,20000,identity_trace,4); }
  else if (plan_id == "mpu6050.stationary.v1" || plan_id == "mpu6050.motion-axis.v1") { float magnitude_sum=0, magnitude_sq=0, gyro_sum=0, max_axis=0; float ax_values[50],ay_values[50],az_values[50],gx_values[50],gy_values[50],gz_values[50]; int samples=0; for (int i=0;i<50;i++){ if(!continueOperation()){ok=false;break;} float ax,ay,az,gx,gy,gz; if (!readMpu(ax,ay,az,gx,gy,gz)){ok=false;break;} ax_values[samples]=ax;ay_values[samples]=ay;az_values[samples]=az;gx_values[samples]=gx;gy_values[samples]=gy;gz_values[samples]=gz; const float magnitude=sqrtf(ax*ax+ay*ay+az*az); magnitude_sum+=magnitude; magnitude_sq+=magnitude*magnitude; gyro_sum+=sqrtf(gx*gx+gy*gy+gz*gz); max_axis=max(max_axis,max(abs(ax),max(abs(ay),abs(az)))); samples++; if(!waitSafely(20)){ok=false;break;} } const float denominator=max(samples,1); const float average=magnitude_sum/denominator; if (plan_id == "mpu6050.stationary.v1") { addMeasurement(values,"stationary_noise_g",sqrtf(max(0.0F,magnitude_sq/denominator-average*average)),"g",target_id,ok); addMeasurement(values,"drift_dps",gyro_sum/denominator,"deg/s",target_id,ok); } else { addMeasurement(values,"motion_detected",max_axis>1.15F,"boolean",target_id,ok); addMeasurement(values,"axis_consistent",ok,"boolean",target_id,ok); } JsonArray captured=data["series"].as<JsonArray>(); addSeries(captured,"accel_x","g",target_id,20000,ax_values,samples);addSeries(captured,"accel_y","g",target_id,20000,ay_values,samples);addSeries(captured,"accel_z","g",target_id,20000,az_values,samples);addSeries(captured,"gyro_x","deg/s",target_id,20000,gx_values,samples);addSeries(captured,"gyro_y","deg/s",target_id,20000,gy_values,samples);addSeries(captured,"gyro_z","deg/s",target_id,20000,gz_values,samples); }
  else { safety.finish(); return sendError(id,"UNKNOWN_PLAN","MPU6050 plan is not registered."); } safety.finish(); addHealth(data["targetHealth"].as<JsonArray>(),target_id,ok,ok?0:1); data["operation"]["accepted"]=ok; data["limitations"].as<JsonArray>().add("Results are baseline characterization without an independent orientation reference."); send(response);
}

void executeDht(const String& id, const String& target_id, const String& plan_id) {
  if (!ahea::profile::DHT11_ENABLED || !ahea::profile::DHT11_3V3_INTERFACE_REVIEWED) return sendError(id,"PROFILE_DISABLED","DHT11 requires a reviewed 3.3 V-compatible data interface."); if (!beginOperation(id,ahea::OperationClass::TimedIo,true)) return; const uint32_t started=millis(); JsonDocument response=baseResponse(id,plan_id,started); JsonObject data=response["data"].as<JsonObject>(); data["bindingIds"].as<JsonArray>().add("dht_data_3v3"); JsonArray values=data["measurements"].as<JsonArray>(); const uint32_t call_started=micros(); const float humidity=dht.readHumidity(); const float temperature=dht.readTemperature(); const uint32_t response_us=micros()-call_started; bool ok=isfinite(humidity)&&isfinite(temperature)&&continueOperation();
  float temperatures[3] = {temperature,0,0}; float humidities[3] = {humidity,0,0}; uint8_t valid_frames[3] = {static_cast<uint8_t>(ok),0,0}; size_t observed_count=1;
  if (plan_id == "dht11.response.v1") { addMeasurement(values,"checksum_valid",ok,"boolean",target_id,ok); addMeasurement(values,"response_time_us",response_us,"us",target_id,ok); }
  else if (plan_id == "dht11.environment.v1") { addMeasurement(values,"temperature_c",temperature,"C",target_id,ok); addMeasurement(values,"humidity_percent",humidity,"%",target_id,ok); }
  else if (plan_id == "dht11.valid-rate.v1") { int valid=ok?1:0; float previous_t=temperature,previous_h=humidity; int stale=0; for(int i=1;i<3;i++){if(!waitSafely(2000)){ok=false;break;} const float h=dht.readHumidity(),t=dht.readTemperature(); const bool frame_valid=isfinite(h)&&isfinite(t); valid_frames[i]=frame_valid?1:0; if(frame_valid){temperatures[i]=t;humidities[i]=h;valid++;if(t==previous_t&&h==previous_h)stale++;previous_t=t;previous_h=h;} observed_count++;} addMeasurement(values,"valid_rate",valid/3.0F,"ratio",target_id); addMeasurement(values,"stale_rate",stale/2.0F,"ratio",target_id); }
  else { safety.finish(); return sendError(id,"UNKNOWN_PLAN","DHT11 plan is not registered."); } JsonArray captured=data["series"].as<JsonArray>(); if(ok){addSeries(captured,"temperature","C",target_id,2000000,temperatures,observed_count);addSeries(captured,"humidity","%",target_id,2000000,humidities,observed_count);} addSeries(captured,"valid_frame","logic",target_id,2000000,valid_frames,observed_count); safety.finish(); addHealth(data["targetHealth"].as<JsonArray>(),target_id,ok,ok?0:1); data["operation"]["accepted"]=ok; data["limitations"].as<JsonArray>().add("Valid protocol frames do not establish environmental accuracy."); send(response);
}

void executeHc(const String& id, const String& target_id, const String& plan_id) {
  if (!ahea::profile::HC_SR04_ENABLED || !ahea::profile::HC_SR04_ECHO_DIVIDER_REVIEWED || ahea::profile::HC_SR04_ECHO_UPPER_OHMS != 8200 || ahea::profile::HC_SR04_ECHO_LOWER_OHMS != 10000) return sendError(id,"ECHO_PROTECTION_REQUIRED","HC-SR04 requires the reviewed 8.2 kOhm/10 kOhm Echo divider."); if (!beginOperation(id,ahea::OperationClass::TimedIo,true)) return; const uint32_t started=millis(); const int sample_count=plan_id=="hc-sr04.echo-timing.v1"?8:12; float sum=0,square_sum=0,first=0,last=0; float distances[12]={0}; uint8_t valid_echo[12]={0}; int observed=0,valid=0; bool completed=true; for(int i=0;i<sample_count;i++){if(!continueOperation()){completed=false;break;}digitalWrite(ahea::profile::HC_SR04_TRIGGER_PIN,LOW);delayMicroseconds(2);digitalWrite(ahea::profile::HC_SR04_TRIGGER_PIN,HIGH);delayMicroseconds(10);digitalWrite(ahea::profile::HC_SR04_TRIGGER_PIN,LOW);const unsigned long duration=pulseIn(ahea::profile::HC_SR04_ECHO_PIN,HIGH,30000);observed++;if(duration){const float distance=duration*.0343F/2.0F;distances[valid]=distance;valid_echo[i]=1;if(valid==0)first=distance;last=distance;sum+=distance;square_sum+=distance*distance;valid++;}if(!waitSafely(60)){completed=false;break;}} safety.finish(); const bool ok=completed&&valid>0&&!safety.timedOut(); const float average=ok?sum/valid:0; JsonDocument response=baseResponse(id,plan_id,started); JsonObject data=response["data"].as<JsonObject>(); data["bindingIds"].as<JsonArray>().add("hc_trigger");data["bindingIds"].as<JsonArray>().add("hc_echo_protected");JsonArray values=data["measurements"].as<JsonArray>(); if(plan_id=="hc-sr04.echo-timing.v1"){addMeasurement(values,"distance_cm",average,"cm",target_id,ok);addMeasurement(values,"timeout_rate",1.0F-valid/static_cast<float>(sample_count),"ratio",target_id);} else if(plan_id=="hc-sr04.variance.v1") addMeasurement(values,"distance_stddev_cm",ok?sqrtf(max(0.0F,square_sum/valid-average*average)):0,"cm",target_id,ok); else if(plan_id=="hc-sr04.progression.v1") addMeasurement(values,"progression_consistent",ok&&abs(last-first)>2,"boolean",target_id,ok); else {return sendError(id,"UNKNOWN_PLAN","HC-SR04 plan is not registered.");} JsonArray captured=data["series"].as<JsonArray>();addSeries(captured,"distance_cm","cm",target_id,60000,distances,valid);addSeries(captured,"valid_echo","logic",target_id,60000,valid_echo,observed);addHealth(data["targetHealth"].as<JsonArray>(),target_id,ok,ok?0:1);data["operation"]["accepted"]=ok;data["operation"]["timedOut"]=safety.timedOut();data["operation"]["cleanupSucceeded"]=digitalRead(ahea::profile::HC_SR04_TRIGGER_PIN)==LOW;data["limitations"].as<JsonArray>().add("Beam geometry, alignment, and speed of sound affect distance estimates.");send(response);
}

bool loopbackPlan(const String& plan_id) {
  return plan_id == "loopback.observe-destination.1khz.v1" || plan_id == "loopback.observe-source.1khz.v1" ||
    plan_id == "loopback.compare-endpoints.1khz.v1" || plan_id == "loopback.measure-timing.1khz.v1" ||
    plan_id == "loopback.inspect-stimulus.static.v1" || plan_id == "loopback.repeat-synchronized.500hz.v1" ||
    plan_id == "loopback.verify-path.1khz.v1";
}
bool mpuPlan(const String& plan_id) { return plan_id == "mpu6050.identity.v1" || plan_id == "mpu6050.stationary.v1" || plan_id == "mpu6050.motion-axis.v1"; }
bool dhtPlan(const String& plan_id) { return plan_id == "dht11.response.v1" || plan_id == "dht11.environment.v1" || plan_id == "dht11.valid-rate.v1"; }
bool hcPlan(const String& plan_id) { return plan_id == "hc-sr04.echo-timing.v1" || plan_id == "hc-sr04.variance.v1" || plan_id == "hc-sr04.progression.v1"; }
bool planAvailable(const String& plan_id) {
  if (loopbackPlan(plan_id)) return ahea::profile::LOOPBACK_FIXTURE_REVIEWED;
  if (mpuPlan(plan_id)) return ahea::profile::MPU6050_ENABLED && ahea::profile::I2C_PULLUPS_AT_3V3_REVIEWED;
  if (dhtPlan(plan_id)) return ahea::profile::DHT11_ENABLED && ahea::profile::DHT11_3V3_INTERFACE_REVIEWED;
  if (hcPlan(plan_id)) return ahea::profile::HC_SR04_ENABLED && ahea::profile::HC_SR04_ECHO_DIVIDER_REVIEWED && ahea::profile::HC_SR04_ECHO_UPPER_OHMS == 8200 && ahea::profile::HC_SR04_ECHO_LOWER_OHMS == 10000;
  return false;
}
bool targetMatchesPlan(const String& target_id, const String& plan_id) {
  if (loopbackPlan(plan_id)) return target_id == "loopback-path";
  if (mpuPlan(plan_id)) return target_id == "imu";
  if (dhtPlan(plan_id)) return target_id == "climate-sensor";
  if (hcPlan(plan_id)) return target_id == "distance-sensor";
  return false;
}

void processCommand(const String& line) {
  JsonDocument request;
  if (deserializeJson(request, line) != DeserializationError::Ok || !request.is<JsonObject>() || request.as<JsonObject>().size() != 3 || !request["id"].is<const char*>() || !request["cmd"].is<const char*>() || !request["args"].is<JsonObject>()) return sendError("unknown", "MALFORMED_REQUEST", "Expected only id, cmd, and args object.");
  const String id = request["id"].as<String>();
  if (id.isEmpty() || id.length() > 120) return sendError("unknown", "MALFORMED_REQUEST", "Request id must contain 1 to 120 characters.");
  if (requestSeen(id)) return sendError(id, "DUPLICATE_REQUEST", "Duplicate or replayed request IDs are rejected.");
  const String command = request["cmd"].as<String>();
  JsonObject args = request["args"].as<JsonObject>();
  for (JsonPair pair : args) if (String(pair.key().c_str()) != "targetId" && String(pair.key().c_str()) != "planId") return sendError(id, "UNSAFE_ARGUMENT", "Only targetId and registered planId are accepted.");
  if (command == "hello") { if (args.size() != 0) return sendError(id, "UNSAFE_ARGUMENT", "hello accepts no arguments."); return sendHello(id); }
  if (command == "abort") { if (args.size() != 0) return sendError(id, "UNSAFE_ARGUMENT", "abort accepts no arguments."); safeOutputs(); safety.emergencyStop(); JsonDocument response = baseResponse(id, "abort.v1", millis()); response["data"]["operation"]["aborted"] = true; send(response); return; }
  if (command == "arm_session") { if (args.size() != 0) return sendError(id, "UNSAFE_ARGUMENT", "arm_session accepts no arguments."); safeOutputs(); if (!safety.arm(profileValid())) return sendError(id, "ARM_REJECTED", "Physical profile is disabled, ambiguous, or its electrical review is incomplete."); JsonDocument response = baseResponse(id, "arm_session", millis()); send(response); return; }
  if (command != "execute_plan") return sendError(id, "UNKNOWN_COMMAND", "Only registered plan execution is supported.");
  if (args.size() != 2 || !args["targetId"].is<const char*>() || !args["planId"].is<const char*>()) return sendError(id, "MALFORMED_REQUEST", "execute_plan requires targetId and planId only.");
  const String target_id = args["targetId"].as<String>(); const String plan_id = args["planId"].as<String>();
  if (target_id.isEmpty() || target_id.length() > 120 || plan_id.isEmpty() || plan_id.length() > 120) return sendError(id, "MALFORMED_REQUEST", "Target and plan identities must contain 1 to 120 characters.");
  if (!ahea::profile::PHYSICAL_ENABLED) return sendError(id, "PROFILE_DISABLED", "Physical operations are disabled.");
  if (!planAvailable(plan_id)) return sendError(id, "UNKNOWN_PLAN", "Plan is not registered by the reviewed profile.");
  if (!targetMatchesPlan(target_id, plan_id)) return sendError(id, "TARGET_MISMATCH", "Target does not match the registered plan.");
  if (loopbackPlan(plan_id)) return executeLoopback(id, target_id, plan_id);
  if (mpuPlan(plan_id)) return executeMpu(id, target_id, plan_id);
  if (dhtPlan(plan_id)) return executeDht(id, target_id, plan_id);
  if (hcPlan(plan_id)) return executeHc(id, target_id, plan_id);
  sendError(id, "UNKNOWN_PLAN", "Plan is not registered.");
}
}  // namespace

void setup() {
  if constexpr (ahea::profile::LOOPBACK_FIXTURE_REVIEWED) { pinMode(ahea::profile::LOOPBACK_STIMULUS_PIN,OUTPUT); digitalWrite(ahea::profile::LOOPBACK_STIMULUS_PIN,LOW); }
  esp_task_wdt_init(ahea::profile::WATCHDOG_TIMEOUT_SECONDS, true); esp_task_wdt_add(nullptr);
  registry_digest = computeRegistryDigest(); Serial.begin(115200); if constexpr (ahea::profile::LOOPBACK_FIXTURE_REVIEWED) { pinMode(ahea::profile::LOOPBACK_SOURCE_OBSERVER_PIN,INPUT); pinMode(ahea::profile::LOOPBACK_DESTINATION_OBSERVER_PIN,INPUT); }
  if constexpr (ahea::profile::DHT11_ENABLED) dht.begin();
  if constexpr (ahea::profile::HC_SR04_ENABLED) { pinMode(ahea::profile::HC_SR04_TRIGGER_PIN,OUTPUT); digitalWrite(ahea::profile::HC_SR04_TRIGGER_PIN,LOW); pinMode(ahea::profile::HC_SR04_ECHO_PIN,INPUT); }
  if constexpr (ahea::profile::MPU6050_ENABLED) { Wire.begin(ahea::profile::MPU6050_SDA_PIN, ahea::profile::MPU6050_SCL_PIN, ahea::profile::MPU6050_I2C_FREQUENCY_HZ); Wire.beginTransmission(ahea::profile::MPU6050_ADDRESS); Wire.write(0x6B); Wire.write(0); Wire.endTransmission(); }
}
void loop() { esp_task_wdt_reset(); while(Serial.available()){const char character=static_cast<char>(Serial.read());if(character=='\n'){if(!line_buffer.isEmpty())processCommand(line_buffer);line_buffer="";}else if(line_buffer.length()<2048)line_buffer+=character;else{line_buffer="";safeOutputs();safety.fault();}} }
