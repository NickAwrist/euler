import { Check, Copy } from "lucide-react";
import type { Root, RootContent } from "mdast";
import {
  type ComponentPropsWithoutRef,
  isValidElement,
  memo,
  useRef,
  useState,
} from "react";
import ReactMarkdown, {
  type Components,
  type ExtraProps,
} from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { COMFYUI_VIEW_PREFIX } from "../../src/attachments/types";
import { copyTextToClipboard } from "../lib/copyTextToClipboard";
import { cx } from "../styles";
import { artifactPath, useArtifacts } from "./Artifacts/ArtifactContext";
import { HighlightedCode } from "./HighlightedCode";

const remarkPlugins = [remarkGfm, remarkBreaks];

/** GFM tables need newline-separated rows; streamed/model text often uses a single line. */
function normalizeFlattenedPipeTables(markdown: string): string {
  if (markdown.includes("\n")) return markdown;
  const pipeRuns = markdown.match(/\|\s+\|/g);
  if (!pipeRuns || pipeRuns.length < 2) return markdown;
  return markdown.replace(/\|\s+\|/g, "|\n|");
}

const codeCopyBtn =
  "code-copy-action inline-flex shrink-0 items-center justify-center rounded-md bg-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent-ring";

function CodeBlock({
  className,
  children,
  ...rest
}: ComponentPropsWithoutRef<"code"> & ExtraProps) {
  const match = /language-(\w+)/.exec(className || "");
  const lang = match?.[1] || "text";
  const rawCode = String(children).replace(/\n$/, "");
  return (
    <HighlightedCode
      {...rest}
      code={rawCode}
      language={lang}
      className={className}
    />
  );
}

function MarkdownCode({
  className,
  children,
  ...rest
}: ComponentPropsWithoutRef<"code"> & ExtraProps) {
  const match = /language-(\w+)/.exec(className || "");
  const isCodeBlock =
    Boolean(match) || (typeof children === "string" && children.includes("\n"));

  if (!isCodeBlock) {
    return (
      <code {...rest} className={className}>
        {children}
      </code>
    );
  }

  return (
    <CodeBlock className={className} {...rest}>
      {children}
    </CodeBlock>
  );
}

function MarkdownPre({
  children,
  ...rest
}: ComponentPropsWithoutRef<"pre"> & ExtraProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const copyBlock = async () => {
    const root = preRef.current;
    if (!root) return;
    const codeEl = root.querySelector("code");
    const text = codeEl?.innerText ?? root.innerText ?? "";
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  const codeProps = isValidElement<ComponentPropsWithoutRef<"code">>(children)
    ? children.props
    : undefined;
  const source =
    typeof codeProps?.children === "string"
      ? codeProps.children.replace(/\n$/, "")
      : "";
  const singleLine = !source.includes("\n");
  const language =
    /language-([^ ]+)/.exec(codeProps?.className ?? "")?.[1] ?? "Code";
  const copyButton = (
    <button
      type="button"
      onClick={() => void copyBlock()}
      className={codeCopyBtn}
      title={copied ? "Copied" : "Copy code"}
      aria-label={copied ? "Copied" : "Copy code"}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );

  return (
    <div
      className={cx(
        "markdown-code-block",
        singleLine && "markdown-code-single",
      )}
    >
      {!singleLine && (
        <div className="code-block-header">
          <span>{language}</span>
          {copyButton}
        </div>
      )}
      <pre ref={preRef} {...rest} className={rest.className}>
        {children}
      </pre>
      {singleLine && copyButton}
    </div>
  );
}

// The prefix has no regex metacharacters, so the patterns embed it directly.
const VIEW_URL = COMFYUI_VIEW_PREFIX;
const JSON_WRAPPED_VIEW_URL = new RegExp(
  String.raw`\{\s*"[^"]*"\s*:\s*"(${VIEW_URL}[^"]+)"\s*\}`,
  "g",
);
const QUOTED_VIEW_URL = new RegExp(
  String.raw`(?<!\]\()"(${VIEW_URL}[^"]+)"`,
  "g",
);
// Trailing sentence punctuation is not part of a bare URL.
const BARE_VIEW_URL = new RegExp(
  String.raw`(?<!\]\()(?<!\()(${VIEW_URL}[^\s"')>\]]*[^\s"')>\].,;:!?])`,
  "g",
);
const markdownParser = unified().use(remarkParse).use(remarkGfm);

function isComfyUIImage(src: string | undefined): boolean {
  return typeof src === "string" && src.startsWith(COMFYUI_VIEW_PREFIX);
}

/** ComfyUI image URLs rendered as images (not code) after {@link convertComfyUIUrls}, in order (deduped). */
export function extractComfyUIImageUrls(markdown: string): string[] {
  const source = convertComfyUIUrls(normalizeFlattenedPipeTables(markdown));
  const tree = markdownParser.parse(source);
  const definitions = new Map<string, string>();
  const images: Extract<RootContent, { type: "image" | "imageReference" }>[] =
    [];
  function collect(node: Root | RootContent): void {
    if (node.type === "definition" && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, node.url);
    } else if (node.type === "image" || node.type === "imageReference") {
      images.push(node);
    }
    if ("children" in node) node.children.forEach(collect);
  }
  collect(tree);
  const urls = images.flatMap((node) => {
    const url =
      node.type === "image" ? node.url : definitions.get(node.identifier);
    return url && isComfyUIImage(url) ? [url] : [];
  });
  return [...new Set(urls)];
}

