import { expect, test } from "bun:test";
import { RunContext } from "../../src/RunContext";
import { BaseAgent } from "../../src/agents/BaseAgent";
import { JobManager } from "../../src/jobs/JobManager";
import { updateContent } from "../../src/jobs/content";
import { JobSchema } from "../../src/schemas/jobs";
import { BaseTool } from "../../src/tools/BaseTool";
import type { JobContext, RunningExecution } from "../../src/tools/background";
import { JobTool } from "../../src/tools/jobs";

class FixtureTool extends BaseTool {
  constructor() {
    super("fixture", "Test async content.");
  }
  describeInput() {
    return {
      summary: "Example",
      content: { blocks: [{ kind: "text" as const, text: "input" }] },
    };
  }
  async start(
    _args: Record<string, unknown>,
    ctx: JobContext,
  ): Promise<RunningExecution> {
    ctx.emitProgress({
      mode: "replace",
      content: { blocks: [{ kind: "text", text: "working" }] },
    });
    ctx.emitOutput({
      mode: "append",
      content: { blocks: [{ kind: "code", text: "early\n" }] },
    });
    const completion = Bun.sleep(20).then(() => {
      ctx.emitOutput({
        mode: "append",
        content: { blocks: [{ kind: "code", text: "done\n" }] },
      });
      return {
        text: "early\ndone\n",
        metadata: {
          blocks: [
            {
              kind: "fields" as const,
              fields: [{ label: "Items", value: "1" }],
            },
          ],
        },
      };
    });
    return {
      completion,
      cancel: async () => {
        await completion;
      },
    };
  }
}
function fixture() {
  let notifications = 0;
  const manager = new JobManager({
    temporary: () => true,
    blocked: () => false,
    changed: () => {},
    position: () => 0,
    notify: () => {
      notifications++;
    },
  });
  const ctx = new RunContext(
    new BaseAgent("test", "test"),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    "owner",
    { kind: "sandbox", hostPath: "/tmp", displayPath: "/workspace" },
  );
  return { manager, ctx, notifications: () => notifications };
}
async function terminal(manager: JobManager, id: string) {
  const deadline = Date.now() + 2000;
  while (manager.read("owner", "session", id).endedAt === null) {
    if (Date.now() > deadline) throw new Error("Timed out");
    await Bun.sleep(5);
  }
  return JobSchema.parse(manager.read("owner", "session", id));
}

test("non-shell tools own content; live output survives completion without duplication", async () => {
  const { manager, ctx, notifications } = fixture();
  const started = await manager
    .executor("agent", "session", "activation")
    .start(new FixtureTool(), {}, ctx);
  const { jobId } = JSON.parse(started.text);
  const inspect = new JobTool("get_job", (id) =>
    manager.read("owner", "session", id),
  );
  const running = JobSchema.parse(
    JSON.parse((await inspect.execute({ jobId })).text),
  );
  expect(running.progress?.blocks).toEqual([{ kind: "text", text: "working" }]);
  expect(running.output?.blocks).toEqual([{ kind: "code", text: "early\n" }]);
  const job = await terminal(manager, jobId);
  expect(job.status).toBe("succeeded");
  expect(job.input.blocks).toEqual([{ kind: "text", text: "input" }]);
  expect(job.output?.blocks).toEqual([{ kind: "code", text: "early\ndone\n" }]);
  expect(job.metadata?.blocks).toEqual([
    { kind: "fields", fields: [{ label: "Items", value: "1" }] },
  ]);
  expect(job.result).not.toHaveProperty("metadata");
  expect(notifications()).toBe(1);
});

test("invalid content fails jobs without persisting malformed presentation", async () => {
  const { manager, ctx } = fixture();
  for (const phase of ["output", "metadata"] as const) {
    class InvalidTool extends FixtureTool {
      override async start(
        _args: Record<string, unknown>,
        context: JobContext,
      ) {
        const content = {
          blocks: [
            { kind: "text" as const, text: "bad", label: "x".repeat(121) },
          ],
        };
        if (phase === "output")
          context.emitOutput({ mode: "replace", content });
        return {
          completion: Promise.resolve({
            text: "bad",
            ...(phase === "metadata" ? { metadata: content } : {}),
          }),
          cancel: async () => {},
        };
      }
    }
    const result = await manager
      .executor("agent", "session", "activation")
      .start(new InvalidTool(), {}, ctx);
    const job = await terminal(manager, JSON.parse(result.text).jobId);
    expect(job.status).toBe("failed");
    expect(job.error?.code).toBe("JOB_OUTPUT_INVALID");
    expect(job.output).toBeNull();
    expect(job.progress).toBeNull();
    expect(job.metadata).toBeNull();
  }
});

test("stream bounds account for UTF-8 and JSON escaping", () => {
  const bounded = updateContent(null, {
    mode: "append",
    content: { blocks: [{ kind: "code", text: '😀\n"'.repeat(40000) }] },
  });
  expect(
    Buffer.byteLength(JSON.stringify(bounded.content)),
  ).toBeLessThanOrEqual(65536);
  expect(bounded.truncated).toBe(true);
});
