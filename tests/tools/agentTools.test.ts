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
  }, true);
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
      prompt: "prompt",
      wait: "false",
    }),
  ).rejects.toThrow();
  await expect(
    spawn.execute({ kind: "nested", title: "ok", prompt: "prompt" }),
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
        prompt: "prompt",
        wait: false,
      })
    ).text,
  ).toContain("child");
  expect(calls).toBe(1);
});

test("a main agent's messages always wake the subagent they name", async () => {
  const sent: unknown[] = [];
  const send = new SendMessageTool((request) => sent.push(request), false);
  await send.execute({ to: "child", content: "Retry", kind: "progress" });
  expect(sent).toEqual([{ to: "child", content: "Retry" }]);
  await expect(send.execute({ content: "No recipient" })).rejects.toThrow();
});
