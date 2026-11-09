import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Agent_Kind,
  InboxMessage_Kind,
} from "../../../src/gen/euler/v1/agent_pb";
import type { Event } from "../../../src/gen/euler/v1/events_pb";
import type { ToolApproval } from "../../../src/gen/euler/v1/permissions_pb";
import { Message_Role } from "../../../src/gen/euler/v1/sessions_pb";
import { Step_Kind, Step_Status } from "../../../src/gen/euler/v1/steps_pb";
import { isWorkingAgent } from "../../lib/agentStatus";
import {
  type RuntimeSnapshot,
  fetchRuntime,
  markSessionViewed,
} from "../../persist/agents";
import { subscribeEvents } from "../../persist/events";
import type { Message } from "../../types";
import { type AgentPhases, nextAgentPhases } from "./agentPhases";

const empty = (): RuntimeSnapshot => ({
  agents: [],
  jobs: [],
  activation: undefined,
  queued: [],
  held: false,
  history: [],
  approvals: [],
  sequence: 0n,
});
// Snapshots decode a fresh empty list; one shared value keeps the approvals prop stable.
const noApprovals: ToolApproval[] = [];
export function applyEvent(
  state: RuntimeSnapshot,
  event: Event,
): RuntimeSnapshot {
  if (event.sequence <= state.sequence) return state;
  const next = { ...state, sequence: event.sequence };
  const main = state.agents.find((a) => a.kind === Agent_Kind.MAIN);
  const { payload } = event;
  const activation = state.activation;
  switch (payload.case) {
    case "agentStatus": {
      const agent = payload.value.agent;
      if (!agent) break;
      next.agents = [...state.agents.filter((a) => a.id !== agent.id), agent];
      if (agent.kind === Agent_Kind.MAIN) next.held = agent.held;
      break;
    }
    case "activationStarted":
      if (event.agentId === main?.id)
        next.activation = payload.value.activation;
      break;
    case "delta":
      if (activation && payload.value.activationId === activation.id)
        next.activation = {
          ...activation,
          content: activation.content + payload.value.contentDelta,
          thinking: activation.thinking + payload.value.thinkingDelta,
        };
      break;
    case "step": {
      const { step, position } = payload.value;
      if (!activation || !step || payload.value.activationId !== activation.id)
        break;
      const steps = [...activation.steps];
      steps[position] = step;
      next.activation = {
        ...activation,
        steps,
        ...(step.kind === Step_Kind.LLM_CALL &&
        step.status === Step_Status.RUNNING
          ? { content: "", thinking: "" }
          : {}),
      };
      break;
    }
    case "activationEnded":
      if (payload.value.activationId === activation?.id)
        next.activation = undefined;
      break;
    case "inboxQueued":
      if (event.agentId === main?.id)
        next.queued = [
          ...state.queued,
          ...payload.value.messages.filter(
            (m) => m.kind === InboxMessage_Kind.USER,
          ),
        ];
      break;
    case "transcriptAppended": {
      const message = payload.value.message;
      if (!message) break;
      next.history = [...state.history, message];
      if (message.role === Message_Role.USER)
        next.queued = state.queued.slice(1);
      if (activation)
        next.activation = {
          ...activation,
          content: "",
          thinking: "",
          steps: [],
        };
      break;
    }
    case "approvalRequested": {
      const approval = payload.value.approval;
      if (approval && !state.approvals.some((a) => a.id === approval.id))
        next.approvals = [...state.approvals, approval];
      break;
    }
    case "approvalResolved":
      if (state.approvals.some((a) => a.id === payload.value.approvalId))
        next.approvals = state.approvals.filter(
          (a) => a.id !== payload.value.approvalId,
        );
      break;
  }
  return next;
}

export function useAgentEvents(
  sessionId: string | null,
  setMessages: (messages: Message[]) => void,
  refreshSessions: () => Promise<void>,
) {
  const [state, setState] = useState<RuntimeSnapshot>(empty);
  const [phases, setPhases] = useState<AgentPhases>({});
  const current = useRef({ sessionId, setMessages, refreshSessions });
  const views = useRef(new Map<string, RuntimeSnapshot>());
  const recent = useRef<Event[]>([]);
  const publish = (id: string, value: RuntimeSnapshot) => {
    const previous = views.current.get(id);
    views.current.set(id, value);
    if (current.current.sessionId !== id) return;
    // Events for other agents, such as a subagent's tokens, only advance the sequence.
    if (
      previous &&
      previous.agents === value.agents &&
      previous.activation === value.activation &&
      previous.queued === value.queued &&
      previous.held === value.held &&
      previous.history === value.history &&
      previous.approvals === value.approvals
    )
      return;
    setState(value);
    if (
      previous &&
      previous.history === value.history &&
      !previous.activation === !value.activation
    )
      return;
    current.current.setMessages(value.history);
    if (document.visibilityState === "visible" && !value.activation)
      void markSessionViewed(id)
        .then(current.current.refreshSessions)
        .catch(console.error);
  };
  const refresh = async () => {
    const id = current.current.sessionId;
    if (!id) return;
    let snapshot = await fetchRuntime(id);
    for (const event of recent.current)
      if (event.sessionId === id) snapshot = applyEvent(snapshot, event);
    const previous = views.current.get(id);
    if (!previous || snapshot.sequence >= previous.sequence)
      publish(id, snapshot);
  };
  const refreshRef = useRef(refresh);
  const publishRef = useRef(publish);
  useLayoutEffect(() => {
    current.current = { sessionId, setMessages, refreshSessions };
    refreshRef.current = refresh;
    publishRef.current = publish;
  });
  useEffect(() => {
    setState(sessionId ? (views.current.get(sessionId) ?? empty()) : empty());
    void refreshRef.current().catch(console.error);
  }, [sessionId]);
  useEffect(() => {
    const controller = new AbortController();
    void subscribeEvents(controller.signal, (event) => {
      if (event.payload.case === "resync") {
        views.current.clear();
        recent.current = [];
        setPhases({});
        void refreshRef.current().catch(console.error);
        void current.current.refreshSessions();
        return;
      }
      recent.current.push(event);
      setPhases((current) => nextAgentPhases(current, event));
      if (recent.current.length > 2000) recent.current.shift();
      const view = views.current.get(event.sessionId);
      if (view) publishRef.current(event.sessionId, applyEvent(view, event));
      else if (event.sessionId === current.current.sessionId)
        void refreshRef.current().catch(console.error);
      // The session list only shows whether a chat has working agents.
      const before = view?.agents.find((a) => a.id === event.agentId);
      const { payload } = event;
      if (
        payload.case === "activationEnded" ||
        (payload.case === "agentStatus" &&
          payload.value.agent &&
          (!before ||
            isWorkingAgent(before) !== isWorkingAgent(payload.value.agent)))
      )
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
  // A step event can fill a later position first, leaving holes until the rest arrive.
  const steps = (state.activation?.steps ?? []).filter(Boolean);
  return {
    agents: state.agents,
    jobs: state.jobs,
    phases,
    queued: state.queued,
    held: state.held,
    approvals: state.approvals.length ? state.approvals : noApprovals,
    refresh,
    runPending: state.activation !== undefined,
    streamingContent: state.activation?.content ?? "",
    streamingThinking: state.activation?.thinking ?? "",
    streamingSteps: steps,
    streamingStep: steps.at(-1) ?? null,
  };
}
