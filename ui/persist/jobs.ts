import { JobSchema } from "../../src/schemas/jobs";
import { apiJson } from "../lib/api";
import { runtimePath } from "./agents";
export async function cancelJob(id: string, jobId: string) {
  return JobSchema.parse(
    await apiJson(
      `${runtimePath(id)}/jobs/${encodeURIComponent(jobId)}/cancel`,
      {
        method: "POST",
      },
    ),
  );
}
export async function fetchJob(
  id: string,
  jobId: string,
  signal?: AbortSignal,
) {
  return JobSchema.parse(
    await apiJson(`${runtimePath(id)}/jobs/${encodeURIComponent(jobId)}`, {
      signal,
    }),
  );
}
