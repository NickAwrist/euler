import "../setup";
import { describe, expect, test } from "bun:test";
import { RunContext } from "../../src/RunContext";
import { BaseAgent } from "../../src/agents/BaseAgent";
import {
  agentManager,
  buildServerRunPromptContext,
} from "../../src/agents/agentManager";
import { SUBAGENT_NAME } from "../../src/agents/agentNames";
import { createSkillRow, ensureUserData } from "../../src/db";
import {
  DEFAULT_SYSTEM_PROMPT,
  SUBAGENT_DIRECTIVES,
} from "../../src/prompts/systemPrompt";
import { BUILTIN_TOOLS } from "../../src/tools/builtinTools";
import { RunSubagentTool } from "../../src/tools/run_subagent";

const RUNTIME_USER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_USER_ID = "44444444-4444-4444-8444-444444444444";

function contextFor(agent: BaseAgent, promptContext = {}) {
  return new RunContext(
    agent,
    "Parent task",
    undefined,
    undefined,
    undefined,
    undefined,
    promptContext,
    RUNTIME_USER_ID,
  );
}

describe("agent runtime", () => {
  test("gives the main agent every built-in tool, subagents, and the owner's skills", async () => {
    ensureUserData(RUNTIME_USER_ID);
    const releaseSkill = createSkillRow(RUNTIME_USER_ID, {
      name: "manager-release-notes",
      description: "Write release notes.",
      instructions: "Release instructions only.",
    });
    const otherUserSkill = createSkillRow(OTHER_USER_ID, {
      name: "private-skill",
      description: "Private metadata.",
      instructions: "Private instructions.",
    });

    const agent = agentManager.createAgent({
      ownerUuid: RUNTIME_USER_ID,
      userPrompt: "Use $manager-release-notes.",
    });

    for (const tool of BUILTIN_TOOLS) {
      expect(agent.TOOL_MAP[tool]).toBeDefined();
    }
    expect(agent.TOOL_MAP.run_subagent).toBeInstanceOf(RunSubagentTool);
    expect(agent.systemPrompt).toContain(releaseSkill.instructions);
    expect(agent.systemPrompt).not.toContain(otherUserSkill.description);
    expect(
      (await agent.TOOL_MAP.load_skill!.execute({ name: otherUserSkill.name }))
        .text,
    ).toBe(`Error: skill '${otherUserSkill.name}' not found`);
  });

  test("uses the default prompt unless the user provides one", () => {
    const standard = agentManager.createAgent({
      ownerUuid: RUNTIME_USER_ID,
      promptContext: buildServerRunPromptContext({
        metadata: { systemPrompt: "   " },
      }),
    });
    expect(standard.systemPrompt).toContain(
      DEFAULT_SYSTEM_PROMPT.split("\n")[0]!,
    );

    const custom = agentManager.createAgent({
      ownerUuid: RUNTIME_USER_ID,
      promptContext: buildServerRunPromptContext({
        metadata: {
          systemPrompt: "Talk like a pirate.\n\n{{PERSONALIZATION}}",
          name: "Alice",
        },
      }),
    });
    expect(custom.systemPrompt).toStartWith("Talk like a pirate.");
    expect(custom.systemPrompt).toContain("User name: Alice");
    expect(custom.systemPrompt).not.toContain(
      DEFAULT_SYSTEM_PROMPT.split("\n")[0]!,
    );
    expect(custom.systemPrompt).toContain("<tool_format>");
  });

  test("builds subagents from the parent's prompt, model, and effort without nesting", () => {
    ensureUserData(RUNTIME_USER_ID);
    const promptContext = buildServerRunPromptContext({
      metadata: { systemPrompt: "Custom instructions." },
    });
    const parent = agentManager.createAgent({
      ownerUuid: RUNTIME_USER_ID,
      promptContext,
      reasoningEffort: "high",
    });
    parent.model = "parent-model";

    const subagent = agentManager.createSubagentForContext(
      contextFor(parent, promptContext),
      "Find the config",
    );

    expect(subagent.name).toBe(SUBAGENT_NAME);
    expect(subagent.model).toBe("parent-model");
    expect(subagent.reasoningEffort).toBe("high");
    expect(subagent.systemPrompt).toStartWith("Custom instructions.");
    expect(subagent.systemPrompt).toContain(SUBAGENT_DIRECTIVES);
    expect(parent.systemPrompt).not.toContain(SUBAGENT_DIRECTIVES);
    expect(subagent.TOOL_MAP.bash).toBeDefined();
    expect(subagent.TOOL_MAP.run_subagent).toBeUndefined();
  });

  test("buildServerRunPromptContext includes current date by default when metadata is omitted", () => {
    const agent = agentManager.createAgent({
      ownerUuid: RUNTIME_USER_ID,
      promptContext: buildServerRunPromptContext({}),
    });
    expect(agent.systemPrompt).toContain("Current date:");
  });

  test("buildServerRunPromptContext respects includeCurrentDate: false", () => {
    const agent = agentManager.createAgent({
      ownerUuid: RUNTIME_USER_ID,
      promptContext: buildServerRunPromptContext({
        metadata: { includeCurrentDate: false },
      }),
    });
    expect(agent.systemPrompt).not.toContain("Current date:");
  });
});

describe("RunSubagentTool", () => {
  test("runs the task in a child context and returns its final text", async () => {
    const tool = new RunSubagentTool();
    const parent = new BaseAgent("parent", "Parent");
    const context = new RunContext(parent, "Parent task");
    const parentStep = context.beginStep({
      kind: "tool_call",
      turnIndex: 0,
      toolName: tool.name,
    });
    const original = agentManager.createSubagentForContext;
    let receivedTask = "";
    agentManager.createSubagentForContext = (_ctx, task) => {
      receivedTask = task;
      const child = new BaseAgent("child", "Child");
      child.run = async () => "Nested final text";
      return child;
    };

    try {
      expect(
        (
          await tool.execute(
            { task_lines: ["Review", "this"] },
            context,
            parentStep,
          )
        ).text,
      ).toBe("Nested final text");
      expect(receivedTask).toBe("Review\nthis");
      expect(parentStep.childContext?.agentName).toBe("child");
    } finally {
      agentManager.createSubagentForContext = original;
    }
  });

  test("rejects an empty task", async () => {
    expect((await new RunSubagentTool().execute({})).text).toBe(
      "Error: you must provide a task or task_lines",
    );
  });
});

test("registers patch editing", () => {
  expect(agentManager.getToolInstance("apply_patch").name).toBe("apply_patch");
});
