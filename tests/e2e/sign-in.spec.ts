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

    // Landed somewhere real, and the header knows who it is.
    await expect(page).toHaveURL("/");
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

    await expect(page).toHaveURL("/");
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
