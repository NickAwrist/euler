import {
  type Appearance,
  Appearance_ChatWidth,
  Appearance_CodeFont,
  Appearance_Font,
  Appearance_Theme,
  CHAT_WIDTH_SLUGS,
  CODE_FONT_SLUGS,
  FONT_SLUGS,
  THEME_SLUGS,
} from "../../persist/appearance";
import { cx, eyebrowText } from "../../styles";
import { MarkdownMessage } from "../MarkdownMessage";
import { EnableSwitch } from "../ModelPreferenceControls";
import { type Option, OptionSelect } from "./OptionSelect";
import { hintClass, labelClass } from "./constants";

export const themes: Option<Appearance_Theme>[] = [
  { id: Appearance_Theme.DEFAULT, name: "Default" },
  { id: Appearance_Theme.ONE_DARK, name: "One Dark" },
  { id: Appearance_Theme.DRACULA, name: "Dracula" },
  { id: Appearance_Theme.NORD, name: "Nord" },
  { id: Appearance_Theme.CATPPUCCIN, name: "Catppuccin" },
  { id: Appearance_Theme.GITHUB, name: "GitHub" },
];

const fonts: Option<Appearance_Font>[] = [
  { id: Appearance_Font.DEFAULT, name: "Default" },
  { id: Appearance_Font.SERIF, name: "Literary · Source Serif 4" },
  { id: Appearance_Font.GEIST, name: "Geist Sans" },
  { id: Appearance_Font.SOURCE_SANS, name: "Source Sans 3" },
  { id: Appearance_Font.ATKINSON, name: "Atkinson Hyperlegible Next" },
  { id: Appearance_Font.OPENDYSLEXIC, name: "OpenDyslexic" },
  { id: Appearance_Font.SYSTEM, name: "System" },
];

const codeFonts: Option<Appearance_CodeFont>[] = [
  { id: Appearance_CodeFont.DEFAULT, name: "Default" },
  { id: Appearance_CodeFont.GEIST_MONO, name: "Geist Mono" },
  { id: Appearance_CodeFont.JETBRAINS_MONO, name: "JetBrains Mono" },
  { id: Appearance_CodeFont.SOURCE_CODE, name: "Source Code Pro" },
];

const chatWidths: Option<Appearance_ChatWidth>[] = [
  { id: Appearance_ChatWidth.STANDARD, name: "Standard" },
  { id: Appearance_ChatWidth.COMFORTABLE, name: "Comfortable" },
  { id: Appearance_ChatWidth.WIDE, name: "Wide" },
  { id: Appearance_ChatWidth.FULL, name: "Full width" },
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
                value={THEME_SLUGS[theme.id]}
                checked={appearance.theme === theme.id}
                onChange={() => onChange({ ...appearance, theme: theme.id })}
                className="peer sr-only"
              />
              <div className="h-full rounded-lg border border-border-subtle p-3 peer-checked:border-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-foreground">
                <div
                  data-theme={THEME_SLUGS[theme.id]}
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
            slugs={FONT_SLUGS}
            onChange={(font) => onChange({ ...appearance, font })}
          />
          <OptionSelect
            id="code-font"
            label="Code block font"
            value={appearance.codeFont}
            options={codeFonts}
            slugs={CODE_FONT_SLUGS}
            onChange={(codeFont) => onChange({ ...appearance, codeFont })}
          />
        </div>
        <section
          aria-label="Response preview"
          data-theme={THEME_SLUGS[appearance.theme]}
          data-font={FONT_SLUGS[appearance.font]}
          data-code-font={CODE_FONT_SLUGS[appearance.codeFont]}
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
              slugs={CHAT_WIDTH_SLUGS}
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
