import { RE2JS } from "re2js";

// Fits a full policy and recent edits, without retaining every pattern ever saved.
const CACHE_LIMIT = 128;
const compiledPatterns = new Map<string, RE2JS>();

/** Validation and execution share the same compiled pattern and regex syntax. */
export function compileToolRegex(pattern: string): RE2JS {
  const cached = compiledPatterns.get(pattern);
  if (cached) {
    compiledPatterns.delete(pattern);
    compiledPatterns.set(pattern, cached);
    return cached;
  }
  const compiled = RE2JS.compile(pattern);
  if (compiledPatterns.size >= CACHE_LIMIT) {
    const oldest = compiledPatterns.keys().next().value;
    if (oldest !== undefined) compiledPatterns.delete(oldest);
  }
  compiledPatterns.set(pattern, compiled);
  return compiled;
}
