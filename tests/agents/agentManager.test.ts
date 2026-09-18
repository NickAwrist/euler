import "../setup";
import { describe, expect, test } from "bun:test";
import { RunContext } from "../../src/RunContext";
import { BaseAgent } from "../../src/agents/BaseAgent";
import {
  agentManager,
  buildServerRunPromptContext,
} from "../../src/agents/agentManager";
import {
  createAgentRow,
  createSkillRow,
  ensureUserData,
  getAgentByName,
  updateAgentRow,
} from "../../src/db";
import { AgentTool, delegationToolName } from "../../src/tools/AgentTool";

const RUNTIME_USER_ID = "33333333-3333-4333-8333-333333333333";

describe("agent capability runtime", () => {
  test("enables page fetching for newly seeded general agents", () => {
    ensureUserData(RUNTIME_USER_ID);
    const agent = agentManager.createAgent("general_agent", {
      ownerUuid: RUNTIME_USER_ID,
    });
    expect(agent.TOOL_MAP.fetch_web_page?.toTool().function.name).toBe(
      "fetch_web_page",
    );
  });

  test("uses only the active agent's skills, built-in tools, and delegation routes", async () => {
    ensureUserData(RUNTIME_USER_ID);
    const releaseSkill = createSkillRow(RUNTIME_USER_ID, {
      name: "manager-release-notes",
      description: "Write release notes.",
      instructions: "Release instructions only.",
    });
    const privateSkill = createSkillRow(RUNTIME_USER_ID, {
      name: "private-skill",
      description: "Private metadata.",
      instructions: "Private instructions.",
    });
    const auditSkill = createSkillRow(RUNTIME_USER_ID, {
      name: "audit",
      description: "Audit changes.",
      instructions: "Audit instructions only.",
    });
    const reviewer = createAgentRow(RUNTIME_USER_ID, {
      name: "reviewer",
      description: "Reviews a proposed change.",
      system_prompt: "Review the work.",
      tools: [],
      skill_ids: [auditSkill.id],
      delegate_agent_ids: [],
    });
    const general = getAgentByName(RUNTIME_USER_ID, "general_agent");
    expect(general).not.toBeNull();
    updateAgentRow(RUNTIME_USER_ID, general!.id, {
      name: general!.name,
      description: general!.description,
      system_prompt: general!.system_prompt,
      tools: ["web_search"],
      skill_ids: [releaseSkill.id],
      delegate_agent_ids: [reviewer.id],
    });

    const parent = agentManager.createAgent("general_agent", {
      ownerUuid: RUNTIME_USER_ID,
      userPrompt: "Use $manager-release-notes and $private-skill.",
    });
    expect(parent.systemPrompt).toContain(releaseSkill.description);
    expect(parent.systemPrompt).toContain(releaseSkill.instructions);
    expect(parent.systemPrompt).not.toContain(privateSkill.description);
    expect(parent.systemPrompt).not.toContain(privateSkill.instructions);
    expect(parent.systemPrompt).not.toContain(auditSkill.description);
    expect(parent.TOOL_MAP.web_search).toBeDefined();
    expect(parent.TOOL_MAP.load_skill).toBeDefined();

    const delegationTools = parent.tools.filter(
      (tool): tool is AgentTool => tool instanceof AgentTool,
    );
    expect(delegationTools).toHaveLength(1);
    expect(delegationTools[0]!.target.id).toBe(reviewer.id);
    expect(delegationTools[0]!.toTool().function.name).toStartWith(
      "delegate_to_reviewer_",
    );
    expect(
      (await parent.TOOL_MAP.load_skill!.execute({ name: privateSkill.name }))
        .text,
    ).toBe(`Error: skill '${privateSkill.name}' not found`);

    parent.model = "parent-model";
    const parentContext = new RunContext(
      parent,
      "Parent task",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      RUNTIME_USER_ID,
    );
    const child = agentManager.createAgentByIdForContext(
      reviewer.id,
      parentContext,
      "Use $audit.",
    );
    expect(child.model).toBe("parent-model");
    expect(child.systemPrompt).toContain(auditSkill.description);
    expect(child.systemPrompt).toContain(auditSkill.instructions);
    expect(child.systemPrompt).not.toContain(releaseSkill.description);
  });

  test("does not expose a target without a configured route", () => {
    ensureUserData(RUNTIME_USER_ID);
    createAgentRow(RUNTIME_USER_ID, {
      name: "unrouted",
      description: "Not available to the parent.",
      system_prompt: "Wait.",
      tools: [],
      skill_ids: [],
      delegate_agent_ids: [],
    });

    const parent = agentManager.createAgent("general_agent", {
      ownerUuid: RUNTIME_USER_ID,
    });
    expect(
      parent.tools.some(
        (tool) => tool instanceof AgentTool && tool.target.name === "unrouted",
      ),
    ).toBeFalse();
  });

  test("buildServerRunPromptContext includes current date by default when metadata is omitted", () => {
    ensureUserData(RUNTIME_USER_ID);
    const ctx = buildServerRunPromptContext({});
    const agent = agentManager.createAgent("general_agent", {
      ownerUuid: RUNTIME_USER_ID,
      promptContext: ctx,
    });
    expect(agent.systemPrompt).toContain("Current date:");
  });

  test("buildServerRunPromptContext respects includeCurrentDate: false", () => {
    ensureUserData(RUNTIME_USER_ID);
    const ctx = buildServerRunPromptContext({
      metadata: { includeCurrentDate: false },
    });
    const agent = agentManager.createAgent("general_agent", {
      ownerUuid: RUNTIME_USER_ID,
      promptContext: ctx,
    });
    expect(agent.systemPrompt).not.toContain("Current date:");
  });
});

