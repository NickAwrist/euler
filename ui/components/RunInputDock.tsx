import {
  ArrowUp,
  BookOpen,
  Command,
  Folder,
  ImagePlus,
  Square,
  Upload,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { hasConfigurableThinking } from "../lib/thinkingLevel";
import { type SkillData, fetchSkills } from "../persist/skills";
import { cx, iconButton, primaryButton } from "../styles";
import type { MessageStep, ModelOption, SessionWorkspace } from "../types";
import { AgentSelectBar } from "./AgentSelectBar";
import { ModelSelectBar } from "./ModelSelectBar";
import { ThinkingLevelBar } from "./ThinkingLevelBar";
import {
  type RunCommandName,
  exactRunCommand,
  matchingRunCommands,
} from "./runCommands";
import {
  completeSkillToken,
  filterAssignedSkills,
  findActiveSkillToken,
} from "./skillPicker";

export function RunInputDock({
  ollamaModels,
  ollamaConnected,
  modelsLoadError,
  selectedModel,
  onModelChange,
  thinkingEffort,
  onThinkingEffortChange,
  runAgents,
  selectedSessionAgent,
  onSessionAgentChange,
  input,
  setInput,
  onSendMessage,
  onStopGeneration,
  runPending,
  streamingStep,
  streamingSteps,
  modelSendReady,
  pendingImages,
  imageError,
  addPendingImages,
  removePendingImage,
  supportsImageInput,
  canAttachImages,
  attachImageDisabledReason,
  attachmentsSendReady,
  assignedSkillIds,
  workspace,
  onRunCommand,
  onFooterHeightChange,
}: {
  ollamaModels: ModelOption[];
  ollamaConnected: boolean | null;
  modelsLoadError: string | null;
  selectedModel: string;
  onModelChange: (model: string) => void;
  thinkingEffort?: string | null;
  onThinkingEffortChange?: (effort: string) => void;
  runAgents: { name: string }[];
  selectedSessionAgent: string;
  onSessionAgentChange: (name: string) => void;
  input: string;
  setInput: (v: string) => void;
  onSendMessage: (e: React.FormEvent) => void;
  onStopGeneration: () => void;
  runPending: boolean;
  streamingStep: MessageStep | null;
  streamingSteps: MessageStep[];
  modelSendReady: boolean;
  pendingImages: Array<{ id: string; file: File; previewUrl: string }>;
  imageError: string | null;
  addPendingImages: (files: File[]) => void;
  removePendingImage: (id: string) => void;
  supportsImageInput: boolean;
  canAttachImages: boolean;
  attachImageDisabledReason?: string;
  attachmentsSendReady: boolean;
  assignedSkillIds: string[];
  workspace: SessionWorkspace;
  onRunCommand: (command: RunCommandName) => void | Promise<void>;
  onFooterHeightChange: (heightPx: number) => void;
}) {
  const footerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [isFileDragActive, setIsFileDragActive] = useState(false);
  const [skills, setSkills] = useState<SkillData[]>([]);
  const [caretIndex, setCaretIndex] = useState(input.length);
  const [selectedSkillIndex, setSelectedSkillIndex] = useState(0);
  const [skillPickerDismissed, setSkillPickerDismissed] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const isBusy =
    runPending || streamingStep !== null || streamingSteps.length > 0;
  const currentModelOption = ollamaModels.find(
    (model) => model.id === selectedModel,
  );
  const canSend = modelSendReady && attachmentsSendReady && !isBusy;
  const activeSkillToken = skillPickerDismissed
    ? null
    : findActiveSkillToken(input, caretIndex);
  const matchingSkills = activeSkillToken
    ? filterAssignedSkills(skills, assignedSkillIds)
        .filter((skill) => skill.name.startsWith(activeSkillToken.query))
        .slice(0, 8)
    : [];
  const skillPickerOpen = !isBusy && matchingSkills.length > 0;
  const matchingCommands = matchingRunCommands(input, workspace.kind);
  const commandPickerOpen = !isBusy && matchingCommands.length > 0;

  const runCommand = (command: RunCommandName) => {
    setInput("");
    setSelectedCommandIndex(0);
    void onRunCommand(command);
  };

  useEffect(() => {
    let cancelled = false;
    void fetchSkills()
      .then((availableSkills) => {
        if (!cancelled) setSkills(availableSkills);
      })
      .catch(() => {
        if (!cancelled) setSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSelectedSkillIndex(0);
  }, [activeSkillToken?.query]);

  useEffect(() => {
    if (selectedSkillIndex < matchingSkills.length) return;
    setSelectedSkillIndex(Math.max(0, matchingSkills.length - 1));
  }, [matchingSkills.length, selectedSkillIndex]);

  useEffect(() => {
    if (selectedCommandIndex < matchingCommands.length) return;
    setSelectedCommandIndex(Math.max(0, matchingCommands.length - 1));
  }, [matchingCommands.length, selectedCommandIndex]);

  const selectSkill = (skill: SkillData) => {
    if (!activeSkillToken) return;
    const completed = completeSkillToken(input, activeSkillToken, skill.name);
    setInput(completed.value);
    setCaretIndex(completed.caret);
    setSkillPickerDismissed(true);
    queueMicrotask(() => {
      const textarea = inputRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(completed.caret, completed.caret);
    });
  };

  const syncInputHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const maxPx = window.innerHeight * 0.3;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`;
  }, []);

  useLayoutEffect(() => {
    syncInputHeight();
  }, [input, syncInputHeight]);

  useLayoutEffect(() => {
    const onResize = () => syncInputHeight();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [syncInputHeight]);

  useLayoutEffect(() => {
    const el = footerRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.offsetHeight;
      if (h > 0) onFooterHeightChange(h);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onFooterHeightChange]);

  return (
    <div
      ref={footerRef}
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2 border-t border-border-subtle/60 bg-background/[0.16] px-5 pb-4 pt-3 shadow-[0_-1px_0_0_rgba(255,255,255,0.03)] backdrop-blur-xl backdrop-saturate-125 max-[640px]:px-3.5 max-[640px]:pb-3.5 max-[640px]:pt-2.5"
    >
      {workspace.kind === "local" && (
        <div className="pointer-events-auto flex w-full max-w-3xl items-center gap-2 px-1 text-xs text-muted-foreground">
          <Folder size={13} />
          <span className="min-w-0 truncate" title={workspace.path}>
            Working in {workspace.label}
          </span>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const command = exactRunCommand(input);
          if (command) {
            runCommand(command);
            return;
          }
          onSendMessage(e);
        }}
        onDragEnter={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          dragDepthRef.current += 1;
          setIsFileDragActive(true);
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect =
            canAttachImages && !isBusy ? "copy" : "none";
        }}
        onDragLeave={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) setIsFileDragActive(false);
        }}
        onDrop={(e) => {
          const files = Array.from(e.dataTransfer.files);
          dragDepthRef.current = 0;
          setIsFileDragActive(false);
          if (files.length === 0) return;
          e.preventDefault();
          addPendingImages(files);
        }}
        className={cx(
          "pointer-events-auto relative flex w-full max-w-3xl flex-col gap-1 rounded-xl border bg-surface px-[10px] py-1 transition-[border-color,background-color,box-shadow] duration-150 ease-out focus-within:border-border focus-within:shadow-[0_0_0_1px_var(--color-accent-ring)]",
          isFileDragActive
            ? "border-accent/60 bg-accent-soft-strong shadow-[0_0_0_3px_var(--color-accent-ring)]"
            : "border-border-subtle",
        )}
      >
        {commandPickerOpen && (
          <div
            id="command-picker"
            className="ui-animate-slide-up absolute inset-x-0 bottom-[calc(100%+8px)] z-40 overflow-hidden rounded-xl border border-border-subtle bg-surface p-1.5 shadow-[0_14px_36px_rgba(0,0,0,0.42)]"
            aria-label="Chat commands"
          >
            {matchingCommands.map((command, index) => (
              <button
                key={command.name}
                type="button"
                aria-current={index === selectedCommandIndex}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setSelectedCommandIndex(index)}
                onClick={() => runCommand(command.name)}
                className={cx(
                  "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left",
                  index === selectedCommandIndex
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Command size={14} className="shrink-0" />
                <span className="font-mono text-[0.8125rem] text-foreground">
                  /{command.name}
                </span>
                <span className="truncate text-xs">{command.description}</span>
              </button>
            ))}
          </div>
        )}
        {skillPickerOpen && (
          <div
            id="skill-picker"
            className="ui-animate-slide-up absolute inset-x-0 bottom-[calc(100%+8px)] z-30 overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-[0_14px_36px_rgba(0,0,0,0.42)]"
            aria-label="Available skills"
          >
            <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              <BookOpen size={13} />
              Skills
            </div>
            <div className="max-h-64 overflow-y-auto p-1.5">
              {matchingSkills.map((skill, index) => (
                <button
                  key={skill.id}
                  type="button"
                  aria-current={index === selectedSkillIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setSelectedSkillIndex(index)}
                  onClick={() => selectSkill(skill)}
                  className={cx(
                    "flex w-full min-w-0 items-start gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                    index === selectedSkillIndex
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <span className="shrink-0 font-mono text-[0.8125rem] font-medium text-foreground">
                    ${skill.name}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[0.75rem] leading-[1.45]">
                    {skill.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div
          aria-hidden={!isFileDragActive}
          className={cx(
            "pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] border border-dashed border-accent/60 bg-surface/95 text-accent backdrop-blur-sm transition-[opacity,transform,visibility] duration-150 ease-out",
            isFileDragActive
              ? "visible scale-100 opacity-100"
              : "invisible scale-[0.985] opacity-0",
          )}
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <Upload size={17} strokeWidth={2} />
            <span>Drop to attach</span>
          </div>
        </div>
        {pendingImages.length > 0 && (
          <div className="flex max-w-full gap-2 overflow-x-auto px-1 pt-1">
            {pendingImages.map((image) => (
              <div
                key={image.id}
                className="group/image relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-border-subtle bg-muted"
              >
                <img
                  src={image.previewUrl}
                  alt={image.file.name}
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removePendingImage(image.id)}
                  disabled={isBusy}
                  className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-background/85 text-foreground shadow-sm backdrop-blur hover:bg-background disabled:opacity-50"
                  aria-label={`Remove ${image.file.name}`}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        {imageError && (
          <p className="px-1 pt-1 text-xs text-red-300" role="alert">
            {imageError}
          </p>
        )}
        <div className="flex w-full items-end gap-1">
          {supportsImageInput && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                className="hidden"
                onChange={(e) => {
                  addPendingImages(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isBusy || !canAttachImages}
                className={cx(
                  iconButton,
                  "mb-0.5 size-9 shrink-0 border-transparent p-0",
                )}
                title={attachImageDisabledReason ?? "Add images"}
                aria-label={attachImageDisabledReason ?? "Add images"}
              >
                <ImagePlus size={17} />
              </button>
            </>
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setCaretIndex(e.currentTarget.selectionStart);
              setSkillPickerDismissed(false);
            }}
            onClick={(e) => {
              setCaretIndex(e.currentTarget.selectionStart);
              setSkillPickerDismissed(false);
            }}
            onSelect={(e) => setCaretIndex(e.currentTarget.selectionStart)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length > 0) {
                e.preventDefault();
                addPendingImages(files);
              }
            }}
            onKeyDown={(e) => {
              if (commandPickerOpen) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const direction = e.key === "ArrowDown" ? 1 : -1;
                  setSelectedCommandIndex(
                    (current) =>
                      (current + direction + matchingCommands.length) %
                      matchingCommands.length,
                  );
                  return;
                }
                if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
                  e.preventDefault();
                  const command = matchingCommands[selectedCommandIndex];
                  if (command) runCommand(command.name);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setInput("");
                  return;
                }
              }
              if (skillPickerOpen) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSelectedSkillIndex(
                    (current) => (current + 1) % matchingSkills.length,
                  );
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSelectedSkillIndex(
                    (current) =>
                      (current - 1 + matchingSkills.length) %
                      matchingSkills.length,
                  );
                  return;
                }
                if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
                  e.preventDefault();
                  const skill = matchingSkills[selectedSkillIndex];
                  if (skill) selectSkill(skill);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setSkillPickerDismissed(true);
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSend) onSendMessage(e);
              }
            }}
            disabled={isBusy}
            placeholder="Send a message..."
            aria-autocomplete="list"
            aria-controls={
              commandPickerOpen
                ? "command-picker"
                : skillPickerOpen
                  ? "skill-picker"
                  : undefined
            }
            aria-expanded={skillPickerOpen || commandPickerOpen}
            className="min-h-10 max-h-[30vh] w-full flex-1 resize-none overflow-y-auto bg-transparent px-1 py-2.5 text-[0.9375rem] leading-[1.5] text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            rows={1}
          />
          {isBusy ? (
            <button
              type="button"
              onClick={(event) => {
                // Stopping can turn this same DOM button into the submit button.
                event.preventDefault();
                onStopGeneration();
              }}
              className={cx(
                iconButton,
                "mb-0.5 size-9 shrink-0 p-0 hover:border-red-500/20 hover:bg-red-500/[0.06] hover:text-red-300",
              )}
              aria-label="Stop generation"
            >
              <Square size={12} strokeWidth={2.25} className="shrink-0" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim() || !canSend}
              className={cx(
                primaryButton,
                "mb-0.5 size-9 shrink-0 justify-center rounded-lg p-0",
              )}
              aria-label="Send message"
            >
              <ArrowUp size={18} />
            </button>
          )}
        </div>
        <div
          className="flex min-w-0 items-center gap-1 border-t border-border-subtle pt-1"
          aria-label="Chat settings"
        >
          <ModelSelectBar
            ollamaModels={ollamaModels}
            ollamaConnected={ollamaConnected}
            modelsLoadError={modelsLoadError}
            selectedModel={selectedModel}
            onModelChange={onModelChange}
            disabled={isBusy}
          />
          {currentModelOption?.reasoning &&
            hasConfigurableThinking(currentModelOption.reasoning) &&
            onThinkingEffortChange && (
              <>
                <span
                  className="mx-1 h-4 w-px shrink-0 bg-border-subtle"
                  aria-hidden
                />
                <ThinkingLevelBar
                  reasoning={currentModelOption.reasoning}
                  value={thinkingEffort}
                  onChange={onThinkingEffortChange}
                  disabled={isBusy}
                />
              </>
            )}
          <span
            className="mx-1 h-4 w-px shrink-0 bg-border-subtle"
            aria-hidden
          />
          <AgentSelectBar
            agents={runAgents}
            selectedAgent={selectedSessionAgent}
            onAgentChange={onSessionAgentChange}
            disabled={isBusy}
          />
        </div>
      </form>
    </div>
  );
}
