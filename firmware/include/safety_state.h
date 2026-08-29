#pragma once
#include <cstdint>

namespace ahea {
enum class OperationClass { Read, TimedIo, BoundedOutput };
enum class SafetyState { Unarmed, Armed, Running, Estopped, Faulted };
enum class StartResult { Accepted, NotArmed, Busy, BudgetExhausted, OperationDisabled, Estopped };

class SafetyMachine {
 public:
  SafetyMachine(uint32_t timeout_ms, uint16_t operation_limit);
  bool arm(bool profile_valid);
  StartResult start(OperationClass kind, uint32_t now_ms, bool operation_enabled = true);
  bool tick(uint32_t now_ms, bool abort_requested = false);
  void finish();
  void emergencyStop();
  void fault();
  SafetyState state() const { return state_; }
  bool running() const { return state_ == SafetyState::Running; }
  bool estopLatched() const { return estop_latched_; }
  bool timedOut() const { return timed_out_; }
  uint16_t operations() const { return operations_; }
 private:
  SafetyState state_ = SafetyState::Unarmed;
  uint32_t timeout_ms_;
  uint16_t operation_limit_;
  uint32_t started_at_ms_ = 0;
  uint16_t operations_ = 0;
  bool estop_latched_ = false;
  bool timed_out_ = false;
};
}  // namespace ahea
