import os from "node:os";
import type { RunContext } from "../RunContext";
import { DEFAULT_RUN_MODEL } from "../constants";
import { listSkills } from "../db/index";
import {
  type PersonalizationFields,
  type PromptContext,
  renderSystemPrompt,
} from "../prompts/render";
import {
  DEFAULT_SYSTEM_PROMPT,
  SUBAGENT_DIRECTIVES,
} from "../prompts/systemPrompt";
import { modelInvocableSkills, renderSkillsPrompt } from "../skills/runtime";
import type { BaseTool } from "../tools/BaseTool";
import { ApplyPatchTool } from "../tools/apply_patch";
import { BashTool } from "../tools/bash";
import { BUILTIN_TOOLS } from "../tools/builtinTools";
import { CreateFileTool } from "../tools/create_file";
import { DeleteFileTool } from "../tools/delete_file";
import { FetchWebPageTool } from "../tools/fetch_web_page";
import { GenerateImageTool } from "../tools/generate_image";
import { GrepTool } from "../tools/grep";
import { ListFilesTool } from "../tools/list_files";
import { LoadSkillTool } from "../tools/load_skill";
import { ModifyPlan } from "../tools/modify_plan";
import { ReadFileTool } from "../tools/read_file";
import { RunSubagentTool } from "../tools/run_subagent";
import { WebSearchTool } from "../tools/web_search";
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

function createBuiltinTool(toolName: string): BaseTool {
  switch (toolName) {
    case "create_file":
      return new CreateFileTool();
    case "delete_file":
      return new DeleteFileTool();
    case "grep":
      return new GrepTool();
    case "list_files":
      return new ListFilesTool();
    case "modify_plan":
      return new ModifyPlan();
    case "read_file":
      return new ReadFileTool();
    case "apply_patch":
      return new ApplyPatchTool();
    case "web_search":
      return new WebSearchTool();
    case "fetch_web_page":
      return new FetchWebPageTool();
    case "bash":
      return new BashTool();
    case "generate_image":
      return new GenerateImageTool();
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
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
  // are model invocations too.
  const skills = isSubagent ? modelInvocableSkills(allSkills) : allSkills;
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
  agent.addTools(BUILTIN_TOOLS.map((tool) => createBuiltinTool(tool)));
  if (!isSubagent) {
    agent.addTool(new RunSubagentTool());
  }
  if (loadableSkills.length > 0) {
    agent.addTool(new LoadSkillTool(loadableSkills));
  }
  if (opts.reasoningEffort) {
    agent.reasoningEffort = opts.reasoningEffort;
  }
  return agent;
}

export const agentManager = {
  createAgent(opts: CreateAgentOptions): BaseAgent {
    return buildAgent(MAIN_AGENT_NAME, opts);
  },

  /** Build a subagent that inherits its parent's run context and model. */
  createSubagentForContext(ctx: RunContext, task: string): BaseAgent {
    const parent = ctx.agentInstance;
    const agent = buildAgent(SUBAGENT_NAME, {
      ownerUuid: ctx.ownerUuid,
      toolSessionDir: ctx.sessionDir,
      promptContext: ctx.promptContext,
      userPrompt: task,
    });
    agent.model = parent.model || DEFAULT_RUN_MODEL;
    agent.reasoningEffort = parent.reasoningEffort;
    return agent;
  },

  getToolInstance(toolName: string): BaseTool {
    return createBuiltinTool(toolName);
  },
};
