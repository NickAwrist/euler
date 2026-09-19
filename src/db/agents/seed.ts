import type { Database } from "bun:sqlite";
import crypto from "node:crypto";

const DEFAULT_AGENTS: Array<{
  name: string;
  description: string;
  system_prompt: string;
  tools: string[];
  delegates: string[];
}> = [
  {
    name: "general_agent",
    description:
      "Orchestrator agent that answers questions directly or delegates to specialized subagents.",
    tools: ["web_search", "fetch_web_page"],
    delegates: ["system_agent"],
    system_prompt: [
      "You are the orchestrator agent. You answer the user's request directly when you can, and delegate to your tools when the task requires capabilities you do not have.",
      "",
      "<delegation>",
      "When delegating, write a self-contained task description. Include all relevant context, file paths, code snippets, and exact success criteria so the subagent can complete the work without follow-up questions.",
      "You may chain multiple tool calls to accomplish complex tasks.",
      "</delegation>",
      "",
      "<response_rules>",
      "- Answer simple factual or conversational questions yourself without delegating.",
      "- After a tool returns, review its output. If the result is incomplete or contains errors, either retry with a corrected task or inform the user of what went wrong.",
      "- Be concise. Avoid restating entire tool output when a short summary and the key result suffice.",
      "- When presenting code, file contents, or command output, include the actual content - do not describe it abstractly.",
      "</response_rules>",
      "",
      "{{PERSONALIZATION}}",
    ].join("\n"),
  },
  {
    name: "system_agent",
    description:
      "Uses contained shell and file tools in the active chat workspace. Provide a self-contained task description with the expected output or deliverable.",
    tools: ["bash", "apply_patch"],
    delegates: [],
    system_prompt: [
      "You are a system agent with contained shell and file access to the active chat workspace.",
      "",
      "<execution_rules>",
      "- Before running a destructive command (rm, overwrite, etc.), verify the target path exists and is correct.",
      "- If a command fails, read the error output carefully. Fix the issue (wrong path, missing dependency, permission) and retry - do not repeat the identical failing command.",
      "- For multi-step tasks, execute one step at a time and verify the result before proceeding.",
      "- Prefer simple, portable commands. Avoid unnecessary pipes or one-liners when clarity matters.",
      "</execution_rules>",
      "",
      "<output_rules>",
      "Your response is consumed by the orchestrator agent, not a human.",
      '- When asked to read files, list directories, or retrieve information: include the FULL, VERBATIM content in your response. Never summarize or say "I have read the file" without including its contents.',
      "- When asked to execute a command: include the complete stdout/stderr output.",
      "- When asked to perform an action (install, move, delete): confirm what was done and include any relevant output that proves success or shows failure.",
      "</output_rules>",
      "",
      "{{SESSION_DIRECTORY}}",
      "",
      "{{OS}}",
    ].join("\n"),
  },
];

export function seedDefaultAgents(db: Database, ownerUuid: string) {
  const count = db
    .query("SELECT COUNT(*) as c FROM agents WHERE owner_uuid = ?")
    .get(ownerUuid) as {
    c: number;
  };
  if (count.c > 0) return;

  const now = Date.now();
  const insertAgent = db.prepare(
    "INSERT INTO agents (id, owner_uuid, name, description, system_prompt, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
  );
  const insertTool = db.prepare(
    "INSERT INTO agent_tools (agent_id, tool_name, position) VALUES (?, ?, ?)",
  );
  const insertDelegation = db.prepare(
    "INSERT INTO agent_delegations (source_agent_id, target_agent_id, position) VALUES (?, ?, ?)",
  );

  const tx = db.transaction(() => {
    const agentIds = new Map<string, string>();
    for (const a of DEFAULT_AGENTS) {
      const id = crypto.randomUUID();
      agentIds.set(a.name, id);
      insertAgent.run(
        id,
        ownerUuid,
        a.name,
        a.description,
        a.system_prompt,
        now,
        now,
      );
    }
    for (const a of DEFAULT_AGENTS) {
      const id = agentIds.get(a.name);
      if (!id) throw new Error(`Missing seeded agent ID for ${a.name}`);
      a.tools.forEach((t, i) => insertTool.run(id, t, i));
      a.delegates.forEach((name, position) => {
        const targetId = agentIds.get(name);
        if (!targetId) throw new Error(`Missing seeded agent ID for ${name}`);
        insertDelegation.run(id, targetId, position);
      });
    }
  });
  tx();
}
