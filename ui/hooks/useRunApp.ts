import { useCallback, useRef, useState } from "react";
import { InputCapability } from "../../src/modelCapabilities";
import { traceStepsForModal } from "../components/ExecutionTrace";
import { resolveEffectiveThinkingEffort } from "../lib/thinkingLevel";
import type {
  DebugData,
  Message,
  TraceModalSelection,
  TruncateConfirmState,
} from "../types";
import type { RunFlightApi } from "./run/runTypes";
import { useComfyUIConnection } from "./run/useComfyUIConnection";
import { useOllamaConnection } from "./run/useOllamaConnection";
import { useRunStreaming } from "./run/useRunStreaming";
import { useSearXNGConnection } from "./run/useSearXNGConnection";
import { useSessionsAndNavigation } from "./run/useSessionsAndNavigation";
import { useSettings } from "./run/useSettings";
import { useSidebarState } from "./useSidebarState";

export function useRunApp() {
  const sidebar = useSidebarState();
  const ollama = useOllamaConnection();
  const comfy = useComfyUIConnection();
  const searxng = useSearXNGConnection();

  const activeSessionIdRef = useRef<string | null>(null);
  const isEphemeralRef = useRef(false);
  const modelMessagesRef = useRef<Array<Record<string, unknown>> | null>(null);
  const debugOpenRef = useRef(false);
  const resetStreamingUiRef = useRef<() => void>(() => {});
  const runFlightRef = useRef<RunFlightApi | null>(null);

  const bindStreamingReset = useCallback((fn: () => void) => {
    resetStreamingUiRef.current = fn;
  }, []);

  const resetStreamingUi = useCallback(() => resetStreamingUiRef.current(), []);

  const settings = useSettings(
    ollama.setOllamaHost,
    ollama.fetchOllamaHealth,
    ollama.refreshOllamaModels,
    comfy.fetchComfyUIHealth,
    comfy.applyComfyConfigResponse,
    searxng.fetchSearXNGHealth,
    searxng.applySearXNGConfigResponse,
  );

  const [messages, setMessages] = useState<Message[]>([]);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugData, setDebugData] = useState<DebugData | null>(null);
  const [stepsModalData, setStepsModalData] =
    useState<TraceModalSelection>(null);
  const [editingUserIndex, setEditingUserIndex] = useState<number | null>(null);
  const [truncateConfirm, setTruncateConfirm] =
    useState<TruncateConfirmState>(null);

  debugOpenRef.current = debugOpen;

  const sessions = useSessionsAndNavigation({
    ollamaModels: ollama.ollamaModels,
    userSettingsRef: settings.userSettingsRef,
    userSettingsDefaultModel: settings.userSettings.defaultModel,
    messages,
    setMessages,
    setEditingUserIndex,
    setTruncateConfirm,
    setStepsModalData,
    setDebugOpen,
    setDebugData,
    resetStreamingUi,
    modelMessagesRef,
    activeSessionIdRef,
    isEphemeralRef,
    runFlightRef,
    onNavigate: () => sidebar.setSidebarOpen(false),
  });

  const selectedModelOption = ollama.ollamaModels.find(
    (model) => model.id === sessions.selectedModel,
  );
  const modelSendReady =
    selectedModelOption?.provider === "openrouter"
      ? selectedModelOption.configured === true
      : selectedModelOption?.provider === "ollama" && ollama.ollamaReady;
  const openRouterReady = ollama.ollamaModels.some(
    (model) => model.provider === "openrouter" && model.configured === true,
  );
  const supportsImageInput =
    selectedModelOption?.inputCapabilities.includes(InputCapability.Image) ===
    true;
  const noProviderAvailable =
    ollama.catalogLoaded &&
    ollama.ollamaConnected === false &&
    !openRouterReady;

  const effectiveThinkingEffort = selectedModelOption?.reasoning
    ? resolveEffectiveThinkingEffort(
        selectedModelOption.reasoning,
        sessions.thinkingEffort,
      )
    : undefined;

  const stream = useRunStreaming({
    messages,
    setMessages,
    activeSessionId: sessions.activeSessionId,
    activeSessionIdRef,
    isEphemeralRef,
    userSettingsRef: settings.userSettingsRef,
    modelMessagesRef,
    debugOpenRef,
    debugOpen,
    setDebugOpen,
    setDebugData,
    selectedModel: sessions.selectedModel,
    reasoningEffort: effectiveThinkingEffort,
    modelSendReady: modelSendReady && sessions.sessionSendReady,
    refreshSessions: sessions.refreshSessions,
    fetchOllamaHealth: ollama.fetchOllamaHealth,
    bindStreamingReset,
    setEditingUserIndex,
    truncateConfirm,
    setTruncateConfirm,
    runFlightRef,
    supportsImageInput,
    isEphemeral: sessions.isEphemeral,
    startSession: sessions.startSession,
  });

  const modalSteps = traceStepsForModal(
    stepsModalData,
    stream.streamingSteps,
    stream.streamingStep,
  );

  return {
    sessions: sessions.sessions,
    activeSessionId: sessions.activeSessionId,
    messages,
    input: stream.input,
    setInput: stream.setInput,
    streamingStep: stream.streamingStep,
    streamingSteps: stream.streamingSteps,
    streamingContent: stream.streamingContent,
    streamingThinking: stream.streamingThinking,
    debugOpen,
    setDebugOpen,
    debugData,
    stepsModalData,
    setStepsModalData,
    sessionLoadState: sessions.sessionLoadState,
    sessionError: sessions.sessionError,
    retrySessionLoad: sessions.retrySessionLoad,
    sessionSendReady: sessions.sessionSendReady,
    sidebarOpen: sidebar.sidebarOpen,
    setSidebarOpen: sidebar.setSidebarOpen,
    sidebarCollapsed: sidebar.sidebarCollapsed,
    setSidebarCollapsed: sidebar.setSidebarCollapsed,
    renameSessionId: sessions.renameSessionId,
    setRenameSessionId: sessions.setRenameSessionId,
    editingUserIndex,
    setEditingUserIndex,
    truncateConfirm,
    setTruncateConfirm,
    pendingDeleteSessionId: sessions.pendingDeleteSessionId,
    setPendingDeleteSessionId: sessions.setPendingDeleteSessionId,
    ephemeralExitPromptOpen: sessions.ephemeralExitPromptOpen,
    resolveEphemeralExit: sessions.resolveEphemeralExit,
    runPending: stream.runPending,
    ollamaModels: ollama.ollamaModels,
    catalogLoaded: ollama.catalogLoaded,
    modelsLoadError: ollama.modelsLoadError,
    selectedModel: sessions.selectedModel,
    workspace: sessions.workspace,
    chooseDirectory: sessions.chooseDirectory,
    returnToSandbox: sessions.returnToSandbox,
    ollamaConnected: ollama.ollamaConnected,
    noProviderAvailable,
    modelSendReady: modelSendReady && sessions.sessionSendReady,
    thinkingEffort: sessions.thinkingEffort,
    handleThinkingEffortChange: sessions.handleThinkingEffortChange,
    handleModelChange: sessions.handleModelChange,
    isEphemeral: sessions.isEphemeral,
    userSettings: settings.userSettings,
    ollamaHost: ollama.ollamaHost,
    comfyuiHost: comfy.comfyuiHost,
    comfyuiConnected: comfy.comfyuiConnected,
    comfyuiDefaultModel: comfy.comfyuiDefaultModel,
    comfyuiDefaultWidth: comfy.comfyuiDefaultWidth,
    comfyuiDefaultHeight: comfy.comfyuiDefaultHeight,
    comfyuiNegativePrompt: comfy.comfyuiNegativePrompt,
    searxngHost: searxng.searxngHost,
    searxngConnected: searxng.searxngConnected,
    saveUserSettings: settings.saveUserSettings,
    refreshModels: ollama.refreshOllamaModels,
    switchToSession: sessions.switchToSession,
    startSession: sessions.startSession,
    createEphemeralSession: sessions.createEphemeralSession,
    goToHome: sessions.goToHome,
    sendMessage: stream.sendMessage,
    stopGeneration: stream.stopGeneration,
    confirmTruncateAndRetry: stream.confirmTruncateAndRetry,
    toggleDebug: stream.toggleDebug,
    requestDeleteSession: sessions.requestDeleteSession,
    performDeleteSession: sessions.performDeleteSession,
    saveSessionTitle: sessions.saveSessionTitle,
    modalSteps,
    renameTarget: sessions.renameTarget,
    pendingImages: stream.pendingImages,
    imageError: stream.imageError,
    addPendingImages: stream.addPendingImages,
    removePendingImage: stream.removePendingImage,
    canAttachImages: stream.canAttachImages,
    attachImageDisabledReason: stream.attachImageDisabledReason,
    attachmentsSendReady: stream.attachmentsSendReady,
  };
}
