import { type JsonValue, fromJson } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import type { ServiceImpl } from "@connectrpc/connect";
import {
  effectiveUserPreferences,
  updateUserPreferences,
} from "../db/userPreferences";
import { getEnvironmentSettings } from "../env";
import {
  PermissionField_Type,
  type PreferenceService,
} from "../gen/euler/v1/preferences_pb";
import { OperationError } from "../observability/errors";
import {
  removeToolPermissionRule,
  saveToolPermissionRule,
} from "../permissions/preferences";
import { toolCatalog } from "../permissions/toolCatalog";
import { preferences, preferencesPatch } from "../preferences/wire";
import { ToolPermissionRuleSchema } from "../schemas/toolPermissions";
import { ownerOf } from "./context";
import { fromPermissionRule, icon } from "./wire";

const FIELD_TYPES = {
  string: PermissionField_Type.STRING,
  number: PermissionField_Type.NUMBER,
  boolean: PermissionField_Type.BOOLEAN,
} as const;

export const preferenceService: ServiceImpl<typeof PreferenceService> = {
  getPreferences(_request, context) {
    return {
      preferences: preferences(effectiveUserPreferences(ownerOf(context))),
    };
  },
  updatePreferences(request, context) {
    const width = request.layout?.artifactWidth;
    if (width && width < 280)
      throw new OperationError("INVALID_REQUEST", {
        message: "layout.artifact_width: must be at least 280",
      });
    return {
      preferences: preferences(
        updateUserPreferences(ownerOf(context), preferencesPatch(request)),
      ),
    };
  },
  putPermissionRule(request, context) {
    // RE2 compiles each regex here, which buf.validate cannot express.
    const parsed = ToolPermissionRuleSchema.safeParse(
      fromPermissionRule(request.rule!),
    );
    if (!parsed.success)
      throw new OperationError("INVALID_REQUEST", {
        message: parsed.error.issues[0]?.message,
      });
    return {
      preferences: preferences(
        saveToolPermissionRule(ownerOf(context), parsed.data),
      ),
    };
  },
  deletePermissionRule(request, context) {
    return {
      preferences: preferences(
        removeToolPermissionRule(ownerOf(context), request.ruleId),
      ),
    };
  },
  async listPermissionTools(_request, context) {
    const tools = await toolCatalog(ownerOf(context), context.signal);
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        icons: (tool.icons ?? []).map(icon),
        fields: tool.fields.map((field) => ({
          path: field.path,
          type: FIELD_TYPES[field.type],
          description: field.description,
          values: (field.values ?? []).map((value) =>
            fromJson(ValueSchema, value as JsonValue),
          ),
        })),
      })),
    };
  },
  getEnvironment() {
    const environment = getEnvironmentSettings();
    return {
      ollamaHost: environment.ollamaHost,
      comfyuiHost: environment.comfyuiHost,
    };
  },
};
