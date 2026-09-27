import { expect, test } from "bun:test";
import { AskParentTool } from "../../src/tools/ask_parent";
import { CancelAgentTool } from "../../src/tools/cancel_agent";
import { SendMessageTool } from "../../src/tools/send_message";
import { SpawnAgentTool } from "../../src/tools/spawn_agent";

test("agent tools reject invalid arguments before invoking runtime actions", async () => {
  let calls = 0;
  const spawn = new SpawnAgentTool(async () => {
    calls++;
    return { agentId: "child" };
  });
  const send = new SendMessageTool(() => {
    calls++;
  });
  const ask = new AskParentTool(() => {
    calls++;
  });
  const cancel = new CancelAgentTool(async () => {
    calls++;
  });
  await expect(
    spawn.execute({
      kind: "general",
      title: "ok",
      task: "task",
      wait: "false",
    }),
  ).rejects.toThrow();
  await expect(
    spawn.execute({ kind: "nested", title: "ok", task: "task" }),
  ).rejects.toThrow();
  await expect(
    send.execute({ content: " ", kind: "progress" }),
  ).rejects.toThrow();
  await expect(
    send.execute({ content: "hello", kind: "unknown" }),
  ).rejects.toThrow();
  await expect(ask.execute({ question: 123 })).rejects.toThrow();
  await expect(
    cancel.execute({ agentId: "child", reason: " " }),
  ).rejects.toThrow();
  expect(calls).toBe(0);
  expect(
    (
      await spawn.execute({
        kind: "general",
        title: "ok",
        task: "task",
        wait: false,
      })
    ).text,
  ).toContain("child");
  expect(calls).toBe(1);
});
