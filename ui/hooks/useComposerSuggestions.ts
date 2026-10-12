import { useEffect, useState } from "react";
import type { McpToolData } from "../../src/schemas/mcp";
import {
  collectComposerSuggestions,
  composerSuggestionSources,
  findActiveToolToken,
} from "../components/composerSuggestions";
import type { RunCommandName } from "../components/runCommands";
import { findActiveSkillToken } from "../components/skillPicker";
import { fetchMcpTools } from "../persist/mcpServers";
import { type SkillData, fetchSkills } from "../persist/skills";
import type { SessionWorkspace } from "../types";

export function useComposerSuggestions({
  input,
  caret,
  dismissed,
  busy,
  workspace,
  complete,
  runCommand,
}: {
  input: string;
  caret: number;
  dismissed: boolean;
  busy: boolean;
  workspace: SessionWorkspace;
  complete: (completion: { value: string; caret: number }) => void;
  runCommand: (command: RunCommandName) => void;
}) {
  const [skills, setSkills] = useState<SkillData[]>([]);
  const [tools, setTools] = useState<McpToolData[]>([]);
  const [toolStatus, setToolStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const skillToken = dismissed ? null : findActiveSkillToken(input, caret);
  const toolToken = dismissed ? null : findActiveToolToken(input, caret);
  const discoverTools = toolToken !== null;

  useEffect(() => {
    let cancelled = false;
    void fetchSkills()
      .then((value) => {
        if (!cancelled) setSkills(value);
      })
      .catch(() => {
        if (!cancelled) setSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh on opening the menu so changes to enabled servers are reflected.
  useEffect(() => {
    if (!discoverTools) return;
    const controller = new AbortController();
    setTools([]);
    setToolStatus("loading");
    void fetchMcpTools(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setTools(value);
          setToolStatus("ready");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setToolStatus("error");
      });
    return () => controller.abort();
  }, [discoverTools]);

  const options = dismissed
    ? []
    : collectComposerSuggestions(composerSuggestionSources, {
        input,
        workspace,
        busy,
        skills,
        tools,
        skillToken,
        toolToken,
        complete,
        runCommand,
      });
  return {
    options,
    id: skillToken ? "skill-picker" : "command-picker",
    label: skillToken ? "Available skills" : "Commands and MCP tools",
    resetKey: skillToken?.query ?? toolToken?.query,
    open: options.length > 0 || toolToken !== null,
    status: toolToken
      ? toolStatus === "loading"
        ? "Loading MCP tools..."
        : toolStatus === "error"
          ? "Could not load MCP tools"
          : options.length === 0
            ? "No matching commands or MCP tools"
            : undefined
      : undefined,
  };
}
