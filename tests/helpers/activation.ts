import { expect } from "bun:test";
import { agentRuntime } from "../../src/agents/runtime/AgentRuntime";
import { TEST_USER_ID } from "./server";
export async function waitForActivation(
  sessionId: string,
  owner = TEST_USER_ID,
) {
  const deadline = Date.now() + 5000;
  do {
    const state = agentRuntime.snapshot(owner, sessionId);
    if (!state.activation && !state.queued.length) return state;
    await Bun.sleep(10);
  } while (Date.now() < deadline);
  expect.unreachable("Activation did not finish");
}
