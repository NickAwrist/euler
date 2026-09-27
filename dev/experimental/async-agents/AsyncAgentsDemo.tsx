import { Bot, FileText } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../ui/components/Button";
import { AgentTaskCard, type MockAgentStatus } from "../shared/AgentTaskCard";
import {
  AssistantMessage,
  Composer,
  type MockChat,
  MockShell,
  UserMessage,
} from "../shared/MockShell";
import { AgentsPanel, type InboxEntry, type MockAgent } from "./AgentsPanel";
import "./async-agents.css";

type Scene = "started" | "chatting" | "question" | "inflight" | "finished";
const scenes: { id: Scene; label: string }[] = [
  { id: "started", label: "Background agent" },
  { id: "chatting", label: "Chat while it works" },
  { id: "question", label: "Agent asks Euler" },
  { id: "inflight", label: "Finishes mid-reply" },
  { id: "finished", label: "Finishes while idle" },
];
const chatTitle = "Email worker queue";
const chats: MockChat[] = [
  { title: chatTitle },
  { title: "Check the latest deployment", badge: "needs-you" },
  { title: "Nightly error report", badge: "unread" },
  { title: "Draft the release notes", badge: "running" },
];

const benchTask: InboxEntry = {
  from: "Euler",
  kind: "Task",
  wakes: true,
  text: "Benchmark BullMQ, Bee-Queue, and pg-boss in /workspace. Enqueue 10,000 email-sized jobs per library and measure throughput and p99 latency. Recommend one for the email worker and save the scripts in bench/queues/.",
};
const progress: InboxEntry[] = [
  {
    from: "Research agent",
    kind: "Progress",
    wakes: false,
    text: "BullMQ done: 11,200 jobs/s, p99 38 ms.",
  },
  {
    from: "Research agent",
    kind: "Progress",
    wakes: false,
    text: "Bee-Queue done: 9,800 jobs/s, p99 41 ms.",
  },
];
const question: InboxEntry = {
  from: "Research agent",
  kind: "Question",
  wakes: true,
  text: "pg-boss needs Postgres. Should I start the Postgres container from docker-compose.yml, or skip pg-boss?",
};
const reply: InboxEntry = {
  from: "Euler",
  kind: "Reply",
  wakes: true,
  text: "The user says to start the container.",
};
const benchResult: InboxEntry = {
  from: "Research agent",
  kind: "Result",
  wakes: true,
  text: "BullMQ: 11,200 jobs/s, p99 38 ms. Bee-Queue: 9,800 jobs/s, p99 41 ms, unmaintained since 2023. pg-boss: 2,100 jobs/s, p99 120 ms, reuses existing Postgres. Recommend BullMQ. Scripts in bench/queues/.",
};
const benchSteps = [
  "bash · docker compose up -d redis",
  "create_file · bench/queues/bullmq.ts",
  "bash · bun bench/queues/bullmq.ts",
  "send_message · progress to Euler",
  "create_file · bench/queues/bee-queue.ts",
  "bash · bun bench/queues/bee-queue.ts",
  "send_message · progress to Euler",
  "ask_parent · Postgres for pg-boss?",
  "bash · docker compose up -d postgres",
  "bash · bun bench/queues/pg-boss.ts",
];
function notesAgent(delivered: boolean): MockAgent {
  return {
    id: "notes",
    title: "Check @acme/mailer 3.0 release notes",
    status: "completed",
    elapsed: "0m 41s",
    activity: delivered
      ? "Found one breaking change"
      : "Result queued for Euler's next step",
    inbox: [
      {
        from: "Euler",
        kind: "Task",
        wakes: true,
        text: "Read the @acme/mailer 3.0 release notes and list breaking changes that could affect an email worker's retry and connection settings.",
      },
      {
        from: "Research agent",
        kind: "Result",
        wakes: true,
        text: "One relevant breaking change: retry.backoff is now in milliseconds instead of seconds. Connection options are unchanged.",
        queued: !delivered,
      },
    ],
    steps: [
      "fetch_web_page · acme.example.test/mailer/releases/3.0",
      "fetch_web_page · acme.example.test/mailer/migrating-to-3",
    ],
  };
}

