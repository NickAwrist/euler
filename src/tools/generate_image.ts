import type { Tool } from "ollama";
import type { RunContext } from "../RunContext";
import { generateAndStoreImage } from "../imageGen/index";
import { errorMessage } from "../utils/errors";
import { BaseTool, type ToolResult, textToolResult } from "./BaseTool";

export class GenerateImageTool extends BaseTool {
  constructor() {
    super(
      "generate_image",
      "Generate an image from a text prompt and attach it to the reply.",
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
          required: ["prompt"],
          properties: {
            prompt: {
              type: "string",
              description:
                "A detailed text description of the image to generate.",
            },
            aspect_ratio: {
              type: "string",
              description:
                "Optional aspect ratio such as 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, or 2:3.",
            },
          },
        },
      },
    };
  }

  override async execute(
    args: Record<string, unknown>,
    ctx?: RunContext,
  ): Promise<ToolResult> {
    if (typeof args.prompt !== "string" || args.prompt.trim().length === 0) {
      return textToolResult("Error: prompt must be a non-empty string");
    }
    if (!ctx?.ownerUuid || !ctx.sessionId) {
      return textToolResult(
        "Error: image generation requires an active chat session",
      );
    }
    const aspectRatio =
      typeof args.aspect_ratio === "string" && args.aspect_ratio.trim()
        ? args.aspect_ratio.trim()
        : undefined;

    try {
      const { attachment, providerLabel, model } = await generateAndStoreImage({
        ownerUuid: ctx.ownerUuid,
        sessionId: ctx.sessionId,
        prompt: args.prompt.trim(),
        aspectRatio,
        signal: ctx.signal,
      });
      return {
        text: `Generated image "${attachment.name}" with ${providerLabel} (${model}). It is attached to this reply.`,
        attachments: [attachment],
      };
    } catch (error) {
      return textToolResult(`Error generating image: ${errorMessage(error)}`);
    }
  }
}
