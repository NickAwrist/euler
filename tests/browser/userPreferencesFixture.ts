import type { Page } from "@playwright/test";
import {
  type UserPreferences,
  userPreferencesSchema,
} from "../../src/schemas/userPreferences";

const attached = new WeakSet<Page>();
export async function mockUserPreferences(
  page: Page,
  store = new Map<string, UserPreferences>(),
) {
  if (attached.has(page)) return;
  attached.add(page);
  let lastUser = "fixture";
  await page.route("**/api/settings/user", async (route) => {
    lastUser = route.request().headers()["x-euler-user-id"] ?? lastUser;
    let preferences = store.get(lastUser) ?? null;
    const method = route.request().method();
    if (method !== "GET") {
      const patch = route.request().postDataJSON() as Partial<UserPreferences>;
      if (method === "PATCH" || preferences === null) {
        const current = preferences ?? userPreferencesSchema.parse({});
        preferences = userPreferencesSchema.parse({
          ...current,
          settings: { ...current.settings, ...patch.settings },
          appearance: { ...current.appearance, ...patch.appearance },
          layout: { ...current.layout, ...patch.layout },
          image: { ...current.image, ...patch.image },
          capabilities: { ...current.capabilities, ...patch.capabilities },
        });
      }
    }
    if (preferences) store.set(lastUser, preferences);
    await route.fulfill({ json: preferences });
  });
  await page.route("**/api/comfyui/config", async (route) => {
    lastUser = route.request().headers()["x-euler-user-id"] ?? lastUser;
    let preferences = store.get(lastUser) ?? userPreferencesSchema.parse({});
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
