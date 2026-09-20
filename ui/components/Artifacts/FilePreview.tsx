import { ArrowLeft, Code, Download, Eye, LoaderCircle } from "lucide-react";
import { type ComponentType, useEffect, useRef, useState } from "react";
import type { FilePreview as Preview } from "../../../src/schemas/artifacts";
import { downloadBlob } from "../../lib/downloadBlob";
import { iconButton } from "../../styles";
import { HighlightedCode } from "../HighlightedCode";
import { MarkdownMessage } from "../MarkdownMessage";
import { RefreshButton } from "../RefreshButton";
import { ArtifactContext } from "./ArtifactContext";
import { FileIcon } from "./FileIcon";
import { fileLanguage } from "./fileTypes";
import type { ArtifactPreviewCache } from "./previewCache";

type RendererProps = { preview: Preview };
type FileRenderer = {
  matches: (preview: Preview) => boolean;
  component: ComponentType<RendererProps>;
};
function ImagePreview({ preview }: RendererProps) {
  const [failed, setFailed] = useState<Preview | null>(null);
  if (preview.kind !== "image") return null;
  if (failed === preview)
    return (
      <p role="alert" className="text-sm text-red-300">
        This image could not be decoded.
      </p>
    );
  // SVG is displayed only as an image, never inserted into the document.
  return (
    <img
      src={`data:${preview.mediaType};base64,${preview.data}`}
      alt={preview.path.split("/").pop() ?? preview.path}
      onError={() => setFailed(preview)}
      className="mx-auto max-h-[calc(100dvh-8rem)] max-w-full rounded object-contain"
    />
  );
}
const renderers: readonly FileRenderer[] = [
  { matches: (preview) => preview.kind === "image", component: ImagePreview },
  {
    matches: (preview) =>
      preview.kind === "text" && /\.html?$/i.test(preview.path),
    component: ({ preview }) =>
      preview.kind === "text" ? (
        <iframe
          title={`HTML preview: ${preview.path}`}
          sandbox=""
          referrerPolicy="no-referrer"
          // Apply policy before any artifact markup. Keep styles inside the
          // frame and prevent resource requests to the app or external sites.
          srcDoc={`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'">${preview.content}`}
          className="block h-full min-h-80 w-full border-0 bg-white"
        />
      ) : null,
  },
  {
    matches: (preview) =>
      preview.kind === "text" && /\.(md|markdown)$/i.test(preview.path),
    component: ({ preview }) =>
      preview.kind === "text" ? (
        <MarkdownMessage>{preview.content}</MarkdownMessage>
      ) : null,
  },
];
export function FilePreview({
  source,
  path,
  onBack,
}: {
  source: ArtifactPreviewCache;
  path: string;
  onBack: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(() =>
    source.peek(path),
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(() => !source.peek(path));
  const [refresh, setRefresh] = useState(0);
  const [raw, setRaw] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const downloadRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    setDownloading(false);
    return () => downloadRequest.current?.abort();
  }, [source]);
  const download = async () => {
    if (downloadRequest.current && !downloadRequest.current.signal.aborted)
      return;
    const controller = new AbortController();
    downloadRequest.current = controller;
    setDownloading(true);
    setDownloadError("");
    try {
      const blob = await source.download(path, controller.signal);
      if (!controller.signal.aborted)
        downloadBlob(blob, path.split("/").pop() || "file");
    } catch (cause) {
      if (!controller.signal.aborted)
        setDownloadError(
          cause instanceof Error ? cause.message : "Could not download file",
        );
    } finally {
      if (downloadRequest.current === controller)
        downloadRequest.current = null;
      if (!controller.signal.aborted) setDownloading(false);
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setLoading(!source.peek(path));
    void source
      .preview(path, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setPreview(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "Could not preview file",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [source, path, refresh]);
  const Renderer =
    preview &&
    renderers.find((renderer) => renderer.matches(preview))?.component;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="workspace-header gap-2 pl-2 pr-12">
        <button
          type="button"
          className={iconButton}
          aria-label="Back to files"
          title="Back to files"
          onClick={onBack}
        >
          <ArrowLeft size={17} />
        </button>
        <FileIcon path={path} />
        <span className="min-w-0 flex-1 truncate text-xs" title={path}>
          {path}
        </span>
        {Renderer && preview?.kind === "text" && (
          <button
            type="button"
            className={iconButton}
            aria-label={raw ? "Show rendered preview" : "Show source"}
            title={raw ? "Show rendered preview" : "Show source"}
            aria-pressed={raw}
            onClick={() => setRaw((value) => !value)}
          >
            {raw ? <Eye size={16} /> : <Code size={16} />}
          </button>
        )}
        <button
          type="button"
          className={`${iconButton} disabled:opacity-45`}
          aria-label="Download file"
          title="Download file"
          aria-busy={downloading}
          disabled={downloading}
          onClick={() => void download()}
        >
          {downloading ? (
            <LoaderCircle
              size={16}
              className="animate-spin motion-reduce:animate-none"
            />
          ) : (
            <Download size={16} />
          )}
        </button>
        <RefreshButton
          iconOnly
          label="Refresh preview"
          refreshing={loading}
          onClick={() => {
            source.invalidate(path);
            setRefresh((value) => value + 1);
          }}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {downloadError && (
          <p role="alert" className="mb-3 text-sm text-red-300">
            {downloadError}
          </p>
        )}
        {error ? (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        ) : !preview ? (
          <output className="text-sm text-muted-foreground">
            Loading preview…
          </output>
        ) : Renderer && !raw ? (
          <ArtifactContext.Provider value={null}>
            <Renderer preview={preview} />
          </ArtifactContext.Provider>
        ) : preview.kind === "text" ? (
          <pre className="font-mono text-xs leading-relaxed">
            <HighlightedCode
              code={preview.content}
              language={fileLanguage(path)}
            />
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground">
            No preview available for this file.
          </p>
        )}
      </div>
    </div>
  );
}
