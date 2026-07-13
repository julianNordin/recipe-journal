import { expect, test } from "@playwright/test";

import { AUTHORS, DEMO_PASSWORD, signIn } from "./support/authors";

/**
 * `src/proxy.ts` -- the redirect that keeps signed-out visitors out of the
 * studio.
 *
 * **A redirect, and not a guard.** Nothing here is a security assertion, and
 * the tests are deliberately worded so that nobody later reads them as one. A
 * proxy runs before routing and sees a request; it does not see which recipe
 * a Server Action is about to write to, and it is skipped entirely for a
 * request that never goes through the router. Phase 14 is where the same
 * question gets asked at the boundary that can actually answer it.
 *
 * What this is worth is the other thing: a signed-out person who follows a
 * link into the studio gets the sign-in page and then the page they wanted,
 * rather than an empty dashboard or a stack trace.
 *
 * Playwright is the only tier that can test it. A proxy is not importable --
 * Next compiles it into its own bundle and invokes it around the router -- so
 * "is it wired up at all" is a question only a running server answers, and
 * getting the file in the wrong directory produces no error whatsoever.
 */

test.describe("the studio redirect", () => {
  test("sends a signed-out visitor to sign in, remembering where they were going", async ({
    page,
  }) => {
    await page.goto("/studio");

    const url = new URL(page.url());
    expect(url.pathname).toBe("/signin");
    expect(url.searchParams.get("callbackUrl")).toBe("/studio");
  });

  test("remembers a nested path and its query string", async ({ page }) => {
    await page.goto("/studio/recipes/new?from=header");

    const url = new URL(page.url());
    expect(url.pathname).toBe("/signin");
    // Both halves, or the redirect drops the reader somewhere adjacent to
    // where they were going, which is worse than dropping them at the top.
    expect(url.searchParams.get("callbackUrl")).toBe("/studio/recipes/new?from=header");
  });

  test("hands the visitor back to where they were going once they sign in", async ({ page }) => {
    // The round trip is the point: the proxy writes the callbackUrl and the
    // sign-in page validates and honours it. Either half can be correct on its
    // own while the pair does nothing.
    await page.goto("/studio");
    await page.getByLabel("Email").fill(AUTHORS.ada.email);
    await page.getByLabel("Password").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL("/studio");
  });

  test("lets a signed-in visitor through", async ({ page }) => {
    await signIn(page);

    await page.goto("/studio");

    // What is asserted is that the proxy did not send them to /signin, which
    // is what would happen if the token were being read wrongly or not at all.
    await expect(page).toHaveURL("/studio");
    await expect(page.getByRole("heading", { name: "Studio", level: 1 })).toBeVisible();
  });

  test("leaves the public site alone", async ({ page }) => {
    // The control. A matcher that caught everything would pass every test
    // above and break the whole site.
    await page.goto("/recipes");
    await expect(page).toHaveURL("/recipes");

    await page.goto("/signin");
    await expect(page).toHaveURL("/signin");
  });
});
