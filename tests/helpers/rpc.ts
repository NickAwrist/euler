import type { DescService } from "@bufbuild/protobuf";
import {
  type Client,
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
} from "@connectrpc/connect";
import { AgentService } from "../../src/gen/euler/v1/agent_pb";
import { AttachmentService } from "../../src/gen/euler/v1/attachments_pb";
import { DebugService } from "../../src/gen/euler/v1/debug_pb";
import { DeviceService } from "../../src/gen/euler/v1/devices_pb";
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
import { RPC_OPTIONS, registerServices } from "../../src/rpc/routes";
import { USER_ID_HEADER } from "../../src/userIdentity";
import { TEST_USER_ID } from "./server";

/**
 * Typed clients for every service, served in process through the same router
 * options and interceptors as the HTTP mount. `owner: null` omits the user
 * header.
 */
export function rpc(owner: string | null = TEST_USER_ID) {
  const transport = createRouterTransport(registerServices, {
    router: RPC_OPTIONS,
    transport: {
      interceptors: [
        (next) => (request) => {
          if (owner !== null) request.header.set(USER_ID_HEADER, owner);
          return next(request);
        },
      ],
    },
  });
  const client = <T extends DescService>(service: T): Client<T> =>
    createClient(service, transport);
  return {
    events: client(EventService),
    sessions: client(SessionService),
    agent: client(AgentService),
    jobs: client(JobService),
    attachments: client(AttachmentService),
    models: client(ModelService),
    devices: client(DeviceService),
    workspace: client(WorkspaceService),
    preferences: client(PreferenceService),
    skills: client(SkillService),
    mcp: client(McpServerService),
    providers: client(ProviderService),
    usage: client(UsageService),
    directories: client(DirectoryService),
    debug: client(DebugService),
  };
}

/** The Connect code a call failed with, or "ok" when it succeeded. */
export async function rpcCode(call: Promise<unknown>): Promise<Code | "ok"> {
  try {
    await call;
    return "ok";
  } catch (error) {
    return ConnectError.from(error).code;
  }
}

/** The failure a call raised, for asserting on its code and public message. */
export async function rpcError(call: Promise<unknown>): Promise<ConnectError> {
  try {
    await call;
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("Expected the call to fail");
}

export { Code };
