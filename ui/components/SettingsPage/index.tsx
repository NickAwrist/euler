import { Save } from "lucide-react";
import { useUnsavedChanges } from "../../hooks/useUnsavedChanges";
import { cx } from "../../styles";
import { BackToChatButton } from "../BackToChatButton";
import { Button } from "../Button";
import { UnsavedChangesModal } from "../UnsavedChangesModal";
import { AppearanceSettingsTab } from "./AppearanceSettingsTab";
import { GeneralSettingsTab } from "./GeneralSettingsTab";
import { ImageGenerationTab } from "./ImageGenerationTab";
import { OllamaSettingsTab } from "./OllamaSettingsTab";
import { OpenRouterSettingsTab } from "./OpenRouterSettingsTab";
import { WebSearchTab } from "./WebSearchTab";
import { SETTINGS_TABS } from "./constants";
import type { SettingsPageProps } from "./types";
import { useEnvironmentSettings } from "./useEnvironmentSettings";
import { useSettingsPageState } from "./useSettingsPageState";

export function SettingsPage(props: SettingsPageProps) {
  const p = useSettingsPageState(props);
  const environment = useEnvironmentSettings();
  const { tab, onTabChange: setTab } = props;
  const { prompt, setPrompt, resolveLeave } = useUnsavedChanges(
    p.isDirty,
    "/settings/",
  );
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
        <BackToChatButton onClick={props.onBack} />
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

          {tab === "appearance" && (
            <AppearanceSettingsTab
              appearance={p.appearance.appearance}
              onChange={p.appearance.setAppearance}
            />
          )}

          {tab === "general" && (
            <GeneralSettingsTab
              settings={p.settings}
              onFieldChange={p.handleChange}
              availableModels={props.ollamaModels}
              catalogLoaded={props.catalogLoaded}
            />
          )}

          {tab === "ollama" && (
            <OllamaSettingsTab
              environmentManaged={environment.settings?.ollamaHost}
              ollamaUri={p.ollama.host}
              onOllamaUriInput={p.ollama.onHostInput}
              ollamaConnected={p.ollama.connected}
              testState={p.ollama.testState}
              onTestOllama={p.ollama.test}
            />
          )}

          {tab === "image-generation" && (
            <ImageGenerationTab
              environmentManaged={environment.settings?.comfyuiHost}
              comfyuiConnected={p.comfy.server.connected}
              comfyUri={p.comfy.server.host}
              onComfyUriInput={p.comfy.server.onHostInput}
              comfyTestState={p.comfy.server.testState}
              onTestComfyUI={p.comfy.server.test}
              comfyModel={p.comfy.model}
              setComfyModel={p.comfy.setModel}
              comfyModels={p.comfy.models}
              comfySize={p.comfy.size}
              setComfySize={p.comfy.setSize}
              comfyNegative={p.comfy.negative}
              setComfyNegative={p.comfy.setNegative}
            />
          )}

          {tab === "openrouter" && (
            <OpenRouterSettingsTab onModelsChanged={props.onModelsChanged} />
          )}

          {tab === "web-search" && (
            <WebSearchTab
              environmentManaged={environment.settings?.searxngHost}
              searxngConnected={p.searxng.connected}
              searxngUri={p.searxng.host}
              onSearxngUriInput={p.searxng.onHostInput}
              searxngTestState={p.searxng.testState}
              onTestSearXNG={p.searxng.test}
              brave={p.brave}
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
          changes={p.changes.map((change) => ({
            label: change.label,
            group: SETTINGS_TABS.find((tab) => tab.id === change.tab)?.label,
          }))}
          saving={p.isSaving}
          onStay={() => resolveLeave(false)}
          onDiscard={() => resolveLeave(true)}
          onSaveAndLeave={() => void handleSaveAndLeave()}
        />
      )}
      {prompt === "discard" && (
        <UnsavedChangesModal
          title="Discard changes?"
          changes={p.changes.map((change) => ({
            label: change.label,
            group: SETTINGS_TABS.find((tab) => tab.id === change.tab)?.label,
          }))}
          saving={p.isSaving}
          onStay={() => setPrompt(null)}
          onDiscard={confirmDiscard}
        />
      )}
    </div>
  );
}
