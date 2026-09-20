import { ApiError } from "./errors";

/** Accept unchanged fields in a settings form without persisting environment values. */
export function canEditEnvironmentSetting(
  configuredValue: string,
  requestedValue: string,
): boolean {
  if (!configuredValue) return true;
  if (requestedValue.trim() !== configuredValue) {
    throw new ApiError(
      409,
      "CONFLICT",
      "This setting is managed by the environment.",
    );
  }
  return false;
}
