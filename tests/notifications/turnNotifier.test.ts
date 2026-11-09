import { expect, test } from "bun:test";
import type { DeviceRow } from "../../src/db/devices";
import type { AgentEvent } from "../../src/events/types";
import type {
  ApnsNotification,
  ApnsResult,
} from "../../src/notifications/apns";
import {
  APPROVAL_CATEGORY,
  TurnNotifier,
  plainSummary,
} from "../../src/notifications/turnNotifier";
import type { Agent } from "../../src/schemas/agents";

const OWNER = "owner";
const device: DeviceRow = {
  token: "abc123",
  owner_uuid: OWNER,
  environment: "sandbox",
  bundle_id: "net.spaceheater.euler",
  updated_at: 1,
};

function setup({ watching = false, result = { ok: true } as ApnsResult } = {}) {
  const sent: ApnsNotification[] = [];
  const forgotten: string[] = [];
  const notifier = new TurnNotifier({
    send: async (notification) => {
      sent.push(notification);
      return result;
    },
    devices: (owner) => (owner === OWNER ? [device] : []),
    forget: (token) => forgotten.push(token),
    watching: () => watching,
    title: () => "Release notes",
  });
  const publish = async (...events: AgentEvent[]) => {
    for (const event of events) notifier.observe(OWNER, event);
    // Sends run after observe returns.
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { sent, forgotten, publish };
}

const agent = (id: string, kind: Agent["kind"]): AgentEvent => ({
  type: "agent_status",
  sessionId: "chat",
  agentId: id,
  agent: {
    held: false,
    id,
    sessionId: "chat",
    ownerUuid: OWNER,
    parentId: kind === "main" ? null : "main",
    kind,
    title: kind === "main" ? "Main agent" : "Helper",
    status: "running",
    model: "test",
    spawnPosition: 0,
    createdAt: 1,
    endedAt: null,
    activity: "",
  },
});
const reply = (
  agentId: string,
  content: string,
  attachments: NonNullable<
    Extract<AgentEvent, { type: "transcript_appended" }>["message"]
  >["attachments"] = [],
): AgentEvent => ({
  type: "transcript_appended",
  sessionId: "chat",
  agentId,
  message: { role: "assistant", content, attachments },
});
const ended = (
  agentId: string,
  outcome: "done" | "aborted" | "error" | "paused",
): AgentEvent => ({
  type: "activation_ended",
  sessionId: "chat",
  agentId,
  activationId: "turn",
  outcome,
});

test("a finished main turn pushes its reply as plain text", async () => {
  const { sent, publish } = setup();
  await publish(
    agent("main", "main"),
    reply(
      "main",
      "## Done\n\nThe **build** passes. See [the log](https://x.test).",
    ),
    ended("main", "done"),
  );
  expect(sent).toEqual([
    {
      token: "abc123",
      environment: "sandbox",
      topic: "net.spaceheater.euler",
      payload: {
        aps: {
          alert: {
            title: "Release notes",
            body: "Done The build passes. See the log.",
          },
          sound: "default",
          "thread-id": "chat",
          "mutable-content": 1,
        },
        sessionId: "chat",
      },
    },
  ]);
});

test("failed turns push, stopped and subagent turns do not", async () => {
  const { sent, publish } = setup();
  await publish(
    agent("main", "main"),
    agent("helper", "general"),
    reply("helper", "Helper result"),
    ended("helper", "done"),
    reply("main", "Partial"),
    ended("main", "aborted"),
    ended("main", "paused"),
  );
  expect(sent).toEqual([]);
  await publish(
    reply("main", "Error: Provider unavailable"),
    ended("main", "error"),
  );
  expect(sent.map((push) => push.payload.aps)).toMatchObject([
    { alert: { body: "Error: Provider unavailable" } },
  ]);
});

test("a reply's generated image rides along for the notification extension", async () => {
  const { sent, publish } = setup();
  await publish(
    agent("main", "main"),
    reply("main", "", [
      { kind: "generated_image", url: "/api/comfyui/view/out.png" },
    ]),
    ended("main", "done"),
  );
  expect(sent[0]?.payload).toMatchObject({
    aps: { alert: { body: "Generated an image." } },
    image: "/api/comfyui/view/out.png",
  });
});

test("approvals from any agent push with actions", async () => {
  const { sent, publish } = setup();
  await publish({
    type: "approval_requested",
    sessionId: "chat",
    agentId: "helper",
    approval: {
      id: "22222222-2222-4222-8222-222222222222",
      sessionId: "chat",
      agentId: "helper",
      agentTitle: "Helper",
      tool: "bash",
      arguments: { command: "ls" },
      workspacePath: "/repo",
      reason: "Tool calls ask before running.",
      matchingScope: "Identical arguments in this chat and workspace",
    },
  });
  expect(sent[0]?.payload).toMatchObject({
    aps: {
      alert: { body: "Helper wants to run bash" },
      category: APPROVAL_CATEGORY,
    },
    sessionId: "chat",
    approvalId: "22222222-2222-4222-8222-222222222222",
  });
});

test("an open event stream means the app is watching, so nothing is pushed", async () => {
  const { sent, publish } = setup({ watching: true });
  await publish(
    agent("main", "main"),
    reply("main", "Hi"),
    ended("main", "done"),
  );
  expect(sent).toEqual([]);
});

test("tokens APNs reports dead are forgotten", async () => {
  const { forgotten, publish } = setup({
    result: { ok: false, status: 410, reason: "Unregistered", deadToken: true },
  });
  await publish(
    agent("main", "main"),
    reply("main", "Hi"),
    ended("main", "done"),
  );
  expect(forgotten).toEqual(["abc123"]);
});

test("summaries drop Markdown and stay short", () => {
  expect(plainSummary("```ts\ncode\n```\n- one\n- two $x^2$")).toBe(
    "one two x^2",
  );
  const long = plainSummary("word ".repeat(200));
  expect(long.length).toBeLessThanOrEqual(240);
  expect(long.endsWith("…")).toBe(true);
});
