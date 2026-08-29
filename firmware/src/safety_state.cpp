#include "safety_state.h"

namespace ahea {

SafetyMachine::SafetyMachine(uint32_t pulse_ms, uint32_t hard_timeout_ms, uint32_t cooldown_ms,
                             uint16_t total_limit, uint16_t diagnostic_limit, uint16_t verification_limit)
    : pulse_ms_(pulse_ms),
      hard_timeout_ms_(hard_timeout_ms),
      cooldown_ms_(cooldown_ms),
      total_limit_(total_limit),
      diagnostic_limit_(diagnostic_limit),
      verification_limit_(verification_limit) {}

bool SafetyMachine::arm(bool profile_valid, bool estop_released) {
  if (!profile_valid || !estop_released || estop_latched_ || state_ == SafetyState::Faulted) return false;
  state_ = SafetyState::Armed;
  total_activations_ = 0;
  diagnostic_activations_ = 0;
  verification_activations_ = 0;
  tripped_ = false;
  timed_out_ = false;
  return true;
}

StartResult SafetyMachine::start(ProbeKind kind, uint32_t now_ms, bool sensors_healthy) {
  if (estop_latched_) return StartResult::Estopped;
  if (state_ == SafetyState::Pulsing) return StartResult::Busy;
  if (state_ == SafetyState::Unarmed || state_ == SafetyState::Faulted) return StartResult::NotArmed;
  if (state_ == SafetyState::Cooldown && now_ms - cooldown_started_ms_ < cooldown_ms_) return StartResult::Cooldown;
  if (!sensors_healthy) return StartResult::SensorUnhealthy;
  if (total_activations_ >= total_limit_) return StartResult::BudgetExhausted;
  if (kind == ProbeKind::Verification && verification_activations_ >= verification_limit_) {
    return StartResult::VerificationBudgetExhausted;
  }
  if (kind != ProbeKind::Verification && diagnostic_activations_ >= diagnostic_limit_) {
    return StartResult::DiagnosticBudgetExhausted;
  }
  total_activations_++;
  if (kind == ProbeKind::Verification) verification_activations_++;
  else diagnostic_activations_++;
  state_ = SafetyState::Pulsing;
  started_at_ms_ = now_ms;
  tripped_ = false;
  timed_out_ = false;
  return StartResult::Accepted;
}

bool SafetyMachine::tick(uint32_t now_ms, float current_ma, float current_limit_ma, bool estop_pressed) {
  if (estop_pressed) {
    emergencyStop();
    return false;
  }
  if (state_ != SafetyState::Pulsing) return false;
  if (current_ma > current_limit_ma) {
    tripped_ = true;
    state_ = SafetyState::Faulted;
    return false;
  }
  if (now_ms - started_at_ms_ >= hard_timeout_ms_) {
    timed_out_ = true;
    state_ = SafetyState::Faulted;
    return false;
  }
  if (now_ms - started_at_ms_ >= pulse_ms_) {
    finish(now_ms);
    return false;
  }
  return true;
}

void SafetyMachine::finish(uint32_t now_ms) {
  if (state_ != SafetyState::Pulsing) return;
  state_ = SafetyState::Cooldown;
  cooldown_started_ms_ = now_ms;
}

void SafetyMachine::emergencyStop() {
  estop_latched_ = true;
  state_ = SafetyState::Estopped;
}

void SafetyMachine::fault() {
  tripped_ = true;
  state_ = SafetyState::Faulted;
}

}  // namespace ahea
