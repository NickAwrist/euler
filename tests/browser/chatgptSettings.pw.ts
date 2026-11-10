import { expect, test } from "@playwright/test";
import { ProviderService } from "../../src/gen/euler/v1/providers_pb";
import { RpcFailure, mockRpc, on } from "./rpcMock";
import { mockUserPreferences } from "./userPreferencesFixture";

const authorizationUrl = "https://auth.example.test/authorize?state=abc";
const callbackUrl = "http://127.0.0.1:1455/auth/callback?code=c&state=abc";
// Fixture account profile served by mocked routes.
const pictureUrl = "https://avatar.example.test/nick.png";
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

for (const device of ["desktop", "mobile"] as const) {
  test(`settings save ${device}: ChatGPT sign-in and disconnect`, async ({
    browser,
  }) => {
    const page = await browser.newPage({
      baseURL: "http://127.0.0.1:5199",
      hasTouch: device === "mobile",
      viewport:
        device === "desktop"
          ? { width: 1280, height: 800 }
          : { width: 390, height: 844 },
    });
    let connected = false;
    let statusLoads = 0;
    const callbacks: unknown[] = [];
    const logins: unknown[] = [];
    await page
      .context()
      .route("https://auth.example.test/**", (route) =>
        route.fulfill({ body: "sign in" }),
      );
    await page
      .context()
      .route(pictureUrl, (route) =>
        route.fulfill({ contentType: "image/png", body: pixel }),
      );
    const status = () => ({
      connected,
      email: connected ? "nick@example.com" : undefined,
      name: connected ? "Nick Example" : undefined,
      picture: connected ? pictureUrl : undefined,
      planEnabled: connected,
    });
    await mockRpc(
      page,
      [
        on(ProviderService.method.startChatGptLogin, ({ newAccount }) => {
          logins.push({ newAccount });
          return { authorizationUrl };
        }),
        on(ProviderService.method.finishChatGptLogin, ({ callbackUrl }) => {
          callbacks.push({ callbackUrl });
          if (!callbackUrl.includes("code="))
            return new RpcFailure(
              "invalid_argument",
              "ChatGPT sign-in failed.",
              "INVALID_REQUEST",
            );
          connected = true;
          return { status: status() };
        }),
        on(ProviderService.method.disconnectChatGpt, () => {
          connected = false;
          return { revoked: false };
        }),
        on(ProviderService.method.getChatGptStatus, () => {
          statusLoads += 1;
          return { status: status() };
        }),
      ],
      { empty: true },
    );
    try {
      await mockUserPreferences(page);
      await page.goto("/dev/settings");
      await page.getByRole("button", { name: "ChatGPT", exact: true }).click();
      await expect(page.getByText("Not connected")).toBeVisible();
      const initialStatusLoads = statusLoads;

      const popup = page.waitForEvent("popup");
      await page.getByRole("button", { name: "Sign in with ChatGPT" }).click();
      expect((await popup).url()).toBe(authorizationUrl);
      await expect(
        page.getByRole("link", { name: "ChatGPT sign-in page" }),
      ).toHaveAttribute("href", authorizationUrl);

      const field = page.getByLabel("Callback URL");
      const connect = page.getByRole("button", { name: "Connect" });
      await expect(connect).toBeDisabled();
      await field.fill("http://127.0.0.1:1455/auth/callback");
      await connect.click();
      await expect(page.getByRole("alert")).toContainText("sign-in failed");
      const anotherPopup = page.waitForEvent("popup");
      await page.getByRole("button", { name: "Use another account" }).click();
      await anotherPopup;
      expect(logins).toEqual([{ newAccount: false }, { newAccount: true }]);
      await field.fill(` ${callbackUrl} `);
      await field.press("Enter");
      await expect(page.getByText("Nick Example")).toBeVisible();
      await expect(
        page.getByRole("link", { name: "View usage limits" }),
      ).toHaveAttribute("href", "https://chatgpt.com/settings/usage");
      await expect(page.locator(`img[src="${pictureUrl}"]`)).toBeVisible();
      const email = page.getByText("nick@example.com");
      const reveal = page.getByRole("button", { name: "Show email" });
      await expect(email).toHaveCSS("filter", "blur(5px)");
      await reveal.hover();
      await expect(email).toHaveCSS("filter", "none");
      await expect(
        page.getByRole("button", { name: "nick@example.com" }),
      ).toBeVisible();
      await page.mouse.move(0, 0);
      await expect(email).toHaveCSS("filter", "blur(5px)");
      await reveal.focus();
      await expect(email).toHaveCSS("filter", "none");
      await page
        .getByRole("button", { name: "Appearance", exact: true })
        .click();
      await expect(email).toBeHidden();
      await page.getByRole("button", { name: "ChatGPT", exact: true }).click();
      expect(
        await page.evaluate(() => ({
          loading: document.body.innerText.includes("Loading..."),
          account: document.body.innerText.includes("Nick Example"),
        })),
      ).toEqual({ loading: false, account: true });
      expect(statusLoads).toBe(initialStatusLoads);
      await expect(email).toHaveCSS("filter", "blur(5px)");
      await reveal.focus();
      await page.keyboard.press("Tab");
      await expect(email).toHaveCSS("filter", "blur(5px)");
      if (device === "mobile") {
        await reveal.tap();
        await expect(email).toHaveCSS("filter", "none");
        await page
          .getByRole("heading", { name: "Settings", exact: true })
          .tap();
        await expect(email).toHaveCSS("filter", "blur(5px)");
      }
      expect(callbacks.at(-1)).toEqual({ callbackUrl });
      await expect(field).toBeHidden();
      expect(
        await page.evaluate(() =>
          JSON.stringify({ ...localStorage, ...sessionStorage }),
        ),
      ).not.toContain("code=c");

      await page.getByRole("button", { name: "Disconnect" }).click();
      await expect(page.getByText("Not connected")).toBeVisible();
      await expect(page.getByText("Nick Example")).toBeHidden();
      await expect(page.locator(`img[src="${pictureUrl}"]`)).toBeHidden();
      await expect(page.getByText("ChatGPT didn't confirm")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Sign in with ChatGPT" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Appearance", exact: true })
        .click();
      await page.getByRole("button", { name: "ChatGPT", exact: true }).click();
      await expect(page.getByText("Not connected")).toBeVisible();
      await expect(
        page.getByRole("link", { name: "View usage limits" }),
      ).toBeHidden();
      expect(statusLoads).toBe(initialStatusLoads);
    } finally {
      await page.close();
    }
  });
}

test("settings save desktop: ChatGPT account without name or working picture", async ({
  browser,
}) => {
  const page = await browser.newPage({ baseURL: "http://127.0.0.1:5199" });
  const brokenPicture = "https://avatar.example.test/missing.png";
  await page
    .context()
    .route(brokenPicture, (route) => route.fulfill({ status: 404 }));
  await mockRpc(
    page,
    [
      on(ProviderService.method.getChatGptStatus, () => ({
        status: {
          connected: true,
          email: "nick@example.com",
          picture: brokenPicture,
          planEnabled: true,
        },
      })),
    ],
    { empty: true },
  );
  try {
    await mockUserPreferences(page);
    await page.goto("/dev/settings");
    await page.getByRole("button", { name: "ChatGPT", exact: true }).click();
    await expect(
      page.getByText("ChatGPT account", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(`img[src="${brokenPicture}"]`)).toHaveCount(0);
    await expect(page.locator("svg.lucide-circle-user-round")).toBeVisible();
    await expect(page.getByText("nick@example.com")).toHaveCSS(
      "filter",
      "blur(5px)",
    );
  } finally {
    await page.close();
  }
});
