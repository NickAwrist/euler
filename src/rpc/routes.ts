import {
  type ConnectRouter,
  type ConnectRouterOptions,
  createContextValues,
} from "@connectrpc/connect";
import { expressConnectMiddleware } from "@connectrpc/connect-express";
import type { Request } from "express";
import { AgentService } from "../gen/euler/v1/agent_pb";
import { AttachmentService } from "../gen/euler/v1/attachments_pb";
import { DebugService } from "../gen/euler/v1/debug_pb";
import { DeviceService } from "../gen/euler/v1/devices_pb";
import { DirectoryService } from "../gen/euler/v1/directories_pb";
import { EventService } from "../gen/euler/v1/events_pb";
import { JobService } from "../gen/euler/v1/jobs_pb";
import { McpServerService } from "../gen/euler/v1/mcp_pb";
import { ModelService } from "../gen/euler/v1/models_pb";
import { PreferenceService } from "../gen/euler/v1/preferences_pb";
import { ProviderService } from "../gen/euler/v1/providers_pb";
import { SessionService } from "../gen/euler/v1/sessions_pb";
import { SkillService } from "../gen/euler/v1/skills_pb";
import { UsageService } from "../gen/euler/v1/usage_pb";
import { WorkspaceService } from "../gen/euler/v1/workspace_pb";
import { agentService } from "./agent";
import { attachmentService } from "./attachments";
import { forwardedForKey, remoteAddressKey } from "./context";
import { debugService } from "./debug";
import { deviceService } from "./devices";
import { directoryService } from "./directories";
import { eventService } from "./events";
import { errorMapping, userIdentity, validation } from "./interceptors";
import { jobService } from "./jobs";
import { mcpServerService } from "./mcp";
import { modelService } from "./models";
import { preferenceService } from "./preferences";
import { providerService } from "./providers";
import { sessionService } from "./sessions";
import { skillService } from "./skills";
import { usageService } from "./usage";
import { workspaceService } from "./workspace";

/** Where the services are served, for the web app and the iOS app alike. */
export const RPC_PATH_PREFIX = "/api/rpc";

export function registerServices(router: ConnectRouter) {
  router.service(EventService, eventService);
  router.service(SessionService, sessionService);
  router.service(AgentService, agentService);
  router.service(JobService, jobService);
  router.service(AttachmentService, attachmentService);
  router.service(ModelService, modelService);
  router.service(DeviceService, deviceService);
  router.service(WorkspaceService, workspaceService);
  router.service(PreferenceService, preferenceService);
  router.service(SkillService, skillService);
  router.service(McpServerService, mcpServerService);
  router.service(ProviderService, providerService);
  router.service(UsageService, usageService);
  router.service(DirectoryService, directoryService);
  router.service(DebugService, debugService);
}

/** Shared by the HTTP mount and in-process test clients; the first interceptor is outermost. */
export const RPC_OPTIONS: ConnectRouterOptions = {
  interceptors: [errorMapping, userIdentity, validation],
  // gRPC needs HTTP/2 trailers, which Express on Bun does not provide.
  grpc: false,
  grpcWeb: false,
  // An 8 MiB image grows by a third as base64 in the web's JSON encoding.
  readMaxBytes: 12 * 1024 * 1024,
};

export function rpcMiddleware() {
  return expressConnectMiddleware({
    ...RPC_OPTIONS,
    requestPathPrefix: RPC_PATH_PREFIX,
    routes: registerServices,
    contextValues: (req: Request) =>
      createContextValues()
        .set(remoteAddressKey, req.socket.remoteAddress ?? "")
        .set(forwardedForKey, req.get("x-forwarded-for")),
  });
}
