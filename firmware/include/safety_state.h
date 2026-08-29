#pragma once

#include <cstdint>

namespace ahea {

enum class ProbeKind { Motion, Current, Verification };
enum class SafetyState { Unarmed, Armed, Pulsing, Cooldown, Estopped, Faulted };
enum class StartResult {
  Accepted,
  NotArmed,
  Busy,
  Cooldown,
  BudgetExhausted,
  DiagnosticBudgetExhausted,
  VerificationBudgetExhausted,
  SensorUnhealthy,
  Estopped,
};

class SafetyMachine {
 public:
  SafetyMachine(uint32_t pulse_ms, uint32_t hard_timeout_ms, uint32_t cooldown_ms,
                uint16_t total_limit, uint16_t diagnostic_limit, uint16_t verification_limit);

  bool arm(bool profile_valid, bool estop_released);
  StartResult start(ProbeKind kind, uint32_t now_ms, bool sensors_healthy);
  bool tick(uint32_t now_ms, float current_ma, float current_limit_ma, bool estop_pressed);
  void finish(uint32_t now_ms);
  void emergencyStop();
  void fault();

  SafetyState state() const { return state_; }
  bool motorEnabled() const { return state_ == SafetyState::Pulsing; }
  bool estopLatched() const { return estop_latched_; }
  bool tripped() const { return tripped_; }
  bool timedOut() const { return timed_out_; }
  uint16_t totalActivations() const { return total_activations_; }
  uint16_t diagnosticActivations() const { return diagnostic_activations_; }
  uint16_t verificationActivations() const { return verification_activations_; }

 private:
  SafetyState state_ = SafetyState::Unarmed;
  uint32_t pulse_ms_;
  uint32_t hard_timeout_ms_;
  uint32_t cooldown_ms_;
  uint16_t total_limit_;
  uint16_t diagnostic_limit_;
  uint16_t verification_limit_;
  uint32_t started_at_ms_ = 0;
  uint32_t cooldown_started_ms_ = 0;
  uint16_t total_activations_ = 0;
  uint16_t diagnostic_activations_ = 0;
  uint16_t verification_activations_ = 0;
  bool estop_latched_ = false;
  bool tripped_ = false;
  bool timed_out_ = false;
};

}  // namespace ahea