describe("AgentTool", () => {
  test("builds function-safe names that differ for normalized name collisions", () => {
    const first = delegationToolName({
      id: "a1b2c3d4-1111",
      name: "Code Reviewer",
    });
    const second = delegationToolName({
      id: "e5f6a7b8-2222",
      name: "code--reviewer",
    });

    expect(first).toMatch(/^[a-z0-9_]+$/);
    expect(second).toMatch(/^[a-z0-9_]+$/);
    expect(first).not.toBe(second);
  });

  test("executes the configured target by ID and returns its final text", async () => {
    const target = {
      id: "target-id",
      name: "renamed reviewer",
      description: "Reviews changes.",
    };
    const tool = new AgentTool(target);
    const parent = new BaseAgent("parent", "Parent");
    const context = new RunContext(parent, "Parent task");
    const parentStep = context.beginStep({
      kind: "tool_call",
      turnIndex: 0,
      toolName: tool.name,
    });
    const original = agentManager.createAgentByIdForContext;
    let receivedId = "";
    agentManager.createAgentByIdForContext = (agentId) => {
      receivedId = agentId;
      const child = new BaseAgent("child", "Child");
      child.run = async () => "Nested final text";
      return child;
    };

    try {
      expect(
        (await tool.execute({ task: "Review this" }, context, parentStep)).text,
      ).toBe("Nested final text");
      expect(receivedId).toBe(target.id);
      expect(parentStep.childContext?.agentName).toBe("child");
    } finally {
      agentManager.createAgentByIdForContext = original;
    }
  });

  test("configures and inherits reasoning effort on agents", () => {
    ensureUserData(RUNTIME_USER_ID);
    const parent = agentManager.createAgent("general_agent", {
      ownerUuid: RUNTIME_USER_ID,
      reasoningEffort: "high",
    });
    expect(parent.reasoningEffort).toBe("high");

    const context = new RunContext(
      parent,
      "Sub task",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      RUNTIME_USER_ID,
    );
    const subagent = agentManager.createAgentForContext(
      "general_agent",
      context,
    );
    expect(subagent.reasoningEffort).toBe("high");
  });
});
