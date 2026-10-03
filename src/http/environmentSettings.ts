import { OperationError } from "../observability/errors";

/** Accept unchanged fields in a settings form without persisting environment values. */
export function canEditEnvironmentSetting(
  configuredValue: string,
  requestedValue: string,
): boolean {
  if (!configuredValue) return true;
  if (requestedValue.trim() !== configuredValue) {
    throw new OperationError("ENVIRONMENT_MANAGED");
  }
  return false;
}
