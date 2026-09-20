import { useMemo, useState } from "react";
import { ArtifactContext } from "../components/Artifacts/ArtifactContext";
import { WorkspaceArtifacts } from "../components/Artifacts/WorkspaceArtifacts";
import { Button } from "../components/Button";
import { MessageItem } from "../components/MessageItem";
import { SidebarToggle } from "../components/SidebarToggle";
import { fixtureMessages, fixtureSource } from "./artifactFixtures";

function DemoWorkspace({ alternate }: { alternate: boolean }) {
  const source = useMemo(() => fixtureSource(alternate), [alternate]);
  const messages = fixtureMessages(alternate);
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const openFile = (value: string) => {
    setPath(value);
    setOpen(true);
  };
  return (
    <ArtifactContext.Provider value={{ openFile }}>
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <SidebarToggle
          side="right"
          open={open}
          onToggle={() => setOpen((value) => !value)}
        />
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="workspace-header min-w-0 justify-between gap-3 pl-4 pr-14">
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">
                {alternate ? "Staging workspace" : "Queue service"}
              </h1>
              <p className="truncate text-xs text-muted-foreground">
                Mock chat · {alternate ? "/demo/staging" : "Private sandbox"}
              </p>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="mx-auto max-w-3xl space-y-6 px-5 py-8">
              {messages.map((message, index) => (
                <MessageItem
                  key={`${index}:${message.role}`}
                  message={message}
                  messageIndex={index}
                  isBusy={false}
                  editingUserIndex={null}
                  onStartEditUser={() => {}}
                  onCancelEditUser={() => {}}
                  onRequestEditConfirm={() => {}}
                  onRequestRetryConfirm={() => {}}
                />
              ))}
            </div>
          </div>
          <footer className="border-t border-border-subtle px-4 py-3 text-center text-xs text-muted-foreground">
            Fixture data only. No model requests or local files are used.
          </footer>
        </main>
        <WorkspaceArtifacts
          open={open}
          source={source}
          path={path}
          revision={0}
          rootLabel={alternate ? "/demo/staging" : "/workspace"}
          onOpen={openFile}
          onBack={() => setPath(null)}
          onClose={() => setOpen(false)}
        />
      </div>
    </ArtifactContext.Provider>
  );
}
export default function ArtifactsDemo() {
  const [workspace, setWorkspace] = useState(0);
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-4 py-2">
        <span className="text-xs text-muted-foreground">
          Artifacts playground
        </span>
        <Button
          variant="secondary"
          onClick={() => setWorkspace((value) => value + 1)}
        >
          Change directory
        </Button>
      </div>
      <DemoWorkspace key={workspace} alternate={workspace % 2 === 1} />
    </div>
  );
}
