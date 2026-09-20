import crypto from "node:crypto";
import type { WorkspaceFileAttachment } from "../attachments/types";
import type { WireMessage } from "../db/index";
import { logger } from "../logger";
import {
  AgentSession,
  type HistoryWireStep,
  type SessionAbortedEvent,
  type SessionMessage,
  type SessionRunDeltaEvent,
  type SessionStepEvent,
} from "../session/AgentSession";
import { errorMessage } from "../utils/errors";
import { workspaceService } from "../workspaces/WorkspaceService";
import type { RunPersistence } from "./runPersistence";
import type { RunTurnContext } from "./runRequestContext";
import type { RunStream } from "./runStream";

const log = logger.child({ component: "runTurnRunner" });

/**
 * Run one agent turn end-to-end: bootstrap the session from the request
 * body, pipe its lifecycle events to the SSE stream, and persist at the
 * documented boundaries. All I/O dependencies are injected so this file
 * contains no Express, no DB, no SSE internals.
 */
export async function runTurn(
  ctx: RunTurnContext,
  stream: RunStream,
  persistence: RunPersistence,
): Promise<void> {
  const session = buildSession(ctx);
  const filesBefore = await workspaceFileSnapshot(ctx);

  const onStep = (p: SessionStepEvent) =>
    stream.emit({ type: "run_step", step: p.step, steps: p.steps });

  const onRunDelta = (p: SessionRunDeltaEvent) =>
    stream.emit({
      type: "run_delta",
      contentDelta: p.contentDelta,
      thinkingDelta: p.thinkingDelta,
      agentName: p.agentName,
    });

  const onAborted = (p: SessionAbortedEvent) => {
    persistence.saveFinal(p.history as WireMessage[], p.modelMessages);
    stream.emit({
      type: "run_aborted",
      result: p.result,
      steps: p.steps,
      history: p.history,
      modelMessages: p.modelMessages,
    });
  };

  session.on("step", onStep);
  session.on("run_delta", onRunDelta);
  session.on("aborted", onAborted);

  persistence.saveInitial(
    ctx.body.history as WireMessage[],
    ctx.body.message,
    ctx.attachments,
    ctx.body.modelMessages ?? null,
  );
  stream.emit({ type: "run_started", requestId: stream.requestId });

  try {
    const result = await session.sendRun(
      ctx.body.message,
      ctx.attachments,
      stream.signal,
    );
    if (stream.signal.aborted) return;
    const changedFiles = await changedFileAttachments(ctx, filesBefore);
    const assistantMessage = session.history[session.history.length - 1];
    if (assistantMessage && changedFiles.length > 0) {
      assistantMessage.attachments = changedFiles;
    }
    const stepsSnapshot =
      (session.history[session.history.length - 1]?.steps as
        | HistoryWireStep[]
        | undefined) ?? [];
    const modelMessages = session.getModelMessages();
    persistence.saveFinal(session.history as WireMessage[], modelMessages);
    stream.emit({
      type: "run_done",
      result,
      steps: stepsSnapshot,
      attachments: changedFiles,
      ...(ctx.ephemeral ? { modelMessages } : {}),
    });
  } catch (err) {
    if (stream.signal.aborted) return;
    log.error({ err }, "run failed");
    stream.emit({
      type: "run_error",
      error: errorMessage(err),
    });
  } finally {
    session.off("step", onStep);
    session.off("run_delta", onRunDelta);
    session.off("aborted", onAborted);
  }
}

async function workspaceFileSnapshot(
  ctx: RunTurnContext,
): Promise<Map<string, string>> {
  try {
    return new Map(
      (await workspaceService.listFiles(ctx.workspace)).map((file) => [
        file.path,
        `${file.size}:${file.modifiedAt}`,
      ]),
    );
  } catch {
    return new Map();
  }
}

async function changedFileAttachments(
  ctx: RunTurnContext,
  before: Map<string, string>,
): Promise<WorkspaceFileAttachment[]> {
  try {
    return (await workspaceService.listFiles(ctx.workspace))
      .filter(
        (file) => before.get(file.path) !== `${file.size}:${file.modifiedAt}`,
      )
      .map((file) => ({
        id: crypto.randomUUID(),
        kind: "file" as const,
        name: file.name,
        size: file.size,
        path: file.path,
        sessionId: ctx.sessionId,
        workspaceKind: ctx.workspace.kind,
        temporary: ctx.ephemeral,
      }));
  } catch {
    return [];
  }
}

function buildSession(ctx: RunTurnContext): AgentSession {
  const session = new AgentSession(crypto.randomUUID(), {
    model: ctx.model,
    reasoningEffort: ctx.reasoningEffort,
    agentName: ctx.agentName,
    promptContext: ctx.promptContext,
    toolSessionDir: ctx.toolSessionDir,
    workspace: ctx.workspace,
    ownerUuid: ctx.ownerUuid,
    attachmentSessionId: ctx.sessionId,
    userPrompt: ctx.body.message,
  });
  session.restoreFromPersistence({
    history: ctx.body.history as SessionMessage[],
    modelMessages: ctx.body.modelMessages ?? null,
  });
  return session;
}