function benchAgent(scene: Scene, answered: boolean): MockAgent {
  const common = { id: "bench", title: "Benchmark queue libraries" };
  switch (scene) {
    case "started":
      return {
        ...common,
        status: "running",
        elapsed: "0m 48s",
        activity: "Running BullMQ throughput test",
        inbox: [benchTask],
        steps: benchSteps.slice(0, 3),
      };
    case "chatting":
      return {
        ...common,
        status: "running",
        elapsed: "4m 02s",
        activity: "Running pg-boss throughput test (3 of 3)",
        inbox: [benchTask, ...progress],
        steps: benchSteps.slice(0, 7),
      };
    case "question":
      return answered
        ? {
            ...common,
            status: "running",
            elapsed: "4m 40s",
            activity: "Starting Postgres container",
            inbox: [benchTask, ...progress, question, reply],
            steps: benchSteps.slice(0, 9),
          }
        : {
            ...common,
            status: "waiting",
            elapsed: "4m 31s",
            activity: "Waiting for an answer from Euler",
            inbox: [benchTask, ...progress, question],
            steps: benchSteps.slice(0, 8),
          };
    default:
      return {
        ...common,
        status: "completed",
        elapsed: "6m 12s",
        activity: "Results in bench/queues/",
        inbox: [benchTask, ...progress, question, reply, benchResult],
        steps: benchSteps,
      };
  }
}

function params() {
  return new URLSearchParams(window.location.search);
}

function initialScene(): Scene {
  const value = params().get("scene");
  return scenes.find((scene) => scene.id === value)?.id ?? "started";
}

