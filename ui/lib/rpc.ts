import type { DescService } from "@bufbuild/protobuf";
import {
  type Client,
  Code,
  ConnectError,
  type Interceptor,
  createClient,
} from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { AgentService } from "../../src/gen/euler/v1/agent_pb";
import { AttachmentService } from "../../src/gen/euler/v1/attachments_pb";
import { DebugService } from "../../src/gen/euler/v1/debug_pb";
import { DirectoryService } from "../../src/gen/euler/v1/directories_pb";
import { EventService } from "../../src/gen/euler/v1/events_pb";
import { JobService } from "../../src/gen/euler/v1/jobs_pb";
import { McpServerService } from "../../src/gen/euler/v1/mcp_pb";
import { ModelService } from "../../src/gen/euler/v1/models_pb";
import { PreferenceService } from "../../src/gen/euler/v1/preferences_pb";
import { ProviderService } from "../../src/gen/euler/v1/providers_pb";
import { SessionService } from "../../src/gen/euler/v1/sessions_pb";
import { SkillService } from "../../src/gen/euler/v1/skills_pb";
import { UsageService } from "../../src/gen/euler/v1/usage_pb";
import { WorkspaceService } from "../../src/gen/euler/v1/workspace_pb";
import { USER_ID_HEADER, getOrCreateUserId } from "../persist/userIdentity";
import { ApiError, apiErrorFromConnect } from "./apiError";

/** Names the browser's user on every call, from the one stored ID. */
const userIdHeader: Interceptor = (next) => (request) => {
  request.header.set(USER_ID_HEADER, getOrCreateUserId());
  return next(request);
};

// JSON keeps requests readable in DevTools; the iOS app uses binary.
const transport = createConnectTransport({
  baseUrl: "/api/rpc",
  useBinaryFormat: false,
  interceptors: [userIdHeader],
});

/**
 * A client whose unary failures surface as ApiError, so callers show the
 * server's public message. Cancellation stays a ConnectError.
 */
function rpcClient<T extends DescService>(service: T): Client<T> {
  const client = createClient(service, transport);
  for (const method of service.methods) {
    if (method.methodKind !== "unary") continue;
    const call = client[method.localName as keyof Client<T>] as (
      ...args: unknown[]
    ) => Promise<unknown>;
    Object.assign(client, {
      [method.localName]: async (...args: unknown[]) => {
        try {
          return await call(...args);
        } catch (error) {
          const connectError = ConnectError.from(error);
          throw connectError.code === Code.Canceled
            ? error
            : apiErrorFromConnect(connectError);
        }
      },
    });
  }
  return client;
}

export const eventClient = createClient(EventService, transport);
export const sessionClient = rpcClient(SessionService);
export const agentClient = rpcClient(AgentService);
export const jobClient = rpcClient(JobService);
export const attachmentClient = rpcClient(AttachmentService);
export const modelClient = rpcClient(ModelService);
export const workspaceClient = rpcClient(WorkspaceService);
export const preferenceClient = rpcClient(PreferenceService);
export const skillClient = rpcClient(SkillService);
export const mcpServerClient = rpcClient(McpServerService);
export const providerClient = rpcClient(ProviderService);
export const usageClient = rpcClient(UsageService);
export const directoryClient = rpcClient(DirectoryService);
export const debugClient = rpcClient(DebugService);

/** Whether a failed call reported the item missing. */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.code === Code.NotFound;
}

/**
 * Runs a call whose failures the server did not explain, such as a dropped
 * connection, report as `message` instead of the protocol's wording.
 */
export async function withErrorMessage<T>(
  call: Promise<T>,
  message: string,
): Promise<T> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof ApiError && !error.diagnostic)
      throw new ApiError(message, error.status, undefined, error.code);
    throw error;
  }
}
