import { ArrowLeft } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useSavedDraft } from "../hooks/useSavedDraft";
import { effectiveDefaultRunModel } from "../lib/defaultModel";
import { completeOnboarding } from "../persist/onboarding";
import type { UserSettings } from "../persist/userSettings";
import type { ComfyUIConfigPayload, ModelOption } from "../types";
import { Button } from "./Button";
import { PersonalizationFields } from "./CustomizationPage/PersonalizationFields";
import { type OnboardingSection, OnboardingShell } from "./OnboardingShell";
import {
  AppearanceSettingsTab,
  themes,
} from "./SettingsPage/AppearanceSettingsTab";
import { BraveSettings } from "./SettingsPage/BraveSettings";
import { DefaultModelSetting } from "./SettingsPage/DefaultModelSetting";
import { ImageGenerationTab } from "./SettingsPage/ImageGenerationTab";
import { OllamaSettingsTab } from "./SettingsPage/OllamaSettingsTab";
import { OpenRouterSettingsTab } from "./SettingsPage/OpenRouterSettingsTab";
import { useAppearanceDraft } from "./SettingsPage/useAppearanceDraft";
import { useBraveSettings } from "./SettingsPage/useBraveSettings";
import { useEnvironmentSettings } from "./SettingsPage/useEnvironmentSettings";
import {
  type ServiceStatus,
  useComfyUIDraft,
  useOllamaDraft,
} from "./SettingsPage/useProviderDrafts";

type SetupStep = {
  title: string;
  description: string | null;
  content: ReactNode;
  /** Saves this step's draft; resolves false when the step shows its own error. */
  save: () => Promise<boolean | undefined>;
  /** Drops this step's draft so a later save cannot include it. */
  discard: () => void;
  /** Configures server-wide services, whose fields need the environment settings. */
  sharedServices?: boolean;
};
type SetupSection = Omit<OnboardingSection, "steps"> & { steps: SetupStep[] };

function servicesSummary(services: [string, ServiceStatus][]): string {
  return (
    services
      .filter(([, status]) => status)
      .map(([name, status]) => `${name} ${status}`)
      .join(", ") || "None set up"
  );
}

