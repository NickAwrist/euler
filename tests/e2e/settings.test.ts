import "../setup";
import { beforeEach, describe, expect, test } from "bun:test";
import { getOpenRouterApiKey } from "../../src/db";
import { getDb } from "../../src/db/connection";
import { startTestServer } from "../helpers/server";

describe("Settings E2E Tests", () => {
  beforeEach(() => {
    const db = getDb();
    db.run("DELETE FROM app_settings");
  });

  test("balance requires a configured key and is never cached", async () => {
    const { url, close } = await startTestServer();
    try {
      const response = await fetch(`${url}/api/settings/openrouter/balance`);
      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toMatchObject({
        error: { code: "INVALID_REQUEST" },
      });
    } finally {
      await close();
    }
  });

  test("save, retrieve presence/absence, overwrite, clear, whitespace trim, empty payload, SQL injection, and database locks", async () => {
    const { url, close } = await startTestServer();
    try {
      // 1. Retrieve presence/absence (should be false initially because DB was cleared)
      let getRes = await fetch(`${url}/api/settings/openrouter`);
      expect(getRes.status).toBe(200);
      let getData = await getRes.json();
      expect(getData.hasKey).toBeFalse();

      // 2. Save / Trim whitespace
      let putRes = await fetch(`${url}/api/settings/openrouter`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "  sk-or-test-key-12345  " }),
      });
      expect(putRes.status).toBe(200);
      const putData = (await putRes.json()) as { ok?: boolean };
      expect(putData.ok).toBeTrue();
      expect(getOpenRouterApiKey()).toBe("sk-or-test-key-12345");

      // The secret is never returned by the read endpoint.
      getRes = await fetch(`${url}/api/settings/openrouter`);
      expect(JSON.stringify(await getRes.json())).not.toContain(
        "sk-or-test-key-12345",
      );

      // Verify presence is now true
      getRes = await fetch(`${url}/api/settings/openrouter`);
      expect(getRes.status).toBe(200);
      getData = await getRes.json();
      expect(getData.hasKey).toBeTrue();

      // 3. Overwrite key
      putRes = await fetch(`${url}/api/settings/openrouter`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "sk-or-new-key-6789" }),
      });
      expect(putRes.status).toBe(200);
      expect(getOpenRouterApiKey()).toBe("sk-or-new-key-6789");

      // 4. Clear key (empty payload / empty string / clear)
      putRes = await fetch(`${url}/api/settings/openrouter`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "" }),
      });
      expect(putRes.status).toBe(200);
      expect(getOpenRouterApiKey()).toBe("");

      getRes = await fetch(`${url}/api/settings/openrouter`);
      expect((await getRes.json()).hasKey).toBeFalse();

      // Clear key via empty payload
      putRes = await fetch(`${url}/api/settings/openrouter`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(putRes.status).toBe(200);
      expect(getOpenRouterApiKey()).toBe("");

      // 5. SQL Injection Attempt
      const sqlInjection = "' OR '1'='1";
      putRes = await fetch(`${url}/api/settings/openrouter`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: sqlInjection }),
      });
      expect(putRes.status).toBe(200);
      expect(getOpenRouterApiKey()).toBe(sqlInjection);

      // 6. Database locks (concurrent writes)
      const promises = Array.from({ length: 20 }).map((_, i) => {
        return fetch(`${url}/api/settings/openrouter`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: `concurrent-key-${i}` }),
        });
      });
      const responses = await Promise.all(promises);
      for (const res of responses) {
        expect(res.status).toBe(200);
      }
      expect(getOpenRouterApiKey()).toStartWith("concurrent-key-");
    } finally {
      await close();
    }
  });
});
