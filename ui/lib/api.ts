import { userScopedFetch } from "../persist/userIdentity";
import { readApiError } from "./readApiError";

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  json?: unknown;
  body?: BodyInit | null;
  headers?: HeadersInit;
  signal?: AbortSignal;
  errorMessage?: string;
  keepalive?: boolean;
  notFound?: "null" | "throw";
}

export async function userApiFetch(
  url: string,
  options: ApiRequestOptions = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  let body = options.body;
  if (options.json !== undefined) {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    body = JSON.stringify(options.json);
  }

  const response = await userScopedFetch(url, {
    method: options.method ?? "GET",
    headers,
    body,
    signal: options.signal,
    keepalive: options.keepalive,
  });

  if (response.status === 404 && options.notFound === "null") {
    return response;
  }

  if (!response.ok) {
    throw new Error(await readApiError(response, options.errorMessage));
  }

  return response;
}

export async function globalApiFetch(
  url: string,
  options: ApiRequestOptions = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  let body = options.body;
  if (options.json !== undefined) {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    body = JSON.stringify(options.json);
  }

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body,
    signal: options.signal,
    keepalive: options.keepalive,
  });

  if (response.status === 404 && options.notFound === "null") {
    return response;
  }

  if (!response.ok) {
    throw new Error(await readApiError(response, options.errorMessage));
  }

  return response;
}

export async function userApiJson<T>(
  url: string,
  options?: ApiRequestOptions,
): Promise<T> {
  const response = await userApiFetch(url, options);
  if (response.status === 404 && options?.notFound === "null") {
    return null as T;
  }
  return response.json() as Promise<T>;
}

export async function globalApiJson<T>(
  url: string,
  options?: ApiRequestOptions,
): Promise<T> {
  const response = await globalApiFetch(url, options);
  if (response.status === 404 && options?.notFound === "null") {
    return null as T;
  }
  return response.json() as Promise<T>;
}

export async function userApiVoid(
  url: string,
  options?: ApiRequestOptions,
): Promise<void> {
  await userApiFetch(url, options);
}

export async function globalApiVoid(
  url: string,
  options?: ApiRequestOptions,
): Promise<void> {
  await globalApiFetch(url, options);
}

export async function userApiBlob(
  url: string,
  options?: ApiRequestOptions,
): Promise<Blob> {
  const response = await userApiFetch(url, options);
  return response.blob();
}

export async function globalApiBlob(
  url: string,
  options?: ApiRequestOptions,
): Promise<Blob> {
  const response = await globalApiFetch(url, options);
  return response.blob();
}

export const apiJson = userApiJson;
export const apiVoid = userApiVoid;
export const apiBlob = userApiBlob;
