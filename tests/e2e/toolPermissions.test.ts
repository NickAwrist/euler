import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { agentRuntime } from "../../src/agents/runtime/AgentRuntime";
import { AgentRuntime } from "../../src/agents/runtime/AgentRuntime";
import { setOpenRouterApiKey } from "../../src/db";
import { createSessionRow } from "../../src/db/sessions";
import {
  effectiveUserPreferences,
  updateUserPreferences,
} from "../../src/db/userPreferences";
import {
  ApprovalDecision,
  ToolPermissionCondition_Argument_Match,
  ToolPermissionRule_Action,
} from "../../src/gen/euler/v1/permissions_pb";
import { toProtoRule } from "../../src/permissions/wire";
import { workspaceService } from "../../src/workspaces/WorkspaceService";
import { getOpenRouterRequests } from "../helpers/mockOpenRouter";
import { setOpenRouterScenario } from "../helpers/mockOpenRouter";
import { Code, rpc, rpcCode } from "../helpers/rpc";
import { TEST_USER_ID } from "../helpers/server";
import { allToolsRule } from "../helpers/toolPermissions";

const model = "openrouter:openai/gpt-5.6-terra";
async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out");
    await Bun.sleep(10);
  }
}

test("approval API gates real execution, survives browser reload, and saves matching calls without another prompt", async () => {
  setOpenRouterApiKey("test");
  setOpenRouterScenario("tool-permissions");
  updateUserPreferences(TEST_USER_ID, {
    toolPermissions: { rules: [allToolsRule()] },
  });
  const api = rpc();
  const { id: sessionId } = await api.sessions.createSession({ model });
  const root = workspaceService.retainedPath(TEST_USER_ID, sessionId);
  // A client on the stream sees the approval open and close as typed events.
  const watching = new AbortController();
  const seen: string[] = [];
  const watched = (async () => {
    for await (const { event } of api.events.subscribe(
      { afterSequence: 0n },
      { signal: watching.signal },
    )) {
      const kind = event?.payload.case;
      if (
        event?.sessionId === sessionId &&
        (kind === "approvalRequested" || kind === "approvalResolved")
      )
        seen.push(kind);
    }
  })().catch(() => {});
  try {
    const command = "echo approved >> marker.txt";
    const send = () =>
      api.agent.sendMessage({
        sessionId,
        content: `command:${command}`,
        settings: { model },
      });
    await send();
    await until(
      () => agentRuntime.approvals.list(TEST_USER_ID, sessionId).length === 1,
    );
    expect(
      await fs.readFile(`${root}/marker.txt`, "utf8").catch(() => null),
    ).toBeNull();
    // A reloaded client finds the pending approval in the runtime snapshot.
    const [approval] = (await api.agent.getRuntime({ sessionId })).approvals;
    expect(approval?.arguments?.command).toBe(command);
    expect(approval?.arguments?.background === true).toBe(false);
    const respond = (decision: ApprovalDecision, owner = TEST_USER_ID) =>
      rpc(owner).agent.respondToApproval({
        sessionId,
        approvalId: approval!.id,
        decision,
      });
    expect(
      await rpcCode(
        respond(
          ApprovalDecision.ALLOW_ONCE,
          "22222222-2222-4222-8222-222222222222",
        ),
      ),
    ).toBe(Code.NotFound);
    expect(await rpcCode(respond(ApprovalDecision.UNSPECIFIED))).toBe(
      Code.InvalidArgument,
    );
    const answered = await respond(ApprovalDecision.ALLOW_MATCHING);
    expect(answered.rule?.sessionId).toBe(sessionId);
    await until(() => !agentRuntime.busy(TEST_USER_ID, sessionId));
    expect(await fs.readFile(`${root}/marker.txt`, "utf8")).toBe("approved\n");
    expect(await rpcCode(respond(ApprovalDecision.ALLOW_ONCE))).toBe(
      Code.NotFound,
    );
    const saved =
      effectiveUserPreferences(TEST_USER_ID).toolPermissions.rules.at(-1)!;
    expect(saved.sessionId).toBe(sessionId);
    expect(saved.id).toBe(answered.rule!.id);
    await send();
    await until(() => !agentRuntime.busy(TEST_USER_ID, sessionId));
    expect(await fs.readFile(`${root}/marker.txt`, "utf8")).toBe(
      "approved\napproved\n",
    );
    expect(agentRuntime.approvals.list(TEST_USER_ID, sessionId)).toEqual([]);
    expect(seen).toEqual(["approvalRequested", "approvalResolved"]);
    await api.preferences.deletePermissionRule({ ruleId: saved.id });
    expect(
      effectiveUserPreferences(TEST_USER_ID).toolPermissions.rules,
    ).toEqual([allToolsRule()]);
  } finally {
    watching.abort();
    await watched;
    await agentRuntime.deleteSession(TEST_USER_ID, sessionId);
  }
});

