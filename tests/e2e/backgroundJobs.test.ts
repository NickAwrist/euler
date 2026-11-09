import { expect, test } from "bun:test";
import { agentRuntime } from "../../src/agents/runtime/AgentRuntime";
import { setOpenRouterApiKey } from "../../src/db";
import { getDb } from "../../src/db/connection";
import { getMessagesForSession } from "../../src/db/sessions";
import { setOpenRouterScenario } from "../helpers/mockOpenRouter";
import { Code, rpc, rpcCode } from "../helpers/rpc";
import { TEST_USER_ID } from "../helpers/server";
const model = "openrouter:openai/gpt-5.6-terra";
async function until(condition: () => boolean, timeout = 15000) {
  const end = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > end) throw new Error("Timed out");
    await Bun.sleep(20);
  }
}
test("real Bash job returns immediately, survives idle and wakes agent exactly once with output attachment", async () => {
  setOpenRouterApiKey("test");
  setOpenRouterScenario("background-jobs");
  const api = rpc();
  const send = (sessionId: string, content: string) =>
    api.agent.sendMessage({ sessionId, content, settings: { model } });
  const { id } = await api.sessions.createSession({ model });
  try {
    await send(id, "Run the script");
    await until(() => getMessagesForSession(TEST_USER_ID, id).length === 2);
    const job = agentRuntime.jobs.list(TEST_USER_ID, id)[0]!;
    expect(job.status).toBe("running");
    expect(JSON.stringify(job.input)).toContain("sleep 7");
    expect(job.spawnPosition).toBe(1);
    expect(agentRuntime.snapshot(TEST_USER_ID, id).activation).toBeNull();
    expect(agentRuntime.busy(TEST_USER_ID, id)).toBe(true);
    await send(id, "How is it going?");
    await until(() => getMessagesForSession(TEST_USER_ID, id).length === 4);
    await until(
      () => job.status === "succeeded" && !agentRuntime.busy(TEST_USER_ID, id),
    );
    expect(job.endedAt! - job.createdAt).toBeGreaterThanOrEqual(10000);
    expect(job.output).toEqual({
      blocks: [{ kind: "code", text: "JOB_STARTED\nJOB_PROGRESS\nJOB_DONE\n" }],
    });
    expect(
      job.result?.attachments?.some(
        (a) => a.kind === "file" && a.path === "result.txt",
      ),
    ).toBe(true);
    const main = agentRuntime.main(TEST_USER_ID, id);
    expect(
      agentRuntime.store.inbox(main.id).filter((m) => m.kind === "job"),
    ).toHaveLength(1);
    expect(getMessagesForSession(TEST_USER_ID, id).at(-1)?.content).toContain(
      "received automatically",
    );
    const stored = getDb()
      .query<{ payload: string }, [string]>(
        "SELECT payload FROM jobs WHERE id=?",
      )
      .get(job.id)!;
    expect(JSON.parse(stored.payload).status).toBe("succeeded");
    expect(
      await rpcCode(
        rpc("22222222-2222-4222-8222-222222222222").jobs.listJobs({
          sessionId: id,
        }),
      ),
    ).toBe(Code.NotFound);
    const listed = await api.jobs.listJobs({ sessionId: id });
    expect(listed.jobs.map((entry) => entry.id)).toEqual([job.id]);
    expect(
      (await api.jobs.getJob({ sessionId: id, jobId: job.id })).job?.id,
    ).toBe(job.id);
    expect(
      await rpcCode(api.jobs.getJob({ sessionId: id, jobId: "job_missing" })),
    ).toBe(Code.NotFound);
  } finally {
    await agentRuntime.deleteSession(TEST_USER_ID, id);
  }
}, 20000);

