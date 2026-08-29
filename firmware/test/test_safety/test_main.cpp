#include <cassert>
#include "safety_state.h"
using namespace ahea;

int main() {
  SafetyMachine disabled(100, 2);
  assert(!disabled.arm(false));
  SafetyMachine safety(100, 2);
  assert(safety.arm(true));
  assert(safety.start(OperationClass::Read, 0) == StartResult::Accepted);
  assert(safety.running());
  assert(safety.tick(50));
  safety.finish();
  assert(safety.start(OperationClass::Actuation, 60, false) == StartResult::OperationDisabled);
  assert(safety.start(OperationClass::TimedIo, 60) == StartResult::Accepted);
  assert(!safety.tick(161));
  assert(safety.timedOut());
  SafetyMachine stopped(100, 4);
  assert(stopped.arm(true));
  assert(stopped.start(OperationClass::Read, 0) == StartResult::Accepted);
  assert(!stopped.tick(1, true));
  assert(stopped.estopLatched());
  assert(!stopped.arm(true));
  SafetyMachine budget(100, 1);
  assert(budget.arm(true));
  assert(budget.start(OperationClass::Read, 0) == StartResult::Accepted);
  budget.finish();
  assert(budget.start(OperationClass::Read, 1) == StartResult::BudgetExhausted);
  return 0;
}
