import "../setup";
import { describe, expect, test } from "bun:test";
import type { BaseAgent } from "../../src/agents/BaseAgent";
import {
  agentManager,
  buildServerRunPromptContext,
} from "../../src/agents/agentManager";
import { SUBAGENT_NAME } from "../../src/agents/agentNames";
import {
  createSkillRow,
  deleteSkillRow,
  ensureUserData,
  getSkillByName,
} from "../../src/db";
import { updateUserPreferences } from "../../src/db/userPreferences";
import {
  DEFAULT_SYSTEM_PROMPT,
  SUBAGENT_DIRECTIVES,
} from "../../src/prompts/systemPrompt";
import { MANAGE_SUBAGENTS_SKILL_NAME } from "../../src/skills/defaults";
import { BUILTIN_TOOLS } from "../../src/tools/builtinTools";

const RUNTIME_USER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_USER_ID = "44444444-4444-4444-8444-444444444444";

describe("agent runtime", () => {
  test("gives the main agent every built-in tool, subagents, and the owner's skills", async () => {
    ensureUserData(RUNTIME_USER_ID);
    const releaseSkill = createSkillRow(RUNTIME_USER_ID, {
      name: "manager-release-notes",
      description: "Write release notes.",
      instructions: "Release instructions only.",
      user_invocable: true,
      disable_model_invocation: false,
    });
    const otherUserSkill = createSkillRow(OTHER_USER_ID, {
      name: "private-skill",
      description: "Private metadata.",
      instructions: "Private instructions.",
      user_invocable: true,
      disable_model_invocation: false,
    });

    const agent = agentManager.createAgent({
      ownerUuid: RUNTIME_USER_ID,
      userPrompt: "Use $manager-release-notes.",
    });

    for (const tool of BUILTIN_TOOLS) {
      expect(agent.TOOL_MAP[tool]).toBeDefined();
    }
    expect(agent.TOOL_MAP.run_subagent).toBeUndefined();
    expect(agent.systemPrompt).toContain(releaseSkill.instructions);
    expect(agent.systemPrompt).not.toContain(otherUserSkill.description);
    expect(
      (await agent.TOOL_MAP.load_skill!.execute({ name: otherUserSkill.name }))
        .text,
    ).toBe(`Error: skill '${otherUserSkill.name}' not found`);
  });

  test("leaves out the tools of capabilities the owner turned off", () => {
    updateUserPreferences(RUNTIME_USER_ID, {
      capabilities: { web: false, imageGeneration: false },
    });
    const tools = (ownerUuid: string) =>
      Object.keys(agentManager.createGeneralAgent({ ownerUuid }).TOOL_MAP);

    const owned = tools(RUNTIME_USER_ID);
    for (const tool of ["web_search", "fetch_web_page", "generate_image"])
      expect(owned).not.toContain(tool);
    expect(owned).toContain("bash");
    expect(owned).toContain("modify_plan");
    expect(tools(OTHER_USER_ID)).toContain("generate_image");
  });

  test("seeds the subagent skill once for the main agent only", () => {
    const owner = "55555555-5555-4555-8555-555555555555";
    ensureUserData(owner);
    const seeded = getSkillByName(owner, MANAGE_SUBAGENTS_SKILL_NAME);
    expect(seeded).toMatchObject({
      user_invocable: false,
      disable_model_invocation: false,
    });

    const listed = `"name":"${MANAGE_SUBAGENTS_SKILL_NAME}"`;
    expect(
      agentManager.createAgent({ ownerUuid: owner }).systemPrompt,
    ).toContain(listed);
    expect(
      agentManager.createGeneralAgent({ ownerUuid: owner }).systemPrompt,
    ).not.toContain(listed);

    deleteSkillRow(owner, seeded!.id);
    ensureUserData(owner);
    expect(getSkillByName(owner, MANAGE_SUBAGENTS_SKILL_NAME)).toBeNull();
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

    const subagent = agentManager.createGeneralAgent({
      ownerUuid: RUNTIME_USER_ID,
      promptContext,
      reasoningEffort: "high",
    });
    subagent.model = parent.model;

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

test("registers patch editing", () => {
  expect(agentManager.getToolInstance("apply_patch").name).toBe("apply_patch");
});
