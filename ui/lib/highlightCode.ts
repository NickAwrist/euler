import { bundledLanguages, createHighlighter } from "shiki";
type HighlighterInstance = Awaited<ReturnType<typeof createHighlighter>>;
let highlighterPromise: Promise<HighlighterInstance> | null = null;

function getHighlighter(): Promise<HighlighterInstance> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark-dimmed"],
      langs: [
        "javascript",
        "typescript",
        "tsx",
        "jsx",
        "json",
        "html",
        "css",
        "python",
        "bash",
        "sh",
        "yaml",
        "markdown",
        "sql",
        "rust",
        "go",
      ],
    });
  }
  return highlighterPromise;
}

export async function highlightCode(
  code: string,
  lang: string,
): Promise<string | null> {
  try {
    const highlighter = await getHighlighter();
    const cleanLang = lang.toLowerCase();
    if (
      cleanLang in bundledLanguages &&
      !highlighter.getLoadedLanguages().includes(cleanLang)
    ) {
      await highlighter.loadLanguage(
        cleanLang as keyof typeof bundledLanguages,
      );
    }
    const targetLang = highlighter.getLoadedLanguages().includes(cleanLang)
      ? cleanLang
      : "text";

    const fullHtml = highlighter.codeToHtml(code, {
      lang: targetLang,
      theme: "github-dark-dimmed",
    });
    const match = /<code>([\s\S]*?)<\/code>/.exec(fullHtml);
    return match?.[1] ?? null;
  } catch (err) {
    console.error("Syntax highlighting error:", err);
    return null;
  }
}
