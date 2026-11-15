import { type SkillRow, listSkills } from "../db/index";
import { MANAGE_SUBAGENTS_SKILL_NAME } from "../skills/defaults";
import { modelInvocableSkills, renderSkillsPrompt } from "../skills/runtime";
import { LoadSkillTool } from "../tools/load_skill";
import { ManageSkillsTool } from "../tools/manage_skills";
import {
  CAPABLE,
  type Capability,
  Feature,
  type FeatureRun,
  type FeatureScope,
  type FeatureTools,
} from "./Feature";

/** On whenever the user has a skill; there is no switch. */
export class SkillsFeature extends Feature {
  readonly id = "skills";
  readonly label = "Skills";
  readonly description = "Instructions the agent loads for specialized tasks.";
  readonly toolNames = ["load_skill", "manage_skills"];

  async capable(): Promise<Capability> {
    return CAPABLE;
  }

  enabled(ownerUuid: string): boolean {
    return listSkills(ownerUuid).length > 0;
  }

  override prompt(scope: FeatureScope, userPrompt: string): string {
    return renderSkillsPrompt(this.skills(scope), userPrompt);
  }

  override async tools(run: FeatureRun): Promise<FeatureTools> {
    const loadable = modelInvocableSkills(this.skills(run));
    return {
      tools: [
        ...(loadable.length > 0 ? [new LoadSkillTool(loadable)] : []),
        // Skills persist into later chats, so only the user's own agent edits them.
        ...(run.agentKind === "main"
          ? [new ManageSkillsTool(run.ownerUuid)]
          : []),
      ],
    };
  }

  private skills({ ownerUuid, agentKind, active }: FeatureScope): SkillRow[] {
    const skills = listSkills(ownerUuid);
    const canSpawn = agentKind === "main" && active.has("subagents");
    // A subagent's task is written by the model, so its $skill-name references
    // are model invocations too.
    return (
      agentKind === "main" ? skills : modelInvocableSkills(skills)
    ).filter((skill) => canSpawn || skill.name !== MANAGE_SUBAGENTS_SKILL_NAME);
  }
}
