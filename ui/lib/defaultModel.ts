import type { ModelOption } from "../types";

/** Use the saved preference only while its model is available. */
export function effectiveDefaultRunModel(
  savedModel: string,
  models: ModelOption[],
): string {
  const available = models.filter(
    (model) =>
      model.configured !== false && model.availability !== "unavailable",
  );
  return (
    available.find((model) => model.id === savedModel.trim())?.id ??
    available[0]?.id ??
    ""
  );
}
