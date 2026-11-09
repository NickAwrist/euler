import { useEffect, useState } from "react";
import { type Job, Job_Status } from "../../../src/gen/euler/v1/jobs_pb";
import { JOB_STATUS_LABELS, activeJob } from "../../lib/agentStatus";
import { formatDuration } from "../../lib/formatDuration";
import { optionalMillis, toMillis } from "../../lib/timestamps";
export function JobElapsed({
  job,
  valueOnly = false,
}: { job: Job; valueOnly?: boolean }) {
  const [now, setNow] = useState(Date.now);
  const active = activeJob(job);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const elapsed = Math.max(
    0,
    (optionalMillis(job.endedAt) ?? now) - toMillis(job.createdAt),
  );
  return (
    <span
      className="shrink-0 text-xs text-muted-foreground tabular-nums"
      aria-label="Job elapsed time"
    >
      {!valueOnly &&
        `${active ? "Running for" : job.status === Job_Status.SUCCEEDED ? "Completed in" : "Ran for"} `}
      {elapsed < 1000
        ? "0s"
        : formatDuration(Math.floor(elapsed / 1000) * 1000)}
    </span>
  );
}
