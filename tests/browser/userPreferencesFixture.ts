import type { Page } from "@playwright/test";
import {
  type UserPreferences,
  type UserPreferencesPatch,
  userPreferencesSchema,
} from "../../src/schemas/userPreferences";

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
 * Serves `/api/settings/user` like the server: users without saved
 * preferences get `initial`, and each PATCH saves into `store`.
 */
export async function mockUserPreferences(
  page: Page,
  store = new Map<string, UserPreferences>(),
  initial: UserPreferencesPatch = {},
) {
  if (attached.has(page)) return;
  attached.add(page);
  const defaults = merge(userPreferencesSchema.parse({}), initial);
  let lastUser = "fixture";
  await page.route("**/api/settings/user", async (route) => {
    lastUser = route.request().headers()["x-euler-user-id"] ?? lastUser;
    let preferences = store.get(lastUser) ?? defaults;
    if (route.request().method() === "PATCH") {
      preferences = merge(preferences, route.request().postDataJSON());
      store.set(lastUser, preferences);
    }
    await route.fulfill({ json: preferences });
  });
  await page.route(
    "**/api/settings/user/tool-permission-rules/*",
    async (route) => {
      lastUser = route.request().headers()["x-euler-user-id"] ?? lastUser;
      const current = store.get(lastUser) ?? defaults;
      const id = decodeURIComponent(
        new URL(route.request().url()).pathname.split("/").at(-1) ?? "",
      );
      const rules = current.toolPermissions.rules.filter(
        (rule) => rule.id !== id,
      );
      if (route.request().method() === "PUT") {
        const index = current.toolPermissions.rules.findIndex(
          (rule) => rule.id === id,
        );
        rules.splice(
          index < 0 ? rules.length : index,
          0,
          route.request().postDataJSON(),
        );
      }
      const preferences = userPreferencesSchema.parse({
        ...current,
        toolPermissions: { ...current.toolPermissions, rules },
      });
      store.set(lastUser, preferences);
      await route.fulfill({ json: preferences });
    },
  );
  await page.route("**/api/comfyui/config", async (route) => {
    lastUser = route.request().headers()["x-euler-user-id"] ?? lastUser;
    let preferences = store.get(lastUser) ?? defaults;
    if (route.request().method() === "PUT") {
      const { host: _host, ...image } = route.request().postDataJSON();
      preferences = userPreferencesSchema.parse({
        ...preferences,
        image: { ...preferences.image, ...image },
      });
      store.set(lastUser, preferences);
    }
    await route.fulfill({
      json: { host: "", effectiveHost: "", ...preferences.image },
    });
  });
}