test("stress: admission, bounded logs, failures, descendant cancellation, rewind and deletion", async () => {
  setOpenRouterApiKey("test");
  setOpenRouterScenario("background-jobs");
  const api = rpc();
  const send = (sessionId: string, content: string) =>
    api.agent.sendMessage({ sessionId, content, settings: { model } });
  const sessions: string[] = [];
  const create = async () => {
    const { id } = await api.sessions.createSession({ model });
    sessions.push(id);
    return id;
  };
  const run = async (id: string, command: string, count: number) => {
    await send(id, `command:${command}`);
    await until(
      () =>
        getMessagesForSession(TEST_USER_ID, id).filter((m) => m.role === "user")
          .length === count &&
        !agentRuntime.snapshot(TEST_USER_ID, id).activation,
    );
  };
  try {
    const id = await create();
    for (let i = 1; i <= 5; i++)
      await run(id, "echo START; sleep 30 & wait; echo LEAK > leak.txt", i);
    expect(agentRuntime.jobs.list(TEST_USER_ID, id)).toHaveLength(4);
    const main = agentRuntime.main(TEST_USER_ID, id);
    expect(
      main.history.some((m) => m.content.includes("Active job limit reached")),
    ).toBe(true);
    await Promise.all(
      agentRuntime.jobs
        .list(TEST_USER_ID, id)
        .map((job) => agentRuntime.jobs.cancel(TEST_USER_ID, id, job.id)),
    );
    expect(
      agentRuntime.jobs
        .list(TEST_USER_ID, id)
        .every((j) => j.status === "cancelled"),
    ).toBe(true);
    expect(
      agentRuntime.store.inbox(main.id).filter((m) => m.kind === "job"),
    ).toHaveLength(0);
    const admitted: string[] = [];
    for (let group = 0; group < 5; group++) {
      const session = await create();
      admitted.push(session);
      for (let i = 1; i <= 4; i++)
        await run(session, "echo START; sleep 30", i);
    }
    expect(
      admitted
        .flatMap((session) => agentRuntime.jobs.list(TEST_USER_ID, session))
        .filter((j) => j.status === "running"),
    ).toHaveLength(16);
    await Promise.all(
      admitted.map((session) =>
        agentRuntime.jobs.cancelAgent(TEST_USER_ID, session),
      ),
    );
    const overflow = await create();
    await run(overflow, "yes LOG | head -c 200000; echo EARLY >&2; exit 7", 1);
    await until(() => !agentRuntime.busy(TEST_USER_ID, overflow));
    const failed = agentRuntime.jobs.list(TEST_USER_ID, overflow)[0]!;
    expect(failed.status).toBe("failed");
    expect(failed.progress).toBeNull();
    expect(failed.output?.blocks).toHaveLength(1);
    expect(failed.metadata?.blocks.at(-1)).toEqual({
      kind: "fields",
      fields: [{ label: "Exit code", value: "7" }],
    });
    expect(JSON.stringify(failed.output)).toContain("LOG");
    expect(JSON.stringify(failed.output)).toContain("EARLY");
    expect(failed.outputTruncated).toBe(true);
    expect(
      Buffer.byteLength(JSON.stringify(failed.output)),
    ).toBeLessThanOrEqual(65536);
    const rewound = await create();
    await run(rewound, "sleep 30", 1);
    await agentRuntime.rewind(TEST_USER_ID, rewound, {
      position: 0,
      content: "How is it going?",
      model,
    });
    expect(agentRuntime.jobs.list(TEST_USER_ID, rewound)[0]?.status).toBe(
      "cancelled",
    );
    const deleted = await create();
    await run(deleted, "sleep 30", 1);
    await agentRuntime.deleteSession(TEST_USER_ID, deleted);
    expect(agentRuntime.jobs.list(TEST_USER_ID, deleted)).toHaveLength(0);
  } finally {
    for (const id of sessions)
      await agentRuntime.deleteSession(TEST_USER_ID, id);
  }
}, 20000);

test("ephemeral chat jobs persist, survive reply completion, and stop cancels them without waking the agent", async () => {
  setOpenRouterApiKey("test");
  setOpenRouterScenario("background-jobs");
  const api = rpc();
  const send = (sessionId: string, content: string) =>
    api.agent.sendMessage({ sessionId, content, settings: { model } });
  const { id } = await api.sessions.createSession({ model, ephemeral: true });
  try {
    await send(id, "command:echo START; sleep 30");
    await until(
      () =>
        agentRuntime.jobs.list(TEST_USER_ID, id).length === 1 &&
        !agentRuntime.snapshot(TEST_USER_ID, id).activation,
    );
    expect(agentRuntime.jobs.list(TEST_USER_ID, id)[0]?.status).toBe("running");
    expect(
      getDb()
        .query<{ count: number }, [string]>(
          "SELECT count(*) AS count FROM jobs WHERE session_id=?",
        )
        .get(id)?.count,
    ).toBe(1);
    await api.agent.stop({ sessionId: id });
    expect(agentRuntime.jobs.list(TEST_USER_ID, id)[0]?.status).toBe(
      "cancelled",
    );
    expect(
      agentRuntime.store
        .inbox(agentRuntime.main(TEST_USER_ID, id).id)
        .filter((m) => m.kind === "job"),
    ).toHaveLength(0);
  } finally {
    await agentRuntime.deleteSession(TEST_USER_ID, id);
  }
});

test("restart records one non-waking interruption notification without restarting work", async () => {
  const { AgentRuntime } = await import(
    "../../src/agents/runtime/AgentRuntime"
  );
  const { id } = await rpc().sessions.createSession({ model });
  try {
    const main = agentRuntime.main(TEST_USER_ID, id);
    const job = {
      id: "job_restart",
      ownerUuid: TEST_USER_ID,
      sessionId: id,
      agentId: main.id,
      tool: "bash",
      description: "sleep 30",
      activationId: "old",
      status: "running",
      createdAt: Date.now(),
      endedAt: null,
      metadata: null,
      outputTruncated: false,
      input: { blocks: [] },
      progress: null,
      output: null,
      notified: false,
    };
    getDb().run("INSERT INTO jobs VALUES (?, ?, ?, ?)", [
      job.id,
      id,
      TEST_USER_ID,
      JSON.stringify(job),
    ]);
    const recovered = new AgentRuntime();
    recovered.recover();
    recovered.recover();
    expect(recovered.jobs.read(TEST_USER_ID, id, job.id).status).toBe(
      "interrupted",
    );
    const notifications = recovered.store
      .inbox(main.id)
      .filter((m) => m.kind === "job");
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.wakes).toBe(false);
    expect(recovered.snapshot(TEST_USER_ID, id).activation).toBeNull();
  } finally {
    await agentRuntime.deleteSession(TEST_USER_ID, id);
  }
});
