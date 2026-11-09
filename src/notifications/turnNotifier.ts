import type { DeviceRow } from "../db/devices";
import type { WireMessage } from "../db/types";
import type { AgentEvent } from "../events/types";
import { logEvent } from "../observability/logger";
import type { ApnsSend } from "./apns";

/** The notification category whose Allow and Deny actions answer an approval. */
export const APPROVAL_CATEGORY = "TOOL_APPROVAL";
/** Lock screens show about four lines; the rest is cut anyway. */
const MAX_BODY_LENGTH = 240;

export type TurnNotifierDependencies = {
  send: ApnsSend;
  devices: (owner: string) => DeviceRow[];
  /** Drops a token APNs reported as dead. */
  forget: (token: string) => void;
  /** Whether a client holds the owner's event stream open, so it sees changes itself. */
  watching: (owner: string) => boolean;
  title: (owner: string, sessionId: string) => string;
};

type Alert = {
  sessionId: string;
  body: string;
  category?: string;
  data?: Record<string, string>;
};

/** Reply text as one plain line, without the Markdown that lock screens show raw. */
export function plainSummary(markdown: string): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\$\$?/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > MAX_BODY_LENGTH
    ? `${text.slice(0, MAX_BODY_LENGTH - 1).trimEnd()}…`
    : text;
}

function generatedImage(message: WireMessage | undefined) {
  for (const attachment of message?.attachments ?? [])
    if (attachment.kind === "generated_image") return attachment.url;
  return undefined;
}

/**
 * Pushes to a user's phones when a main agent's turn ends or fails, and when
 * any agent asks to run a tool, unless a client has the event stream open.
 */
export class TurnNotifier {
  private readonly mainAgents = new Set<string>();
  /** The last reply each main agent appended in its current turn. */
  private readonly replies = new Map<string, WireMessage>();

  constructor(private readonly dependencies: TurnNotifierDependencies) {}

  /** Follows one published event. Never throws. */
  observe(owner: string, event: AgentEvent): void {
    try {
      const alert = this.alert(event);
      if (alert) void this.notify(owner, alert);
    } catch (error) {
      logEvent("error", "push.observe_failed", {}, error);
    }
  }

  private alert(event: AgentEvent): Alert | undefined {
    switch (event.type) {
      case "agent_status":
        if (event.agent.kind === "main") this.mainAgents.add(event.agent.id);
        return;
      case "transcript_appended":
        if (
          event.message.role === "assistant" &&
          this.mainAgents.has(event.agentId)
        )
          this.replies.set(event.agentId, event.message);
        return;
      case "activation_ended": {
        if (!this.mainAgents.has(event.agentId)) return;
        const reply = this.replies.get(event.agentId);
        this.replies.delete(event.agentId);
        // A stopped turn was the user's choice; a paused one resumes itself.
        if (event.outcome !== "done" && event.outcome !== "error") return;
        const summary = plainSummary(reply?.content ?? "");
        const image = generatedImage(reply);
        return {
          sessionId: event.sessionId,
          body:
            event.outcome === "error"
              ? summary || "The reply failed."
              : summary || (image ? "Generated an image." : "Reply ready."),
          ...(image ? { data: { image } } : {}),
        };
      }
      case "approval_requested": {
        const { approval } = event;
        return {
          sessionId: event.sessionId,
          body: `${approval.agentTitle} wants to run ${approval.tool}`,
          category: APPROVAL_CATEGORY,
          data: { approvalId: approval.id },
        };
      }
    }
  }

  private async notify(owner: string, alert: Alert) {
    const { send, devices, forget, watching, title } = this.dependencies;
    if (watching(owner)) return;
    const targets = devices(owner);
    if (targets.length === 0) return;
    const payload = {
      aps: {
        alert: { title: title(owner, alert.sessionId), body: alert.body },
        sound: "default",
        "thread-id": alert.sessionId,
        // Lets the notification service extension attach a generated image.
        "mutable-content": 1,
        ...(alert.category ? { category: alert.category } : {}),
      },
      sessionId: alert.sessionId,
      ...alert.data,
    };
    await Promise.all(
      targets.map(async (device) => {
        try {
          const result = await send({
            token: device.token,
            environment: device.environment,
            topic: device.bundle_id,
            payload,
          });
          if (result.ok) {
            logEvent("info", "push.sent", { label: alert.category ?? "turn" });
            return;
          }
          logEvent("warn", "push.rejected", {
            status: result.status,
            reason: result.reason,
          });
          if (result.deadToken) forget(device.token);
        } catch (error) {
          logEvent("error", "push.failed", {}, error);
        }
      }),
    );
  }
}
