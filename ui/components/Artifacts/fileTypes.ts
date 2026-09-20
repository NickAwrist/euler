export function fileLanguage(path: string): string {
  const name = path.split("/").pop()?.toLowerCase() ?? "";
  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile") return "makefile";
  const extension = name.split(".").pop() ?? "";
  const languages: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    jsx: "jsx",
    json: "json",
    jsonc: "jsonc",
    md: "markdown",
    markdown: "markdown",
    py: "python",
    rs: "rust",
    go: "go",
    sh: "bash",
    bash: "bash",
    zsh: "shellscript",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml",
    css: "css",
    scss: "scss",
    html: "html",
    htm: "html",
    svg: "xml",
    xml: "xml",
    sql: "sql",
    c: "c",
    h: "c",
    cpp: "cpp",
    java: "java",
    rb: "ruby",
    php: "php",
    diff: "diff",
  };
  return languages[extension] ?? "text";
}
