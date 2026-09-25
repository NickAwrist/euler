import { useState } from "react";
import { MessageItem } from "../components/MessageItem";
import { StepsModal } from "../components/StepsModal";
import { TruncateConfirmModal } from "../components/TruncateConfirmModal";
import type { Message, MessageStep, TruncateConfirmState } from "../types";

const steps: MessageStep[] = [
  {
    kind: "llm_call",
    status: "completed",
    result: "Generated the requested example.",
    metrics: { promptTokens: 120, outputTokens: 48, tokensPerSecond: 76.7 },
  },
];
const initialMessages: Message[] = [
  { role: "user", content: "Show me a greeting in a code block." },
  { role: "assistant", content: "```text\nhello world\n```", steps },
  { role: "user", content: "And a short Python example?" },
  {
    role: "assistant",
    content:
      "Here's a binary search:\n\n```python\ndef binary_search(arr, target):\n    low, high = 0, len(arr) - 1\n    while low <= high:\n        mid = (low + high) // 2\n        if arr[mid] == target:\n            return mid\n        if arr[mid] < target:\n            low = mid + 1\n        else:\n            high = mid - 1\n    return -1\n```\n\nThe input must be sorted. Returns `-1` when the value isn't found.",
    steps,
  },
  { role: "user", content: "What about a long command?" },
  {
    role: "assistant",
    content:
      "```sh\ncurl --request GET https://example.com/api/messages --header 'Accept: application/json'\n```",
    steps,
  },
  {
    role: "assistant",
    content:
      "```\nUnlabeled code\nwith two lines\n```\n\nInline code like `hello world` stays in the text.",
  },
];

const markdownMessages: Message[] = [
  {
    role: "assistant",
    content:
      "```\nUnlabeled code\nwith two lines\n```\n\nLocal weights awaken,\nCode flows through the quiet night,\nThinking whispers softly.\n\n3. First step\n4. Second step\n   - Nested bullet\n\n- First bullet\n- Second bullet\n\n[External docs](https://example.com/docs) and [Protocol relative](//example.com/docs).\n\n[Jump](#details) and [Email](mailto:hello@example.com).\n\n| Name | Value |\n| --- | --- |\n| Answer | 42 |",
  },
  {
    role: "assistant",
    content:
      "Here is the lighthouse:\n\n![Lighthouse](/api/comfyui/view/echoed.png)",
    attachments: [
      {
        kind: "generated_image",
        url: "/api/comfyui/view/echoed.png?type=output",
      },
      {
        kind: "generated_image",
        url: "/api/comfyui/view/omitted.png?type=output",
      },
      {
        kind: "web_source",
        title: "Lighthouse history",
        url: "https://www.example.com/lighthouses",
      },
    ],
  },
];

export default function MessageDemo() {
  const [messages, setMessages] = useState(
    new URLSearchParams(window.location.search).has("markdown")
      ? markdownMessages
      : initialMessages,
  );
  const [editing, setEditing] = useState<number | null>(null);
  const [trace, setTrace] = useState<MessageStep[] | null>(null);
  const [confirm, setConfirm] = useState<TruncateConfirmState>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="min-h-full bg-background text-foreground">
      <header className="sticky top-0 z-10 flex h-[52px] items-center justify-between border-b border-border-subtle bg-background px-3.5 text-sm">
        <span>Message demo</span>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={busy}
            onChange={(event) => setBusy(event.target.checked)}
          />
          Simulate busy
        </label>
        <a href="/" className="text-muted-foreground">
          Exit
        </a>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-col px-3.5 py-4 sm:px-5">
        {messages.map((message, index) => (
          <section
            key={`${index}:${message.content}`}
            aria-label={`Message ${index + 1}`}
          >
            <MessageItem
              message={message}
              messageIndex={index}
              animateEntry={false}
              isBusy={busy}
              editingUserIndex={editing}
              onStartEditUser={setEditing}
              onCancelEditUser={() => setEditing(null)}
              onRequestEditConfirm={(userIndex, text) =>
                setConfirm({ kind: "edit", userIndex, text })
              }
              onRequestRetryConfirm={(userIndex) =>
                setConfirm({ kind: "retry", userIndex })
              }
              onViewSteps={
                message.steps ? () => setTrace(message.steps ?? []) : undefined
              }
            />
          </section>
        ))}
      </main>
      {trace && <StepsModal steps={trace} onClose={() => setTrace(null)} />}
      {confirm && (
        <TruncateConfirmModal
          title={
            confirm.kind === "edit"
              ? "Save edits and retry?"
              : "Retry from here?"
          }
          description="Later demo messages will be removed. Reload this page to reset the examples."
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            setMessages((previous) =>
              previous
                .slice(0, confirm.userIndex + 1)
                .map((message, index) =>
                  confirm.kind === "edit" && index === confirm.userIndex
                    ? { ...message, content: confirm.text }
                    : message,
                ),
            );
            setEditing(null);
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
}
