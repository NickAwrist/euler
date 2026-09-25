import crypto from "node:crypto";
import type { Tool } from "ollama";
import { COMFYUI_VIEW_PREFIX } from "../attachments/types";
import { getComfyUIClient } from "../comfyui/client";
import { buildImageWorkflow } from "../comfyui/workflows";
import {
  getComfyUIDefaultModel,
  getComfyUIImageSize,
  getComfyUINegativePrompt,
} from "../db/index";
import { errorMessage } from "../utils/errors";
import { BaseTool, type ToolResult, textToolResult } from "./BaseTool";

export class GenerateImageTool extends BaseTool {
  constructor() {
    super(
      "generate_image",
      "Generate an image from a text prompt using ComfyUI. Returns the URL of the generated image.",
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
          },
        },
      },
    };
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    if (typeof args.prompt !== "string" || args.prompt.trim().length === 0) {
      return textToolResult("Error: prompt must be a non-empty string");
    }
    const promptText = args.prompt.trim();

    const client = getComfyUIClient();

    return client.runSerialized(async (): Promise<ToolResult> => {
      const health = await client.healthCheck();
      if (!health.ok) {
        return textToolResult(
          `Error: ComfyUI is not reachable - ${health.error ?? "unknown error"}`,
        );
      }

      const defaultModel = getComfyUIDefaultModel();
      let checkpointName = defaultModel;
      if (!checkpointName) {
        const models = await client.getModels();
        if (models.length === 0) {
          return textToolResult("Error: No models available in ComfyUI");
        }
        checkpointName = models[0]!;
      }

      const { width, height } = getComfyUIImageSize();
      const clientId = crypto.randomUUID();

      const workflow = buildImageWorkflow({
        prompt: promptText,
        negativePrompt: getComfyUINegativePrompt(),
        checkpointName,
        width,
        height,
      });

      try {
        await client.connectWebSocket(clientId);
        const response = await client.queuePrompt(workflow, clientId);
        const images = await client.waitForPrompt(response.prompt_id);

        const img = images[0];
        if (!img) {
          return textToolResult(
            "Error: Image generation completed but no images were produced",
          );
        }

        const params = new URLSearchParams({ type: img.type });
        if (img.subfolder) params.set("subfolder", img.subfolder);
        const queryString = params.toString();
        const url = `${COMFYUI_VIEW_PREFIX}${img.filename}${queryString ? `?${queryString}` : ""}`;
        return {
          text: url,
          attachments: [{ kind: "generated_image", url }],
        };
      } catch (e) {
        return textToolResult(`Error generating image: ${errorMessage(e)}`);
      }
    }, "generate_image");
  }
}
