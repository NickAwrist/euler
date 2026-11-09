import { providerClient } from "../lib/rpc";

export async function loadChatGptStatus(signal?: AbortSignal) {
  return (await providerClient.getChatGptStatus({}, { signal })).status!;
}

export async function startChatGptLogin(newAccount = false) {
  return providerClient.startChatGptLogin({ newAccount });
}

export async function finishChatGptLogin(callbackUrl: string) {
  return (await providerClient.finishChatGptLogin({ callbackUrl })).status!;
}

export async function disconnectChatGpt() {
  return providerClient.disconnectChatGpt({});
}
