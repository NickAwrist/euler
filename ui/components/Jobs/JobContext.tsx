import { createContext, useContext } from "react";
import type { Job } from "../../../src/gen/euler/v1/jobs_pb";
export const JobContext = createContext<{
  jobs: Job[];
  open: (id: string) => void;
  stop: (id: string) => Promise<void>;
}>({ jobs: [], open: () => {}, stop: async () => {} });
export const useJobs = () => useContext(JobContext);
