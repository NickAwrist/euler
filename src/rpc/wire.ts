import { type JsonObject, create, fromJson, toJson } from "@bufbuild/protobuf";
import {
  type Timestamp,
  ValueSchema,
  timestampFromMs,
  timestampMs,
} from "@bufbuild/protobuf/wkt";
import type { LlmMetrics as DomainLlmMetrics } from "../RunContext";
import type {
  MessageAttachment as DomainMessageAttachment,
  OutputAttachment as DomainOutputAttachment,
} from "../attachments/types";
import type { WireMessage } from "../db/types";
import type {
  AgentEvent,
  Activation as DomainActivation,
} from "../events/types";
import {
  type Activation,
  ActivationSchema,
  type Agent,
  AgentSchema,
  Agent_Kind,
  Agent_Status,
  type InboxMessage,
  InboxMessageSchema,
  InboxMessage_Kind,
} from "../gen/euler/v1/agent_pb";
import {
  type MessageAttachment,
  MessageAttachmentSchema,
  type OutputAttachment,
  OutputAttachmentSchema,
  WorkspaceFileAttachment_WorkspaceKind,
} from "../gen/euler/v1/attachments_pb";
import {
  type DisplayIcon,
  DisplayIconSchema,
  DisplayIcon_Theme,
  ErrorCode,
  type ErrorDetail,
  ErrorDetailSchema,
  type ToolContent,
  ToolContentSchema,
} from "../gen/euler/v1/common_pb";
import {
  ActivationEndedSchema,
  ActivationEnded_Outcome,
  ActivationStartedSchema,
  AgentStatusChangedSchema,
  ApprovalRequestedSchema,
  ApprovalResolvedSchema,
  DeltaSchema,
  type Event,
  EventSchema,
  InboxQueuedSchema,
  KeepaliveSchema,
  ResyncSchema,
  StepChangedSchema,
  TranscriptAppendedSchema,
} from "../gen/euler/v1/events_pb";
import { type Job, JobSchema, Job_Status } from "../gen/euler/v1/jobs_pb";
import {
  type ToolApproval,
  ToolApprovalSchema,
  ToolPermissionCondition_Argument_Match,
  type ToolPermissionRule,
  ToolPermissionRuleSchema,
  ToolPermissionRule_Action,
} from "../gen/euler/v1/permissions_pb";
import {
  type Message,
  MessageSchema,
  type MessageVersion,
  MessageVersionSchema,
  Message_Role,
} from "../gen/euler/v1/sessions_pb";
import {
  type LlmMetrics,
  type Step,
  StepSchema,
  Step_Kind,
  Step_Status,
} from "../gen/euler/v1/steps_pb";
import type {
  Agent as DomainAgent,
  InboxMessage as DomainInboxMessage,
} from "../schemas/agents";
import type { DisplayIcon as DomainDisplayIcon } from "../schemas/icons";
import type { Job as DomainJob } from "../schemas/jobs";
import type { ErrorDetails } from "../schemas/observability";
import type { MessageVersion as DomainMessageVersion } from "../schemas/run";
import type { ToolContent as DomainToolContent } from "../schemas/toolContent";
import type {
  ToolApproval as DomainToolApproval,
  ToolPermissionRule as DomainToolPermissionRule,
} from "../schemas/toolPermissions";

// Converters between the runtime's records and the API contract. Domain code
// keeps its own types; only RPC handlers and the event hub cross this line.

/** Maps a domain string union to a proto enum and back, failing on values neither side knows. */
function enumMap<D extends string, P extends number>(
  name: string,
  pairs: Record<D, P>,
) {
  const reverse = new Map(
    Object.entries(pairs).map(([key, value]) => [value as P, key as D]),
  );
  return {
    toProto(value: unknown): P {
      const mapped = pairs[value as D];
      if (mapped === undefined)
        throw new Error(`Unknown ${name}: ${String(value)}`);
      return mapped;
    },
    fromProto(value: number): D {
      const mapped = reverse.get(value as P);
      if (mapped === undefined) throw new Error(`Unknown ${name}: ${value}`);
      return mapped;
    },
  };
}