type Props = {
  settings: UserSettings;
  models: ModelOption[];
  catalogLoaded: boolean;
  ollama: { host: string; connected: boolean | null };
  comfyui: ComfyUIConfigPayload & { connected: boolean | null };
  onSavePreferences: (updates: Partial<UserSettings>) => Promise<void>;
  onSaveOllamaHost: (host: string) => Promise<void>;
  onSaveComfyUI: (config: ComfyUIConfigPayload) => Promise<void>;
  onModelsChanged: () => Promise<void>;
  onComplete: () => void;
};
export function Onboarding({
  settings,
  models,
  catalogLoaded,
  ollama,
  comfyui,
  onSavePreferences,
  onSaveOllamaHost,
  onSaveComfyUI,
  onModelsChanged,
  onComplete,
}: Props) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const environment = useEnvironmentSettings();
  const aboutYou = useSavedDraft(settings);
  const appearance = useAppearanceDraft();
  const [openRouterKey, setOpenRouterKey] = useState(false);
  const ollamaDraft = useOllamaDraft(ollama.host, ollama.connected);
  const defaultModel = useSavedDraft(settings.defaultModel);
  const comfy = useComfyUIDraft(comfyui, comfyui.connected);
  const brave = useBraveSettings();
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const { name, location, preferredFormats } = aboutYou.value;
  const selectedModel = effectiveDefaultRunModel(defaultModel.value, models);
  const sections: SetupSection[] = [
    {
      title: "About you",
      summary: [name, location].filter(Boolean).join(", ") || "Not set",
      steps: [
        {
          title: "About you",
          description:
            "Euler adds these to the instructions for every chat. Fill in as many as you like.",
          content: (
            <div className="space-y-5">
              <PersonalizationFields
                settings={aboutYou.value}
                onChange={(key, value) =>
                  aboutYou.setValue((previous) => ({
                    ...previous,
                    [key]: value,
                  }))
                }
              />
            </div>
          ),
          save: async () => {
            if (
              name !== settings.name ||
              location !== settings.location ||
              preferredFormats !== settings.preferredFormats
            )
              await onSavePreferences({ name, location, preferredFormats });
            aboutYou.accept();
            return true;
          },
          discard: aboutYou.reset,
        },
      ],
    },
    {
      title: "Appearance",
      summary: `${themes.find((theme) => theme.id === appearance.appearance.theme)?.name} theme`,
      steps: [
        {
          title: "Appearance",
          description: null,
          content: (
            <AppearanceSettingsTab
              compact
              appearance={appearance.appearance}
              onChange={appearance.setAppearance}
            />
          ),
          save: async () => {
            if (appearance.changes.length > 0) appearance.save();
            return true;
          },
          discard: appearance.reset,
        },
      ],
    },
    {
      title: "Model providers",
      summary: servicesSummary([
        ["OpenRouter", openRouterKey ? "configured" : null],
        ["Ollama", ollamaDraft.status],
      ]),
      steps: [
        {
          title: "Cloud models",
          description:
            "Add an OpenRouter key, then choose which publishers' models appear in the composer.",
          sharedServices: true,
          content: (
            <OpenRouterSettingsTab
              onModelsChanged={onModelsChanged}
              onKeyStatusChange={setOpenRouterKey}
            />
          ),
          // The key and model choices save as they change.
          save: async () => true,
          discard: () => {},
        },
        {
          title: "Local models",
          description: "Run models on your own hardware with Ollama.",
          sharedServices: true,
          content: (
            <OllamaSettingsTab
              environmentManaged={environment.settings?.ollamaHost}
              ollamaUri={ollamaDraft.host}
              onOllamaUriInput={ollamaDraft.onHostInput}
              ollamaConnected={ollamaDraft.connected}
              testState={ollamaDraft.testState}
              onTestOllama={ollamaDraft.test}
            />
          ),
          save: async () => {
            if (!ollamaDraft.dirty) return true;
            await onSaveOllamaHost(ollamaDraft.host);
            ollamaDraft.accept();
            await onModelsChanged();
            return true;
          },
          discard: ollamaDraft.reset,
        },
      ],
    },
    {
      title: "Default model",
      summary:
        models.find((model) => model.id === selectedModel)?.name ?? "None",
      steps: [
        {
          title: "Default model",
          description:
            "New chats start with this model. You can switch in any chat.",
          content: (
            <DefaultModelSetting
              value={defaultModel.value}
              onChange={defaultModel.setValue}
              availableModels={models}
              catalogLoaded={catalogLoaded}
            />
          ),
          save: async () => {
            if (defaultModel.value !== settings.defaultModel)
              await onSavePreferences({ defaultModel: defaultModel.value });
            defaultModel.accept();
            return true;
          },
          discard: defaultModel.reset,
        },
      ],
    },
    {
      title: "Tools",
      summary: servicesSummary([
        ["ComfyUI", comfy.server.status],
        ["Brave Search", brave.settings?.hasKey ? "configured" : null],
      ]),
      steps: [
        {
          title: "Image generation",
          description: "Connect ComfyUI to generate images in chat.",
          sharedServices: true,
          content: (
            <ImageGenerationTab
              compact
              environmentManaged={environment.settings?.comfyuiHost}
              comfyuiConnected={comfy.server.connected}
              comfyUri={comfy.server.host}
              onComfyUriInput={comfy.server.onHostInput}
              comfyTestState={comfy.server.testState}
              onTestComfyUI={comfy.server.test}
              comfyModel={comfy.model}
              setComfyModel={comfy.setModel}
              comfyModels={comfy.models}
              comfySize={comfy.size}
              setComfySize={comfy.setSize}
              comfyNegative={comfy.negative}
              setComfyNegative={comfy.setNegative}
            />
          ),
          save: async () => {
            if (comfy.changes.length === 0) return true;
            await onSaveComfyUI(comfy.config);
            comfy.accept();
            return true;
          },
          discard: comfy.reset,
        },
        {
          title: "Web search",
          description: null,
          sharedServices: true,
          content: <BraveSettings brave={brave} actions={false} />,
          save: async () =>
            brave.key.trim() ? brave.save(brave.key.trim()) : true,
          discard: brave.reset,
        },
      ],
    },
  ];
  const steps = sections.flatMap((section) =>
    section.steps.map((item) => ({
      ...item,
      group: section.steps.length > 1 ? section.title : null,
    })),
  );
  const lastStep = steps.length - 1;
  const current = steps[step];
  const environmentError = current?.sharedServices && environment.error;

  const goToStep = (next: number) => {
    setError(null);
    setStep(next);
  };
  const advance = async (skip: boolean) => {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      if (skip) current.discard();
      else if (!(await current.save())) return;
      if (step === lastStep) {
        completeOnboarding();
        onComplete();
      } else setStep(step + 1);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save setup. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <OnboardingShell
      sections={sections}
      step={step}
      busy={busy}
      onSelectStep={goToStep}
      content={
        <div key={step} className="onboarding-step">
          {current?.group && (
            <p className="mb-1 text-[0.75rem] font-medium text-muted-foreground">
              {current.group}
            </p>
          )}
          <h1
            ref={heading}
            tabIndex={-1}
            className="text-[1.25rem] font-semibold tracking-[-0.01em] outline-none"
          >
            {current?.title}
          </h1>
          {current?.description && (
            <p className="mt-1.5 text-[0.875rem] leading-relaxed text-muted-foreground">
              {current.description}
            </p>
          )}
          {current?.sharedServices && (
            <p className="mt-1.5 text-[0.75rem] text-muted-foreground">
              Shared with everyone on this Euler server.
            </p>
          )}
          {(error || environmentError) && (
            <div
              role="alert"
              className="mt-6 space-y-3 rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400"
            >
              {error ? (
                <p>{error}</p>
              ) : (
                <>
                  <p>
                    Could not load shared settings. Retry before connecting a
                    service.
                  </p>
                  <Button variant="secondary" onClick={environment.reload}>
                    Retry
                  </Button>
                </>
              )}
            </div>
          )}
          <div className="mt-7">{current?.content}</div>
        </div>
      }
      actions={
        <>
          <Button
            variant="ghost"
            icon={ArrowLeft}
            disabled={busy || step === 0}
            className="-ml-3"
            onClick={() => goToStep(step - 1)}
          >
            Back
          </Button>
          <div className="flex-1" />
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void advance(true)}
          >
            Skip
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            loading={busy}
            onClick={() => void advance(false)}
          >
            {step === lastStep ? "Finish setup" : "Continue"}
          </Button>
        </>
      }
    />
  );
}
