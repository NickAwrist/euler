export type ActiveFileToken = {
  start: number;
  end: number;
  query: string;
};

export function findActiveFileToken(
  value: string,
  caret: number,
): ActiveFileToken | null {
  if (caret < 0 || caret > value.length) return null;
  const start = value.lastIndexOf("@", caret - 1);
  if (start < 0 || start >= caret) return null;
  if (start > 0 && !/[\s([{]/.test(value[start - 1]!)) return null;

  const quoted = value[start + 1] === '"';
  const query = value.slice(start + (quoted ? 2 : 1), caret);
  const pattern = quoted ? /^[^"\r\n]*$/ : /^[^\s@"<>()[\]{}]*$/;
  if (!pattern.test(query)) return null;
  const suffix =
    value
      .slice(caret)
      .match(quoted ? /^[^"\r\n]*"?/ : /^[^\s@"<>()[\]{}]*/)?.[0] ?? "";
  return { start, end: caret + suffix.length, query };
}

export function completeFileToken(
  value: string,
  token: ActiveFileToken,
  path: string,
): { value: string; caret: number } {
  const reference = /[\s"<>()[\]{}@]/.test(path) ? JSON.stringify(path) : path;
  const replacement = `@${reference}${token.end === value.length ? " " : ""}`;
  return {
    value: `${value.slice(0, token.start)}${replacement}${value.slice(token.end)}`,
    caret: token.start + replacement.length,
  };
}
