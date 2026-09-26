import { cx, eyebrowText } from "../../styles";
import {
  ConnectionTestFeedback,
  comfyConnectionFeedback,
} from "./ConnectionTestFeedback";
import { EnvironmentSettingHint } from "./EnvironmentSettingHint";
import {
  SIZE_PRESETS,
  hintClass,
  inputClass,
  labelClass,
  selectClass,
  sizeKey,
} from "./constants";
import type { ComfyUITestState } from "./types";

type Props = {
  comfyuiConnected: boolean | null;
  environmentManaged: boolean | undefined;
  comfyUri: string;
  onComfyUriInput: (v: string) => void;
  comfyTestState: ComfyUITestState;
  onTestComfyUI: () => void;
  comfyModel: string;
  setComfyModel: (v: string) => void;
  comfyModels: string[];
  comfySize: string;
  setComfySize: (v: string) => void;
  comfyNegative: string;
  setComfyNegative: (v: string) => void;
};

export function ImageGenerationTab({
  comfyuiConnected,
  environmentManaged,
  comfyUri,
  onComfyUriInput,
  comfyTestState,
  onTestComfyUI,
  comfyModel,
  setComfyModel,
  comfyModels,
  comfySize,
  setComfySize,
  comfyNegative,
  setComfyNegative,
}: Props) {
  return (
    <div className="space-y-4">
      <h2 className={cx(eyebrowText, "mb-4")}>ComfyUI</h2>

      <div className="space-y-2">
        <label htmlFor="comfyUri" className={labelClass}>
          Server URL
        </label>
        <div className="flex flex-wrap items-stretch gap-2 sm:flex-nowrap">
          <input
            type="text"
            id="comfyUri"
            aria-describedby="comfyUri-environment"
            value={comfyUri}
            disabled={environmentManaged !== false}
            onChange={(e) => onComfyUriInput(e.target.value)}
            placeholder="http://127.0.0.1:8188"
            autoComplete="off"
            className={cx(inputClass, "min-w-0 flex-1")}
          />
          <button
            type="button"
            onClick={() => void onTestComfyUI()}
            disabled={comfyTestState.status === "loading"}
            className="shrink-0 rounded-lg border border-border-subtle bg-muted/40 px-3 py-2 text-[0.875rem] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
          >
            {comfyTestState.status === "loading"
              ? "Testing..."
              : "Test connection"}
          </button>
        </div>
        <EnvironmentSettingHint
          id="comfyUri-environment"
          managed={environmentManaged}
        >
          Leave empty to use the default local ComfyUI address
          (http://127.0.0.1:8188).
        </EnvironmentSettingHint>
        <ConnectionTestFeedback
          {...comfyConnectionFeedback(comfyTestState, comfyuiConnected)}
        />
      </div>

      <hr className="border-border-subtle" />

      <div className="space-y-2">
        <label htmlFor="comfyModel" className={labelClass}>
          Default Checkpoint Model
        </label>
        <select
          id="comfyModel"
          value={comfyModel}
          onChange={(e) => setComfyModel(e.target.value)}
          className={selectClass}
        >
          <option value="">Auto (first available)</option>
          {comfyModels.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <p className={hintClass}>
          The checkpoint model used for image generation. Auto uses the first
          model ComfyUI reports.
        </p>
      </div>

      <hr className="border-border-subtle" />

      <div className="space-y-2">
        <label htmlFor="comfySize" className={labelClass}>
          Default Image Size
        </label>
        <select
          id="comfySize"
          value={comfySize}
          onChange={(e) => setComfySize(e.target.value)}
          className={selectClass}
        >
          {SIZE_PRESETS.map((preset) => {
            const key = sizeKey(preset.width, preset.height);
            return (
              <option key={key} value={key}>
                {preset.label}
              </option>
            );
          })}
        </select>
        <p className={hintClass}>Default resolution for generated images.</p>
      </div>

      <hr className="border-border-subtle" />

      <div className="space-y-2">
        <label htmlFor="comfyNegative" className={labelClass}>
          Negative Prompt
        </label>
        <textarea
          id="comfyNegative"
          value={comfyNegative}
          onChange={(e) => setComfyNegative(e.target.value)}
          placeholder="e.g., low quality, blurry, watermark, text"
          rows={4}
          className="min-h-[100px] w-full resize-y rounded-lg border border-border-subtle bg-surface px-3 py-2 text-[0.875rem] text-foreground placeholder:text-muted-foreground transition-colors focus:border-border focus:outline-none"
        />
        <p className={hintClass}>
          Applied to every generated image. Clear the field and save to use no
          negative prompt.
        </p>
      </div>
    </div>
  );
}
