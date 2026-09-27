import { ArrowUp, Hand, PanelLeft, Plus, Settings2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../../../ui/components/Button";
import { IconButton } from "../../../ui/components/IconButton";
import "./mock-shell.css";

/** Sidebar activity a chat can show without being open. */
export type MockChatBadge = "running" | "unread" | "needs-you";

export type MockChat = {
  title: string;
  badge?: MockChatBadge;
};

const badgeLabels: Record<MockChatBadge, string> = {
  running: "Agent working",
  unread: "New reply",
  "needs-you": "Needs you",
};

type Props<Scene extends string> = {
  title: string;
  scenes: readonly { id: Scene; label: string }[];
  scene: Scene;
  onScene: (scene: Scene) => void;
  chats: readonly MockChat[];
  activeChat: string;
  headerAside?: ReactNode;
  mainClassName?: string;
  onOpenSettings?: () => void;
  footerActions?: ReactNode;
  /** Right-hand panel standing in for Euler's artifact sidebar. */
  sidePanel?: ReactNode;
  children: ReactNode;
};

/** Euler-like frame shared by the experimental design mocks. */
export function MockShell<Scene extends string>({
  title,
  scenes,
  scene,
  onScene,
  chats,
  activeChat,
  headerAside,
  mainClassName,
  onOpenSettings,
  footerActions,
  sidePanel,
  children,
}: Props<Scene>) {
  return (
    <div className="mock-root" data-theme="default">
      <nav className="mock-scenarios" aria-label="Mock scenarios">
        <span>
          {title} <small>Design prototype</small>
        </span>
        <div>
          {scenes.map(({ id, label }) => (
            <Button
              key={id}
              size="sm"
              variant={scene === id ? "secondary" : "ghost"}
              aria-pressed={scene === id}
              onClick={() => onScene(id)}
            >
              {label}
            </Button>
          ))}
        </div>
      </nav>
      <div className="mock-app">
        <aside className="mock-sidebar">
          <div className="mock-brand">
            <img src="/icons/euler.svg" alt="" />
            Euler
            <PanelLeft size={17} />
          </div>
          <div className="mock-new-chat">
            <Plus size={17} /> New chat
          </div>
          <p>Recent</p>
          <ul className="mock-chat-list" aria-label="Chats">
            {chats.map((chat) => (
              <li
                key={chat.title}
                className={
                  chat.title === activeChat
                    ? "mock-chat-title mock-chat-active"
                    : "mock-chat-title"
                }
                aria-current={chat.title === activeChat ? "page" : undefined}
              >
                <span>{chat.title}</span>
                {chat.badge && <ChatBadge badge={chat.badge} />}
              </li>
            ))}
          </ul>
          <div className="mock-account">
            <span className="mock-avatar">S</span>
            <div>
              Sam<small>Personal account</small>
            </div>
            {onOpenSettings && (
              <IconButton
                icon={Settings2}
                label="Browser settings"
                variant="ghost"
                onClick={onOpenSettings}
              />
            )}
          </div>
        </aside>
        <main className={`mock-main ${mainClassName ?? ""}`}>
          <header className="mock-chat-header">
            <span>{activeChat}</span>
            {headerAside}
          </header>
          {children}
        </main>
        {sidePanel}
      </div>
      <footer className="mock-fixture-footer">
        <span>Experimental mock · Fictional data · No server connection</span>
        {footerActions && <div>{footerActions}</div>}
      </footer>
    </div>
  );
}

function ChatBadge({ badge }: { badge: MockChatBadge }) {
  const label = badgeLabels[badge];
  if (badge === "needs-you") {
    return (
      <span
        className="mock-badge mock-badge-needs-you"
        role="img"
        aria-label={label}
        title={label}
      >
        <Hand size={12} />
      </span>
    );
  }
  return (
    <span
      className={`mock-badge mock-badge-${badge}`}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}

export function UserMessage({ children }: { children: ReactNode }) {
  return <div className="mock-user-message">{children}</div>;
}

export function AssistantMessage({ children }: { children: ReactNode }) {
  return (
    <div className="mock-assistant">
      <img src="/icons/euler.svg" alt="Euler" />
      <div>{children}</div>
    </div>
  );
}

export function Composer({ placeholder }: { placeholder: string }) {
  return (
    <div className="mock-composer">
      <span>{placeholder}</span>
      <ArrowUp size={20} />
      <small>Prototype only. Messages are not sent.</small>
    </div>
  );
}
