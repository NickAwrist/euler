import os from "node:os";
import type { AgentRecord } from "../db/agents";
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
import { INBOX_DIRECTIVES } from "./runtime/agentContext";

type CreateAgentOptions = {
  ownerUuid: string;
  /** System prompt template and values to fill its `{{PLACEHOLDERS}}`. */
  promptContext?: PromptContext;
  /** Current user task, used to activate explicit `$skill-name` references. */
  userPrompt?: string;
  /** The active features, whose prompt text joins the system prompt. */
  features?: readonly Feature[];
  reasoningEffort?: string;
};

/** Prompt context for run turns, with server OS and session directory values. */
const HOST_OS = `${os.platform()} ${os.arch()} (${os.release()})`;

export function buildServerRunPromptContext(opts: {
  metadata?: {
    systemPrompt?: string | undefined;
    name?: string | undefined;
    location?: string | undefined;
    preferredFormats?: string | undefined;
    includeCurrentDate?: boolean | undefined;
  };
  /** Where the agent sees its workspace; absent when the run has none. */
  sessionDirectory?: string;
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
  return {
    systemPrompt: opts.metadata?.systemPrompt?.trim() || undefined,
    personalization,
    sessionDirectory: opts.sessionDirectory,
    os: HOST_OS,
  };
}

export const agentManager = {
  /** An agent with its system prompt rendered. The caller adds the tools. */
  createAgent(kind: AgentRecord["kind"], opts: CreateAgentOptions): BaseAgent {
    const promptContext = opts.promptContext ?? buildServerRunPromptContext({});
    const isSubagent = kind !== "main";
    const features = opts.features ?? [];
    const scope = {
      ownerUuid: opts.ownerUuid,
      agentKind: kind,
      active: featureIds(features),
    };
    const prompt = [
      renderSystemPrompt(
        promptContext.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT,
        promptContext,
      ),
      isSubagent ? SUBAGENT_DIRECTIVES : "",
      ...features.map((feature) =>
        feature.prompt(scope, opts.userPrompt ?? ""),
      ),
    ]
      .filter((part) => part.length > 0)
      .join("\n\n");

    const agent = new BaseAgent(
      isSubagent ? SUBAGENT_NAME : MAIN_AGENT_NAME,
      undefined,
      undefined,
      prompt,
    );
    agent.systemPrompt += `\n\n${INBOX_DIRECTIVES}`;
    if (opts.reasoningEffort) agent.reasoningEffort = opts.reasoningEffort;
    return agent;
  },
};
