#include "safety_state.h"

namespace ahea {
SafetyMachine::SafetyMachine(uint32_t timeout_ms, uint16_t operation_limit) : timeout_ms_(timeout_ms), operation_limit_(operation_limit) {}
bool SafetyMachine::arm(bool profile_valid) { if (!profile_valid || estop_latched_ || state_ == SafetyState::Faulted) return false; state_ = SafetyState::Armed; operations_ = 0; timed_out_ = false; return true; }
StartResult SafetyMachine::start(OperationClass kind, uint32_t now_ms, bool operation_enabled) {
  if (estop_latched_) return StartResult::Estopped;
  if (state_ == SafetyState::Running) return StartResult::Busy;
  if (state_ != SafetyState::Armed) return StartResult::NotArmed;
  if (kind == OperationClass::Actuation && !operation_enabled) return StartResult::OperationDisabled;
  if (operations_ >= operation_limit_) return StartResult::BudgetExhausted;
  operations_++; started_at_ms_ = now_ms; timed_out_ = false; state_ = SafetyState::Running; return StartResult::Accepted;
}
bool SafetyMachine::tick(uint32_t now_ms, bool abort_requested) {
  if (abort_requested) { emergencyStop(); return false; }
  if (state_ != SafetyState::Running) return false;
  if (now_ms - started_at_ms_ >= timeout_ms_) { timed_out_ = true; state_ = SafetyState::Faulted; return false; }
  return true;
}
void SafetyMachine::finish() { if (state_ == SafetyState::Running) state_ = SafetyState::Armed; }
void SafetyMachine::emergencyStop() { estop_latched_ = true; state_ = SafetyState::Estopped; }
void SafetyMachine::fault() { state_ = SafetyState::Faulted; }
}  // namespace ahea
