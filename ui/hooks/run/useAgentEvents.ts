import { useEffect, useRef, useState } from "react";
import type { AgentEvent } from "../../../src/schemas/events";
import { agentAction } from "../../persist/agents";
import { type RuntimeSnapshot, fetchRuntime } from "../../persist/agents";
import { subscribeEvents } from "../../persist/events";
import type { Message, MessageStep } from "../../types";

const empty = (): RuntimeSnapshot => ({
  agents: [],
  activation: null,
  queued: [],
  held: false,
  history: [],
  sequence: 0,
});
function applyEvent(
  state: RuntimeSnapshot,
  event: AgentEvent,
): RuntimeSnapshot {
  if (event.sequence <= state.sequence) return state;
  const next = { ...state, sequence: event.sequence };
  const main = state.agents.find((a) => a.kind === "main");
  if (event.type === "agent_status") {
    next.agents = [
      ...state.agents.filter((a) => a.id !== event.agent.id),
      event.agent,
    ];
    if (event.agent.kind === "main") next.held = event.agent.held;
  }
  if (event.type === "activation_started" && event.agentId === main?.id)
    next.activation = event.activation;
  if (event.type === "delta" && event.activationId === state.activation?.id)
    next.activation = {
      ...state.activation,
      content: state.activation.content + event.contentDelta,
      thinking: state.activation.thinking + event.thinkingDelta,
    };
  if (event.type === "step" && event.activationId === state.activation?.id) {
    const step = event.steps.at(-1);
    next.activation = {
      ...state.activation,
      steps: event.steps,
      ...(step?.kind === "llm_call" && step.status === "running"
        ? { content: "", thinking: "" }
        : {}),
    };
  }
  if (
    event.type === "activation_ended" &&
    event.activationId === state.activation?.id
  )
    next.activation = null;
  if (event.type === "inbox_queued" && event.agentId === main?.id)
    next.queued = [
      ...state.queued,
      ...event.messages.filter((m) => m.kind === "user"),
    ];
  if (event.type === "transcript_appended") {
    next.history = [...(state.history ?? []), event.message];
    if (event.message.role === "user") next.queued = state.queued.slice(1);
    if (state.activation)
      next.activation = {
        ...state.activation,
        content: "",
        thinking: "",
        steps: [],
      };
  }
  return next;
}

export function useAgentEvents(
  sessionId: string | null,
  temporary: boolean,
  setMessages: (messages: Message[]) => void,
  refreshSessions: () => Promise<void>,
) {
  const [state, setState] = useState<RuntimeSnapshot>(empty);
  const current = useRef({
    sessionId,
    temporary,
    setMessages,
    refreshSessions,
  });
  current.current = { sessionId, temporary, setMessages, refreshSessions };
  const views = useRef(new Map<string, RuntimeSnapshot>());
  const recent = useRef<AgentEvent[]>([]);
  const publish = (id: string, value: RuntimeSnapshot) => {
    views.current.set(id, value);
    if (current.current.sessionId !== id) return;
    setState(value);
    current.current.setMessages((value.history ?? []) as Message[]);
    if (
      !current.current.temporary &&
      document.visibilityState === "visible" &&
      !value.activation
    )
      void agentAction(id, "viewed")
        .then(current.current.refreshSessions)
        .catch(console.error);
  };
  const refresh = async () => {
    const { sessionId: id, temporary: ephemeral } = current.current;
    if (!id) return;
    let snapshot = await fetchRuntime(id, ephemeral);
    for (const event of recent.current)
      if (event.sessionId === id) snapshot = applyEvent(snapshot, event);
    const previous = views.current.get(id);
    if (!previous || snapshot.sequence >= previous.sequence)
      publish(id, snapshot);
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const publishRef = useRef(publish);
  publishRef.current = publish;
  useEffect(() => {
    setState(sessionId ? (views.current.get(sessionId) ?? empty()) : empty());
    void refreshRef.current().catch(console.error);
  }, [sessionId, temporary]);
  useEffect(() => {
    const controller = new AbortController();
    void subscribeEvents(controller.signal, (event) => {
      if (event.type === "resync") {
        views.current.clear();
        recent.current = [];
        void refreshRef.current().catch(console.error);
        void current.current.refreshSessions();
        return;
      }
      recent.current.push(event);
      if (recent.current.length > 2000) recent.current.shift();
      const view = views.current.get(event.sessionId);
      if (view) publishRef.current(event.sessionId, applyEvent(view, event));
      else if (event.sessionId === current.current.sessionId)
        void refreshRef.current().catch(console.error);
      if (event.type === "activation_ended" || event.type === "agent_status")
        void current.current.refreshSessions();
    });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === "visible")
        void refreshRef.current().catch(console.error);
    };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, []);
  const steps = (state.activation?.steps ?? []).filter(
    (step): step is Record<string, unknown> & MessageStep =>
      typeof step.kind === "string",
  );
  return {
    agents: state.agents,
    queued: state.queued,
    held: state.held,
    refresh,
    runPending: state.activation !== null,
    streamingContent: state.activation?.content ?? "",
    streamingThinking: state.activation?.thinking ?? "",
    streamingSteps: steps,
    streamingStep: steps.at(-1) ?? null,
  };
}