/** Identifies the image a view URL loads; the view route defaults `type` to "output". */
export function comfyUIImageKey(url: string): string {
  const { pathname, searchParams } = new URL(url, "http://localhost");
  return [
    pathname,
    searchParams.get("type") || "output",
    searchParams.get("subfolder") ?? "",
  ].join("\n");
}

export function ComfyUIImageCard({ src, alt }: { src: string; alt?: string }) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const [errorDetails, setErrorDetails] = useState<string>("");

  const handleError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    console.error("ComfyUI image failed to load:", src, e);
    setErrored(true);
    setErrorDetails(`URL: ${src}`);
  };

  return (
    <div className="my-3 inline-block max-w-full">
      <div className="overflow-hidden rounded-lg border border-border-subtle bg-background shadow-sm">
        {errored ? (
          <div className="flex h-48 w-80 max-w-full flex-col items-center justify-center p-4 text-center text-[0.8125rem] text-muted-foreground">
            <div className="mb-2">Failed to load image</div>
            <div className="break-all text-[0.7rem] opacity-70">
              {errorDetails}
            </div>
          </div>
        ) : (
          <div className="relative block h-48 w-80 max-w-full">
            {!loaded && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-border-subtle border-t-foreground" />
              </div>
            )}
            <img
              src={src}
              loading="lazy"
              decoding="async"
              alt={alt || "Generated image"}
              onLoad={() => setLoaded(true)}
              onError={handleError}
              className={cx(
                "block h-full w-full object-contain",
                loaded ? "opacity-100" : "opacity-0",
              )}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function MarkdownImg({
  src,
  alt,
  ...rest
}: ComponentPropsWithoutRef<"img"> & ExtraProps) {
  if (isComfyUIImage(src)) {
    return <ComfyUIImageCard src={src!} alt={alt} />;
  }
  return (
    <img {...rest} src={src} alt={alt ?? ""} loading="lazy" decoding="async" />
  );
}

/**
 * Detect ComfyUI image URLs in various formats the LLM might produce and
 * convert them into clean markdown image syntax.
 *
 * Handles:
 *  - JSON wrapper:  { "image_url": "/api/comfyui/view/..." }
 *  - Quoted URL:    "/api/comfyui/view/..."
 *  - Bare URL:      /api/comfyui/view/...
 *  - Already valid: ![alt](/api/comfyui/view/...) - left untouched
 */
function convertComfyUIUrls(markdown: string): string {
  // 1. Replace full JSON object wrappers like { "image_url": "..." }
  let result = markdown.replace(
    JSON_WRAPPED_VIEW_URL,
    (_match, url) => `![Generated Image](${url})`,
  );

  // 2. Replace quoted URLs not already inside markdown image syntax
  result = result.replace(
    QUOTED_VIEW_URL,
    (_match, url) => `![Generated Image](${url})`,
  );

  // 3. Replace remaining bare URLs (exclude quotes, parens, brackets, whitespace)
  result = result.replace(BARE_VIEW_URL, (match) => {
    if (result.includes(`](${match})`)) return match;
    return `![Generated Image](${match})`;
  });

  return result;
}

function MarkdownLink({
  href,
  children,
  node: _node,
  ...rest
}: ComponentPropsWithoutRef<"a"> & ExtraProps) {
  const artifacts = useArtifacts();
  const path =
    artifacts && href ? artifactPath(href, artifacts.localPath) : null;
  if (path && artifacts)
    return (
      <button
        type="button"
        className="cursor-pointer text-accent hover:underline"
        onClick={() => artifacts.openFile(path)}
        title={`Preview ${path}`}
      >
        {children}
      </button>
    );
  const external = /^(?:https?:)?\/\//i.test(href ?? "");
  return (
    <a
      {...rest}
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
    >
      {children}
    </a>
  );
}

const markdownComponents: Components = {
  a: MarkdownLink,
  pre: MarkdownPre,
  code: MarkdownCode,
  img: MarkdownImg,
};

const markdownProseClass =
  "min-w-0 break-words text-[0.9375rem] leading-[1.65] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_a]:text-accent [&_a:hover]:underline [&_blockquote]:my-2 [&_blockquote]:border-l-[3px] [&_blockquote]:border-border [&_blockquote]:pl-[0.9em] [&_blockquote]:text-muted-foreground [&_code]:rounded-[4px] [&_code]:border [&_code]:border-border-subtle [&_code]:bg-muted [&_code]:px-[0.35em] [&_code]:py-[0.12em] [&_code]:text-[0.85em] [&_h1]:my-[0.75em] [&_h1]:mb-[0.4em] [&_h1]:text-[1.125rem] [&_h1]:font-semibold [&_h1]:leading-[1.3] [&_h1]:tracking-[-0.02em] [&_h2]:my-[0.75em] [&_h2]:mb-[0.4em] [&_h2]:text-[1.05rem] [&_h2]:font-semibold [&_h2]:leading-[1.3] [&_h2]:tracking-[-0.02em] [&_h3]:my-[0.75em] [&_h3]:mb-[0.4em] [&_h3]:text-[1rem] [&_h3]:font-semibold [&_h3]:leading-[1.3] [&_h3]:tracking-[-0.02em] [&_hr]:my-[0.85em] [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-border-subtle [&_li]:my-[0.2em] [&_ol]:list-decimal [&_ol]:my-2 [&_ol]:pl-[1.35em] [&_p]:my-2 [&_pre]:my-[0.65em] [&_pre]:overflow-x-auto [&_pre]:whitespace-pre [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border-subtle [&_pre]:bg-background [&_pre]:px-3 [&_pre]:py-2.5 [&_pre]:text-[0.8125rem] [&_pre_code]:rounded-none [&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[0.8125rem] [&_table]:my-[0.65em] [&_table]:border-collapse [&_table]:text-[0.875rem] [&_td]:border [&_td]:border-border-subtle [&_td]:px-[10px] [&_td]:py-[6px] [&_th]:border [&_th]:border-border-subtle [&_th]:bg-muted [&_th]:px-[10px] [&_th]:py-[6px] [&_th]:text-left [&_th]:font-semibold [&_ul]:list-disc [&_ul]:my-2 [&_ul]:pl-[1.35em]";

export const MarkdownMessage = memo(function MarkdownMessage({
  children,
  className,
}: { children: string; className?: string }) {
  const source = convertComfyUIUrls(normalizeFlattenedPipeTables(children));

  return (
    <div className={cx(markdownProseClass, className)}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        components={markdownComponents}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});
