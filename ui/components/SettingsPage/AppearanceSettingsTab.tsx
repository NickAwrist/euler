import type { Appearance } from "../../persist/appearance";
import { cx, eyebrowText } from "../../styles";
import { MarkdownMessage } from "../MarkdownMessage";
import { EnableSwitch } from "../ModelPreferenceControls";
import { hintClass, labelClass, selectClass } from "./constants";

type Option<T extends string> = { id: T; name: string };

export const themes: Option<Appearance["theme"]>[] = [
  { id: "default", name: "Default" },
  { id: "one-dark", name: "One Dark" },
  { id: "dracula", name: "Dracula" },
  { id: "nord", name: "Nord" },
  { id: "catppuccin", name: "Catppuccin" },
  { id: "github", name: "GitHub" },
];

const fonts: Option<Appearance["font"]>[] = [
  { id: "default", name: "Default" },
  { id: "serif", name: "Literary · Source Serif 4" },
  { id: "geist", name: "Geist Sans" },
  { id: "source-sans", name: "Source Sans 3" },
  { id: "atkinson", name: "Atkinson Hyperlegible Next" },
  { id: "opendyslexic", name: "OpenDyslexic" },
  { id: "system", name: "System" },
];

const codeFonts: Option<Appearance["codeFont"]>[] = [
  { id: "default", name: "Default" },
  { id: "geist-mono", name: "Geist Mono" },
  { id: "jetbrains-mono", name: "JetBrains Mono" },
  { id: "source-code", name: "Source Code Pro" },
];

const chatWidths: Option<Appearance["chatWidth"]>[] = [
  { id: "standard", name: "Standard" },
  { id: "comfortable", name: "Comfortable" },
  { id: "wide", name: "Wide" },
  { id: "full", name: "Full width" },
];

const responsePreview = [
  "Here's a small function that adds up your values. It accepts a list of numbers and returns the **total**.",
  "",
  "```javascript",
  "function sum(values) {",
  "  return values.reduce(",
  "    (total, value) => total + value, 0",
  "  );",
  "}",
  "",
  "sum([12, 18, 24]); // 54",
  "```",
  "",
  "An empty list returns **0**, so you can use it without a separate check.",
].join("\n");

function OptionSelect<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="min-w-0 max-w-64 space-y-2">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <select
        id={id}
        className={selectClass}
        value={value}
        onChange={(event) => {
          const option = options.find(
            (candidate) => candidate.id === event.target.value,
          );
          if (option) onChange(option.id);
        }}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function ShiftSwitch({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <EnableSwitch
        id={id}
        label={label}
        checked={checked}
        onChange={onChange}
      />
      <div className="space-y-0.5">
        <label htmlFor={id} className={labelClass}>
          {label}
        </label>
        <p className={hintClass}>{hint}</p>
      </div>
    </div>
  );
}

export function AppearanceSettingsTab({
  appearance,
  onChange,
  compact = false,
}: {
  compact?: boolean;
  appearance: Appearance;
  onChange: (appearance: Appearance) => void;
}) {
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className={cx(eyebrowText, "mb-4")}>Color theme</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {themes.map((theme) => (
            <label key={theme.id} className="relative cursor-pointer">
              <input
                type="radio"
                name="color-theme"
                value={theme.id}
                checked={appearance.theme === theme.id}
                onChange={() => onChange({ ...appearance, theme: theme.id })}
                className="peer sr-only"
              />
              <div className="h-full rounded-lg border border-border-subtle p-3 peer-checked:border-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-foreground">
                <div
                  data-theme={theme.id}
                  aria-hidden="true"
                  className="mb-3 flex h-20 overflow-hidden rounded-md border border-border-subtle bg-background"
                >
                  <div className="w-1/5 border-r border-border-subtle bg-surface" />
                  <div className="flex flex-1 flex-col justify-center gap-2 px-4">
                    <div className="h-1.5 w-3/4 rounded bg-foreground/70" />
                    <div className="h-1.5 w-1/2 rounded bg-muted-foreground/60" />
                    <div className="h-3 w-8 rounded-sm bg-accent" />
                  </div>
                </div>
                <span className="block text-sm font-medium">{theme.name}</span>
              </div>
            </label>
          ))}
        </div>
      </fieldset>

      <hr className="border-border-subtle" />

      <div className="space-y-4">
        <h2 className={eyebrowText}>Typography</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <OptionSelect
            id="interface-font"
            label="Font style"
            value={appearance.font}
            options={fonts}
            onChange={(font) => onChange({ ...appearance, font })}
          />
          <OptionSelect
            id="code-font"
            label="Code block font"
            value={appearance.codeFont}
            options={codeFonts}
            onChange={(codeFont) => onChange({ ...appearance, codeFont })}
          />
        </div>
        <section
          aria-label="Response preview"
          data-theme={appearance.theme}
          data-font={appearance.font}
          data-code-font={appearance.codeFont}
          className="rounded-lg border border-border-subtle bg-background p-4 font-sans sm:p-5"
        >
          <h3 className="mb-3 text-xs font-medium text-muted-foreground">
            Response preview
          </h3>
          <MarkdownMessage className="text-foreground">
            {responsePreview}
          </MarkdownMessage>
        </section>
      </div>

      {!compact && (
        <>
          <hr className="border-border-subtle" />

          <div className="space-y-4">
            <h2 className={eyebrowText}>Layout</h2>
            <OptionSelect
              id="chat-width"
              label="Chat width"
              value={appearance.chatWidth}
              options={chatWidths}
              onChange={(chatWidth) => onChange({ ...appearance, chatWidth })}
            />
            <ShiftSwitch
              id="shift-for-chat-list"
              label="Make room for the chat list"
              hint="Always move the chat aside when the chat list opens. When off, the list slides over empty space and only nudges the chat if it would cover messages."
              checked={appearance.shiftForChatList}
              onChange={(shiftForChatList) =>
                onChange({ ...appearance, shiftForChatList })
              }
            />
            <ShiftSwitch
              id="shift-for-artifacts"
              label="Make room for artifacts"
              hint="Always move the chat aside when the artifacts panel opens. When off, the panel slides over empty space and only nudges the chat if it would cover messages."
              checked={appearance.shiftForArtifacts}
              onChange={(shiftForArtifacts) =>
                onChange({ ...appearance, shiftForArtifacts })
              }
            />
            <div className="max-w-64 space-y-2">
              <div className="flex items-baseline justify-between">
                <label htmlFor="sidebar-animation" className={labelClass}>
                  Sidebar animation
                </label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {appearance.sidebarAnimationMs} ms
                </span>
              </div>
              <input
                id="sidebar-animation"
                type="range"
                min={0}
                max={600}
                step={25}
                value={appearance.sidebarAnimationMs}
                aria-valuetext={`${appearance.sidebarAnimationMs} ms`}
                onChange={(event) =>
                  onChange({
                    ...appearance,
                    sidebarAnimationMs: event.target.valueAsNumber,
                  })
                }
                className="w-full accent-foreground"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
