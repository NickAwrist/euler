import "../setup";
import { describe, expect, test } from "bun:test";
import {
  agentManager,
  buildServerRunPromptContext,
} from "../../src/agents/agentManager";
import { SUBAGENT_NAME } from "../../src/agents/agentNames";
import { deleteSkillRow, ensureUserData, getSkillByName } from "../../src/db";
import { FEATURES } from "../../src/features/index";
import {
  DEFAULT_SYSTEM_PROMPT,
  SUBAGENT_DIRECTIVES,
} from "../../src/prompts/systemPrompt";
import { MANAGE_SUBAGENTS_SKILL_NAME } from "../../src/skills/defaults";

const RUNTIME_USER_ID = "33333333-3333-4333-8333-333333333333";

describe("agent runtime", () => {
  test("seeds the subagent skill once for the main agent only", () => {
    const owner = "55555555-5555-4555-8555-555555555555";
    ensureUserData(owner);
    const seeded = getSkillByName(owner, MANAGE_SUBAGENTS_SKILL_NAME);
    expect(seeded).toMatchObject({
      user_invocable: false,
      disable_model_invocation: false,
    });

    const features = FEATURES.filter(
      ({ id }) => id === "skills" || id === "subagents",
    );
    const listed = `"name":"${MANAGE_SUBAGENTS_SKILL_NAME}"`;
    expect(
      agentManager.createAgent({ ownerUuid: owner, features }).systemPrompt,
    ).toContain(listed);
    expect(
      agentManager.createGeneralAgent({ ownerUuid: owner, features })
        .systemPrompt,
    ).not.toContain(listed);
    // The skill explains tools the agent only has with subagents on.
    expect(
      agentManager.createAgent({
        ownerUuid: owner,
        features: features.filter(({ id }) => id === "skills"),
      }).systemPrompt,
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
