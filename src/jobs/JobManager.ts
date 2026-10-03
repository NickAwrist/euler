import { z } from "zod";
import type { RunContext, Step } from "../RunContext";
import { changedWorkspaceFiles } from "../agents/runtime/workspaceOutputs";
import { getDb, transaction } from "../db/connection";
import { logEvent, withBackgroundLogContext } from "../observability/logger";
import { type Job, JobSchema, activeJob } from "../schemas/jobs";
import { errorDetails } from "../schemas/observability";
import {
  ToolContentSchema,
  type ToolContentUpdate,
  ToolContentUpdateSchema,
  ToolInputSchema,
} from "../schemas/toolContent";
import type { ToolResult } from "../tools/BaseTool";
import type {
  BackgroundCapable,
  BackgroundResult,
  JobExecutor,
  RunningExecution,
} from "../tools/background";
import { updateContent } from "./content";

export class JobManager {
  private records = new Map<string, Job>();
  private live = new Map<
    string,
    {
      controller: AbortController;
      execution?: RunningExecution;
      done: Promise<void>;
    }
  >();
  constructor(
    private host: {
      blocked(sessionId: string): boolean;
      notify(job: Job, wakes: boolean): void;
      changed(job: Job): void;
      position(sessionId: string): number;
    },
    private sessionLimit = z.coerce
      .number()
      .int()
      .positive()
      .parse(process.env.EULER_MAX_SESSION_JOBS ?? 4),
    private ownerLimit = z.coerce
      .number()
      .int()
      .positive()
      .parse(process.env.EULER_MAX_OWNER_JOBS ?? 16),
  ) {}
  private save(job: Job) {
    getDb().run(
      "INSERT INTO jobs VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      [job.id, job.sessionId, job.ownerUuid, JSON.stringify(job)],
    );
    this.records.set(job.id, job);
  }
  list(owner: string, sessionId: string) {
    for (const row of getDb()
      .query<{ id: string; payload: string }, [string, string]>(
        "SELECT id, payload FROM jobs WHERE owner_uuid=? AND session_id=?",
      )
      .all(owner, sessionId)) {
      if (!this.records.has(row.id))
        this.records.set(row.id, JobSchema.parse(JSON.parse(row.payload)));
    }
    return [...this.records.values()].filter(
      (j) => j.ownerUuid === owner && j.sessionId === sessionId,
    );
  }
  busy(owner: string, sessionId: string) {
    return this.list(owner, sessionId).some(activeJob);
  }
  read(owner: string, sessionId: string, id: string) {
    const job = this.list(owner, sessionId).find((j) => j.id === id);
    if (!job) throw new Error("Unknown job");
    return job;
  }
  executor(
    agentId: string,
    sessionId: string,
    activationId: string,
  ): JobExecutor {
    return {
      start: (tool, args, ctx, step) =>
        this.start(tool, args, ctx, agentId, sessionId, activationId, step),
    };
  }
  private async start(
    tool: BackgroundCapable,
    args: Record<string, unknown>,
    ctx: RunContext,
    agentId: string,
    sessionId: string,
    activationId: string,
    step?: Step,
  ): Promise<ToolResult> {
    const workspace = ctx.workspace;
    if (!workspace) throw new Error("Workspace required");
    const input = ToolInputSchema.parse(tool.describeInput(args));
    if (this.host.blocked(sessionId) || ctx.signal?.aborted)
      throw new Error("Job starts are blocked");
    const active = [...this.records.values()].filter(activeJob);
    if (
      active.filter((j) => j.sessionId === sessionId).length >=
        this.sessionLimit ||
      active.filter((j) => j.ownerUuid === ctx.ownerUuid).length >=
        this.ownerLimit
    )
      throw new Error("Active job limit reached");
    const job: Job = {
      id: `job_${crypto.randomUUID()}`,
      ownerUuid: ctx.ownerUuid,
      sessionId,
      agentId,
      activationId,
      input: input.content,
      spawnPosition: this.host.position(sessionId),
      tool: tool.name,
      description: input.summary,
      status: "starting",
      createdAt: Date.now(),
      endedAt: null,
      progress: null,
      output: null,
      metadata: null,
      outputTruncated: false,
      notified: false,
    };
    this.save(job);
    if (step) step.jobId = job.id;
    const controller = new AbortController();
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const handle = {
      controller,
      done,
      execution: undefined as RunningExecution | undefined,
    };
    this.live.set(job.id, handle);
    this.host.changed(job);
    let presentationError: Error | undefined;
    const settle = async (
      result?: BackgroundResult,
      executionError?: unknown,
    ) => {
      let outputError = presentationError;
      for (const target of ["output", "metadata"] as const) {
        const content = result?.[target];
        if (!content) continue;
        const parsed = ToolContentSchema.safeParse(content);
        if (parsed.success) job[target] = parsed.data;
        else outputError = new Error(z.prettifyError(parsed.error));
      }
      // Invalid output aborts the job, so it outranks the abort it causes.
      const failure = presentationError ?? executionError ?? outputError;
      try {
        if (result) {
          job.result = {
            text: result.text,
            failed: result.failed,
            attachments: result.attachments,
          };
          if (!controller.signal.aborted && !failure && !result.failed) {
            const files = await changedWorkspaceFiles(
              workspace,
              new Set(result.outputFiles ?? []),
              sessionId,
            );
            job.result.attachments = [...(result.attachments ?? []), ...files];
          }
        }
        job.status = presentationError
          ? "failed"
          : controller.signal.aborted
            ? "cancelled"
            : failure || result?.failed
              ? "failed"
              : "succeeded";
        const code =
          job.status !== "failed" || !failure
            ? undefined
            : executionError && !presentationError
              ? "JOB_FAILED"
              : "JOB_OUTPUT_INVALID";
        if (code) job.error = errorDetails(code, { jobId: job.id });
        job.endedAt = Date.now();
        logEvent(
          code ? "error" : "info",
          "job.finished",
          {
            status: job.status,
            code,
            durationMs: job.endedAt - job.createdAt,
          },
          failure,
        );
        transaction(() => {
          this.save(job);
          if (job.status !== "cancelled" && !this.host.blocked(sessionId)) {
            this.host.notify(job, true);
            job.notified = true;
            this.save(job);
          }
        });
        this.host.changed(job);
      } finally {
        this.live.delete(job.id);
        finish();
      }
    };
    const publish = (
      target: "progress" | "output",
      update: ToolContentUpdate,
    ) => {
      if (controller.signal.aborted || !this.live.has(job.id)) return;
      const parsed = ToolContentUpdateSchema.safeParse(update);
      if (!parsed.success) {
        presentationError = new Error(z.prettifyError(parsed.error));
        controller.abort();
        return;
      }
      const updated = updateContent(job[target], parsed.data);
      job[target] = updated.content;
      if (target === "output")
        job.outputTruncated =
          (parsed.data.mode === "append" && job.outputTruncated) ||
          updated.truncated;
    };
    // A job outlives the activation that started it.
    await withBackgroundLogContext(
      { sessionId, agentId, jobId: job.id },
      async () => {
        logEvent("info", "job.started", { tool: tool.name });
        try {
          const execution = await tool.start(args, {
            workspace,
            signal: controller.signal,
            background: true,
            emitProgress: (update) => publish("progress", update),
            emitOutput: (update) => publish("output", update),
          });
          handle.execution = execution;
          job.status = "running";
          this.save(job);
          this.host.changed(job);
          void execution.completion
            .then(
              (result) => settle(result),
              (error) => settle(undefined, error),
            )
            .catch((error) =>
              logEvent("error", "job.settlement_failed", {}, error),
            );
        } catch (error) {
          await settle(undefined, error);
        }
      },
    );
    return { text: JSON.stringify({ jobId: job.id, status: job.status }) };
  }
  async cancel(owner: string, sessionId: string, id: string) {
    const job = this.read(owner, sessionId, id);
    const handle = this.live.get(job.id);
    if (handle) {
      handle.controller.abort();
      await handle.execution?.cancel();
      await handle.done;
    }
    return this.read(owner, sessionId, id);
  }
  async cancelAgent(owner: string, sessionId: string, agentId?: string) {
    await Promise.all(
      this.list(owner, sessionId)
        .filter((j) => activeJob(j) && (!agentId || j.agentId === agentId))
        .map((j) => this.cancel(owner, sessionId, j.id)),
    );
  }
  remove(owner: string, sessionId: string) {
    for (const job of this.list(owner, sessionId)) this.records.delete(job.id);
    getDb().run("DELETE FROM jobs WHERE session_id=? AND owner_uuid=?", [
      sessionId,
      owner,
    ]);
  }
  recover() {
    for (const row of getDb()
      .query<{ payload: string }, []>("SELECT payload FROM jobs")
      .all()) {
      const job = JobSchema.parse(JSON.parse(row.payload));
      if (activeJob(job)) {
        job.status = "interrupted";
        job.endedAt = Date.now();
        job.error = errorDetails("JOB_INTERRUPTED", { jobId: job.id });
        logEvent("warn", "job.interrupted", {
          sessionId: job.sessionId,
          agentId: job.agentId,
          jobId: job.id,
        });
        transaction(() => {
          this.save(job);
          if (!job.notified) {
            this.host.notify(job, false);
            job.notified = true;
            this.save(job);
          }
        });
      }
    }
  }
}
