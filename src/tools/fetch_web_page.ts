import type { Tool } from "ollama";
import { envConfig } from "../env";
import { errorMessage } from "../utils/errors";
import { BaseTool, type ToolResult, textToolResult } from "./BaseTool";

const MAX_CONTENT_LENGTH = 16000;

export class FetchWebPageTool extends BaseTool {
  constructor() {
    super(
      "fetch_web_page",
      "Fetch and read the full text content of a web page URL as markdown.",
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
          required: ["url"],
          properties: {
            url: {
              type: "string",
              description: "The HTTP or HTTPS URL of the web page to read.",
            },
          },
        },
      },
    };
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    let targetUrl: URL;
    try {
      if (
        typeof args.url !== "string" ||
        !/^https?:\/\//i.test(args.url.trim())
      ) {
        throw new Error("Invalid URL");
      }
      targetUrl = new URL(args.url.trim());
      if (targetUrl.username || targetUrl.password) {
        return textToolResult("Error: URL must not contain credentials");
      }
    } catch {
      return textToolResult("Error: url must be a valid HTTP or HTTPS URL");
    }

    try {
      const headers: Record<string, string> = {
        Accept: "text/plain, text/markdown",
      };
      if (envConfig.jinaApiKey) {
        headers.Authorization = `Bearer ${envConfig.jinaApiKey}`;
      }
      const response = await fetch(`https://r.jina.ai/${targetUrl.href}`, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        throw new Error(`Jina Reader returned HTTP ${response.status}`);
      }

      const content = await response.text();
      return textToolResult(
        content.length > MAX_CONTENT_LENGTH
          ? `${content.slice(0, MAX_CONTENT_LENGTH)}\n\n[Content truncated to ${MAX_CONTENT_LENGTH} characters.]`
          : content,
      );
    } catch (error: unknown) {
      return textToolResult(`Error fetching web page: ${errorMessage(error)}`);
    }
  }
}
