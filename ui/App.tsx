import { Bug, EyeOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArtifactContext } from "./components/Artifacts/ArtifactContext";
import { WorkspaceArtifacts } from "./components/Artifacts/WorkspaceArtifacts";
import { workspaceArtifactSource } from "./components/Artifacts/api";
import { useWorkspaceHasFiles } from "./components/Artifacts/useWorkspaceHasFiles";
import { CustomizationPage } from "./components/CustomizationPage";
import { DebugModal } from "./components/DebugModal";
import { DirectoryModal } from "./components/DirectoryModal";
import { shouldShowStepsModal } from "./components/ExecutionTrace";
import { ProviderSetupBanner } from "./components/OllamaDisconnectedBanner";
import { RenameSessionModal } from "./components/RenameSessionModal";
import { RunArea } from "./components/RunArea";
import { RunInputDock } from "./components/RunInputDock";
import { SettingsPage } from "./components/SettingsPage";
import { Sidebar } from "./components/Sidebar";
import { SidebarBackdrop } from "./components/SidebarBackdrop";
import { SidebarToggle } from "./components/SidebarToggle";
import { StepsModal } from "./components/StepsModal";
import { TruncateConfirmModal } from "./components/TruncateConfirmModal";
import { UsagePage } from "./components/UsagePage";
import { WelcomeHome } from "./components/WelcomeHome";
import { WorkspaceModal } from "./components/WorkspaceModal";
import type { RunCommandName } from "./components/runCommands";
import { useAppKeybinds } from "./hooks/useAppKeybinds";
import { useMobileLayout } from "./hooks/useMobileLayout";
import { useRunApp } from "./hooks/useRunApp";
import { downloadBlob } from "./lib/downloadBlob";
import {
  formatRunTranscript,
  transcriptFileName,
} from "./lib/formatRunTranscript";
import {
  NAVIGATION_EVENT,
  navigate,
  parseRoute,
  sessionPath,
} from "./lib/navigation";
import { fetchSession } from "./persist/sessions";
import { cx } from "./styles";

type ChatViewProps = {
  app: ReturnType<typeof useRunApp>;
  directoryOpen: boolean;
  stepsModalOpen: boolean;
  runCommand: (command: RunCommandName) => Promise<void>;
  onCustomization: () => void;
  onSettings: () => void;
  onUsage: () => void;
};

import { safeStorage } from "./lib/safeStorage";

const ARTIFACT_STATE_KEY = "euler:artifactSidebarState";
function loadArtifactState(): {
  open: boolean;
  workspace: string;
  path: string | null;
} {
  const value = safeStorage.getJSON<unknown>(ARTIFACT_STATE_KEY, null);
  if (
    value &&
    typeof value === "object" &&
    "open" in value &&
    "workspace" in value &&
    "path" in value &&
    typeof value.open === "boolean" &&
    typeof value.workspace === "string" &&
    (value.path === null || typeof value.path === "string")
  ) {
    return { open: value.open, workspace: value.workspace, path: value.path };
  }
  return { open: false, workspace: "", path: null };
}

