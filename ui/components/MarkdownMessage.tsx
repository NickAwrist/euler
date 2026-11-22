import { Check, Copy } from "lucide-react";
import type { Root, RootContent } from "mdast";
import {
  type ComponentPropsWithoutRef,
  isValidElement,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown, {
  type Components,
  type ExtraProps,
  type Options,
} from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { copyTextToClipboard } from "../lib/copyTextToClipboard";
import { cx } from "../styles";
import { artifactPath, useArtifacts } from "./Artifacts/ArtifactContext";
import { HighlightedCode } from "./HighlightedCode";

const remarkPlugins: Options["remarkPlugins"] = [
  remarkGfm,
  remarkBreaks,
  // Single dollars are currency; see normalizeMathDelimiters.
  [remarkMath, { singleDollarTextMath: false }],
];
// Math that is invalid or still streaming shows as plain TeX, not red errors.
const rehypePlugins: Options["rehypePlugins"] = [
  [rehypeKatex, { errorColor: "inherit" }],
];

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

const markdownParser = unified().use(remarkParse).use(remarkGfm);

/**
 * Math delimiter policy. `$$…$$`, `\(…\)`, and `\[…\]` are always math.
 * A single `$…$` pair is math only under Pandoc's rules: the opening `$` is
 * followed by a non-space, the closing `$` follows a non-space and is not
 * followed by a digit, and both are on one line. So "$5 and $10" and
 * "$5-$10" stay text. Escaped `\$` is always a literal dollar.
 */
const MATH_DELIMITERS =
  /\$\$[\s\S]*?\$\$|\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|(?<![\\$])\$(?![\s$])((?:\\.|[^$\\\n])*?[^\s\\$])\$(?![\d$])/g;

function toDollarMath(text: string): string {
  return text.replace(
    MATH_DELIMITERS,
    (match: string, paren?: string, bracket?: string, single?: string) => {
      const tex = paren ?? bracket ?? single;
      return tex === undefined ? match : `$$${tex}$$`;
    },
  );
}

/** Rewrites math under the delimiter policy as `$$…$$`, leaving code untouched. */
export function normalizeMathDelimiters(markdown: string): string {
  if (!/\$|\\[([]/.test(markdown)) return markdown;
  let result = "";
  let cursor = 0;
  function visit(node: Root | RootContent): void {
    if (node.type === "code" || node.type === "inlineCode") {
      const start = node.position!.start.offset!;
      const end = node.position!.end.offset!;
      result += toDollarMath(markdown.slice(cursor, start));
      result += markdown.slice(start, end);
      cursor = end;
    } else if ("children" in node) {
      node.children.forEach(visit);
    }
  }
  visit(markdownParser.parse(markdown));
  return result + toDollarMath(markdown.slice(cursor));
}

function ImageLinkPreviewCard({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  if (errored) return null;

  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open image in new tab"
      className={cx("my-3 inline-block max-w-full", !loaded && "hidden")}
    >
      <div className="overflow-hidden rounded-lg border border-border-subtle bg-background shadow-sm">
        <div className="relative block h-48 w-80 max-w-full">
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-border-subtle border-t-foreground" />
            </div>
          )}
          <img
            src={src}
            loading="eager"
            decoding="async"
            referrerPolicy="no-referrer"
            alt={alt}
            onLoad={() => setLoaded(true)}
            onError={() => setErrored(true)}
            className={cx(
              "block h-full w-full object-contain",
              loaded ? "opacity-100" : "opacity-0",
            )}
          />
        </div>
      </div>
    </a>
  );
}

function MarkdownImg({
  src,
  alt,
  ...rest
}: ComponentPropsWithoutRef<"img"> & ExtraProps) {
  return (
    <img {...rest} src={src} alt={alt ?? ""} loading="lazy" decoding="async" />
  );
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

/** Find rendered HTTP links, excluding code and images already embedded in the reply. */
export function extractImagePreviewLinks(markdown: string): string[] {
  const tree = markdownParser.parse(markdown);
  const definitions = new Map<string, string>();
  const links: string[] = [];
  const images = new Set<string>();
  function collectDefinitions(node: Root | RootContent): void {
    if (node.type === "definition" && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, node.url);
    }
    if ("children" in node) node.children.forEach(collectDefinitions);
  }
  function collect(node: Root | RootContent): void {
    if (node.type === "link" || node.type === "linkReference") {
      const url =
        node.type === "link" ? node.url : definitions.get(node.identifier);
      if (url && /^https?:\/\//i.test(url)) links.push(url);
    } else if (node.type === "image" || node.type === "imageReference") {
      const url =
        node.type === "image" ? node.url : definitions.get(node.identifier);
      if (url) images.add(url);
    }
    if ("children" in node) node.children.forEach(collect);
  }
  collectDefinitions(tree);
  collect(tree);
  return [...new Set(links)].filter((url) => !images.has(url));
}

function ImageLinkPreviews({ urls }: { urls: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="flex flex-wrap gap-x-3">
      {visible &&
        urls.map((src) => (
          <ImageLinkPreviewCard key={src} src={src} alt="Linked image" />
        ))}
    </div>
  );
}

const markdownProseClass =
  "min-w-0 break-words text-[0.9375rem] leading-[1.65] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_a]:text-accent [&_a:hover]:underline [&_blockquote]:my-2 [&_blockquote]:border-l-[3px] [&_blockquote]:border-border [&_blockquote]:pl-[0.9em] [&_blockquote]:text-muted-foreground [&_code]:rounded-[4px] [&_code]:border [&_code]:border-border-subtle [&_code]:bg-muted [&_code]:px-[0.35em] [&_code]:py-[0.12em] [&_code]:text-[0.85em] [&_h1]:my-[0.75em] [&_h1]:mb-[0.4em] [&_h1]:text-[1.125rem] [&_h1]:font-semibold [&_h1]:leading-[1.3] [&_h1]:tracking-[-0.02em] [&_h2]:my-[0.75em] [&_h2]:mb-[0.4em] [&_h2]:text-[1.05rem] [&_h2]:font-semibold [&_h2]:leading-[1.3] [&_h2]:tracking-[-0.02em] [&_h3]:my-[0.75em] [&_h3]:mb-[0.4em] [&_h3]:text-[1rem] [&_h3]:font-semibold [&_h3]:leading-[1.3] [&_h3]:tracking-[-0.02em] [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_hr]:my-[0.85em] [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-border-subtle [&_li]:my-[0.2em] [&_ol]:list-decimal [&_ol]:my-2 [&_ol]:pl-[1.35em] [&_p]:my-2 [&_pre]:my-[0.65em] [&_pre]:overflow-x-auto [&_pre]:whitespace-pre [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border-subtle [&_pre]:bg-background [&_pre]:px-3 [&_pre]:py-2.5 [&_pre]:text-[0.8125rem] [&_pre_code]:rounded-none [&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[0.8125rem] [&_table]:my-[0.65em] [&_table]:border-collapse [&_table]:text-[0.875rem] [&_td]:border [&_td]:border-border-subtle [&_td]:px-[10px] [&_td]:py-[6px] [&_th]:border [&_th]:border-border-subtle [&_th]:bg-muted [&_th]:px-[10px] [&_th]:py-[6px] [&_th]:text-left [&_th]:font-semibold [&_ul]:list-disc [&_ul]:my-2 [&_ul]:pl-[1.35em]";

export const MarkdownMessage = memo(function MarkdownMessage({
  children,
  className,
}: { children: string; className?: string }) {
  const source = normalizeMathDelimiters(
    normalizeFlattenedPipeTables(children),
  );
  const imageLinks = useMemo(() => extractImagePreviewLinks(source), [source]);

  return (
    <div className={cx(markdownProseClass, className)}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={markdownComponents}
      >
        {source}
      </ReactMarkdown>
      {imageLinks.length > 0 && <ImageLinkPreviews urls={imageLinks} />}
    </div>
  );
});
