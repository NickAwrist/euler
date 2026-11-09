import type { MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import type { Page } from "@playwright/test";
import {
  AgentService,
  type GetRuntimeResponseSchema,
} from "../../src/gen/euler/v1/agent_pb";
import {
  InputCapability,
  ModelProvider,
  type ModelSchema,
  ModelService,
} from "../../src/gen/euler/v1/models_pb";
import {
  type GetEnvironmentResponseSchema,
  PreferenceService,
} from "../../src/gen/euler/v1/preferences_pb";
import { ProviderService } from "../../src/gen/euler/v1/providers_pb";
import {
  type MessageSchema,
  Message_Role,
  type SessionSchema,
  SessionService,
  type SessionSummarySchema,
} from "../../src/gen/euler/v1/sessions_pb";
import { mockRpc, on } from "./rpcMock";

export type SummaryInit = MessageInitShape<typeof SessionSummarySchema>;
export type SessionInit = Exclude<
  MessageInitShape<typeof SessionSchema>,
  { $typeName: string }
>;
export type MessageInit = MessageInitShape<typeof MessageSchema>;
export type ModelInit = MessageInitShape<typeof ModelSchema>;
export type RuntimeInit = MessageInitShape<typeof GetRuntimeResponseSchema>;

export const at = timestampFromMs;
export const sandbox = { kind: { case: "sandbox" as const, value: {} } };

/** A transcript message from a role name and text. */
export function message(
  role: "user" | "assistant" | "event",
  content: string,
  fields: Pick<
    MessageInitShape<typeof MessageSchema>,
    "attachments" | "steps" | "versions" | "id" | "activationId"
  > = {},
): MessageInit {
  const roles = {
    user: Message_Role.USER,
    assistant: Message_Role.ASSISTANT,
    event: Message_Role.EVENT,
  };
  return { ...fields, role: roles[role], content };
}

/** A ready local model, the default every chat fixture can use. */
export function ollamaModel(id: string, fields: ModelInit = {}): ModelInit {
  return {
    id,
    name: id,
    lab: "Ollama",
    provider: ModelProvider.OLLAMA,
    configured: true,
    inputCapabilities: [InputCapability.TEXT],
    ...fields,
  };
}

/** A configured OpenRouter model. */
export function openRouterModel(
  route: string,
  fields: ModelInit = {},
): ModelInit {
  return {
    id: `openrouter:${route}`,
    route,
    name: route.split("/").at(-1),
    lab: route.split("/")[0],
    publisherId: route.split("/")[0],
    provider: ModelProvider.OPENROUTER,
    configured: true,
    inputCapabilities: [InputCapability.TEXT],
    ...fields,
  };
}

export type AppFixture = {
  sessions?: SummaryInit[];
  /** Stored chats by ID; GetSession reports others as missing. */
  chats?: Record<string, SessionInit>;
  models?: ModelInit[];
  environment?: MessageInitShape<typeof GetEnvironmentResponseSchema>;
};

/**
 * Serves a returning user's app: chat list, stored chats, their runtime, the
 * model catalog and healthy providers. Any other call gets an empty reply, so
 * tests add only the RPCs they exercise, registered after this one.
 */
export async function mockApp(page: Page, fixture: AppFixture = {}) {
  const chats = fixture.chats ?? {};
  const runtime = (sessionId: string): RuntimeInit => ({
    history: chats[sessionId]?.history ?? [],
  });
  await mockRpc(
    page,
    [
      on(SessionService.method.listSessions, () => ({
        sessions: fixture.sessions ?? [],
      })),
      on(SessionService.method.getSession, ({ id }) => {
        const chat = chats[id];
        return chat ? { session: { workspace: sandbox, ...chat, id } } : {};
      }),
      on(AgentService.method.getRuntime, ({ sessionId }) => runtime(sessionId)),
      on(ModelService.method.listModels, () => ({
        models: fixture.models ?? [ollamaModel("test")],
        providers: { ollama: { connected: true } },
      })),
      on(ProviderService.method.getOllamaHealth, () => ({ connected: true })),
      on(ProviderService.method.getComfyUiHealth, () => ({ connected: true })),
      on(PreferenceService.method.getEnvironment, () => ({
        ollamaHost: false,
        comfyuiHost: false,
        ...fixture.environment,
      })),
    ],
    { empty: true },
  );
}