function ChatView({
  app,
  directoryOpen,
  stepsModalOpen,
  runCommand,
  onCustomization,
  onSettings,
  onUsage,
}: ChatViewProps) {
  const workspaceKey = `${app.activeSessionId}:${app.workspace.kind === "local" ? app.workspace.path : "sandbox"}`;
  const [savedArtifacts] = useState(loadArtifactState);
  const [artifactsOpen, setArtifactsOpen] = useState(savedArtifacts.open);
  const workspaceReady =
    app.sessionLoadState === "loaded" || app.sessionLoadState === "empty";
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      document.documentElement.setAttribute("data-window-resizing", "");
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        document.documentElement.removeAttribute("data-window-resizing");
      }, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      clearTimeout(timeout);
      document.documentElement.removeAttribute("data-window-resizing");
    };
  }, []);
  const mobileLayout = useMobileLayout();
  const chatsOpen = mobileLayout ? app.sidebarOpen : !app.sidebarCollapsed;
  const toggleChats = () => {
    if (mobileLayout) app.setSidebarOpen((value) => !value);
    else app.setSidebarCollapsed((value) => !value);
  };
  const [fileSelection, setFileSelection] = useState<{
    workspace: string;
    path: string | null;
  }>({
    workspace: savedArtifacts.workspace,
    path: savedArtifacts.path,
  });
  const selectedFile =
    fileSelection.workspace === workspaceKey ? fileSelection.path : null;
  const setSelectedFile = useCallback(
    (path: string | null) => {
      setFileSelection({ workspace: workspaceKey, path });
    },
    [workspaceKey],
  );

  useEffect(() => {
    if (!workspaceReady || !app.activeSessionId) return;
    safeStorage.setJSON(ARTIFACT_STATE_KEY, {
      open: artifactsOpen,
      workspace: workspaceKey,
      path: selectedFile,
    });
  }, [
    workspaceReady,
    app.activeSessionId,
    artifactsOpen,
    workspaceKey,
    selectedFile,
  ]);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!app.runPending) setRevision((value) => value + 1);
  }, [app.runPending]);
  const source = useMemo(
    () => workspaceArtifactSource(app.activeSessionId ?? "", app.isEphemeral),
    [app.activeSessionId, app.isEphemeral],
  );
  const hasFiles = useWorkspaceHasFiles(
    source,
    workspaceKey,
    workspaceReady && artifactsOpen,
  );
  // The remembered open state applies only to workspaces with files; an
  // explicit open in this chat shows the panel even when it is empty.
  const [openedSessionId, setOpenedSessionId] = useState<string | null>(null);
  const filesOpen =
    artifactsOpen &&
    (hasFiles === true || openedSessionId === app.activeSessionId);
  const toggleFiles = () => {
    setArtifactsOpen(!filesOpen);
    if (!filesOpen) setOpenedSessionId(app.activeSessionId);
  };
  const openFile = useCallback(
    (path: string) => {
      setSelectedFile(path);
      setArtifactsOpen(true);
      setOpenedSessionId(app.activeSessionId);
    },
    [setSelectedFile, app.activeSessionId],
  );
  const chatTitle = app.activeSessionId
    ? app.sessions.find((session) => session.id === app.activeSessionId)
        ?.preview || "New chat"
    : null;
  useEffect(() => {
    document.title = chatTitle
      ? `${app.runPending ? "● " : ""}${chatTitle} · Euler`
      : "Euler";
    return () => {
      document.title = "Euler";
    };
  }, [chatTitle, app.runPending]);
  const artifactContext = useMemo(
    () => ({
      openFile,
      workspaceKind: app.workspace.kind,
      localPath:
        app.workspace.kind === "local" ? app.workspace.path : undefined,
    }),
    [openFile, app.workspace],
  );
  const [runFooterInset, setRunFooterInset] = useState(104);
  // Home and empty chats center the composer; the first message docks it.
  const composerCentered =
    app.messages.length === 0 &&
    !app.runPending &&
    (!app.activeSessionId || app.sessionLoadState === "empty");
  const { setEditingUserIndex, setTruncateConfirm } = app;
  const cancelEditUser = useCallback(
    () => setEditingUserIndex(null),
    [setEditingUserIndex],
  );
  const requestEditConfirm = useCallback(
    (userIndex: number, text: string) => {
      setTruncateConfirm({ kind: "edit", userIndex, text });
    },
    [setTruncateConfirm],
  );
  const requestRetryConfirm = useCallback(
    (userIndex: number) => {
      setTruncateConfirm({ kind: "retry", userIndex });
    },
    [setTruncateConfirm],
  );

  useAppKeybinds({
    blockShortcuts:
      Boolean(app.renameSessionId) ||
      app.truncateConfirm != null ||
      Boolean(app.pendingDeleteSessionId) ||
      app.ephemeralExitPromptOpen ||
      directoryOpen ||
      app.debugOpen ||
      stepsModalOpen,
    sessions: app.sessions,
    activeSessionId: app.activeSessionId,
    switchToSession: app.switchToSession,
    setSidebarOpen: app.setSidebarOpen,
    setSidebarCollapsed: app.setSidebarCollapsed,
    goToHome: app.goToHome,
    headerRunBusy: app.runPending,
  });

  return (
    <ArtifactContext.Provider
      value={app.activeSessionId ? artifactContext : null}
    >
      <div className="relative flex h-full w-full overflow-hidden">
        <SidebarToggle
          side="left"
          open={chatsOpen}
          onToggle={toggleChats}
          className={filesOpen ? "max-[900px]:hidden" : undefined}
        />
        {app.activeSessionId && (
          <SidebarToggle side="right" open={filesOpen} onToggle={toggleFiles} />
        )}
        <aside
          id="app-sidebar"
          aria-label="Chats"
          aria-hidden={!chatsOpen}
          inert={!chatsOpen}
          className={cx(
            "h-full w-[260px] min-w-[260px] shrink-0 overflow-hidden bg-background motion-reduce:transition-none",
            // Mobile <= 900px: overlay drawer
            "max-[900px]:fixed max-[900px]:top-0 max-[900px]:bottom-0 max-[900px]:left-0 max-[900px]:z-30 max-[900px]:w-[min(85vw,300px)] max-[900px]:shadow-[4px_0_24px_rgba(0,0,0,0.35)] max-[900px]:transform-gpu max-[900px]:transition-transform max-[900px]:duration-300 max-[900px]:ease-[cubic-bezier(0.22,1,0.36,1)]",
            app.sidebarOpen
              ? "max-[900px]:translate-x-0"
              : "max-[900px]:-translate-x-full",
            // Medium desktop 901px - 1319px: moves chat over so sidebar never covers chat
            "min-[901px]:max-[1319px]:relative min-[901px]:max-[1319px]:transition-[margin-left] min-[901px]:max-[1319px]:duration-300 min-[901px]:max-[1319px]:ease-[cubic-bezier(0.22,1,0.36,1)]",
            app.sidebarCollapsed
              ? "min-[901px]:max-[1319px]:pointer-events-none min-[901px]:max-[1319px]:-ml-[260px] min-[901px]:max-[1319px]:border-r-0"
              : "min-[901px]:max-[1319px]:pointer-events-auto min-[901px]:max-[1319px]:ml-0 min-[901px]:max-[1319px]:border-r min-[901px]:max-[1319px]:border-border-subtle",
            // Wide desktop >= 1320px: screen has plenty of gutter space, slides in without moving the chat
            "min-[1320px]:absolute min-[1320px]:inset-y-0 min-[1320px]:left-0 min-[1320px]:z-20 min-[1320px]:transition-transform min-[1320px]:duration-300 min-[1320px]:ease-[cubic-bezier(0.22,1,0.36,1)]",
            app.sidebarCollapsed
              ? "min-[1320px]:pointer-events-none min-[1320px]:-translate-x-full min-[1320px]:border-r-0"
              : "min-[1320px]:pointer-events-auto min-[1320px]:translate-x-0 min-[1320px]:border-r min-[1320px]:border-border-subtle",
          )}
        >
          <Sidebar
            sessions={app.sessions}
            activeSessionId={app.activeSessionId}
            onSelectSession={(id) => {
              app.setSidebarOpen(false);
              app.switchToSession(id);
            }}
            onNewSession={app.goToHome}
            onNewEphemeralSession={app.createEphemeralSession}
            onRenameSession={(id) => app.setRenameSessionId(id)}
            onExportSession={async (id) => {
              const useCurrent =
                id === app.activeSessionId &&
                (app.sessionLoadState === "loaded" ||
                  app.sessionLoadState === "empty");
              const stored = await fetchSession(id, { fresh: true });
              if (!stored) throw new Error("Conversation not found.");
              const title =
                app.sessions.find((s) => s.id === id)?.preview ?? "Chat";
              const transcript = formatRunTranscript(
                useCurrent ? app.messages : stored.history,
                {
                  title,
                  exportedAt: new Date(),
                  model: stored.model,
                  streamingAssistant: useCurrent
                    ? app.streamingContent
                    : undefined,
                },
              );
              downloadBlob(
                new Blob([transcript], { type: "text/markdown;charset=utf-8" }),
                transcriptFileName(title),
              );
            }}
            onDeleteSession={app.requestDeleteSession}
            onCustomization={onCustomization}
            onSettings={onSettings}
            onUsage={onUsage}
          />
        </aside>

        <SidebarBackdrop
          open={app.sidebarOpen}
          onClose={() => app.setSidebarOpen(false)}
        />

        <main
          className={cx(
            "relative h-full min-h-0 min-w-0 flex-1 bg-background transition-[margin-left] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
            filesOpen && !app.sidebarCollapsed && "min-[1320px]:ml-[260px]",
          )}
        >
          {app.activeSessionId && app.userSettings.showDebugButton && (
            <button
              type="button"
              onClick={app.toggleDebug}
              title="Debug inspector"
              aria-label="Debug inspector"
              className={cx(
                "absolute top-[calc((var(--workspace-header-height)-2.25rem-1px)/2)] z-10 inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground",
                filesOpen ? "right-2" : "right-14",
              )}
            >
              <Bug size={16} />
            </button>
          )}
          {app.isEphemeral && (
            <span
              title="Not saved. Messages and files are deleted when you leave."
              className={cx(
                "absolute left-14 top-4 z-10 inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-background px-2 py-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-amber-400",
                !app.sidebarCollapsed &&
                  !filesOpen &&
                  "min-[1320px]:left-[calc(260px+1rem)]",
              )}
            >
              <EyeOff size={12} />
              Ephemeral
            </span>
          )}

          <section
            className={cx(
              "flex h-full min-h-0 overflow-x-hidden",
              !app.activeSessionId && "pt-0",
            )}
          >
            {app.activeSessionId && !composerCentered ? (
              <div
                key={app.activeSessionId}
                className="ui-animate-fade-in flex h-full min-h-0 min-w-0 flex-1 flex-col"
              >
                <RunArea
                  messages={app.messages}
                  sessionLoadState={app.sessionLoadState}
                  sessionError={app.sessionError}
                  sessionSendReady={app.sessionSendReady}
                  onRetryLoad={app.retrySessionLoad}
                  streamingSteps={app.streamingSteps}
                  streamingStep={app.streamingStep}
                  streamingContent={app.streamingContent}
                  streamingThinking={app.streamingThinking}
                  runPending={app.runPending}
                  footerInset={runFooterInset}
                  onViewSteps={app.setStepsModalData}
                  editingUserIndex={app.editingUserIndex}
                  onStartEditUser={app.setEditingUserIndex}
                  onCancelEditUser={cancelEditUser}
                  onRequestEditConfirm={requestEditConfirm}
                  onRequestRetryConfirm={requestRetryConfirm}
                />
              </div>
            ) : (
              <WelcomeHome
                sessions={app.sessions}
                home={!app.activeSessionId}
                ephemeral={app.isEphemeral}
                composerHeight={runFooterInset}
                onNewEphemeralRun={app.createEphemeralSession}
                onOpenSession={app.switchToSession}
              />
            )}
          </section>

          <RunInputDock
            centered={composerCentered}
            ollamaModels={app.ollamaModels}
            ollamaConnected={app.ollamaConnected}
            modelsLoadError={app.modelsLoadError}
            selectedModel={app.selectedModel}
            onModelChange={app.handleModelChange}
            thinkingEffort={app.thinkingEffort}
            onThinkingEffortChange={app.handleThinkingEffortChange}
            input={app.input}
            setInput={app.setInput}
            onSendMessage={app.sendMessage}
            onStopGeneration={app.stopGeneration}
            runPending={app.runPending}
            streamingStep={app.streamingStep}
            streamingSteps={app.streamingSteps}
            modelSendReady={app.modelSendReady}
            pendingImages={app.pendingImages}
            imageError={app.imageError}
            addPendingImages={app.addPendingImages}
            removePendingImage={app.removePendingImage}
            canAttachImages={app.canAttachImages}
            attachImageDisabledReason={app.attachImageDisabledReason}
            attachmentsSendReady={app.attachmentsSendReady}
            workspace={app.workspace}
            onRunCommand={runCommand}
            onFooterHeightChange={setRunFooterInset}
          />
        </main>
        {app.activeSessionId && workspaceReady && (
          <WorkspaceArtifacts
            key={workspaceKey}
            open={filesOpen}
            source={source}
            path={selectedFile}
            revision={revision}
            rootLabel={
              app.workspace.kind === "local" ? app.workspace.path : "/workspace"
            }
            onOpen={openFile}
            onBack={() => setSelectedFile(null)}
            onClose={() => setArtifactsOpen(false)}
          />
        )}
      </div>
    </ArtifactContext.Provider>
  );
}