export const stepKinds = enumMap("step kind", {
  llm_call: Step_Kind.LLM_CALL,
  tool_call: Step_Kind.TOOL_CALL,
  complete: Step_Kind.COMPLETE,
  error: Step_Kind.ERROR,
});
export const stepStatuses = enumMap("step status", {
  running: Step_Status.RUNNING,
  done: Step_Status.DONE,
  error: Step_Status.ERROR,
});
export const roles = enumMap("message role", {
  user: Message_Role.USER,
  assistant: Message_Role.ASSISTANT,
  event: Message_Role.EVENT,
});
export const agentKinds = enumMap("agent kind", {
  main: Agent_Kind.MAIN,
  general: Agent_Kind.GENERAL,
});
export const agentStatuses = enumMap("agent status", {
  queued: Agent_Status.QUEUED,
  running: Agent_Status.RUNNING,
  waiting: Agent_Status.WAITING,
  idle: Agent_Status.IDLE,
  completed: Agent_Status.COMPLETED,
  cancelled: Agent_Status.CANCELLED,
});
export const inboxKinds = enumMap("inbox message kind", {
  user: InboxMessage_Kind.USER,
  task: InboxMessage_Kind.TASK,
  message: InboxMessage_Kind.MESSAGE,
  question: InboxMessage_Kind.QUESTION,
  progress: InboxMessage_Kind.PROGRESS,
  result: InboxMessage_Kind.RESULT,
  failure: InboxMessage_Kind.FAILURE,
  control: InboxMessage_Kind.CONTROL,
  job: InboxMessage_Kind.JOB,
});
export const jobStatuses = enumMap("job status", {
  starting: Job_Status.STARTING,
  running: Job_Status.RUNNING,
  succeeded: Job_Status.SUCCEEDED,
  failed: Job_Status.FAILED,
  cancelled: Job_Status.CANCELLED,
  interrupted: Job_Status.INTERRUPTED,
});
const workspaceKinds = enumMap("workspace kind", {
  sandbox: WorkspaceFileAttachment_WorkspaceKind.SANDBOX,
  local: WorkspaceFileAttachment_WorkspaceKind.LOCAL,
});
const iconThemes = enumMap("icon theme", {
  light: DisplayIcon_Theme.LIGHT,
  dark: DisplayIcon_Theme.DARK,
});

export const millis = (ms: number): Timestamp => timestampFromMs(ms);
export const optionalMillis = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? undefined : timestampFromMs(ms);
const isoTimestamp = (iso: unknown): Timestamp => {
  const ms = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(ms)) throw new Error(`Invalid step timestamp: ${iso}`);
  return timestampFromMs(ms);
};

export function icon(value: DomainDisplayIcon): DisplayIcon {
  return create(DisplayIconSchema, {
    src: value.src,
    theme: value.theme ? iconThemes.toProto(value.theme) : undefined,
  });
}

export function fromIcon(value: DisplayIcon): DomainDisplayIcon {
  return {
    src: value.src,
    ...(value.theme ? { theme: iconThemes.fromProto(value.theme) } : {}),
  };
}

