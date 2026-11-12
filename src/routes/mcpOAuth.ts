import { Router } from "express";
import { asyncRoute } from "../http/asyncRoute";
import {
  MCP_OAUTH_APP_RETURN_URL,
  completeMcpOAuthHttpCallback,
} from "../mcp/oauth";

const router = Router();

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderCallbackPage(options: {
  ok: boolean;
  title: string;
  body: string;
  serverId?: string;
}): string {
  const payload = JSON.stringify({
    type: "euler:mcp-oauth",
    ok: options.ok,
    serverId: options.serverId ?? null,
    error: options.ok ? null : options.body,
  }).replaceAll("<", "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.title)}</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, -apple-system, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    main { max-width: 420px; border: 1px solid rgba(128, 128, 128, 0.28); border-radius: 12px; padding: 20px 22px; }
    h1 { margin: 0 0 8px; font-size: 16px; font-weight: 600; }
    p { margin: 0; font-size: 14px; line-height: 1.5; opacity: 0.8; word-break: break-word; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(options.title)}</h1>
    <p>${escapeHtml(options.body)}</p>
  </main>
  <script>
    (function () {
      var message = ${payload};
      try {
        var channel = new BroadcastChannel("euler:mcp-oauth");
        channel.postMessage(message);
        channel.close();
      } catch (e) {}
      if (message.ok) {
        try { window.close(); } catch (e) {}
      }
    })();
  </script>
</body>
</html>`;
}

router.get(
  "/callback",
  asyncRoute(async (req, res) => {
    const params = new URL(req.originalUrl, "http://127.0.0.1").searchParams;
    const outcome = await completeMcpOAuthHttpCallback(params);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (outcome.returnToApp) {
      // Percent-encoded, since iOS reads a "+" in a query as a plus sign.
      res.redirect(
        302,
        outcome.ok
          ? MCP_OAUTH_APP_RETURN_URL
          : `${MCP_OAUTH_APP_RETURN_URL}?error=${encodeURIComponent(outcome.message)}`,
      );
      return;
    }
    if (outcome.ok) {
      res.status(200).send(
        renderCallbackPage({
          ok: true,
          serverId: outcome.serverId,
          title: `Connected to ${outcome.serverName}`,
          body: "Authorization succeeded. You can close this tab and return to Euler.",
        }),
      );
      return;
    }
    res.status(400).send(
      renderCallbackPage({
        ok: false,
        serverId: outcome.serverId,
        title: "MCP authorization failed",
        body: outcome.message,
      }),
    );
  }),
);

export default router;