for (const action of ["stop", "rewind", "delete"] as const) {
  test(`${action} cancels a pending approval without executing the tool or saving a rule`, async () => {
    setOpenRouterApiKey("test");
    setOpenRouterScenario("tool-permissions");
    updateUserPreferences(TEST_USER_ID, {
      toolPermissions: { rules: [allToolsRule()] },
    });
    const runtime = new AgentRuntime();
    const id = crypto.randomUUID();
    createSessionRow(TEST_USER_ID, id, Date.now(), model);
    const workspace = await workspaceService.provisionRetained(
      TEST_USER_ID,
      id,
    );
    const main = runtime.main(TEST_USER_ID, id);
    runtime.send(main, {
      content: "command:touch forbidden.txt",
      attachmentIds: [],
    });
    await until(() => runtime.approvals.list(TEST_USER_ID, id).length === 1);
    const approval = runtime.approvals.list(TEST_USER_ID, id)[0]!;
    if (action === "stop") await runtime.cancel(main);
    else if (action === "rewind")
      await runtime.rewind(TEST_USER_ID, id, { position: 0 });
    else await runtime.deleteSession(TEST_USER_ID, id);
    expect(runtime.approvals.list(TEST_USER_ID, id)).toEqual([]);
    expect(
      await fs
        .readFile(`${workspace.hostPath}/forbidden.txt`)
        .catch(() => null),
    ).toBeNull();
    await expect(
      runtime.approvals.respond(TEST_USER_ID, id, approval.id, {
        decision: "allow_matching",
      }),
    ).rejects.toThrow();
    expect(
      effectiveUserPreferences(TEST_USER_ID).toolPermissions.rules,
    ).toEqual([allToolsRule()]);
    await runtime.deleteSession(TEST_USER_ID, id);
  });
}

test("waiting for approval releases scheduler slots and background jobs are admitted only after approval", async () => {
  setOpenRouterApiKey("test");
  setOpenRouterScenario("background-jobs");
  updateUserPreferences(TEST_USER_ID, {
    toolPermissions: { rules: [allToolsRule()] },
  });
  const runtime = new AgentRuntime(1);
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  try {
    for (const id of ids) {
      createSessionRow(TEST_USER_ID, id, Date.now(), model);
      runtime.send(runtime.main(TEST_USER_ID, id), {
        content: "command:sleep 0.1; echo allowed",
        attachmentIds: [],
      });
    }
    await until(() =>
      ids.every((id) => runtime.approvals.list(TEST_USER_ID, id).length === 1),
    );
    for (const id of ids)
      expect(runtime.jobs.list(TEST_USER_ID, id)).toEqual([]);
    await Promise.all(
      ids.map((id) =>
        runtime.approvals.respond(
          TEST_USER_ID,
          id,
          runtime.approvals.list(TEST_USER_ID, id)[0]!.id,
          { decision: "allow_once" },
        ),
      ),
    );
    await until(() => ids.every((id) => !runtime.busy(TEST_USER_ID, id)));
    for (const id of ids)
      expect(runtime.jobs.list(TEST_USER_ID, id)[0]?.status).toBe("succeeded");
  } finally {
    for (const id of ids) await runtime.deleteSession(TEST_USER_ID, id);
  }
});

