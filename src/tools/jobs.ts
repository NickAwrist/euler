import type { Tool } from "ollama";
import { z } from "zod";
import type { Job } from "../schemas/jobs";
import { BaseTool, parseToolArgs } from "./BaseTool";
export class JobTool extends BaseTool {
  constructor(
    name: "get_job" | "cancel_job",
    private action: (id: string) => Promise<Job> | Job,
  ) {
    super(
      name,
      name === "get_job"
        ? "Inspect a background job's status and current retained output."
        : "Cancel a background job and await process cleanup.",
    );
  }
  override toTool(): Tool {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: "object",
          properties: {
            jobId: { type: "string" },
          },
          required: ["jobId"],
        },
      },
    };
  }
  override async execute(args: Record<string, unknown>) {
    const { jobId } = parseToolArgs(
      z.object({
        jobId: z.string().min(1),
      }),
      args,
    );
    return { text: JSON.stringify(await this.action(jobId)) };
  }
}
