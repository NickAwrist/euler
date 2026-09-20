type ApiErrorEnvelope = {
  error?:
    | string
    | {
        message?: unknown;
        code?: unknown;
        details?: unknown;
      };
};

function isGenericValidationMessage(msg: string): boolean {
  const normalized = msg.trim().toLowerCase().replace(/\.+$/, "");
  return (
    normalized === "invalid request body" ||
    normalized === "invalid request" ||
    normalized === "invalid query" ||
    normalized === "validation error" ||
    normalized === "validation failed" ||
    normalized === "bad request"
  );
}

function extractFirstDetailMessage(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;

  if (Array.isArray(details)) {
    for (const item of details) {
      if (typeof item === "string" && item.trim()) return item.trim();
      if (
        item &&
        typeof item === "object" &&
        typeof (item as { message?: unknown }).message === "string" &&
        (item as { message: string }).message.trim()
      ) {
        return (item as { message: string }).message.trim();
      }
    }
  }

  const d = details as {
    formErrors?: unknown;
    fieldErrors?: Record<string, unknown>;
    issues?: unknown;
  };

  if (Array.isArray(d.formErrors)) {
    for (const msg of d.formErrors) {
      if (typeof msg === "string" && msg.trim()) {
        return msg.trim();
      }
    }
  }

  if (d.fieldErrors && typeof d.fieldErrors === "object") {
    for (const key of Object.keys(d.fieldErrors)) {
      const messages = d.fieldErrors[key];
      if (Array.isArray(messages)) {
        for (const msg of messages) {
          if (typeof msg === "string" && msg.trim()) {
            return msg.trim();
          }
        }
      }
    }
  }

  if (Array.isArray(d.issues)) {
    for (const issue of d.issues) {
      if (
        issue &&
        typeof issue === "object" &&
        typeof (issue as { message?: unknown }).message === "string" &&
        (issue as { message: string }).message.trim()
      ) {
        return (issue as { message: string }).message.trim();
      }
    }
  }

  return null;
}

export async function readApiError(
  res: Response,
  fallback?: string,
): Promise<string> {
  try {
    const body = (await res.json()) as ApiErrorEnvelope;
    if (typeof body.error === "string") return body.error;
    if (body.error && typeof body.error === "object") {
      const msg =
        typeof body.error.message === "string" ? body.error.message.trim() : "";
      if (msg && !isGenericValidationMessage(msg)) {
        return msg;
      }
      const detailMsg = extractFirstDetailMessage(body.error.details);
      if (detailMsg) return detailMsg;
      if (msg) return msg;
    }
  } catch {
    /* ignore */
  }
  return fallback || res.statusText || `HTTP ${res.status}`;
}
