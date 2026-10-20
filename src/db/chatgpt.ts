import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { chatGptCredentialSchema } from "../schemas/chatgpt";
import { normalizeUserId } from "../userIdentity";
import { DATA_ROOT } from "./constants";

export type ChatGptCredential = z.infer<typeof chatGptCredentialSchema>;
const registrationSchema = chatGptCredentialSchema.pick({
  clientId: true,
  subject: true,
  email: true,
  name: true,
  picture: true,
});
export type ChatGptRegistration = z.infer<typeof registrationSchema>;
const storedSchema = z.union([chatGptCredentialSchema, registrationSchema]);
const directory = join(DATA_ROOT, "chatgpt");
function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return null;
    throw error;
  }
}
function write(path: string, value: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, value, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
function credentialPath(owner: string): string {
  const uuid = normalizeUserId(owner);
  if (!uuid) throw new Error("ChatGPT requires a user UUID");
  return join(directory, `${uuid}.json`);
}
export function readChatGptCredential(owner: string): ChatGptCredential | null {
  const value = read(credentialPath(owner));
  if (!value) return null;
  const stored = storedSchema.parse(JSON.parse(value));
  return "accessToken" in stored ? stored : null;
}
export function readChatGptRegistration(
  owner: string,
): ChatGptRegistration | null {
  const value = read(credentialPath(owner));
  return value ? registrationSchema.parse(JSON.parse(value)) : null;
}
export function saveChatGptCredential(
  owner: string,
  credential: ChatGptCredential,
): void {
  write(
    credentialPath(owner),
    JSON.stringify(chatGptCredentialSchema.parse(credential)),
  );
}
export function clearChatGptCredential(owner: string): void {
  const registration = readChatGptRegistration(owner);
  if (registration) write(credentialPath(owner), JSON.stringify(registration));
}
export function chatGptHostId(): string {
  const path = join(directory, "host-id");
  const existing = read(path);
  if (existing) return existing;
  const id = `urn:uuid:${crypto.randomUUID()}`;
  write(path, id);
  return id;
}
