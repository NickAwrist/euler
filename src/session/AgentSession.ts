import { EventEmitter } from "node:events";
import { RunContext } from "../RunContext";
import type { BaseAgent } from "../agents/BaseAgent";
import { agentManager } from "../agents/agentManager";
import {
  type MessageAttachment,
  MessageAttachmentSchema,
} from "../attachments/types";
import { type AttachmentRow, getAttachment } from "../db/index";
import type { LlmImage, LlmMessage } from "../llm/index";
import { stripReasoningFromModelMessages } from "../llm/reasoningDetails";
import { logger } from "../logger";
import type { PromptContext } from "../prompts/render";
import { errorMessage } from "../utils/errors";
import type { Workspace } from "../workspaces/WorkspaceService";

const log = logger.child({ component: "AgentSession" });

export type HistoryWireStep = Record<string, unknown>;

export type SessionMessage = {
  role: string;
  content: string;
  steps?: HistoryWireStep[];
  attachments?: MessageAttachment[];
};

export type SessionStepEvent = {
  step: HistoryWireStep;
  steps: HistoryWireStep[];
};

export type SessionRunDeltaEvent = {
  contentDelta: string;
  thinkingDelta: string;
  agentName: string;
};

export type SessionAbortedEvent = {
  result: string;
  steps: HistoryWireStep[];
  history: SessionMessage[];
  modelMessages: Array<Record<string, unknown>> | null;
};

type SessionEvents = {
  step: SessionStepEvent;
  run_delta: SessionRunDeltaEvent;
  aborted: SessionAbortedEvent;
};

export type AgentSessionOptions = {
  model?: string;
  reasoningEffort?: string;
  agentName?: string;
  /** Pre-rendered system prompt from the run request. Takes precedence over `promptContext`. */
  systemPrompt?: string;
  /** Values for `{{PLACEHOLDERS}}` passed to subagents via `RunContext`. */
  promptContext?: PromptContext;
  toolSessionDir?: string;
  workspace?: Workspace;
  ownerUuid: string;
  attachmentSessionId?: string;
  /** Current task, used to activate explicit `$skill-name` references. */
  userPrompt?: string;
};

export class AgentSession extends EventEmitter {
  public sessionId: string;
  public history: SessionMessage[] = [];
  private generalAgent: BaseAgent;
  private readonly toolSessionDir?: string;
  private readonly workspace?: Workspace;
  private readonly promptContext?: PromptContext;
  private readonly ownerUuid: string;
  private readonly attachmentSessionId?: string;

  override on<K extends keyof SessionEvents>(
    event: K,
    listener: (payload: SessionEvents[K]) => void,
  ): this;
  override on(event: string, listener: (...args: unknown[]) => void): this;
  override on(event: string, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override off<K extends keyof SessionEvents>(
    event: K,
    listener: (payload: SessionEvents[K]) => void,
  ): this;
  override off(event: string, listener: (...args: unknown[]) => void): this;
  override off(event: string, listener: (...args: unknown[]) => void): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }

  constructor(sessionId: string, options?: AgentSessionOptions) {
    super();
    this.sessionId = sessionId;
    this.toolSessionDir = options?.toolSessionDir;
    this.workspace = options?.workspace;
    this.promptContext = options?.promptContext;
    this.ownerUuid = options?.ownerUuid ?? "";
    this.attachmentSessionId = options?.attachmentSessionId;
    const agentName = options?.agentName?.trim() || "general_agent";
    const reasoningEffort = options?.reasoningEffort?.trim();
    this.generalAgent = agentManager.createAgent(agentName, {
      systemPrompt: options?.systemPrompt,
      toolSessionDir: options?.toolSessionDir,
      promptContext: options?.promptContext,
      ownerUuid: this.ownerUuid,
      userPrompt: options?.userPrompt,
      reasoningEffort,
    });
    const m = options?.model?.trim();
    if (m) this.generalAgent.model = m;
  }

