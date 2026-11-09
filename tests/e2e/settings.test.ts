import "../setup";
import { beforeEach, describe, expect, test } from "bun:test";
import { toBinary } from "@bufbuild/protobuf";
import { getOpenRouterApiKey } from "../../src/db";
import { getDb } from "../../src/db/connection";
import {
  ApiKeyProvider,
  GetApiKeyResponseSchema,
} from "../../src/gen/euler/v1/providers_pb";
import { Code, rpc, rpcCode } from "../helpers/rpc";

const provider = ApiKeyProvider.OPENROUTER;

describe("Settings E2E Tests", () => {
  beforeEach(() => {
    getDb().run("DELETE FROM app_settings");
  });

  test("balance requires a configured key", async () => {
    expect(await rpcCode(rpc().providers.getOpenRouterBalance({}))).toBe(
      Code.InvalidArgument,
    );
  });

  test("save, retrieve presence/absence, overwrite, clear, whitespace trim, SQL injection, and database locks", async () => {
    const { providers } = rpc();
    const hasKey = async () =>
      (await providers.getApiKey({ provider })).state?.hasKey;
    // 1. Absent because the table was cleared.
    expect(await hasKey()).toBeFalse();

    // 2. Save, trimming whitespace.
    const saved = await providers.setApiKey({
      provider,
      apiKey: "  sk-or-test-key-12345  ",
    });
    expect(saved.state?.hasKey).toBeTrue();
    expect(getOpenRouterApiKey()).toBe("sk-or-test-key-12345");

    // The secret is never returned.
    const read = await providers.getApiKey({ provider });
    expect(
      Buffer.from(toBinary(GetApiKeyResponseSchema, read)).toString(),
    ).not.toContain("sk-or-test-key-12345");
    expect(read.state?.hasKey).toBeTrue();

    // 3. Overwrite.
    await providers.setApiKey({ provider, apiKey: "sk-or-new-key-6789" });
    expect(getOpenRouterApiKey()).toBe("sk-or-new-key-6789");

    // 4. Clear with an empty key.
    await providers.setApiKey({ provider, apiKey: "" });
    expect(getOpenRouterApiKey()).toBe("");
    expect(await hasKey()).toBeFalse();
    await providers.setApiKey({ provider });
    expect(getOpenRouterApiKey()).toBe("");

    // 5. SQL injection is stored as text.
    const sqlInjection = "' OR '1'='1";
    await providers.setApiKey({ provider, apiKey: sqlInjection });
    expect(getOpenRouterApiKey()).toBe(sqlInjection);

    // 6. Concurrent writes all succeed.
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        providers.setApiKey({ provider, apiKey: `concurrent-key-${i}` }),
      ),
    );
    expect(getOpenRouterApiKey()).toStartWith("concurrent-key-");

    // An unknown provider and an oversized key are rejected.
    expect(await rpcCode(providers.getApiKey({}))).toBe(Code.InvalidArgument);
    expect(
      await rpcCode(providers.setApiKey({ provider, apiKey: "k".repeat(513) })),
    ).toBe(Code.InvalidArgument);
  });
});
