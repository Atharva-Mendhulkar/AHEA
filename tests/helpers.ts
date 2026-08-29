import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Coordinator } from "../server/coordinator.js";
import { JsonStore } from "../server/store.js";
import { fallbackDecision, type DecisionClient, type DecisionContext } from "../server/agent.js";
import type { DiagnosisSession, SimulationFixture } from "../shared/domain.js";

export class TestAgent implements DecisionClient {
  calls: DecisionContext[] = [];
  async decide(context: DecisionContext) { this.calls.push(context); return fallbackDecision(context, `digest-${this.calls.length}`, "test"); }
  clear() {}
}
export async function setup(fixture: SimulationFixture = "fsr_outlier_compensable") {
  const root = await mkdtemp(path.join(tmpdir(), "ahea-test-"));
  const agent = new TestAgent();
  const coordinator = new Coordinator({ store: new JsonStore(root), agent, physicalEnabled: false, stateDwellMs: 0 });
  const session = await coordinator.createSession("simulation", fixture);
  return { root, agent, coordinator, session };
}
export async function runDiagnostic(coordinator: Coordinator, initial: DiagnosisSession): Promise<DiagnosisSession> {
  let session = await coordinator.submitProblem(initial.id, "FSR5 differs from the four known-good pressure sensors.");
  for (let guard = 0; session.pendingDecision && guard < 40; guard += 1) session = await coordinator.executePending(session.id, session.pendingDecision.id, session.version, true);
  return session;
}
