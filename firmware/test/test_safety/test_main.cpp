#include <cassert>
#include "safety_state.h"

using namespace ahea;

int main() {
  SafetyMachine safety(350, 500, 2000, 6, 2, 4);
  assert(!safety.arm(false, true));
  assert(safety.arm(true, true));
  assert(safety.start(ProbeKind::Motion, 0, true) == StartResult::Accepted);
  assert(safety.motorEnabled());
  assert(!safety.tick(350, 100, 750, false));
  assert(safety.start(ProbeKind::Current, 400, true) == StartResult::Cooldown);
  assert(safety.start(ProbeKind::Current, 2400, true) == StartResult::Accepted);
  assert(!safety.tick(2410, 800, 750, false));
  assert(safety.tripped());

  SafetyMachine estop(350, 500, 2000, 6, 2, 4);
  assert(estop.arm(true, true));
  assert(estop.start(ProbeKind::Motion, 0, true) == StartResult::Accepted);
  assert(!estop.tick(1, 20, 750, true));
  assert(estop.estopLatched());
  assert(!estop.arm(true, true));

  SafetyMachine budget(10, 20, 0, 6, 2, 4);
  assert(budget.arm(true, true));
  assert(budget.start(ProbeKind::Motion, 0, true) == StartResult::Accepted);
  budget.finish(10);
  assert(budget.start(ProbeKind::Current, 10, true) == StartResult::Accepted);
  budget.finish(20);
  assert(budget.start(ProbeKind::Current, 20, true) == StartResult::DiagnosticBudgetExhausted);
  for (int i = 0; i < 4; i++) {
    assert(budget.start(ProbeKind::Verification, 30 + i * 10, true) == StartResult::Accepted);
    budget.finish(40 + i * 10);
  }
  assert(budget.start(ProbeKind::Verification, 100, true) == StartResult::BudgetExhausted);
  return 0;
}
