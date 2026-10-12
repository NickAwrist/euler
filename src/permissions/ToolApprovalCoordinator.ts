import { getSessionById } from "../db/sessions";
import { effectiveUserPreferences } from "../db/userPreferences";
import { OperationError } from "../observability/errors";
import {
  type ToolApproval,
  type ToolApprovalResponse,
  ToolArgumentsSchema,
} from "../schemas/toolPermissions";
import {
  type Workspace,
  workspaceService,
} from "../workspaces/WorkspaceService";
import { permissionService } from "./PermissionService";
import { saveToolPermissionRule } from "./preferences";

export type ApprovalContext = {
  owner: string;
  sessionId: string;
  agentId: string;
  agentTitle: string;
  workspace: Workspace;
  signal: AbortSignal;
  waiting(): void;
};
type PendingApproval = {
  approval: ToolApproval;
  context: ApprovalContext;
  answered: boolean;
  resolve(decision: ToolApprovalResponse["decision"]): void;
};

/** Pending calls live with the activation; server restart interrupts rather than replays them. */
export class ToolApprovalCoordinator {
  private pending = new Map<string, PendingApproval>();
  constructor(private changed: (owner: string, sessionId: string) => void) {}

  list(owner: string, sessionId: string): ToolApproval[] {
    return [...this.pending.values()]
      .filter(
        (entry) =>
          entry.context.owner === owner &&
          entry.context.sessionId === sessionId &&
          !entry.answered,
      )
      .map((entry) => structuredClone(entry.approval));
  }

  checkCall(
    context: Pick<ApprovalContext, "owner" | "sessionId" | "workspace">,
    tool: string,
    args: Record<string, unknown>,
  ) {
    const preferences = effectiveUserPreferences(context.owner);
    const permissions = permissionService.resolve(
      context.workspace,
      preferences.capabilities,
      preferences.toolPermissions,
    );
    return permissionService.callDecision(permissions, tool, args, {
      sessionId: context.sessionId,
      workspacePath: context.workspace.hostPath,
    });
  }

  async authorize(
    context: ApprovalContext,
    tool: string,
    rawArgs: Record<string, unknown>,
  ): Promise<void> {
    if (context.signal.aborted) throw new Error("Tool call cancelled");
    const args = structuredClone(ToolArgumentsSchema.parse(rawArgs));
    const decision = this.checkCall(context, tool, args);
    if (decision.action === "deny") throw new Error(decision.reason);
    if (decision.action === "allow") return;
    const approval: ToolApproval = {
      id: crypto.randomUUID(),
      sessionId: context.sessionId,
      agentId: context.agentId,
      agentTitle: context.agentTitle,
      tool,
      arguments: args,
      background: args.background === true,
      workspacePath:
        context.workspace.kind === "local"
          ? context.workspace.hostPath
          : context.workspace.displayPath,
      reason: decision.reason,
      createdAt: Date.now(),
      matchingRule: {
        id: crypto.randomUUID(),
        tool,
        action: "allow",
        condition: { kind: "arguments", value: structuredClone(args) },
        sessionId: context.sessionId,
        workspacePath: context.workspace.hostPath,
      },
      matchingScope: "Identical arguments in this chat and workspace",
    };
    let abort: (() => void) | undefined;
    try {
      const answer = await new Promise<ToolApprovalResponse["decision"]>(
        (resolve, reject) => {
          abort = () => reject(new Error("Tool call cancelled"));
          this.pending.set(approval.id, {
            approval,
            context,
            answered: false,
            resolve,
          });
          context.signal.addEventListener("abort", abort, { once: true });
          if (context.signal.aborted) {
            abort();
            return;
          }
          context.waiting();
          this.changed(context.owner, context.sessionId);
        },
      );
      if (context.signal.aborted) throw new Error("Tool call cancelled");
      if (answer === "deny") throw new Error("Tool call denied by the user");
      // A changed deny rule or capability must still win after an approval.
      const current = this.checkCall(context, tool, args);
      if (current.action === "deny") throw new Error(current.reason);
    } finally {
      if (abort) context.signal.removeEventListener("abort", abort);
      this.pending.delete(approval.id);
      this.changed(context.owner, context.sessionId);
    }
  }

  async respond(
    owner: string,
    sessionId: string,
    id: string,
    response: ToolApprovalResponse,
  ) {
    const entry = this.pending.get(id);
    if (
      !entry ||
      entry.context.owner !== owner ||
      entry.context.sessionId !== sessionId
    ) {
      throw new OperationError("NOT_FOUND", {
        message: "Approval request not found",
      });
    }
    const { context, approval } = entry;
    if (response.decision !== "deny") {
      const session = getSessionById(owner, sessionId);
      if (!session)
        throw new OperationError("NOT_FOUND", { message: "Session not found" });
      const workspace = await workspaceService.resolveSession(session);
      if (
        workspace.kind !== context.workspace.kind ||
        workspace.hostPath !== context.workspace.hostPath
      ) {
        throw new OperationError("CONFLICT", {
          message:
            "The working directory changed; this approval is no longer valid",
        });
      }
      const current = this.checkCall(
        context,
        approval.tool,
        approval.arguments,
      );
      if (current.action === "deny")
        throw new OperationError("CONFLICT", { message: current.reason });
    }
    if (entry.answered || context.signal.aborted || !this.pending.has(id)) {
      throw new OperationError("CONFLICT", {
        message: "Approval request is no longer pending",
      });
    }
    const rule =
      response.decision === "allow_matching"
        ? approval.matchingRule
        : undefined;
    if (rule) saveToolPermissionRule(owner, rule);
    entry.answered = true;
    entry.resolve(response.decision);
    this.changed(owner, sessionId);
    return {
      ok: true as const,
      ...(rule ? { rule: structuredClone(rule) } : {}),
    };
  }
}
