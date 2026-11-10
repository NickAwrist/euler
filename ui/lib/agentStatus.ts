import { type Agent, Agent_Status } from "../../src/gen/euler/v1/agent_pb";
import { type Job, Job_Status } from "../../src/gen/euler/v1/jobs_pb";

/** Completed or cancelled: the agent will not run again. */
export const isFinalAgent = (agent: Pick<Agent, "status">) =>
  agent.status === Agent_Status.COMPLETED ||
  agent.status === Agent_Status.CANCELLED;

/** Queued, running, or blocked on a reply. A ready subagent is idle. */
export const isWorkingAgent = (agent: Pick<Agent, "status">) =>
  agent.status === Agent_Status.QUEUED ||
  agent.status === Agent_Status.RUNNING ||
  agent.status === Agent_Status.WAITING;

export const activeJob = (job: Pick<Job, "status">) =>
  job.status === Job_Status.STARTING || job.status === Job_Status.RUNNING;

/** How a job's status reads in the jobs panel. */
export const JOB_STATUS_LABELS: Record<Job_Status, string> = {
  [Job_Status.UNSPECIFIED]: "",
  [Job_Status.STARTING]: "starting",
  [Job_Status.RUNNING]: "running",
  [Job_Status.SUCCEEDED]: "succeeded",
  [Job_Status.FAILED]: "failed",
  [Job_Status.CANCELLED]: "cancelled",
  [Job_Status.INTERRUPTED]: "interrupted",
};
