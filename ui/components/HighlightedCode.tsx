import { type ComponentPropsWithoutRef, useEffect, useState } from "react";
import { highlightCode } from "../lib/highlightCode";

export function HighlightedCode({
  code,
  language,
  ...props
}: Omit<ComponentPropsWithoutRef<"code">, "children"> & {
  code: string;
  language: string;
}) {
  const [highlighted, setHighlighted] = useState<{
    code: string;
    language: string;
    html: string;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void highlightCode(code, language).then((html) => {
      if (!cancelled && html) setHighlighted({ code, language, html });
    });
    return () => {
      cancelled = true;
    };
  }, [code, language]);
  if (highlighted?.code === code && highlighted.language === language) {
    return (
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki escapes source text and generates the markup.
      <code {...props} dangerouslySetInnerHTML={{ __html: highlighted.html }} />
    );
  }
  return <code {...props}>{code}</code>;
}
