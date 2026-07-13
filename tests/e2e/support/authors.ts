import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * The two seeded authors, and how to become one of them.
 *
 * Signing in was written out by hand in every spec that needed it, which was
 * fine while one of them needed it. Phase 14 needs *two* authors inside a
 * single test -- one to make a request, another to send it again -- so the
 * helpers move here rather than being copied a fourth time.
 *
 * The fixture matters as much as the helper: **Ada has one draft and one
 * published recipe; Linus has one published recipe of his own.** Two real
 * authors with real recipes is what makes "only your own" an assertion rather
 * than a description, and it is the reason the seed contains a draft at all.
 */

export const AUTHORS = {
  ada: { email: "ada@example.com", name: "Ada Lindqvist" },
  linus: { email: "linus@example.com", name: "Linus Berg" },
} as const;

export type AuthorKey = keyof typeof AUTHORS;

/** Printed by the seed, written down in the README, and the same for both. */
export const DEMO_PASSWORD = "recipe-journal-demo";

/** Sign in through the real form, and wait until the studio has actually loaded. */
export async function signIn(page: Page, author: AuthorKey = "ada"): Promise<void> {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(AUTHORS[author].email);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/studio");
}

/**
 * What a signed-in browser carries, and all a request needs to be somebody.
 *
 * Cookies, and the session token among them. Worth naming as a type rather
 * than passing an anonymous object around: a request sent with these *is* that
 * author as far as the server is concerned, which is the whole subject of
 * `action-boundary.spec.ts`.
 */
export type SignedInState = Awaited<ReturnType<BrowserContext["storageState"]>>;

/**
 * Sign in as somebody in a context of their own, and keep only the cookies.
 *
 * A second browser context rather than a second page, so the two sessions do
 * not share a cookie jar -- the whole point is that these are two different
 * people. The context is closed once its cookies have been read: what comes
 * back is data, and a request carrying it is that author as far as the server
 * is concerned. That is the premise `authorization.spec.ts` is built on.
 */
export async function signedInAs(browser: Browser, author: AuthorKey): Promise<SignedInState> {
  const context = await browser.newContext();
  try {
    await signIn(await context.newPage(), author);
    return await context.storageState();
  } finally {
    await context.close();
  }
}

/**
 * A draft belonging to whoever this page is signed in as, and its editor URL.
 *
 * Every test that writes gets its own recipe. The suite runs fully parallel
 * and the seeded fixtures are read by other specs, so editing those would make
 * unrelated tests flap for reasons that have nothing to do with what they
 * assert.
 */
export async function newDraft(
  page: Page,
  label: string,
): Promise<{ title: string; editUrl: string }> {
  const title = `${label} ${String(Date.now())}${String(Math.random()).slice(2, 8)}`;

  await page.goto("/studio/new");
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/studio\/[0-9a-f-]+\/edit$/);

  return { title, editUrl: page.url() };
}