  /** Rehydrate from the client request and provider-neutral model messages. */
  restoreFromPersistence(payload: {
    history: {
      role: string;
      content: string;
      steps?: HistoryWireStep[];
      attachments?: MessageAttachment[];
    }[];
    modelMessages?: Array<Record<string, unknown>> | null;
  }) {
    this.history = payload.history.map((h) => ({
      role: h.role,
      content: h.content,
      ...(h.steps != null ? { steps: h.steps } : {}),
      ...(h.attachments?.length ? { attachments: h.attachments } : {}),
    }));
    if (Array.isArray(payload.modelMessages)) {
      this.generalAgent.history = stripReasoningFromModelMessages(
        payload.modelMessages,
      )!.map((m) => {
        const row: LlmMessage = {
          role: typeof m.role === "string" ? m.role : "user",
          content: typeof m.content === "string" ? m.content : "",
        };
        if (Array.isArray(m.tool_calls)) {
          row.tool_calls = m.tool_calls as LlmMessage["tool_calls"];
        }
        if (typeof m.tool_call_id === "string") {
          row.tool_call_id = m.tool_call_id;
        }
        if (typeof m.reasoning === "string") row.reasoning = m.reasoning;
        if (Array.isArray(m.reasoning_details)) {
          row.reasoning_details = m.reasoning_details;
        }
        const images = this.hydrateImages(m.images);
        if (images.length > 0) row.images = images;
        return row;
      });
    } else {
      this.generalAgent.history = payload.history
        .filter((h) => h.role !== "event")
        .map((h) => {
          const images = this.hydrateImages(h.attachments);
          return {
            role: typeof h.role === "string" ? h.role : "user",
            content: typeof h.content === "string" ? h.content : "",
            ...(images.length > 0 ? { images } : {}),
          };
        });
    }
  }

  private hydrateImages(value: unknown): LlmImage[] {
    if (!Array.isArray(value) || !this.attachmentSessionId) return [];
    return value.flatMap((candidate) => {
      const parsed = MessageAttachmentSchema.safeParse(candidate);
      if (!parsed.success || parsed.data.kind !== "image") return [];
      const stored = getAttachment(this.ownerUuid, parsed.data.id);
      if (!stored || stored.sessionId !== this.attachmentSessionId) return [];
      return [
        {
          ...parsed.data,
          data: Buffer.from(stored.data).toString("base64"),
        },
      ];
    });
  }

  public async sendRun(
    prompt: string,
    attachments: AttachmentRow[] = [],
    signal?: AbortSignal,
  ): Promise<string> {
    const attachmentRefs = attachments.map(
      ({
        data: _data,
        ownerUuid: _owner,
        sessionId: _session,
        createdAt: _at,
        ...attachment
      }) => attachment,
    );
    const images: LlmImage[] = attachments.map((attachment) => ({
      id: attachment.id,
      kind: attachment.kind,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      data: Buffer.from(attachment.data).toString("base64"),
    }));
    this.history.push({
      role: "user",
      content: prompt,
      ...(attachmentRefs.length > 0 ? { attachments: attachmentRefs } : {}),
    });

    const turnStartedAt = Date.now();
    let aborted = false;
    log.debug({
      event: "agent_turn_start",
      sessionId: this.sessionId,
      agentName: this.generalAgent.name,
      model: this.generalAgent.model,
    });

    const ctx = new RunContext(
      this.generalAgent,
      prompt,
      (ctx, step) => {
        this.emit("step", {
          step: ctx.wireStep(step),
          steps: ctx.wireSteps(),
        });
      },
      (contentDelta, thinkingDelta, agentName) => {
        this.emit("run_delta", { contentDelta, thinkingDelta, agentName });
      },
      signal,
      this.toolSessionDir,
      this.promptContext,
      this.ownerUuid,
      this.workspace,
    );

    let result = "Error running agent.";
    try {
      const response = await this.generalAgent.run(prompt, ctx, images);
      if (signal?.aborted) {
        aborted = true;
        result = response || "";
      } else if (response !== null) {
        result = response;
      }
    } catch (e) {
      if (signal?.aborted) {
        aborted = true;
        result = "";
      } else {
        logger.error(
          { err: e, sessionId: this.sessionId },
          "AgentSession error",
        );
        result = `Error: ${errorMessage(e)}`;
        ctx.failLastRunningStep(result);
      }
    } finally {
      log.debug({
        event: "agent_turn_done",
        sessionId: this.sessionId,
        agentName: this.generalAgent.name,
        runMs: Date.now() - turnStartedAt,
        aborted,
      });
    }

    this.history.push({
      role: "assistant",
      content: result,
      steps: ctx.wireSteps(),
    });

    if (aborted) {
      this.emit("aborted", {
        result,
        steps: ctx.wireSteps(),
        history: this.history,
        modelMessages: this.getModelMessages(),
      });
    }

    return result;
  }

  /** Cumulative provider-neutral messages the agent keeps for the next call. */
  getModelMessages(): Array<Record<string, unknown>> {
    return this.generalAgent.history.map((msg: LlmMessage) => {
      const row: Record<string, unknown> = {
        role: msg.role,
        content: msg.content ?? "",
      };
      if (msg.tool_calls != null) row.tool_calls = msg.tool_calls;
      if (msg.tool_call_id != null) row.tool_call_id = msg.tool_call_id;
      if (msg.reasoning != null) row.reasoning = msg.reasoning;
      if (msg.reasoning_details != null) {
        row.reasoning_details = msg.reasoning_details;
      }
      if (msg.images?.length) {
        row.images = msg.images.map(
          ({ data: _data, ...attachment }) => attachment,
        );
      }
      return row;
    });
  }
}
