import { RotateCcw } from "lucide-react";
import { effectiveDefaultRunModel } from "../../lib/defaultModel";
import type { ModelOption } from "../../types";
import { IconButton } from "../IconButton";
import { ModelSelectBar } from "../ModelSelectBar";
import { hintClass, labelClass } from "./constants";

export function DefaultModelSetting({
  value,
  onChange,
  availableModels,
  catalogLoaded,
}: {
  value: string;
  onChange: (model: string) => void;
  availableModels: ModelOption[];
  catalogLoaded: boolean;
}) {
  const effectiveModel = effectiveDefaultRunModel(value, availableModels);
  return (
    <div className="space-y-2">
      <label htmlFor="run-model" className={labelClass}>
        Default Model
      </label>
      <div className="flex items-center gap-1">
        <ModelSelectBar
          ollamaModels={availableModels}
          ollamaConnected={catalogLoaded ? true : null}
          modelsLoadError={null}
          selectedModel={effectiveModel}
          onModelChange={onChange}
          disabled={!catalogLoaded || !effectiveModel}
        />
        <IconButton
          icon={RotateCcw}
          label="Reset default model"
          title="Reset to first available model"
          variant="ghost"
          disabled={!value}
          onClick={() => onChange("")}
          className="shrink-0"
        />
      </div>
      {!catalogLoaded ? (
        <p className={hintClass}>Loading models...</p>
      ) : !effectiveModel ? (
        <p className={hintClass}>
          No models available. Connect a provider and enable a model to start
          chatting.
        </p>
      ) : value && value !== effectiveModel ? (
        <p className={hintClass}>
          Saved model {value} is unavailable. New chats will use the model shown
          above.
        </p>
      ) : null}
    </div>
  );
}
