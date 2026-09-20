import { Save } from "lucide-react";
import { useState } from "react";
import { cx } from "../../styles";
import { BackToChatButton } from "../BackToChatButton";
import { Button } from "../Button";
import { GeneralSettingsTab } from "./GeneralSettingsTab";
import { ImageGenerationTab } from "./ImageGenerationTab";
import { OllamaSettingsTab } from "./OllamaSettingsTab";
import { OpenRouterSettingsTab } from "./OpenRouterSettingsTab";
import { UnsavedChangesModal } from "./UnsavedChangesModal";
import { WebSearchTab } from "./WebSearchTab";
import type { SettingsPageProps } from "./types";
import type { SettingsTab } from "./types";
import { useSettingsPageState } from "./useSettingsPageState";

export function SettingsPage(props: SettingsPageProps) {
  const p = useSettingsPageState(props);
  const [leavePromptOpen, setLeavePromptOpen] = useState(false);

  const leave = () => {
    if (window.location.hash === "#settings/openrouter")
      history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search,
      );
    props.onBack();
  };
  const handleBack = () => {
    if (p.isDirty) {
      setLeavePromptOpen(true);
      return;
    }
    leave();
  };
  const handleSaveAndLeave = async () => {
    if (await p.handleSubmit()) leave();
  };

  const tabButtonClass = (t: SettingsTab) =>
    cx(
      "rounded-t-md border-b-2 px-4 py-2 text-[0.8125rem] font-medium transition-colors",
      p.tab === t
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
          onClick={() => p.setTab("general")}
        >
          General
        </button>
        <button
          type="button"
          className={tabButtonClass("ollama")}
          onClick={() => p.setTab("ollama")}
        >
          Ollama
        </button>
        <button
          type="button"
          className={tabButtonClass("openrouter")}
          onClick={() => p.setTab("openrouter")}
        >
          OpenRouter
        </button>
        <button
          type="button"
          className={tabButtonClass("image-generation")}
          onClick={() => p.setTab("image-generation")}
        >
          Image Generation
        </button>
        <button
          type="button"
          className={tabButtonClass("web-search")}
          onClick={() => p.setTab("web-search")}
        >
          Web Search
        </button>
      </div>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-2xl space-y-6">
          {p.error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
              {p.error}
            </div>
          )}

          {p.tab === "general" && (
            <GeneralSettingsTab
              settings={p.settings}
              onFieldChange={p.handleChange}
              availableModels={p.availableModels}
            />
          )}

          {p.tab === "ollama" && (
            <OllamaSettingsTab
              ollamaUri={p.ollamaUri}
              onOllamaUriInput={p.onOllamaUriInput}
              ollamaConnected={props.ollamaConnected}
              testState={p.testState}
              onTestOllama={p.handleTestOllama}
            />
          )}

          {p.tab === "image-generation" && (
            <ImageGenerationTab
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

          {p.tab === "openrouter" && (
            <OpenRouterSettingsTab onModelsChanged={props.onModelsChanged} />
          )}

          {p.tab === "web-search" && (
            <WebSearchTab
              searxngConnected={props.searxngConnected}
              searxngUri={p.searxngUri}
              onSearxngUriInput={p.onSearxngUriInput}
              searxngTestState={p.searxngTestState}
              onTestSearXNG={p.handleTestSearXNG}
            />
          )}

          {p.tab !== "openrouter" && (
            <div className="flex justify-end border-t border-border-subtle pt-6">
              <Button
                variant="primary"
                disabled={!p.isDirty || p.isSaving}
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
          onStay={() => setLeavePromptOpen(false)}
          onDiscard={leave}
          onSaveAndLeave={() => void handleSaveAndLeave()}
        />
      )}
    </div>
  );
}
