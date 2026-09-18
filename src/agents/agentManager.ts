import os from "node:os";
import type { RunContext } from "../RunContext";
import { DEFAULT_RUN_MODEL } from "../constants";
import {
  type AgentData,
  getAgentById,
  getAgentByName,
  listAssignedSkills,
  listDelegationTargets,
} from "../db/index";
import {
  type PersonalizationFields,
  type PromptContext,
  renderSystemPrompt,
} from "../prompts/render";
import { renderSkillsPrompt } from "../skills/runtime";
import { AgentTool } from "../tools/AgentTool";
import type { BaseTool } from "../tools/BaseTool";
import { BashTool } from "../tools/bash";
import { isBuiltinToolName } from "../tools/builtinTools";
import { CreateFileTool } from "../tools/create_file";
import { DeleteFileTool } from "../tools/delete_file";
import { FetchWebPageTool } from "../tools/fetch_web_page";
import { GenerateImageTool } from "../tools/generate_image";
import { GrepTool } from "../tools/grep";
import { ListFilesTool } from "../tools/list_files";
import { LoadSkillTool } from "../tools/load_skill";
import { ModifyPlan } from "../tools/modify_plan";
import { ReadFileTool } from "../tools/read_file";
import { RunTscTool } from "../tools/run_tsc";
import { WebSearchTool } from "../tools/web_search";
import { BaseAgent } from "./BaseAgent";

export type CreateAgentOptions = {
  ownerUuid: string;
  /** Pre-rendered prompt for a root run. Stored templates render on the server. */
  systemPrompt?: string;
  /** Resolved absolute directory tools use; also drives `{{SESSION_DIRECTORY}}`. */
  toolSessionDir?: string;
  /** Values to fill `{{PLACEHOLDERS}}` when `systemPrompt` is not provided. */
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
    personalization: base?.personalization ?? {},
    sessionDirectory: base?.sessionDirectory ?? toolSessionDir,
    os: base?.os ?? `${os.platform()} ${os.arch()} (${os.release()})`,
  };
}

/** Prompt context for run turns, with server OS and session directory values. */
export function buildServerRunPromptContext(opts: {
  metadata?: {
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
  return serverPromptContext({ personalization }, opts.toolSessionDir);
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
    case "run_tsc":
      return new RunTscTool();
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

function buildAgent(config: AgentData, opts: CreateAgentOptions): BaseAgent {
  const renderedAgentPrompt =
    typeof opts.systemPrompt === "string" && opts.systemPrompt.length > 0
      ? opts.systemPrompt
      : renderSystemPrompt(
          config.system_prompt,
          serverPromptContext(opts.promptContext, opts.toolSessionDir),
        );
  const skills = listAssignedSkills(opts.ownerUuid, config.id);
  const skillsPrompt = renderSkillsPrompt(skills, opts.userPrompt ?? "");
  const finalPrompt = [renderedAgentPrompt, skillsPrompt]
    .filter((part) => part.length > 0)
    .join("\n\n");

  const agent = new BaseAgent(
    config.name,
    config.description,
    undefined,
    undefined,
    finalPrompt,
  );
  agent.addTools(
    config.tools
      .filter(isBuiltinToolName)
      .map((tool) => createBuiltinTool(tool)),
  );
  const delegationTargets = listDelegationTargets(opts.ownerUuid, config.id);
  agent.addTools(
    delegationTargets.map(
      (target) =>
        new AgentTool({
          id: target.id,
          name: target.name,
          description: target.description,
        }),
    ),
  );
  if (skills.length > 0) {
    agent.addTool(new LoadSkillTool(skills));
  }
  if (opts.reasoningEffort) {
    agent.reasoningEffort = opts.reasoningEffort;
  }
  return agent;
}

function inheritParentModel(agent: BaseAgent, ctx?: RunContext): BaseAgent {
  const parentModel = ctx?.agentInstance?.model;
  agent.model =
    typeof parentModel === "string" && parentModel.length > 0
      ? parentModel
      : DEFAULT_RUN_MODEL;
  agent.reasoningEffort = ctx?.agentInstance?.reasoningEffort;
  return agent;
}

function contextOptions(
  ctx?: RunContext,
  userPrompt?: string,
): CreateAgentOptions {
  return {
    ownerUuid: ctx?.ownerUuid ?? "",
    toolSessionDir: ctx?.sessionDir,
    promptContext: ctx?.promptContext,
    userPrompt,
  };
}

export const agentManager = {
  /** Build a subagent by name that inherits its parent run context and model. */
  createAgentForContext(
    agentName: string,
    ctx?: RunContext,
    userPrompt?: string,
  ): BaseAgent {
    return inheritParentModel(
      this.createAgent(agentName, contextOptions(ctx, userPrompt)),
      ctx,
    );
  },

  /** Build a subagent by stable ID that inherits its parent run context and model. */
  createAgentByIdForContext(
    agentId: string,
    ctx?: RunContext,
    userPrompt?: string,
  ): BaseAgent {
    return inheritParentModel(
      this.createAgentById(agentId, contextOptions(ctx, userPrompt)),
      ctx,
    );
  },

  createAgent(agentName: string, opts?: CreateAgentOptions): BaseAgent {
    const ownerUuid = opts?.ownerUuid ?? "";
    const config = getAgentByName(ownerUuid, agentName);
    if (!config) {
      throw new Error(
        `Agent configuration for '${agentName}' not found in database`,
      );
    }
    return buildAgent(config, opts ?? { ownerUuid });
  },

  createAgentById(agentId: string, opts?: CreateAgentOptions): BaseAgent {
    const ownerUuid = opts?.ownerUuid ?? "";
    const config = getAgentById(ownerUuid, agentId);
    if (!config) {
      throw new Error(
        `Agent configuration for ID '${agentId}' not found in database`,
      );
    }
    return buildAgent(config, opts ?? { ownerUuid });
  },

  getToolInstance(toolName: string): BaseTool {
    return createBuiltinTool(toolName);
  },

  isToolEnabled(toolName: string): boolean {
    return isBuiltinToolName(toolName);
  },
};
