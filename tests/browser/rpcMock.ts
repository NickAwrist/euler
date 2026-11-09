import {
  type DescMessage,
  type DescMethod,
  type DescService,
  type MessageInitShape,
  type MessageShape,
  create,
  fromJson,
  toBinary,
  toJson,
} from "@bufbuild/protobuf";
import type { Page, Request, Route } from "@playwright/test";
import { AgentService } from "../../src/gen/euler/v1/agent_pb";
import { AttachmentService } from "../../src/gen/euler/v1/attachments_pb";
import { ErrorCode, ErrorDetailSchema } from "../../src/gen/euler/v1/common_pb";
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

// Serves the web app's Connect calls in browser tests. Handlers take and
// return the generated messages, so fixtures stay typed and the wire format
// matches the real server's JSON encoding.

const SERVICES = [
  AgentService,
  AttachmentService,
  DebugService,
  DeviceService,
  DirectoryService,
  EventService,
  JobService,
  McpServerService,
  ModelService,
  PreferenceService,
  ProviderService,
  SessionService,
  SkillService,
  UsageService,
  WorkspaceService,
] as const;

/** A failed call, as the server reports one. */
export class RpcFailure {
  constructor(
    readonly code: string,
    readonly message: string,
    readonly errorCode?: keyof typeof ErrorCode,
  ) {}
}

const HTTP_STATUS: Record<string, number> = {
  invalid_argument: 400,
  not_found: 404,
  permission_denied: 403,
  failed_precondition: 400,
  resource_exhausted: 429,
  unavailable: 503,
  internal: 500,
};

export type RpcContext = { userId: string | undefined; request: Request };
/** One RPC's mock: built with `on` or `onStream`, so request and reply are typed. */
export type RpcMock = {
  method: DescMethod;
  handle: (request: unknown, context: RpcContext) => unknown;
};

type Handler<I extends DescMessage, R> = (
  request: MessageShape<I>,
  context: RpcContext,
) => R | RpcFailure | undefined | Promise<R | RpcFailure | undefined>;

/** Mocks a unary RPC. Returning undefined falls through to the next route. */
export function on<I extends DescMessage, O extends DescMessage>(
  method: { input: I; output: O; methodKind: "unary" },
  handle: Handler<I, MessageInitShape<O>>,
): RpcMock {
  return {
    method: method as unknown as DescMethod,
    handle: handle as RpcMock["handle"],
  };
}

/** Mocks a server stream with the messages to send before it ends. */
export function onStream<I extends DescMessage, O extends DescMessage>(
  method: { input: I; output: O; methodKind: "server_streaming" },
  handle: Handler<I, MessageInitShape<O>[]>,
): RpcMock {
  return {
    method: method as unknown as DescMethod,
    handle: handle as RpcMock["handle"],
  };
}

const methods = new Map<string, { key: string; method: DescMethod }>(
  SERVICES.flatMap((service) =>
    service.methods.map((method) => [
      `/api/rpc/${service.typeName}/${method.name}`,
      {
        key: `${service.typeName.replace("euler.v1.", "")}/${method.name}`,
        method,
      },
    ]),
  ),
);

/** Wraps one JSON message as a Connect stream frame. */
function frame(json: unknown, flags = 0): Buffer {
  const body = Buffer.from(JSON.stringify(json));
  const header = Buffer.alloc(5);
  header.writeUInt8(flags, 0);
  header.writeUInt32BE(body.length, 1);
  return Buffer.concat([header, body]);
}

function failureJson(failure: RpcFailure) {
  const errorCode = failure.errorCode;
  return {
    code: failure.code,
    message: failure.message,
    ...(errorCode
      ? {
          details: [
            {
              type: "euler.v1.ErrorDetail",
              value: Buffer.from(
                toBinary(
                  ErrorDetailSchema,
                  create(ErrorDetailSchema, {
                    code: ErrorCode[errorCode],
                    message: failure.message,
                  }),
                ),
              )
                .toString("base64")
                .replace(/=+$/, ""),
            },
          ],
        }
      : {}),
  };
}

function decodeRequest(method: DescMethod, request: Request) {
  if (method.methodKind === "unary")
    return fromJson(method.input, request.postDataJSON() ?? {});
  // A streaming request is one enveloped JSON message.
  const body = request.postDataBuffer() ?? Buffer.alloc(0);
  const json = body.length > 5 ? JSON.parse(body.subarray(5).toString()) : {};
  return fromJson(method.input, json);
}

/**
 * Routes `/api/rpc/*` to `handlers`. A handler that returns undefined, or a
 * missing one, falls through to the next route; with `empty`, unmocked calls
 * succeed with an empty response and streams end at once.
 */
export async function mockRpc(
  page: Page,
  mocks: RpcMock[],
  options: { empty?: boolean } = {},
) {
  const handlers = new Map(
    mocks.map((mock) => [
      `${mock.method.parent.typeName}/${mock.method.name}`,
      mock.handle,
    ]),
  );
  await page.route("**/api/rpc/**", async (route: Route) => {
    const request = route.request();
    const entry = methods.get(new URL(request.url()).pathname);
    if (!entry) return route.fallback();
    const { method } = entry;
    const handler = handlers.get(`${method.parent.typeName}/${method.name}`);
    const context = {
      userId: request.headers()["x-euler-user-id"],
      request,
    };
    const result = handler
      ? await handler(decodeRequest(method, request), context)
      : options.empty
        ? method.methodKind === "unary"
          ? {}
          : []
        : undefined;
    if (result === undefined) return route.fallback();
    if (result instanceof RpcFailure) {
      if (method.methodKind === "unary")
        return route.fulfill({
          status: HTTP_STATUS[result.code] ?? 500,
          json: failureJson(result),
        });
      return route.fulfill({
        headers: { "Content-Type": "application/connect+json" },
        body: frame({ error: failureJson(result) }, 2),
      });
    }
    if (method.methodKind === "unary")
      return route.fulfill({
        json: toJson(method.output, create(method.output, result as never)),
      });
    // A stream handler returns its messages; the stream then ends.
    const messages = (result as unknown[]).map((message) =>
      frame(toJson(method.output, create(method.output, message as never))),
    );
    return route.fulfill({
      headers: { "Content-Type": "application/connect+json" },
      body: Buffer.concat([...messages, frame({}, 2)]),
    });
  });
}

/** The descriptor of the RPC a browser request called. */
export function rpcMethod(request: Request): DescMethod | undefined {
  return methods.get(new URL(request.url()).pathname)?.method;
}

/** The RPC a browser request called, such as "SessionService/ListSessions". */
export function rpcKey(request: Request): string | undefined {
  return methods.get(new URL(request.url()).pathname)?.key;
}

/** The decoded request of an RPC the browser sent, or undefined for another call. */
export function rpcRequest<I extends DescMessage>(
  request: Request,
  method: { input: I; name: string; parent: DescService },
): MessageShape<I> | undefined {
  const entry = methods.get(new URL(request.url()).pathname);
  if (entry?.method.name !== method.name) return undefined;
  if (entry.method.parent.typeName !== method.parent.typeName) return undefined;
  return decodeRequest(entry.method, request) as MessageShape<I>;
}
