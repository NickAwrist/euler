import { jobClient } from "../lib/rpc";

export async function cancelJob(sessionId: string, jobId: string) {
  return (await jobClient.cancelJob({ sessionId, jobId })).job!;
}

export async function fetchJob(
  sessionId: string,
  jobId: string,
  signal?: AbortSignal,
) {
  return (await jobClient.getJob({ sessionId, jobId }, { signal })).job!;
}
