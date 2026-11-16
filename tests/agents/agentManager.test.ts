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
      agentManager.createAgent("main", { ownerUuid: owner, features })
        .systemPrompt,
    ).toContain(listed);
    expect(
      agentManager.createAgent("general", { ownerUuid: owner, features })
        .systemPrompt,
    ).not.toContain(listed);
    // The skill explains tools the agent only has with subagents on.
    expect(
      agentManager.createAgent("main", {
        ownerUuid: owner,
        features: features.filter(({ id }) => id === "skills"),
      }).systemPrompt,
    ).not.toContain(listed);

    deleteSkillRow(owner, seeded!.id);
    ensureUserData(owner);
    expect(getSkillByName(owner, MANAGE_SUBAGENTS_SKILL_NAME)).toBeNull();
  });

  test("uses the default prompt unless the user provides one", () => {
    const standard = agentManager.createAgent("main", {
      ownerUuid: RUNTIME_USER_ID,
      promptContext: buildServerRunPromptContext({
        metadata: { systemPrompt: "   " },
      }),
    });
    expect(standard.systemPrompt).toContain(
      DEFAULT_SYSTEM_PROMPT.split("\n")[0]!,
    );

    const custom = agentManager.createAgent("main", {
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

  test("subagents get the parent's prompt and effort plus the subagent directives", () => {
    const options = {
      ownerUuid: RUNTIME_USER_ID,
      promptContext: buildServerRunPromptContext({
        metadata: { systemPrompt: "Custom instructions." },
      }),
      reasoningEffort: "high",
    };
    const parent = agentManager.createAgent("main", options);
    const subagent = agentManager.createAgent("general", options);

    expect(subagent.name).toBe(SUBAGENT_NAME);
    expect(subagent.reasoningEffort).toBe("high");
    expect(subagent.systemPrompt).toStartWith("Custom instructions.");
    expect(subagent.systemPrompt).toContain(SUBAGENT_DIRECTIVES);
    expect(parent.systemPrompt).not.toContain(SUBAGENT_DIRECTIVES);
  });

  test("names the messaging tools only while Subagents is active", () => {
    const prompt = (features: typeof FEATURES) =>
      agentManager.createAgent("main", { ownerUuid: RUNTIME_USER_ID, features })
        .systemPrompt;
    expect(prompt(FEATURES.filter(({ id }) => id === "subagents"))).toContain(
      "Use send_message",
    );
    expect(prompt([])).not.toContain("send_message");
    // Job reports still arrive in envelopes the agent must not trust.
    expect(prompt([])).toContain("untrusted reports");
  });
});
