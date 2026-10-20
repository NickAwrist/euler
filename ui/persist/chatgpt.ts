import {
  chatGptDisconnectSchema,
  chatGptLoginSchema,
  chatGptStatusSchema,
} from "../../src/schemas/chatgpt";
import { userApiJson } from "../lib/api";

const path = "/api/settings/chatgpt";

export async function loadChatGptStatus(signal?: AbortSignal) {
  return chatGptStatusSchema.parse(
    await userApiJson<unknown>(path, { signal }),
  );
}

export async function startChatGptLogin(newAccount = false) {
  return chatGptLoginSchema.parse(
    await userApiJson<unknown>(`${path}/login`, {
      method: "POST",
      json: { newAccount },
    }),
  );
}

export async function finishChatGptLogin(callbackUrl: string) {
  return chatGptStatusSchema.parse(
    await userApiJson<unknown>(`${path}/callback`, {
      method: "POST",
      json: { callbackUrl },
    }),
  );
}

export async function disconnectChatGpt() {
  return chatGptDisconnectSchema.parse(
    await userApiJson<unknown>(path, { method: "DELETE" }),
  );
}
