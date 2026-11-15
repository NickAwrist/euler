import { afterEach, expect, spyOn, test } from "bun:test";
import { RunContext } from "../../src/RunContext";
import { BaseAgent } from "../../src/agents/BaseAgent";
import { JobManager } from "../../src/jobs/JobManager";
import * as llm from "../../src/llm";
import type { LlmChatRequest } from "../../src/llm/types";
import { permissionService } from "../../src/permissions/PermissionService";
import { BaseTool } from "../../src/tools/BaseTool";
import type { JobContext } from "../../src/tools/background";
import { featuresExcept } from "../helpers/features";

afterEach(() => {
  streamSpy?.mockRestore();
});
let streamSpy:
  | ReturnType<typeof spyOn<typeof llm, "streamModelChat">>
  | undefined;

test("workspace policies refuse the tools of features that are off, but not MCP tools", () => {
  const features = featuresExcept(
    "sandbox",
    "files",
    "web",
    "skills",
    "subagents",
  );
  for (const kind of ["sandbox", "local"] as const) {
    const policy = permissionService.resolve({ kind }, features);
    for (const tool of [
      "bash",
      "get_job",
      "read_file",
      "create_file",
      "web_search",
      "manage_skills",
      "spawn_agent",
    ]) {
      expect(permissionService.toolDecision(policy, tool).allowed).toBe(false);
    }
    expect(
      permissionService.toolDecision(policy, "mcp_custom_tool").allowed,
    ).toBe(true);
  }
  expect(
    permissionService.toolDecision(
      permissionService.resolve(undefined, features),
      "generate_image",
    ).allowed,
  ).toBe(true);
  expect(
    permissionService.toolDecision(
      permissionService.resolve({ kind: "local" }, featuresExcept("files")),
      "bash",
    ).allowed,
  ).toBe(true);
});

class ShellFixture extends BaseTool {
  calls = 0;
  constructor() {
    super("bash", "Fixture shell");
  }
  override async execute() {
    this.calls++;
    return { text: "executed" };
  }
  describeInput() {
    return { summary: "Fixture", content: { blocks: [] } };
  }
  async start(_args: Record<string, unknown>, _ctx: JobContext) {
    this.calls++;
    return {
      completion: Promise.resolve({ text: "started" }),
      cancel: async () => {},
    };
  }
}

for (const background of [false, true]) {
  test(`dispatcher rejects a disabled shell even when the model calls it, background=${background}`, async () => {
    const requests: LlmChatRequest[] = [];
    streamSpy = spyOn(llm, "streamModelChat").mockImplementation(
      async (request) => {
        requests.push(request);
        const first = requests.length === 1;
        return {
          async *[Symbol.asyncIterator]() {
            yield first
              ? {
                  toolCalls: [
                    {
                      id: "call",
                      function: {
                        name: "bash",
                        arguments: { command: "touch forbidden", background },
                      },
                    },
                  ],
                }
              : { contentDelta: "Done" };
          },
          abort() {},
        };
      },
    );
    const agent = new BaseAgent("test", "test");
    const tool = new ShellFixture();
    agent.addTool(tool);
    const workspace = {
      kind: "local" as const,
      hostPath: "/tmp",
      displayPath: "/workspace",
    };
    const ctx = new RunContext(
      agent,
      permissionService.resolve(workspace, featuresExcept("sandbox")),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "owner",
      workspace,
    );
    let jobs = 0;
    ctx.jobs = {
      start: async () => {
        jobs++;
        return { text: "started" };
      },
    };
    await agent.run("Run a command", ctx);
    expect(requests[0]?.tools).toEqual([]);
    expect(tool.calls).toBe(0);
    expect(jobs).toBe(0);
    expect(
      agent.history.find((message) => message.role === "tool")?.content,
    ).toContain("sandbox feature is disabled");
  });
}

test("background job admission enforces permissions before creating a job", async () => {
  const manager = new JobManager({
    blocked: () => false,
    changed: () => {},
    position: () => 0,
    notify: () => {},
  });
  const workspace = {
    kind: "local" as const,
    hostPath: "/tmp",
    displayPath: "/workspace",
  };
  const tool = new ShellFixture();
  const ctx = new RunContext(
    new BaseAgent("test", "test"),
    permissionService.resolve(workspace, featuresExcept("sandbox")),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    "owner",
    workspace,
  );
  await expect(
    manager.executor("agent", "session", "activation").start(tool, {}, ctx),
  ).rejects.toThrow("sandbox feature is disabled");
  expect(tool.calls).toBe(0);
  expect(manager.list("owner", "session")).toEqual([]);
});
