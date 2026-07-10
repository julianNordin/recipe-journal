import { expect, test } from "@playwright/test";

/**
 * Sign-in, end to end.
 *
 * Everything below the form is already covered by faster tests -- the argon2
 * parameters by a unit test, the credential decision by a database test
 * against real Postgres. What only a browser can show is that the pieces are
 * wired to each other: the form posts where NextAuth is listening, the
 * provider reaches `authenticate`, a session cookie comes back, and the header
 * reads it.
 *
 * The seeded accounts are the fixture. `npm run test:e2e` seeds before it
 * builds, and the seed is idempotent -- see `tests/db/seed.test.ts`.
 */

const EMAIL = "ada@example.com";
const PASSWORD = "recipe-journal-demo";

async function signIn(page: import("@playwright/test").Page, password: string) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("sign in", () => {
  test("a seeded author can sign in and out", async ({ page }) => {
    await signIn(page, PASSWORD);

    // The studio is where signing in with no particular destination lands.
    await expect(page).toHaveURL("/studio");
    await expect(page.getByRole("banner").getByText("Ada Lindqvist")).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();

    await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("banner").getByText("Ada Lindqvist")).toBeHidden();
  });

  test("a wrong password is refused, and says nothing useful about why", async ({ page }) => {
    await signIn(page, "not the password");

    // Scoped to the form. Next renders its own route announcer as a bare
    // `role="alert"` div, so an unscoped alert locator is ambiguous and
    // resolves to whichever it finds first.
    const error = page.locator("form").getByRole("alert");
    await expect(error).toBeVisible();

    // One message for every failure. Distinguishing "no such account" from
    // "wrong password" turns this form into a way to ask whether somebody has
    // an account here.
    await expect(error).toHaveText("That email and password do not match an account.");
    await expect(page).toHaveURL(/\/signin/);
    await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  test("an unknown address gets the same message as a wrong password", async ({ page }) => {
    await page.goto("/signin");
    await page.getByLabel("Email").fill("nobody@example.com");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.locator("form").getByRole("alert")).toHaveText(
      "That email and password do not match an account.",
    );
  });

  test("the callback URL cannot be pointed off the site", async ({ page }) => {
    // The open-redirect rule has unit tests over every shape; this is the one
    // assertion those cannot make -- that the page actually uses it.
    await page.goto("/signin?callbackUrl=https://example.com/phish");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    // Falls back to the default destination rather than to example.com.
    await expect(page).toHaveURL("/studio");
  });

  test("offers GitHub, and the button really starts the handshake", async ({ page }) => {
    /*
     * Intercept the departure rather than follow it. What this project owns is
     * everything up to the redirect: the environment reaching the provider
     * list, the provider reaching NextAuth's sign-in route, and the callback
     * URL it builds from NEXTAUTH_URL. Whether github.com then likes the
     * client id is not this suite's business, and finding out would mean a
     * real OAuth app and a test that fails when someone else's site is down.
     */
    const departure = new Promise<string>((resolve) => {
      void page.route("https://github.com/**", async (route) => {
        resolve(route.request().url());
        await route.abort();
      });
    });

    await page.goto("/signin");
    await page.getByRole("button", { name: "Continue with GitHub" }).click();

    const url = new URL(await departure);
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("Iv1.playwrightfixture");
    // Built from NEXTAUTH_URL. Wrong here and the handshake completes onto a
    // port nothing is serving -- which is how a stale value stayed hidden
    // through three earlier failures in this project.
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3001/api/auth/callback/github",
    );
    expect(url.searchParams.get("scope")).toBe("read:user user:email");
  });

  test("an in-site callback URL is honoured", async ({ page }) => {
    // The control: if every callbackUrl were ignored, the test above would
    // pass while the feature did nothing.
    await page.goto("/signin?callbackUrl=/recipes");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL("/recipes");
  });
});
