import { Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { addNavigationGuard } from "../../lib/navigation";
import { cx } from "../../styles";
import { BackToChatButton } from "../BackToChatButton";
import { Button } from "../Button";
import { GeneralSettingsTab } from "./GeneralSettingsTab";
import { ImageGenerationTab } from "./ImageGenerationTab";
import { OllamaSettingsTab } from "./OllamaSettingsTab";
import { OpenRouterSettingsTab } from "./OpenRouterSettingsTab";
import { UnsavedChangesModal } from "./UnsavedChangesModal";
import { WebSearchTab } from "./WebSearchTab";
import { SETTINGS_TABS } from "./constants";
import type { SettingsPageProps } from "./types";
import { useEnvironmentSettings } from "./useEnvironmentSettings";
import { useSettingsPageState } from "./useSettingsPageState";

export function SettingsPage(props: SettingsPageProps) {
  const p = useSettingsPageState(props);
  const environment = useEnvironmentSettings();
  const [prompt, setPrompt] = useState<"leave" | "discard" | null>(null);

  const { tab, onTabChange: setTab } = props;
  const allowLeave = useRef(false);
  const pendingLeave = useRef<((approved: boolean) => void) | null>(null);
  const requestLeave = () =>
    new Promise<boolean>((resolve) => {
      pendingLeave.current = resolve;
      setPrompt("leave");
    });
  useEffect(() => {
    if (!p.isDirty) return;
    return addNavigationGuard(async (path) => {
      if (path.startsWith("/settings/")) return true;
      const approved = allowLeave.current || (await requestLeave());
      // Approval applies to this attempt; another guard may still cancel it.
      allowLeave.current = false;
      return approved;
    });
  }, [p.isDirty]);
  const resolveLeave = (approved: boolean) => {
    allowLeave.current = approved;
    pendingLeave.current?.(approved);
    pendingLeave.current = null;
    setPrompt(null);
  };
  const handleBack = async () => {
    if (!p.isDirty || (await requestLeave())) props.onBack();
  };
  const handleSaveAndLeave = async () => {
    if (await p.handleSubmit()) resolveLeave(true);
  };

  const confirmDiscard = () => {
    p.discardChanges();
    setPrompt(null);
  };
  const dirtyTabs = SETTINGS_TABS.filter((t) =>
    p.changes.some((change) => change.tab === t.id),
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

      <div className="flex shrink-0 flex-wrap gap-x-1 border-b border-border-subtle px-3 sm:flex-nowrap sm:px-5">
        {SETTINGS_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={cx(
              "flex items-center gap-1.5 whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-[0.8125rem] font-medium transition-colors sm:px-4",
              tab === t.id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {dirtyTabs.includes(t) && (
              <span aria-hidden className="size-1.5 rounded-full bg-accent" />
            )}
          </button>
        ))}
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
        </div>
      </main>

      {p.isDirty && (
        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t border-border-subtle bg-background px-4 py-3 sm:px-6">
          <p className="mr-auto text-[0.8125rem] text-muted-foreground">
            Unsaved changes in {dirtyTabs.map((t) => t.label).join(", ")}
          </p>
          <Button
            variant="secondary"
            disabled={p.isSaving}
            onClick={() => setPrompt("discard")}
          >
            Discard
          </Button>
          <Button
            variant="primary"
            disabled={!environment.settings || p.isSaving}
            loading={p.isSaving}
            icon={Save}
            onClick={() => void p.handleSubmit()}
          >
            Save settings
          </Button>
        </footer>
      )}

      {prompt === "leave" && (
        <UnsavedChangesModal
          title="Leave settings?"
          changes={p.changes}
          saving={p.isSaving}
          onStay={() => resolveLeave(false)}
          onDiscard={() => resolveLeave(true)}
          onSaveAndLeave={() => void handleSaveAndLeave()}
        />
      )}
      {prompt === "discard" && (
        <UnsavedChangesModal
          title="Discard changes?"
          changes={p.changes}
          saving={p.isSaving}
          onStay={() => setPrompt(null)}
          onDiscard={confirmDiscard}
        />
      )}
    </div>
  );
}
