import { afterEach, expect, test } from "bun:test";
import {
  getOllamaHost,
  getOpenRouterApiKey,
  setOllamaHost,
  setOpenRouterApiKey,
} from "../../src/db";
import { DB_PATH } from "../../src/db/constants";
import { envConfig } from "../../src/env";

const original = { ...envConfig };

afterEach(() => {
  Object.assign(envConfig, original);
});

test("the default test runner isolates the development database and credentials", () => {
  expect(DB_PATH).toBe(":memory:");
  expect(envConfig.openrouterApiKey).toBe("");
  expect(envConfig.ollamaHost).toBe("");
});

test("explicit provider configuration overrides persisted test settings", () => {
  setOpenRouterApiKey("fake-key");
  setOllamaHost("http://ollama.test");
  envConfig.openrouterApiKey = "configured-key";
  envConfig.ollamaHost = "http://configured-ollama:11434";

  expect(getOpenRouterApiKey()).toBe("configured-key");
  expect(getOllamaHost()).toBe("http://configured-ollama:11434");

  setOpenRouterApiKey("");
  setOllamaHost("");
  expect(getOpenRouterApiKey()).toBe("configured-key");
  expect(getOllamaHost()).toBe("http://configured-ollama:11434");
});

test("provider settings remain editable without environment configuration", () => {
  envConfig.openrouterApiKey = "";
  envConfig.ollamaHost = "";
  setOpenRouterApiKey(" saved-key ");
  setOllamaHost(" http://saved-ollama:11434 ");
  expect(getOpenRouterApiKey()).toBe("saved-key");
  expect(getOllamaHost()).toBe("http://saved-ollama:11434");

  setOpenRouterApiKey("");
  setOllamaHost("");
  expect(getOpenRouterApiKey()).toBe("");
  expect(getOllamaHost()).toBe("");
});
