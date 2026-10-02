import { userApiJson } from "./api";

export async function modelSettingsRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  return userApiJson<T>(`/api/settings/${path}`, {
    method: method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    json: body,
  });
}
