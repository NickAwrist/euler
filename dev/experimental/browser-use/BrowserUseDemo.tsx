import {
  ArrowLeft,
  Globe,
  Hand,
  LockKeyhole,
  Maximize2,
  Minimize2,
  MousePointer2,
  Play,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../ui/components/Button";
import { IconButton } from "../../../ui/components/IconButton";
import { Modal } from "../../../ui/components/Modal";
import { AgentTaskCard } from "../shared/AgentTaskCard";
import {
  AssistantMessage,
  Composer,
  type MockChat,
  MockShell,
  UserMessage,
} from "../shared/MockShell";
import { MockWebsite } from "./MockWebsite";
import "./browser-use.css";

type Control = "agent" | "stopping" | "user";
type Task = "live" | "finished" | "ended";
type Scene = "agent" | "login" | "finished" | "selection" | "settings";
const scenes: { id: Scene; label: string }[] = [
  { id: "agent", label: "Agent browsing" },
  { id: "login", label: "Private login" },
  { id: "finished", label: "Agent finishes" },
  { id: "selection", label: "Point something out" },
  { id: "settings", label: "Browser settings" },
];
const chatTitle = "Check the latest deployment";
const chats: MockChat[] = [
  { title: chatTitle },
  { title: "Benchmark queue libraries", badge: "running" },
  { title: "Nightly error report", badge: "unread" },
];

function initialScene(): Scene {
  const value = new URLSearchParams(window.location.search).get("scene");
  return scenes.find((scene) => scene.id === value)?.id ?? "agent";
}

export default function BrowserUseDemo() {
  const [scene, setScene] = useState<Scene>(initialScene);
  const [task, setTask] = useState<Task>(
    scene === "finished" ? "finished" : "live",
  );
  const [control, setControl] = useState<Control>(
    scene === "agent" ? "agent" : "user",
  );
  const [expanded, setExpanded] = useState(
    scene === "login" || scene === "selection",
  );
  const [login, setLogin] = useState(scene === "login");
  const [selecting, setSelecting] = useState(scene === "selection");
  const [selected, setSelected] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function switchScene(next: Scene) {
    if (timer.current) clearTimeout(timer.current);
    setScene(next);
    setTask(next === "finished" ? "finished" : "live");
    setControl(next === "agent" ? "agent" : "user");
    setExpanded(next === "login" || next === "selection");
    setLogin(next === "login");
    setSelecting(next === "selection");
    setSelected(null);
    setResetDone(false);
  }
  function takeControl(needsLogin = false) {
    setControl("stopping");
    setSelecting(false);
    timer.current = setTimeout(() => {
      setControl("user");
      setExpanded(true);
      if (needsLogin) setLogin(true);
    }, 700);
  }
  const agent = task === "live" && control === "agent";
  const status = agent
    ? "Browser agent controlling"
    : control === "stopping"
      ? "Stopping browser agent…"
      : "You have control";

  return (
    <MockShell
      title="Browser use"
      scenes={scenes}
      scene={scene}
      onScene={switchScene}
      chats={chats}
      activeChat={chatTitle}
      mainClassName={task === "live" && expanded ? "mock-expanded" : ""}
      onOpenSettings={() => switchScene("settings")}
      headerAside={
        <span>
          <Globe size={15} /> Your browser
        </span>
      }
      footerActions={
        agent && (
          <>
            <Button size="sm" variant="ghost" onClick={() => takeControl(true)}>
              Simulate agent requesting login
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => switchScene("finished")}
            >
              Simulate agent finishing
            </Button>
          </>
        )
      }
    >
      {scene === "settings" ? (
        <section className="mock-settings">
          <p className="mock-breadcrumb">Settings / Browser</p>
          <h1>Your browser</h1>
          <p>One browser for your account, available across conversations.</p>
          <div className="mock-setting-row">
            <div>
              <h2>Saved browser state</h2>
              <p>
                {resetDone
                  ? "Your browser is ready for a fresh start."
                  : "Keep website logins and site preferences between visits."}
              </p>
            </div>
            <span>{resetDone ? "Empty profile" : "Stored on Euler host"}</span>
          </div>
          <div className="mock-setting-row">
            <div>
              <h2>Conversations</h2>
              <p>Deleting a chat leaves your browser data untouched.</p>
            </div>
            <ShieldCheck size={21} />
          </div>
          <div className="mock-reset-section">
            <h2>Reset browser</h2>
            <p>
              Stop browser activity and remove saved logins, site data, browsing
              history, and browser downloads for your account.
            </p>
            <p>
              You will need to sign in to websites again. Chats and files
              already copied to a workspace are kept.
            </p>
            <Button variant="danger" onClick={() => setResetOpen(true)}>
              Reset browser…
            </Button>
            {resetDone && (
              <p aria-live="polite">
                Demo reset complete. No real browser data was changed.
              </p>
            )}
          </div>
        </section>
      ) : (
        <div className="mock-workspace">
          <section className="mock-conversation" aria-label="Conversation">
            <UserMessage>
              Check whether the latest Queue service deployment is healthy.
            </UserMessage>
            <AssistantMessage>
              <p>
                I've started a browser agent to open Parcel and check the latest
                deployment and its health checks. You can keep chatting while it
                works.
              </p>
            </AssistantMessage>
            {task === "live" && expanded && (
              <div className="mock-chat-note">
                <Hand size={18} />
                <p>
                  {agent
                    ? "The browser agent is using your browser. You can take control at any time."
                    : "The browser agent is waiting for you to resume. Euler can still answer messages here."}
                </p>
              </div>
            )}
            {task === "finished" && (
              <>
                <AgentTaskCard
                  kind="browser"
                  title="Check Queue service deployment health"
                  status="completed"
                />
                <AssistantMessage>
                  <p>
                    The latest Queue service deployment, "Improve worker
                    shutdown" (8f2c91a), is Ready. It went out 12 minutes ago
                    and all health checks pass.
                  </p>
                </AssistantMessage>
              </>
            )}
            {task === "ended" && (
              <AgentTaskCard
                kind="browser"
                title="Check Queue service deployment health"
                status="cancelled"
              />
            )}
          </section>
          {task === "live" && (
            <section
              className={`mock-browser ${agent ? "mock-agent-control" : ""}`}
              aria-label="Shared browser"
              data-control={control}
            >
              <div className="mock-browser-toolbar">
                <div className="mock-browser-state" aria-live="polite">
                  {agent ? <Globe size={16} /> : <Hand size={16} />}
                  {status}
                </div>
                <div className="mock-browser-actions">
                  {control !== "user" ? (
                    <IconButton
                      icon={Square}
                      label="Stop agent and take control"
                      variant="ghost"
                      disabled={control === "stopping"}
                      onClick={() => takeControl()}
                    />
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setTask("ended")}
                      >
                        End task
                      </Button>
                      <Button
                        size="sm"
                        icon={Play}
                        onClick={() => {
                          setControl("agent");
                          setSelecting(false);
                          setSelected(null);
                        }}
                      >
                        Resume agent
                      </Button>
                    </>
                  )}
                  <IconButton
                    icon={expanded ? Minimize2 : Maximize2}
                    label={expanded ? "Collapse browser" : "Expand browser"}
                    variant="ghost"
                    onClick={() => setExpanded(!expanded)}
                  />
                </div>
              </div>
              <div className="mock-address">
                <ArrowLeft size={15} />
                <LockKeyhole size={13} />
                <span>
                  parcel.example.test/
                  {login ? "login" : "queue-service/deployments"}
                </span>
                <span className="mock-profile">Personal</span>
              </div>
              {control === "user" && (
                <div className="mock-private">
                  <ShieldCheck size={16} />
                  <span>
                    Private control. The agent cannot see or interact with this
                    browser.
                  </span>
                </div>
              )}
              <MockWebsite
                login={login}
                interactive={control === "user"}
                selecting={selecting}
                selected={selected}
                onSelect={setSelected}
                onLogin={() => setLogin(false)}
              />
              <footer className="mock-browser-footer">
                <span>
                  {agent
                    ? "Inspecting the latest deployment"
                    : login
                      ? "Browser agent: Parcel needs you to sign in. Resume me when you're done."
                      : selecting
                        ? "Choose an element to reference. This will not click the website."
                        : "Your input stays out of the conversation"}
                </span>
                {control === "user" && !login && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={MousePointer2}
                    aria-pressed={selecting}
                    onClick={() => {
                      setSelecting(!selecting);
                      setSelected(null);
                    }}
                  >
                    Point something out
                  </Button>
                )}
              </footer>
            </section>
          )}
          {selected && (
            <div className="mock-selection" aria-live="polite">
              <MousePointer2 size={17} />
              <div>
                <strong>Selected: {selected}</strong>
                <span>
                  Only this reference will be shared when you send your message.
                </span>
              </div>
              <IconButton
                icon={X}
                label="Clear selection"
                variant="ghost"
                onClick={() => setSelected(null)}
              />
            </div>
          )}
          <Composer
            placeholder={
              selected
                ? "What would you like to ask about this deployment?"
                : task !== "live"
                  ? "Message Euler…"
                  : agent
                    ? "Message Euler. The browser agent keeps working."
                    : "Message Euler. The browser agent waits for you."
            }
          />
        </div>
      )}
      {resetOpen && (
        <Modal
          title="Reset your browser?"
          onClose={() => setResetOpen(false)}
          maxWidthClass="max-w-[460px]"
        >
          <div className="mock-reset-dialog">
            <p>
              This stops browser activity and deletes saved logins, site data,
              history, and browser downloads across all conversations.
            </p>
            <p>
              Chats and workspace files are kept. Resetting does not undo
              actions already taken on websites.
            </p>
            <div>
              <Button variant="secondary" onClick={() => setResetOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setResetOpen(false);
                  setResetDone(true);
                }}
              >
                Reset browser
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </MockShell>
  );
}
