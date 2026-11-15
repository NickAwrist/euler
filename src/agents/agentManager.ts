import os from "node:os";
import type { Feature } from "../features/Feature";
import { featureIds } from "../features/index";
import {
  type PersonalizationFields,
  type PromptContext,
  renderSystemPrompt,
} from "../prompts/render";
import {
  DEFAULT_SYSTEM_PROMPT,
  SUBAGENT_DIRECTIVES,
} from "../prompts/systemPrompt";
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
  /** The active features, whose prompt text joins the system prompt. */
  features?: readonly Feature[];
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
  const features = opts.features ?? [];
  const scope = {
    ownerUuid: opts.ownerUuid,
    agentKind: isSubagent ? ("general" as const) : ("main" as const),
    active: featureIds(features),
  };
  const finalPrompt = [
    renderSystemPrompt(
      promptContext.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT,
      promptContext,
    ),
    isSubagent ? SUBAGENT_DIRECTIVES : "",
    ...features.map((feature) => feature.prompt(scope, opts.userPrompt ?? "")),
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
