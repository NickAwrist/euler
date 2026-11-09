import type { ServiceImpl } from "@connectrpc/connect";
import { agentRuntime } from "../agents/runtime/AgentRuntime";
import type { JobService } from "../gen/euler/v1/jobs_pb";
import { OperationError } from "../observability/errors";
import { ownedSession } from "./context";
import { job } from "./wire";

const notFound = () =>
  new OperationError("NOT_FOUND", { message: "Job not found" });

export const jobService: ServiceImpl<typeof JobService> = {
  listJobs(request, context) {
    const { owner_uuid: owner, id } = ownedSession(context, request.sessionId);
    return { jobs: agentRuntime.jobs.list(owner, id).map(job) };
  },
  getJob(request, context) {
    const { owner_uuid: owner, id } = ownedSession(context, request.sessionId);
    try {
      return { job: job(agentRuntime.jobs.read(owner, id, request.jobId)) };
    } catch {
      throw notFound();
    }
  },
  async cancelJob(request, context) {
    const { owner_uuid: owner, id } = ownedSession(context, request.sessionId);
    let cancelled: Awaited<ReturnType<typeof agentRuntime.jobs.cancel>>;
    try {
      cancelled = await agentRuntime.jobs.cancel(owner, id, request.jobId);
    } catch {
      throw notFound();
    }
    return { job: job(cancelled) };
  },
};