const record = (value: unknown, what: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Invalid ${what}`);
  return value as Record<string, unknown>;
};
const optionalString = (value: unknown) =>
  typeof value === "string" ? value : undefined;
const optionalNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

function metrics(value: unknown): LlmMetrics {
  const m = record(value, "step metrics") as DomainLlmMetrics;
  return {
    $typeName: "euler.v1.LlmMetrics",
    cost: optionalNumber(m.cost),
    cachedTokens: optionalNumber(m.cachedTokens),
    outputTokens: optionalNumber(m.outputTokens),
    outputDurationMs: optionalNumber(m.outputDurationMs),
    promptTokens: optionalNumber(m.promptTokens),
    promptDurationMs: optionalNumber(m.promptDurationMs),
    totalDurationMs: optionalNumber(m.totalDurationMs),
    loadDurationMs: optionalNumber(m.loadDurationMs),
    tokensPerSecond: optionalNumber(m.tokensPerSecond),
    thinkingDurationMs: optionalNumber(m.thinkingDurationMs),
    costBreakdown: m.costBreakdown && {
      $typeName: "euler.v1.CostBreakdown",
      cachedInput: m.costBreakdown.cachedInput,
      uncachedInput: m.costBreakdown.uncachedInput,
      output: m.costBreakdown.output,
    },
    cacheSavings: optionalNumber(m.cacheSavings),
  };
}

/** A recorded trace step. Throws on a step that does not fit the contract. */
export function step(value: unknown): Step {
  const s = record(value, "step");
  return create(StepSchema, {
    kind: stepKinds.toProto(s.kind),
    status: stepStatuses.toProto(s.status),
    turnIndex: optionalNumber(s.turnIndex) ?? 0,
    toolName: optionalString(s.toolName),
    toolIcons: Array.isArray(s.toolIcons)
      ? (s.toolIcons as DomainDisplayIcon[]).map(icon)
      : [],
    jobId: optionalString(s.jobId),
    args:
      s.args === undefined
        ? undefined
        : (record(s.args, "step arguments") as JsonObject),
    result: optionalString(s.result),
    thinking: optionalString(s.thinking),
    metrics: s.metrics === undefined ? undefined : metrics(s.metrics),
    error: optionalString(s.error),
    startedAt: isoTimestamp(s.startedAt),
    endedAt: s.endedAt === undefined ? undefined : isoTimestamp(s.endedAt),
    agentName: optionalString(s.agentName),
  });
}

export const steps = (value: unknown): Step[] =>
  value === undefined || value === null
    ? []
    : Array.isArray(value)
      ? value.map(step)
      : (() => {
          throw new Error("Invalid steps");
        })();

/** A step as the runtime records it, for steps a client sends back. */
export function fromStep(value: Step): Record<string, unknown> {
  const metricsValue = value.metrics;
  return {
    kind: stepKinds.fromProto(value.kind),
    status: stepStatuses.fromProto(value.status),
    turnIndex: value.turnIndex,
    ...(value.startedAt
      ? { startedAt: new Date(timestampMs(value.startedAt)).toISOString() }
      : {}),
    ...(value.endedAt
      ? { endedAt: new Date(timestampMs(value.endedAt)).toISOString() }
      : {}),
    ...(value.toolName === undefined ? {} : { toolName: value.toolName }),
    ...(value.toolIcons.length
      ? { toolIcons: value.toolIcons.map(fromIcon) }
      : {}),
    ...(value.jobId === undefined ? {} : { jobId: value.jobId }),
    ...(value.args === undefined ? {} : { args: value.args }),
    ...(value.result === undefined ? {} : { result: value.result }),
    ...(value.thinking === undefined ? {} : { thinking: value.thinking }),
    ...(metricsValue
      ? {
          metrics: Object.fromEntries(
            Object.entries({
              cost: metricsValue.cost,
              cachedTokens: metricsValue.cachedTokens,
              outputTokens: metricsValue.outputTokens,
              outputDurationMs: metricsValue.outputDurationMs,
              promptTokens: metricsValue.promptTokens,
              promptDurationMs: metricsValue.promptDurationMs,
              totalDurationMs: metricsValue.totalDurationMs,
              loadDurationMs: metricsValue.loadDurationMs,
              tokensPerSecond: metricsValue.tokensPerSecond,
              thinkingDurationMs: metricsValue.thinkingDurationMs,
              costBreakdown: metricsValue.costBreakdown && {
                cachedInput: metricsValue.costBreakdown.cachedInput,
                uncachedInput: metricsValue.costBreakdown.uncachedInput,
                output: metricsValue.costBreakdown.output,
              },
              cacheSavings: metricsValue.cacheSavings,
            }).filter(([, entry]) => entry !== undefined),
          ),
        }
      : {}),
    ...(value.error === undefined ? {} : { error: value.error }),
    ...(value.agentName === undefined ? {} : { agentName: value.agentName }),
  };
}

export function outputAttachment(
  value: DomainOutputAttachment,
): OutputAttachment {
  switch (value.kind) {
    case "file":
      return create(OutputAttachmentSchema, {
        kind: {
          case: "file",
          value: {
            id: value.id,
            name: value.name,
            size: BigInt(value.size),
            path: value.path,
            sessionId: value.sessionId,
            workspaceKind: workspaceKinds.toProto(value.workspaceKind),
          },
        },
      });
    case "generated_image":
      return create(OutputAttachmentSchema, {
        kind: { case: "generatedImage", value: { url: value.url } },
      });
    case "web_source":
      return create(OutputAttachmentSchema, {
        kind: {
          case: "webSource",
          value: { title: value.title, url: value.url },
        },
      });
  }
}

export function messageAttachment(
  value: DomainMessageAttachment,
): MessageAttachment {
  if (value.kind === "image")
    return create(MessageAttachmentSchema, {
      kind: {
        case: "image",
        value: {
          id: value.id,
          name: value.name,
          mimeType: value.mimeType,
          size: value.size,
        },
      },
    });
  return create(MessageAttachmentSchema, {
    kind: outputAttachment(value).kind,
  });
}

/** An attachment a client sends back, as the runtime records it. */
export function fromMessageAttachment(
  value: MessageAttachment,
): DomainMessageAttachment {
  const { kind } = value;
  switch (kind.case) {
    case "image":
      return {
        kind: "image",
        id: kind.value.id,
        name: kind.value.name,
        mimeType: kind.value.mimeType as Extract<
          DomainMessageAttachment,
          { kind: "image" }
        >["mimeType"],
        size: kind.value.size,
      };
    case "file":
      return {
        kind: "file",
        id: kind.value.id,
        name: kind.value.name,
        size: Number(kind.value.size),
        path: kind.value.path,
        sessionId: kind.value.sessionId,
        workspaceKind: workspaceKinds.fromProto(kind.value.workspaceKind),
      };
    case "generatedImage":
      return { kind: "generated_image", url: kind.value.url };
    case "webSource":
      return {
        kind: "web_source",
        title: kind.value.title,
        url: kind.value.url,
      };
    default:
      throw new Error("Attachment kind is required");
  }
}

export function messageVersion(value: DomainMessageVersion): MessageVersion {
  return create(MessageVersionSchema, {
    content: value.content,
    steps: steps(value.steps),
    attachments: (value.attachments ?? []).map(messageAttachment),
  });
}

export function fromMessageVersion(
  value: MessageVersion,
): DomainMessageVersion {
  return {
    content: value.content,
    ...(value.steps.length ? { steps: value.steps.map(fromStep) } : {}),
    ...(value.attachments.length
      ? { attachments: value.attachments.map(fromMessageAttachment) }
      : {}),
  };
}

export function message(value: WireMessage): Message {
  return create(MessageSchema, {
    id: value.id === undefined ? undefined : BigInt(value.id),
    activationId: value.activationId,
    role: roles.toProto(value.role),
    content: value.content,
    steps: steps(value.steps),
    attachments: (value.attachments ?? []).map(messageAttachment),
    versions: (value.versions ?? []).map(messageVersion),
  });
}

export function agent(value: DomainAgent): Agent {
  return create(AgentSchema, {
    id: value.id,
    sessionId: value.sessionId,
    parentId: value.parentId ?? undefined,
    kind: agentKinds.toProto(value.kind),
    title: value.title,
    status: agentStatuses.toProto(value.status),
    model: value.model,
    spawnPosition: value.spawnPosition,
    createdAt: millis(value.createdAt),
    endedAt: optionalMillis(value.endedAt),
    activity: value.activity,
    interruption: value.interruption,
    held: value.held,
  });
}

export function inboxMessage(value: DomainInboxMessage): InboxMessage {
  return create(InboxMessageSchema, {
    id: BigInt(value.id),
    agentId: value.agentId,
    sender: value.sender,
    kind: inboxKinds.toProto(value.kind),
    content: value.content,
    wakes: value.wakes,
    createdAt: millis(value.createdAt),
    deliveredAt: optionalMillis(value.deliveredAt),
    held: value.held,
    attachmentIds: value.attachmentIds,
    attachments: value.attachments.map(outputAttachment),
  });
}

export function activation(value: DomainActivation): Activation {
  return create(ActivationSchema, {
    id: value.id,
    agentId: value.agentId,
    sessionId: value.sessionId,
    content: value.content,
    thinking: value.thinking,
    steps: steps(value.steps),
  });
}

function toolContent(value: DomainToolContent): ToolContent {
  return create(ToolContentSchema, {
    blocks: value.blocks.map((block) => {
      switch (block.kind) {
        case "text":
          return {
            kind: {
              case: "text" as const,
              value: { text: block.text, label: block.label },
            },
          };
        case "code":
          return {
            kind: {
              case: "code" as const,
              value: {
                text: block.text,
                language: block.language,
                label: block.label,
              },
            },
          };
        case "fields":
          return {
            kind: { case: "fields" as const, value: { fields: block.fields } },
          };
      }
    }),
  });
}

export function errorDetail(value: ErrorDetails): ErrorDetail {
  return create(ErrorDetailSchema, {
    code: ErrorCode[value.code],
    message: value.message,
    requestId: value.requestId,
    jobId: value.jobId,
  });
}

export function job(value: DomainJob): Job {
  return create(JobSchema, {
    id: value.id,
    sessionId: value.sessionId,
    agentId: value.agentId,
    tool: value.tool,
    description: value.description,
    activationId: value.activationId,
    spawnPosition: value.spawnPosition,
    input: toolContent(value.input),
    status: jobStatuses.toProto(value.status),
    createdAt: millis(value.createdAt),
    endedAt: optionalMillis(value.endedAt),
    progress: value.progress ? toolContent(value.progress) : undefined,
    output: value.output ? toolContent(value.output) : undefined,
    metadata: value.metadata ? toolContent(value.metadata) : undefined,
    outputTruncated: value.outputTruncated,
    result: value.result && {
      text: value.result.text,
      attachments: (value.result.attachments ?? []).map(outputAttachment),
      failed: value.result.failed ?? false,
    },
    error: value.error ? errorDetail(value.error) : undefined,
    notified: value.notified,
  });
}

export function toolApproval(value: DomainToolApproval): ToolApproval {
  return create(ToolApprovalSchema, {
    id: value.id,
    sessionId: value.sessionId,
    agentId: value.agentId,
    agentTitle: value.agentTitle,
    tool: value.tool,
    icons: (value.icons ?? []).map(icon),
    arguments: value.arguments as JsonObject,
    workspacePath: value.workspacePath,
    reason: value.reason,
    matchingScope: value.matchingScope,
  });
}

export {
  fromProtoRule as fromPermissionRule,
  toProtoRule as permissionRule,
} from "../permissions/wire";

const outcomes = enumMap("activation outcome", {
  done: ActivationEnded_Outcome.DONE,
  aborted: ActivationEnded_Outcome.ABORTED,
  error: ActivationEnded_Outcome.ERROR,
  paused: ActivationEnded_Outcome.PAUSED,
});

function eventPayload(value: AgentEvent): Event["payload"] {
  switch (value.type) {
    case "activation_started":
      return {
        case: "activationStarted",
        value: create(ActivationStartedSchema, {
          activation: activation(value.activation),
        }),
      };
    case "delta":
      return {
        case: "delta",
        value: create(DeltaSchema, {
          activationId: value.activationId,
          contentDelta: value.contentDelta,
          thinkingDelta: value.thinkingDelta,
        }),
      };
    case "step":
      return {
        case: "step",
        value: create(StepChangedSchema, {
          activationId: value.activationId,
          position: value.position,
          step: step(value.step),
        }),
      };
    case "activation_ended":
      return {
        case: "activationEnded",
        value: create(ActivationEndedSchema, {
          activationId: value.activationId,
          outcome: outcomes.toProto(value.outcome),
        }),
      };
    case "transcript_appended":
      return {
        case: "transcriptAppended",
        value: create(TranscriptAppendedSchema, {
          message: message(value.message),
        }),
      };
    case "agent_status":
      return {
        case: "agentStatus",
        value: create(AgentStatusChangedSchema, { agent: agent(value.agent) }),
      };
    case "inbox_queued":
      return {
        case: "inboxQueued",
        value: create(InboxQueuedSchema, {
          messages: value.messages.map(inboxMessage),
        }),
      };
    case "approval_requested":
      return {
        case: "approvalRequested",
        value: create(ApprovalRequestedSchema, {
          approval: toolApproval(value.approval),
        }),
      };
    case "approval_resolved":
      return {
        case: "approvalResolved",
        value: create(ApprovalResolvedSchema, {
          approvalId: value.approvalId,
        }),
      };
    case "resync":
      return { case: "resync", value: create(ResyncSchema) };
  }
}

export function event(value: AgentEvent, sequence: number): Event {
  return create(EventSchema, {
    sequence: BigInt(sequence),
    sessionId: value.sessionId,
    agentId: value.agentId,
    payload: eventPayload(value),
  });
}

export const resyncEvent = (sequence: number) =>
  event({ type: "resync", sessionId: "", agentId: "" }, sequence);

export const keepaliveEvent = () =>
  create(EventSchema, {
    payload: { case: "keepalive", value: create(KeepaliveSchema) },
  });
