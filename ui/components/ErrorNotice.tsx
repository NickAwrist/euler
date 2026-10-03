import { useState } from "react";
import {
  type Diagnostic,
  formatDiagnostic,
} from "../../src/schemas/observability";
import { copyTextToClipboard } from "../lib/copyTextToClipboard";
import { cx } from "../styles";
import { Button } from "./Button";

/** A short failure message, with expandable diagnostics when the failure has a code. */
export function ErrorNotice({
  error,
  className,
}: { error: Diagnostic; className?: string }) {
  const [copied, setCopied] = useState(false);
  const text = formatDiagnostic(error);
  return (
    <div role="alert" className={cx("text-sm text-red-400", className)}>
      <p>{error.message}</p>
      {error.code && (
        <details className="mt-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">
            Details
          </summary>
          <pre className="mt-2 select-text whitespace-pre-wrap break-all font-mono">
            {text}
          </pre>
          <Button
            size="sm"
            variant="ghost"
            className="mt-1"
            onClick={() =>
              void copyTextToClipboard(text).then((ok) => {
                if (!ok) return;
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            {copied ? "Copied" : "Copy details"}
          </Button>
        </details>
      )}
    </div>
  );
}