test("permission preferences persist and rule CRUD merges current rules with user ownership", async () => {
  const { preferences } = rpc();
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  const rule = (id: string, pattern: string) =>
    toProtoRule({
      id,
      tool: "bash",
      action: "deny",
      condition: {
        kind: "argument",
        field: "command",
        match: "regex",
        value: pattern,
      },
    });
  for (const id of ids)
    await preferences.putPermissionRule({
      rule: rule(id, "^npm\\s+publish\\b"),
    });
  expect(
    effectiveUserPreferences(TEST_USER_ID).toolPermissions.rules,
  ).toHaveLength(2);
  // RE2 rejects these patterns, which buf.validate cannot check.
  for (const pattern of ["[", "(?=publish)"]) {
    expect(
      await rpcCode(
        preferences.putPermissionRule({ rule: rule(ids[0]!, pattern) }),
      ),
    ).toBe(Code.InvalidArgument);
    expect(
      effectiveUserPreferences(TEST_USER_ID).toolPermissions.rules[0]
        ?.condition,
    ).toMatchObject({ match: "regex", value: "^npm\\s+publish\\b" });
  }
  // A rule needs an action and a condition.
  for (const invalid of [
    { ...rule(ids[0]!, "a"), action: ToolPermissionRule_Action.UNSPECIFIED },
    { ...rule(ids[0]!, "a"), condition: undefined },
    { ...rule(ids[0]!, "a"), id: "not-a-uuid" },
  ])
    expect(
      await rpcCode(preferences.putPermissionRule({ rule: invalid })),
    ).toBe(Code.InvalidArgument);
  await rpc(
    "22222222-2222-4222-8222-222222222222",
  ).preferences.deletePermissionRule({ ruleId: ids[0]! });
  expect(
    effectiveUserPreferences(TEST_USER_ID).toolPermissions.rules,
  ).toHaveLength(2);
  await preferences.updatePreferences({});
  const saved = (await preferences.getPreferences({})).preferences;
  expect(saved?.toolPermissionRules.map((entry) => entry.id)).toEqual(ids);
  expect(saved?.toolPermissionRules[0]?.condition?.kind).toMatchObject({
    case: "argument",
    value: { match: ToolPermissionCondition_Argument_Match.REGEX },
  });
});

test("a deny added while an approved call waits for a scheduler slot still prevents execution", async () => {
  setOpenRouterApiKey("test");
  setOpenRouterScenario("tool-permissions");
  updateUserPreferences(TEST_USER_ID, {
    toolPermissions: { rules: [allToolsRule()] },
  });
  const runtime = new AgentRuntime(1);
  const firstId = crypto.randomUUID();
  const secondId = crypto.randomUUID();
  const commands = [
    "echo started > started.txt; sleep 0.2; echo first",
    "touch blocked.txt",
  ];
  for (const [index, id] of [firstId, secondId].entries()) {
    createSessionRow(TEST_USER_ID, id, Date.now(), model);
    runtime.send(runtime.main(TEST_USER_ID, id), {
      content: `command:${commands[index]}`,
      attachmentIds: [],
    });
  }
  try {
    await until(() =>
      [firstId, secondId].every(
        (id) => runtime.approvals.list(TEST_USER_ID, id).length === 1,
      ),
    );
    await runtime.approvals.respond(
      TEST_USER_ID,
      firstId,
      runtime.approvals.list(TEST_USER_ID, firstId)[0]!.id,
      { decision: "allow_once" },
    );
    await until(() =>
      existsSync(
        `${workspaceService.retainedPath(TEST_USER_ID, firstId)}/started.txt`,
      ),
    );
    await runtime.approvals.respond(
      TEST_USER_ID,
      secondId,
      runtime.approvals.list(TEST_USER_ID, secondId)[0]!.id,
      { decision: "allow_once" },
    );
    updateUserPreferences(TEST_USER_ID, {
      toolPermissions: {
        rules: [
          {
            id: crypto.randomUUID(),
            tool: "bash",
            action: "deny",
            condition: {
              kind: "argument",
              field: "command",
              match: "exact",
              value: commands[1]!,
            },
          },
        ],
      },
    });
    await until(
      () =>
        !runtime.busy(TEST_USER_ID, firstId) &&
        !runtime.busy(TEST_USER_ID, secondId),
    );
    const root = workspaceService.retainedPath(TEST_USER_ID, secondId);
    expect(
      await fs.readFile(`${root}/blocked.txt`).catch(() => null),
    ).toBeNull();
    expect(
      runtime.store
        .get(runtime.main(TEST_USER_ID, secondId).id)
        ?.history.some((message) =>
          message.content.includes("permission rule blocks"),
        ),
    ).toBe(true);
  } finally {
    await runtime.deleteSession(TEST_USER_ID, firstId);
    await runtime.deleteSession(TEST_USER_ID, secondId);
  }
});

