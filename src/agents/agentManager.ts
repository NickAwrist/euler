import os from "node:os";
import { listSkills } from "../db/index";
import { effectiveUserPreferences } from "../db/userPreferences";
import {
  enabledBuiltinTools,
  permissionService,
} from "../permissions/PermissionService";
import {
  type PersonalizationFields,
  type PromptContext,
  renderSystemPrompt,
} from "../prompts/render";
import {
  DEFAULT_SYSTEM_PROMPT,
  SUBAGENT_DIRECTIVES,
} from "../prompts/systemPrompt";
import { MANAGE_SUBAGENTS_SKILL_NAME } from "../skills/defaults";
import { modelInvocableSkills, renderSkillsPrompt } from "../skills/runtime";
import { createBuiltinTool } from "../tools/builtinTools";
import { LoadSkillTool } from "../tools/load_skill";
import { ManageSkillsTool } from "../tools/manage_skills";
import { BaseAgent } from "./BaseAgent";
import { MAIN_AGENT_NAME, SUBAGENT_NAME } from "./agentNames";

export type CreateAgentOptions = {
  ownerUuid: string;
  /** Resolved absolute directory tools use; also drives `{{SESSION_DIRECTORY}}`. */
  toolSessionDir?: string;
  /** System prompt template and values to fill its `{{PLACEHOLDERS}}`. */
  promptContext?: PromptContext;
  /** Current user task, used to activate explicit `$skill-name` references. */
  userPrompt?: string;
  reasoningEffort?: string;
};

function serverPromptContext(
  base: PromptContext | undefined,
  toolSessionDir: string | undefined,
): PromptContext {
  return {
    systemPrompt: base?.systemPrompt,
    personalization: base?.personalization ?? {},
    sessionDirectory: base?.sessionDirectory ?? toolSessionDir,
    os: base?.os ?? `${os.platform()} ${os.arch()} (${os.release()})`,
  };
}

/** Prompt context for run turns, with server OS and session directory values. */
export function buildServerRunPromptContext(opts: {
  metadata?: {
    systemPrompt?: string | undefined;
    name?: string | undefined;
    location?: string | undefined;
    preferredFormats?: string | undefined;
    includeCurrentDate?: boolean | undefined;
  };
  toolSessionDir?: string;
}): PromptContext {
  const personalization: PersonalizationFields = {};
  if (opts.metadata !== undefined) {
    const name = opts.metadata.name?.trim();
    const location = opts.metadata.location?.trim();
    const preferredFormats = opts.metadata.preferredFormats?.trim();
    if (name) personalization.name = name;
    if (location) personalization.location = location;
    if (preferredFormats) personalization.preferredFormats = preferredFormats;
    if (opts.metadata.includeCurrentDate !== undefined) {
      personalization.includeCurrentDate = opts.metadata.includeCurrentDate;
    }
  }
  return serverPromptContext(
    {
      systemPrompt: opts.metadata?.systemPrompt?.trim() || undefined,
      personalization,
    },
    opts.toolSessionDir,
  );
}

function buildAgent(
  name: typeof MAIN_AGENT_NAME | typeof SUBAGENT_NAME,
  opts: CreateAgentOptions,
): BaseAgent {
  const promptContext = serverPromptContext(
    opts.promptContext,
    opts.toolSessionDir,
  );
  const isSubagent = name === SUBAGENT_NAME;
  const allSkills = listSkills(opts.ownerUuid);
  // A subagent's task is written by the model, so its $skill-name references
  // are model invocations too. Subagents can't spawn, so they skip the skill
  // for managing subagents.
  const skills = isSubagent
    ? modelInvocableSkills(allSkills).filter(
        (skill) => skill.name !== MANAGE_SUBAGENTS_SKILL_NAME,
      )
    : allSkills;
  const loadableSkills = modelInvocableSkills(skills);
  const finalPrompt = [
    renderSystemPrompt(
      promptContext.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT,
      promptContext,
    ),
    isSubagent ? SUBAGENT_DIRECTIVES : "",
    renderSkillsPrompt(skills, opts.userPrompt ?? ""),
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");

  const agent = new BaseAgent(
    name,
    isSubagent ? "Subagent" : "Main agent",
    undefined,
    undefined,
    finalPrompt,
  );
  const { capabilities } = effectiveUserPreferences(opts.ownerUuid);
  const permissions = permissionService.resolve(undefined, capabilities);
  agent.addTools(enabledBuiltinTools(permissions).map(createBuiltinTool));
  if (loadableSkills.length > 0) {
    agent.addTool(new LoadSkillTool(loadableSkills));
  }
  // Skills persist into later chats, so only the user's own agent edits them.
  if (
    !isSubagent &&
    permissionService.toolDecision(permissions, "manage_skills").allowed
  ) {
    agent.addTool(new ManageSkillsTool(opts.ownerUuid));
  }
  if (opts.reasoningEffort) {
    agent.reasoningEffort = opts.reasoningEffort;
  }
  return agent;
}

export const agentManager = {
  createGeneralAgent(opts: CreateAgentOptions): BaseAgent {
    return buildAgent(SUBAGENT_NAME, opts);
  },
  createAgent(opts: CreateAgentOptions): BaseAgent {
    return buildAgent(MAIN_AGENT_NAME, opts);
  },
};
