import type { MessageInitShape } from "@bufbuild/protobuf";
import { create } from "@bufbuild/protobuf";
import type { Page } from "@playwright/test";
import {
  PreferenceService,
  UpdatePreferencesRequestSchema,
} from "../../src/gen/euler/v1/preferences_pb";
import { ProviderService } from "../../src/gen/euler/v1/providers_pb";
import { fromProtoRule } from "../../src/permissions/wire";
import {
  imagePatch,
  preferencesPatch,
  preferences as toProto,
} from "../../src/preferences/wire";
import {
  type UserPreferences,
  type UserPreferencesPatch,
  userPreferencesSchema,
} from "../../src/schemas/userPreferences";
import { mockRpc, on } from "./rpcMock";

function merge(
  current: UserPreferences,
  patch: UserPreferencesPatch,
): UserPreferences {
  return userPreferencesSchema.parse({
    settings: { ...current.settings, ...patch.settings },
    appearance: { ...current.appearance, ...patch.appearance },
    layout: { ...current.layout, ...patch.layout },
    image: { ...current.image, ...patch.image },
    capabilities: { ...current.capabilities, ...patch.capabilities },
    toolPermissions: { ...current.toolPermissions, ...patch.toolPermissions },
  });
}

const attached = new WeakSet<Page>();
/**
 * Serves PreferenceService and the ComfyUI config like the server: users
 * without saved preferences get `initial`, and each update saves into `store`.
 */
export async function mockUserPreferences(
  page: Page,
  store = new Map<string, UserPreferences>(),
  initial: MessageInitShape<typeof UpdatePreferencesRequestSchema> = {},
) {
  if (attached.has(page)) return;
  attached.add(page);
  const defaults = merge(
    userPreferencesSchema.parse({}),
    preferencesPatch(create(UpdatePreferencesRequestSchema, initial)),
  );
  let lastUser = "fixture";
  const current = (userId: string | undefined) => {
    lastUser = userId ?? lastUser;
    return store.get(lastUser) ?? defaults;
  };
  const save = (value: UserPreferences) => {
    store.set(lastUser, value);
    return { preferences: toProto(value) };
  };
  await mockRpc(page, [
    on(PreferenceService.method.getPreferences, (_request, { userId }) => ({
      preferences: toProto(current(userId)),
    })),
    on(PreferenceService.method.updatePreferences, (request, { userId }) =>
      save(merge(current(userId), preferencesPatch(request))),
    ),
    on(PreferenceService.method.putPermissionRule, (request, { userId }) => {
      const preferences = current(userId);
      const rule = fromProtoRule(request.rule!);
      const rules = preferences.toolPermissions.rules.filter(
        (saved) => saved.id !== rule.id,
      );
      const index = preferences.toolPermissions.rules.findIndex(
        (saved) => saved.id === rule.id,
      );
      rules.splice(index < 0 ? rules.length : index, 0, rule);
      return save({ ...preferences, toolPermissions: { rules } });
    }),
    on(PreferenceService.method.deletePermissionRule, (request, { userId }) => {
      const preferences = current(userId);
      return save({
        ...preferences,
        toolPermissions: {
          rules: preferences.toolPermissions.rules.filter(
            (rule) => rule.id !== request.ruleId,
          ),
        },
      });
    }),
    on(ProviderService.method.getComfyUiConfig, (_request, { userId }) => ({
      config: { host: "", effectiveHost: "" },
      image: current(userId).image,
    })),
    on(ProviderService.method.updateComfyUiConfig, (request, { userId }) => {
      const preferences = current(userId);
      const image = { ...preferences.image, ...imagePatch(request.image) };
      store.set(lastUser, { ...preferences, image });
      return { config: { host: "", effectiveHost: "" }, image };
    }),
  ]);
}