export default function App() {
  const app = useRunApp();
  const [path, setPath] = useState(() => window.location.pathname);
  const route = parseRoute(path);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener(NAVIGATION_EVENT, update);
    return () => window.removeEventListener(NAVIGATION_EVENT, update);
  }, []);
  const backToChat = () => {
    void navigate(sessionPath(app.isEphemeral ? null : app.activeSessionId));
  };

  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [directorySessionId, setDirectorySessionId] = useState<string | null>(
    null,
  );
  const directoryOpen =
    directorySessionId !== null && directorySessionId === app.activeSessionId;

  const openCustomization = () => {
    app.setSidebarOpen(false);
    void navigate("/customization");
  };

  const openSettings = () => {
    app.setSidebarOpen(false);
    void navigate("/settings/general");
  };

  const runCommand = async (command: RunCommandName) => {
    try {
      const sessionId = app.activeSessionId ?? (await app.startSession());
      if (command === "directory") setDirectorySessionId(sessionId);
      if (command === "sandbox") await app.returnToSandbox();
      if (command === "workspace") setWorkspaceOpen(true);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Command failed");
    }
  };

  const stepsModalOpen = shouldShowStepsModal(
    app.stepsModalData,
    app.streamingSteps,
    app.streamingStep,
  );

  useEffect(() => {
    if (!stepsModalOpen && app.stepsModalData != null) {
      app.setStepsModalData(null);
    }
  }, [app.stepsModalData, app.setStepsModalData, stepsModalOpen]);

  return (
    <>
      {app.noProviderAvailable && (
        <ProviderSetupBanner onOpenSettings={openSettings} />
      )}
      <div
        className={cx(
          "h-screen overflow-hidden",
          app.noProviderAvailable && "pt-9",
        )}
      >
        {route.view === "usage" ? (
          <UsagePage onBack={backToChat} />
        ) : route.view === "customization" ? (
          <main className="relative h-full min-h-0 min-w-0 flex-1 bg-background">
            <CustomizationPage onBack={backToChat} />
          </main>
        ) : route.view === "settings" ? (
          <main className="relative h-full min-h-0 min-w-0 flex-1 bg-background">
            <SettingsPage
              tab={route.tab}
              onTabChange={(tab) => void navigate(`/settings/${tab}`)}
              catalogLoaded={app.catalogLoaded}
              ollamaModels={app.ollamaModels}
              currentSettings={app.userSettings}
              ollamaHost={app.ollamaHost}
              ollamaConnected={app.ollamaConnected}
              comfyuiHost={app.comfyuiHost}
              comfyuiConnected={app.comfyuiConnected}
              comfyuiDefaultModel={app.comfyuiDefaultModel}
              comfyuiDefaultWidth={app.comfyuiDefaultWidth}
              comfyuiDefaultHeight={app.comfyuiDefaultHeight}
              comfyuiNegativePrompt={app.comfyuiNegativePrompt}
              searxngHost={app.searxngHost}
              searxngConnected={app.searxngConnected}
              onSave={app.saveUserSettings}
              onModelsChanged={() => app.refreshModels(true)}
              onBack={backToChat}
            />
          </main>
        ) : (
          <ChatView
            app={app}
            directoryOpen={directoryOpen}
            stepsModalOpen={stepsModalOpen}
            runCommand={runCommand}
            onCustomization={openCustomization}
            onSettings={openSettings}
            onUsage={() => void navigate("/usage")}
          />
        )}

        {app.debugOpen && (
          <DebugModal
            data={app.debugData}
            onClose={() => app.setDebugOpen(false)}
          />
        )}
        {stepsModalOpen && (
          <StepsModal
            steps={app.modalSteps ?? []}
            streamingThinking={
              app.stepsModalData === "live" ? app.streamingThinking : undefined
            }
            onClose={() => app.setStepsModalData(null)}
          />
        )}
        {app.renameSessionId && (
          <RenameSessionModal
            initialTitle={app.renameTarget?.customTitle ?? ""}
            placeholder={
              app.renameTarget?.customTitle
                ? undefined
                : app.renameTarget?.preview
            }
            onSave={app.saveSessionTitle}
            onClose={() => app.setRenameSessionId(null)}
          />
        )}
        {app.truncateConfirm && (
          <TruncateConfirmModal
            title="Delete later messages?"
            description="All message history after this point will be permanently deleted. This cannot be undone."
            onClose={() => app.setTruncateConfirm(null)}
            onConfirm={app.confirmTruncateAndRetry}
          />
        )}
        {app.pendingDeleteSessionId && (
          <TruncateConfirmModal
            title="Delete this chat?"
            description="This chat and all of its messages will be permanently deleted. This cannot be undone."
            confirmLabel="Delete"
            onClose={() => app.setPendingDeleteSessionId(null)}
            onConfirm={app.performDeleteSession}
          />
        )}
        {app.ephemeralExitPromptOpen && (
          <TruncateConfirmModal
            title="Discard this ephemeral chat?"
            description="This chat is not saved. Its messages and files will be permanently deleted. This cannot be undone."
            confirmLabel="Discard"
            onClose={() => app.resolveEphemeralExit(false)}
            onConfirm={() => app.resolveEphemeralExit(true)}
          />
        )}
        {directoryOpen && (
          <DirectoryModal
            initialPath={
              app.workspace.kind === "local" ? app.workspace.path : ""
            }
            onSelect={app.chooseDirectory}
            onClose={() => setDirectorySessionId(null)}
          />
        )}
        {workspaceOpen && app.activeSessionId && (
          <WorkspaceModal
            sessionId={app.activeSessionId}
            workspace={app.workspace}
            temporary={app.isEphemeral}
            onClose={() => setWorkspaceOpen(false)}
          />
        )}
      </div>
    </>
  );
}