export default function AsyncAgentsDemo() {
  const [scene, setScene] = useState<Scene>(initialScene);
  const [answered, setAnswered] = useState(false);
  const [delivered, setDelivered] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [panelOpen, setPanelOpen] = useState(() => params().has("panel"));
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    params().get("panel") === "detail"
      ? initialScene() === "inflight"
        ? "notes"
        : "bench"
      : null,
  );

  function switchScene(next: Scene) {
    setScene(next);
    setAnswered(false);
    setDelivered(false);
    setStopped(false);
    setSelectedId(null);
  }
  function openAgent(id: string) {
    setSelectedId(id);
    setPanelOpen(true);
  }

  const base =
    scene === "inflight" ? notesAgent(delivered) : benchAgent(scene, answered);
  const agent: MockAgent = stopped
    ? {
        ...base,
        status: "cancelled",
        activity: "Stopped. Partial results are in bench/queues/.",
      }
    : base;
  const live = agent.status === "running" || agent.status === "waiting";
  const status: MockAgentStatus = agent.status;

  return (
    <MockShell
      title="Async agents"
      scenes={scenes}
      scene={scene}
      onScene={switchScene}
      chats={chats}
      activeChat={chatTitle}
      headerAside={
        <span>
          <Button
            size="sm"
            variant="ghost"
            icon={Bot}
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen(!panelOpen)}
          >
            {live ? "1 background agent" : "Agents"}
          </Button>
        </span>
      }
      footerActions={
        <>
          {scene === "question" && !answered && !stopped && (
            <Button size="sm" variant="ghost" onClick={() => setAnswered(true)}>
              Simulate your answer
            </Button>
          )}
          {scene === "inflight" && !delivered && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDelivered(true)}
            >
              Simulate step boundary
            </Button>
          )}
        </>
      }
      sidePanel={
        panelOpen && (
          <AgentsPanel
            agents={[agent]}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onStop={() => setStopped(true)}
            onClose={() => setPanelOpen(false)}
          />
        )
      }
    >
      <div className="mock-workspace">
        {scene === "inflight" ? (
          <section aria-label="Conversation">
            <UserMessage>
              Check whether @acme/mailer 3.0 has breaking changes that affect my
              email worker, and review the worker config while you're at it.
            </UserMessage>
            <AssistantMessage>
              <p>
                I've started a research agent on the 3.0 release notes. While it
                reads them, I'll review your worker config.
              </p>
            </AssistantMessage>
            <AgentTaskCard
              kind="general"
              title={agent.title}
              status={status}
              onDetails={() => openAgent(agent.id)}
            />
            <ol className="mock-reply-steps" aria-label="Euler's steps">
              <li>
                <FileText size={14} /> Read src/worker/config.ts
              </li>
              <li data-running={!delivered || undefined}>
                <FileText size={14} /> Read src/worker/send.ts
                {!delivered && <span> · running</span>}
              </li>
            </ol>
            {delivered ? (
              <>
                <div className="mock-assistant-continued">
                  <p>
                    The release notes list one breaking change that affects you:
                    retry.backoff is now in milliseconds instead of seconds.
                    Your config sets backoff: 30, which 3.0 would read as 30 ms.
                    Change it to 30000 before upgrading.
                  </p>
                  <p>Nothing else in the worker config is affected.</p>
                </div>
              </>
            ) : null}
          </section>
        ) : (
          <section aria-label="Conversation">
            <UserMessage>
              Benchmark BullMQ, Bee-Queue, and pg-boss in my workspace and
              recommend one for the email worker.
            </UserMessage>
            <AssistantMessage>
              <p>
                I've started a research agent to set up and benchmark all three.
                It usually takes a few minutes. You can keep chatting, and I'll
                come back with a recommendation when it finishes.
              </p>
            </AssistantMessage>
            <AgentTaskCard
              kind="general"
              title={agent.title}
              status={status}
              onDetails={() => openAgent(agent.id)}
              onStop={() => setStopped(true)}
            />
            {scene === "chatting" && (
              <>
                <UserMessage>
                  While that runs: what's the difference between at-least-once
                  and exactly-once delivery?
                </UserMessage>
                <AssistantMessage>
                  <p>
                    At-least-once delivery retries a job until a worker
                    acknowledges it, so a crash can make a job run twice.
                    Exactly-once needs the queue and the handler's side effects
                    to commit together, which few queues can promise.
                  </p>
                  <p>
                    In practice you get at-least-once and make handlers
                    idempotent, for example by recording sent email IDs.
                  </p>
                </AssistantMessage>
                <UserMessage>How's the benchmark going?</UserMessage>
                <AssistantMessage>
                  <p>
                    Two of three are done. BullMQ handled about 11,200 jobs/s
                    and Bee-Queue about 9,800. It's running the pg-boss test
                    now.
                  </p>
                </AssistantMessage>
              </>
            )}
            {scene === "question" && (
              <>
                <AssistantMessage>
                  <p>
                    The research agent needs a decision before it can test
                    pg-boss: should it start the Postgres container defined in
                    your docker-compose.yml, or skip pg-boss?
                  </p>
                </AssistantMessage>
                {answered && <UserMessage>Start the container.</UserMessage>}
              </>
            )}
            {scene === "finished" && !stopped && (
              <AssistantMessage>
                <p>The benchmark is done. BullMQ is the best fit:</p>
                <ul>
                  <li>BullMQ: 11,200 jobs/s, p99 38 ms.</li>
                  <li>
                    Bee-Queue: 9,800 jobs/s, p99 41 ms, but unmaintained since
                    2023.
                  </li>
                  <li>
                    pg-boss: 2,100 jobs/s, p99 120 ms. Only worth it if you want
                    to avoid running Redis.
                  </li>
                </ul>
                <p>The scripts and raw results are in bench/queues/.</p>
              </AssistantMessage>
            )}
          </section>
        )}
        <Composer
          placeholder={
            live
              ? "Message Euler. The research agent keeps working."
              : "Message Euler…"
          }
        />
      </div>
    </MockShell>
  );
}
