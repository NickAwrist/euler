import { useEffect, useState } from "react";
import { type Job, activeJob } from "../../../src/schemas/jobs";
import type { Diagnostic } from "../../../src/schemas/observability";
import { toDiagnostic } from "../../lib/apiError";
import { fetchJob } from "../../persist/jobs";
import { ErrorNotice } from "../ErrorNotice";
import { Modal } from "../Modal";
import { JobElapsed } from "./JobElapsed";
import { JobCancelButton } from "./JobTaskCard";
import { ToolContentView } from "./ToolContentView";

export function JobTraceModal({
  sessionId,
  job,
  onClose,
}: { sessionId: string; job: Job; onClose: () => void }) {
  const [detail, setDetail] = useState<Job | null>(null);
  const [error, setError] = useState<Diagnostic | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      let polling = activeJob(job);
      try {
        const updated = await fetchJob(sessionId, job.id, controller.signal);
        if (!controller.signal.aborted) {
          setDetail(updated);
          setError(null);
        }
        polling = activeJob(updated);
      } catch (error) {
        if (!controller.signal.aborted) setError(toDiagnostic(error));
      }
      if (polling && !controller.signal.aborted)
        timer = setTimeout(refresh, 1000);
    };
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [sessionId, job.id, job.status]);
  const current = detail ?? job;
  const running = activeJob(current);
  return (
    <Modal
      title="Job details"
      subtitle={`${current.tool} · ${current.status}`}
      onClose={onClose}
      maxWidthClass="max-w-[800px]"
      headerActions={<JobCancelButton job={current} />}
    >
      <div className="min-h-0 overflow-auto p-4 text-sm space-y-4">
        {error && <ErrorNotice error={error} />}
        <section aria-label="Job timing">
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
            Timing
          </h3>
          <dl className="grid gap-3 rounded-lg border border-border-subtle p-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Started</dt>
              <dd className="mt-1 text-xs">
                <time dateTime={new Date(current.createdAt).toISOString()}>
                  {new Date(current.createdAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "long",
                  })}
                </time>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Finished</dt>
              <dd className="mt-1 text-xs">
                {current.endedAt !== null ? (
                  <time dateTime={new Date(current.endedAt).toISOString()}>
                    {new Date(current.endedAt).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "long",
                    })}
                  </time>
                ) : (
                  "Still running"
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {running ? "Elapsed" : "Duration"}
              </dt>
              <dd className="mt-1">
                <JobElapsed job={current} valueOnly />
              </dd>
            </div>
          </dl>
        </section>
        <section aria-label="Job input">
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
            Input
          </h3>
          <ToolContentView content={current.input} />
        </section>
        {running && current.progress && current.progress.blocks.length > 0 && (
          <section aria-label="Job progress">
            <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
              Progress
            </h3>
            <ToolContentView content={current.progress} />
          </section>
        )}
        <section aria-label="Job output">
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
            Output
          </h3>
          {current.outputTruncated && (
            <p className="mb-2 text-xs text-muted-foreground">
              Earlier output was discarded.
            </p>
          )}
          {current.output ? (
            <ToolContentView content={current.output} />
          ) : (
            <p className="text-xs text-muted-foreground">
              {running ? "Pending" : "No output reported."}
            </p>
          )}
        </section>
        {current.metadata && current.metadata.blocks.length > 0 && (
          <details
            aria-label="Job metadata"
            className="border-t border-border-subtle pt-3"
          >
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              Metadata
            </summary>
            <div className="mt-3">
              <ToolContentView content={current.metadata} />
            </div>
          </details>
        )}
        {current.error && <ErrorNotice error={current.error} />}
      </div>
    </Modal>
  );
}
