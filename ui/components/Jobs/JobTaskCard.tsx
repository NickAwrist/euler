import { Activity, ChevronRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { type Job, activeJob } from "../../../src/schemas/jobs";
import type { Diagnostic } from "../../../src/schemas/observability";
import { toDiagnostic } from "../../lib/apiError";
import { chipSurface, cx } from "../../styles";
import { Button } from "../Button";
import { ErrorNotice } from "../ErrorNotice";
import { useJobs } from "./JobContext";
import { JobElapsed } from "./JobElapsed";

export function JobCancelButton({ job }: { job: Job }) {
  const { stop } = useJobs();
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<Diagnostic | null>(null);
  if (!activeJob(job)) return null;
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        loading={cancelling}
        onClick={() => {
          setCancelling(true);
          setError(null);
          void stop(job.id)
            .catch((error) => setError(toDiagnostic(error)))
            .finally(() => setCancelling(false));
        }}
      >
        Cancel job
      </Button>
      {error && <ErrorNotice error={error} />}
    </>
  );
}
export function JobTaskCard({
  job,
  inline = false,
}: { job: Job; inline?: boolean }) {
  const { open } = useJobs();
  const Icon = activeJob(job) ? Loader2 : Activity;
  return (
    <div
      className={cx(
        "my-2 flex max-w-full items-center gap-1 pr-1.5",
        inline
          ? cx(chipSurface, "w-fit")
          : "rounded-lg border border-border-subtle",
      )}
    >
      <button
        type="button"
        onClick={() => open(job.id)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-muted/50"
      >
        <Icon
          size={16}
          className={cx(
            "shrink-0 text-muted-foreground",
            activeJob(job) && "animate-spin motion-reduce:animate-none",
          )}
        />
        <span className="min-w-0">
          <span className="block text-xs">
            {job.tool} · {job.status}
          </span>
          <span
            className="block truncate font-mono text-xs text-muted-foreground"
            title={job.description}
          >
            {job.description}
          </span>
          <JobElapsed job={job} />
        </span>
        <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
      </button>
      <JobCancelButton job={job} />
    </div>
  );
}
export function JobRows({ position }: { position: number }) {
  const { jobs } = useJobs();
  return jobs
    .filter((job) => job.spawnPosition === position)
    .map((job) => <JobTaskCard key={job.id} job={job} inline />);
}
