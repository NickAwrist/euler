import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { useState } from "react";
import {
  MessageSchema,
  MessageVersionSchema,
  Message_Role,
} from "../../src/gen/euler/v1/sessions_pb";
import { Step_Kind, Step_Status } from "../../src/gen/euler/v1/steps_pb";
import { MessageItem } from "../components/MessageItem";
import { StepsModal } from "../components/StepsModal";
import { TruncateConfirmModal } from "../components/TruncateConfirmModal";
import type { Message, Step, TruncateConfirmState } from "../types";

type MessageInit = MessageInitShape<typeof MessageSchema>;
import { fixtureStep, generatedImage, webSource } from "./fixtures";

const steps: Step[] = [
  fixtureStep({
    kind: Step_Kind.LLM_CALL,
    status: Step_Status.DONE,
    result: "Generated the requested example.",
    metrics: { promptTokens: 120, outputTokens: 48, tokensPerSecond: 76.7 },
  }),
];
const initialMessages: Message[] = (
  [
    { role: Message_Role.USER, content: "Show me a greeting in a code block." },
    {
      role: Message_Role.ASSISTANT,
      content: "```text\nhello world\n```",
      steps,
    },
    { role: Message_Role.USER, content: "And a short Python example?" },
    {
      role: Message_Role.ASSISTANT,
      content:
        "Here's a binary search:\n\n```python\ndef binary_search(arr, target):\n    low, high = 0, len(arr) - 1\n    while low <= high:\n        mid = (low + high) // 2\n        if arr[mid] == target:\n            return mid\n        if arr[mid] < target:\n            low = mid + 1\n        else:\n            high = mid - 1\n    return -1\n```\n\nThe input must be sorted. Returns `-1` when the value isn't found.",
      steps,
    },
    { role: Message_Role.USER, content: "What about a long command?" },
    {
      role: Message_Role.ASSISTANT,
      content:
        "```sh\ncurl --request GET https://example.com/api/messages --header 'Accept: application/json'\n```",
      steps,
    },
    {
      role: Message_Role.ASSISTANT,
      content:
        "```\nUnlabeled code\nwith two lines\n```\n\nInline code like `hello world` stays in the text.",
    },
  ] satisfies MessageInit[]
).map((message) => create(MessageSchema, message));

const markdownMessages: Message[] = (
  [
    {
      role: Message_Role.ASSISTANT,
      content:
        "```\nUnlabeled code\nwith two lines\n```\n\nLocal weights awaken,\nCode flows through the quiet night,\nThinking whispers softly.\n\n3. First step\n4. Second step\n   - Nested bullet\n\n- First bullet\n- Second bullet\n\n[External docs](https://example.com/docs) and [Protocol relative](//example.com/docs).\n\n[Jump](#details) and [Email](mailto:hello@example.com).\n\n| Name | Value |\n| --- | --- |\n| Answer | 42 |\n\nThe ball costs $0.05, so $2x + 1.00 = 1.10$.\n\n$$\n\\frac{a}{b}\n$$",
    },
    {
      role: Message_Role.ASSISTANT,
      content:
        "Here is the lighthouse:\n\n![Lighthouse](/api/comfyui/view/echoed.png)",
      attachments: [
        generatedImage("/api/comfyui/view/echoed.png?type=output"),
        generatedImage("/api/comfyui/view/omitted.png?type=output"),
        webSource("Lighthouse history", "https://www.example.com/lighthouses"),
      ],
    },
    {
      role: Message_Role.ASSISTANT,
      content:
        "Lighthouses were automated through the 20th century, and most now run without resident keepers.",
      attachments: [
        "Lighthouse automation timeline",
        "Keepers of the coast: an oral history",
        "Fresnel lens design and optics",
        "Decommissioned lighthouses and preservation efforts",
        "Modern aids to navigation",
        "How LED beacons replaced rotating lamps",
        "Coast guard maintenance schedules",
        "Lighthouse tourism statistics",
      ].map((title, index) =>
        webSource(
          title,
          `https://source-${index + 1}.example.org/articles/${index + 1}`,
        ),
      ),
    },
  ] satisfies MessageInit[]
).map((message) => create(MessageSchema, message));

const imageLinkMessages: Message[] = (
  [
    {
      role: Message_Role.ASSISTANT,
      content: [
        "Here are your images:",
        "Image 1: https://images.example.com/first.png?token=signed",
        "Image 2: [Second image](https://images.example.com/render?id=2)",
        "Repeated: https://images.example.com/first.png?token=signed",
        "[Documentation](https://images.example.com/docs)",
        "[Broken image](https://images.example.com/broken.png)",
        "`https://images.example.com/code.png`",
        "![Embedded](https://images.example.com/embedded.png)",
        "[Embedded link](https://images.example.com/embedded.png)",
      ].join("\n\n"),
    },
  ] satisfies MessageInit[]
).map((message) => create(MessageSchema, message));

export default function MessageDemo() {
  const [messages, setMessages] = useState(
    new URLSearchParams(window.location.search).has("image-links")
      ? imageLinkMessages
      : new URLSearchParams(window.location.search).has("markdown")
        ? markdownMessages
        : initialMessages,
  );
  const [editing, setEditing] = useState<number | null>(null);
  const [trace, setTrace] = useState<Step[] | null>(null);
  const [confirm, setConfirm] = useState<TruncateConfirmState>(null);
  const [busy, setBusy] = useState(false);
  // Replaces a reply and later messages, keeping the reply as a version.
  const regenerate = (index: number) =>
    setMessages((previous) => {
      const { content, steps, attachments, versions } = previous[index]!;
      return [
        ...previous.slice(0, index),
        create(MessageSchema, {
          role: Message_Role.ASSISTANT,
          content: `Regenerated reply ${versions.length + 2}.`,
          versions: [
            ...versions,
            create(MessageVersionSchema, { content, steps, attachments }),
          ],
        }),
      ];
    });
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
              onRegenerate={(assistantIndex) =>
                assistantIndex < messages.length - 1
                  ? setConfirm({ kind: "regenerate", assistantIndex })
                  : regenerate(assistantIndex)
              }
              regenerateLabel="Regenerate with Demo model"
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
              : "Regenerate this reply?"
          }
          description="Later demo messages will be removed. Reload this page to reset the examples."
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            if (confirm.kind === "regenerate") {
              regenerate(confirm.assistantIndex);
            } else {
              setMessages((previous) =>
                previous
                  .slice(0, confirm.userIndex + 1)
                  .map((message, index) =>
                    index === confirm.userIndex
                      ? { ...message, content: confirm.text }
                      : message,
                  ),
              );
            }
            setEditing(null);
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
}
