import { useJobs } from "./JobContext";
import { JobTaskCard } from "./JobTaskCard";
export function JobsList() {
  const { jobs } = useJobs();
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3" aria-label="Jobs">
      {!jobs.length && (
        <p className="text-sm text-muted-foreground">
          No background jobs in this chat.
        </p>
      )}
      {jobs.map((job) => (
        <JobTaskCard key={job.id} job={job} />
      ))}
    </div>
  );
}