test("restart interrupts a subagent waiting on a tool approval instead of leaving it stuck", async () => {
  const id = crypto.randomUUID();
  createSessionRow(TEST_USER_ID, id, Date.now(), model);
  const first = new AgentRuntime();
  const main = first.main(TEST_USER_ID, id);
  const child = {
    ...main,
    id: crypto.randomUUID(),
    kind: "general" as const,
    parentId: main.id,
    title: "Waiting child",
    status: "running" as const,
    history: [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "permission-call",
            function: {
              name: "bash",
              arguments: { command: "touch forbidden" },
            },
          },
        ],
      },
    ],
  };
  first.store.save(child);
  first.store.saveHistory(child, child.history);
  first.store.saveStep(child, "activation", 0, {
    kind: "tool_call",
    status: "running",
    toolName: "bash",
    turnIndex: 0,
  });
  const restarted = new AgentRuntime();
  restarted.recover();
  expect(restarted.approvals.list(TEST_USER_ID, id)).toEqual([]);
  const recovered = restarted.store.get(child.id)!;
  expect(recovered.status).toBe("idle");
  expect(recovered.interruption).toContain("server restart");
  expect(
    recovered.history.find(
      (message) => message.tool_call_id === "permission-call",
    )?.content,
  ).toContain("Interrupted by a server restart");
  expect(getOpenRouterRequests()).toHaveLength(0);
  await restarted.deleteSession(TEST_USER_ID, id);
});

test("a blocking parent keeps waiting while its child needs user approval", async () => {
  setOpenRouterApiKey("test");
  setOpenRouterScenario("blocking-permission");
  updateUserPreferences(TEST_USER_ID, {
    toolPermissions: {
      rules: [
        allToolsRule(),
        {
          id: crypto.randomUUID(),
          tool: "spawn_agent",
          action: "allow",
          condition: { kind: "any" },
        },
      ],
    },
  });
  const runtime = new AgentRuntime(1);
  const id = crypto.randomUUID();
  createSessionRow(TEST_USER_ID, id, Date.now(), model);
  const main = runtime.main(TEST_USER_ID, id);
  try {
    runtime.send(main, {
      content: "Have a child do the work and wait for it",
      attachmentIds: [],
    });
    await until(() => runtime.approvals.list(TEST_USER_ID, id).length === 1);
    const approval = runtime.approvals.list(TEST_USER_ID, id)[0]!;
    expect(approval.agentId).not.toBe(main.id);
    expect(runtime.store.get(approval.agentId)?.status).toBe("running");
    expect(runtime.store.get(approval.agentId)?.activity).toContain(
      "Waiting for approval",
    );
    await Bun.sleep(20);
    expect(
      runtime.store
        .get(main.id)
        ?.history.some((message) => message.role === "tool"),
    ).toBe(false);
    expect(runtime.snapshot(TEST_USER_ID, id).activation).not.toBeNull();
    await runtime.approvals.respond(TEST_USER_ID, id, approval.id, {
      decision: "allow_once",
    });
    await until(() => !runtime.busy(TEST_USER_ID, id));
    expect(
      runtime.store
        .get(main.id)
        ?.history.find((message) => message.role === "tool")?.content,
    ).toContain('"result":"42"');
  } finally {
    await runtime.deleteSession(TEST_USER_ID, id);
  }
});

test("deleting a chat removes only its scoped permission rules", async () => {
  const id = crypto.randomUUID();
  createSessionRow(TEST_USER_ID, id, Date.now(), "test");
  const global = {
    id: crypto.randomUUID(),
    tool: "bash",
    action: "deny" as const,
    condition: { kind: "any" as const },
  };
  const other = {
    ...global,
    id: crypto.randomUUID(),
    sessionId: "another-chat",
  };
  updateUserPreferences(TEST_USER_ID, {
    toolPermissions: {
      rules: [
        allToolsRule(),
        global,
        other,
        { ...global, id: crypto.randomUUID(), sessionId: id },
      ],
    },
  });
  await rpc().sessions.deleteSession({ id });
  expect(effectiveUserPreferences(TEST_USER_ID).toolPermissions).toEqual({
    rules: [allToolsRule(), global, other],
  });
});
