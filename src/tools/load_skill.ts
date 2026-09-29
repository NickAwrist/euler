import type { Tool } from "ollama";
import type { SkillRow } from "../db/index";
import { BaseTool, type ToolResult, textToolResult } from "./BaseTool";

export class LoadSkillTool extends BaseTool {
  private readonly skillsByName: ReadonlyMap<string, SkillRow>;

  constructor(skills: readonly SkillRow[]) {
    super(
      "load_skill",
      "Load the full instructions for an available user skill before applying it.",
    );
    this.skillsByName = new Map(skills.map((skill) => [skill.name, skill]));
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
            name: {
              type: "string",
              description: "Exact skill name from <available_skills>.",
            },
          },
          required: ["name"],
        },
      },
    };
  }

  override async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const name = typeof args.name === "string" ? args.name.trim() : "";
    if (!name) return textToolResult("Error: skill name is required");
    const skill = this.skillsByName.get(name);
    if (!skill) return textToolResult(`Error: skill '${name}' not found`);
    return textToolResult(
      JSON.stringify({
        name: skill.name,
        instructions: skill.instructions,
      }),
    );
  }
}
