import { Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { setNavigationGuard } from "../../lib/navigation";
import { cx } from "../../styles";
import type { SettingsTab } from "../../types";
import { BackToChatButton } from "../BackToChatButton";
import { Button } from "../Button";
import { GeneralSettingsTab } from "./GeneralSettingsTab";
import { ImageGenerationTab } from "./ImageGenerationTab";
import { OllamaSettingsTab } from "./OllamaSettingsTab";
import { OpenRouterSettingsTab } from "./OpenRouterSettingsTab";
import { UnsavedChangesModal } from "./UnsavedChangesModal";
import { WebSearchTab } from "./WebSearchTab";
import type { SettingsPageProps } from "./types";
import { useEnvironmentSettings } from "./useEnvironmentSettings";
import { useSettingsPageState } from "./useSettingsPageState";

export function SettingsPage(props: SettingsPageProps) {
  const p = useSettingsPageState(props);
  const environment = useEnvironmentSettings();
  const [leavePromptOpen, setLeavePromptOpen] = useState(false);

  const { tab, onTabChange: setTab } = props;
  const allowLeave = useRef(false);
  const pendingLeave = useRef<((approved: boolean) => void) | null>(null);
  const requestLeave = () =>
    new Promise<boolean>((resolve) => {
      pendingLeave.current = resolve;
      setLeavePromptOpen(true);
    });
  useEffect(() => {
    if (!p.isDirty) return;
    const removeGuard = setNavigationGuard((path) =>
      path.startsWith("/settings/") || allowLeave.current
        ? Promise.resolve(true)
        : requestLeave(),
    );
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      removeGuard();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [p.isDirty]);
  const resolveLeave = (approved: boolean) => {
    allowLeave.current = approved;
    pendingLeave.current?.(approved);
    pendingLeave.current = null;
    setLeavePromptOpen(false);
  };
  const handleBack = async () => {
    if (!p.isDirty || (await requestLeave())) props.onBack();
  };
  const handleSaveAndLeave = async () => {
    if (await p.handleSubmit()) resolveLeave(true);
  };

  const tabButtonClass = (t: SettingsTab) =>
    cx(
      "rounded-t-md border-b-2 px-4 py-2 text-[0.8125rem] font-medium transition-colors",
      tab === t
        ? "border-foreground text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b border-border-subtle bg-background px-5 py-3">
        <BackToChatButton onClick={handleBack} />
        <div className="h-4 w-px bg-border-subtle" />
        <h1 className="text-[0.9375rem] font-semibold text-foreground">
          Settings
        </h1>
      </header>

      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border-subtle px-3 sm:px-5">
        <button
          type="button"
          className={tabButtonClass("general")}
          onClick={() => setTab("general")}
        >
          General
        </button>
        <button
          type="button"
          className={tabButtonClass("ollama")}
          onClick={() => setTab("ollama")}
        >
          Ollama
        </button>
        <button
          type="button"
          className={tabButtonClass("openrouter")}
          onClick={() => setTab("openrouter")}
        >
          OpenRouter
        </button>
        <button
          type="button"
          className={tabButtonClass("image-generation")}
          onClick={() => setTab("image-generation")}
        >
          Image Generation
        </button>
        <button
          type="button"
          className={tabButtonClass("web-search")}
          onClick={() => setTab("web-search")}
        >
          Web Search
        </button>
      </div>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-2xl space-y-6">
          {(p.error || environment.error) && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
              {p.error || environment.error}
            </div>
          )}

          {tab === "general" && (
            <GeneralSettingsTab
              settings={p.settings}
              onFieldChange={p.handleChange}
              availableModels={p.availableModels}
              catalogLoaded={props.catalogLoaded}
            />
          )}

          {tab === "ollama" && (
            <OllamaSettingsTab
              environmentManaged={environment.settings?.ollamaHost}
              ollamaUri={p.ollamaUri}
              onOllamaUriInput={p.onOllamaUriInput}
              ollamaConnected={props.ollamaConnected}
              testState={p.testState}
              onTestOllama={p.handleTestOllama}
            />
          )}

          {tab === "image-generation" && (
            <ImageGenerationTab
              environmentManaged={environment.settings?.comfyuiHost}
              comfyuiConnected={props.comfyuiConnected}
              comfyUri={p.comfyUri}
              onComfyUriInput={p.onComfyUriInput}
              comfyTestState={p.comfyTestState}
              onTestComfyUI={p.handleTestComfyUI}
              comfyModel={p.comfyModel}
              setComfyModel={p.setComfyModel}
              comfyModels={p.comfyModels}
              comfySize={p.comfySize}
              setComfySize={p.setComfySize}
              comfyNegative={p.comfyNegative}
              setComfyNegative={p.setComfyNegative}
            />
          )}

          {tab === "openrouter" && (
            <OpenRouterSettingsTab onModelsChanged={props.onModelsChanged} />
          )}

          {tab === "web-search" && (
            <WebSearchTab
              environmentManaged={environment.settings?.searxngHost}
              searxngConnected={props.searxngConnected}
              searxngUri={p.searxngUri}
              onSearxngUriInput={p.onSearxngUriInput}
              searxngTestState={p.searxngTestState}
              onTestSearXNG={p.handleTestSearXNG}
            />
          )}

          {tab !== "openrouter" && (
            <div className="flex justify-end border-t border-border-subtle pt-6">
              <Button
                variant="primary"
                disabled={!environment.settings || !p.isDirty || p.isSaving}
                loading={p.isSaving}
                icon={Save}
                onClick={() => void p.handleSubmit()}
              >
                Save settings
              </Button>
            </div>
          )}
        </div>
      </main>

      {leavePromptOpen && (
        <UnsavedChangesModal
          saving={p.isSaving}
          onStay={() => resolveLeave(false)}
          onDiscard={() => resolveLeave(true)}
          onSaveAndLeave={() => void handleSaveAndLeave()}
        />
      )}
    </div>
  );
}
