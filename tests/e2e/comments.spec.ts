import { expect, test, type Page } from "@playwright/test";

import { slugify } from "@/domain/slug";

import { signIn } from "./support/authors";
import { publishableDraft, publishPanel } from "./support/studio";

/**
 * Comments, in a browser.
 *
 * The rules are unit-tested and the two that need the database are covered
 * against real Postgres. What only a browser shows is the split this section
 * is built on: **the list is server-rendered and cached for everybody, and
 * only the controls know who is looking.** A signed-out reader sees every
 * comment in the HTML and no Delete buttons; a signed-in one gets the buttons
 * after hydration.
 */

const published: string[] = [];

test.afterEach(async ({ page }) => {
  for (const editUrl of published.splice(0)) {
    try {
      await page.goto(editUrl);
      await publishPanel(page).getByRole("button", { name: "Unpublish" }).click({ timeout: 5000 });
      await expect(publishPanel(page).getByRole("button", { name: "Publish" })).toBeVisible();
    } catch {
      // Best effort; a test that already failed should report its own reason.
    }
  }
});

/** A published recipe of Ada's, and its public address. */
async function publishedRecipe(page: Page, label: string): Promise<{ address: string }> {
  await signIn(page, "ada");
  const { title, editUrl } = await publishableDraft(page, label);
  published.push(editUrl);

  await page.getByRole("button", { name: "Publish" }).click();
  await expect(publishPanel(page).getByText("Published", { exact: true })).toBeVisible();

  return { address: `/recipes/${slugify(title)}` };
}

const comments = (page: Page) => page.getByRole("region", { name: /comment/i });

test.describe("commenting", () => {
  test("a reader posts one and sees it without reloading", async ({ page }) => {
    const { address } = await publishedRecipe(page, "Commented");

    await page.goto(address);
    await expect(comments(page).getByText("Nobody has said anything yet.")).toBeVisible();

    await page.getByLabel("Leave a comment").fill("Tried this with spelt and it worked.");
    await page.getByRole("button", { name: "Post comment" }).click();

    /*
     * **No reload, and nothing in the component makes that happen.**
     *
     * A `router.refresh()` effect was written here first, from a story that
     * sounded right -- the action invalidates the server's render, the browser
     * still holds the old copy. Deleting the effect changed nothing: a Server
     * Action invoked from a form already returns the re-rendered tree for the
     * current route, so `revalidatePath` inside it updates the caller too.
     *
     * What this test is really pinning is that the action revalidates at all.
     * Take the `revalidateRecipe` call out of `createCommentAction` and the
     * comment is accepted and does not appear.
     */
    await expect(comments(page).getByText("Tried this with spelt and it worked.")).toBeVisible();
    await expect(comments(page).getByRole("heading", { name: "1 comment" })).toBeVisible();
  });

  test("and it is in the HTML the server sends, for everybody", async ({ page, request }) => {
    const { address } = await publishedRecipe(page, "Public comment");

    await page.goto(address);
    await page.getByLabel("Leave a comment").fill("Visible to a reader with no session.");
    await page.getByRole("button", { name: "Post comment" }).click();
    await expect(comments(page).getByText("Visible to a reader with no session.")).toBeVisible();

    // No browser, no session, no JavaScript. The list is content, so it is in
    // the response -- which is also what the revalidation is for.
    const html = await (await request.get(address)).text();

    expect(html).toContain("Visible to a reader with no session.");
    expect(html).toContain("Ada Lindqvist");
  });

  test("refuses an empty one and says so", async ({ page }) => {
    const { address } = await publishedRecipe(page, "Empty comment");

    await page.goto(address);
    await page.getByLabel("Leave a comment").fill("   ");
    await page.getByRole("button", { name: "Post comment" }).click();

    await expect(comments(page).getByRole("alert")).toHaveText("Write something first.");
    await expect(comments(page).getByRole("heading", { name: "Comments" })).toBeVisible();
  });

  test("offers a signed-out reader a way in rather than a form", async ({ browser }) => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto("/recipes/no-knead-sourdough");

      await expect(comments(page).getByRole("link", { name: "Sign in" })).toBeVisible();
      await expect(page.getByLabel("Leave a comment")).toBeHidden();
    } finally {
      await context.close();
    }
  });
});

test.describe("deleting a comment", () => {
  test("the person who wrote it may", async ({ page }) => {
    const { address } = await publishedRecipe(page, "Own comment");

    await page.goto(address);
    await page.getByLabel("Leave a comment").fill("Written by me, deleted by me.");
    await page.getByRole("button", { name: "Post comment" }).click();
    await expect(comments(page).getByText("Written by me, deleted by me.")).toBeVisible();

    await comments(page).getByRole("button", { name: "Delete" }).click();

    await expect(comments(page).getByText("Written by me, deleted by me.")).toBeHidden();
    await expect(comments(page).getByText("Nobody has said anything yet.")).toBeVisible();
  });

  test("the author of the recipe may, on their own page", async ({ page, browser }) => {
    const { address } = await publishedRecipe(page, "Someone else comment");

    // Linus reads Ada's recipe and comments on it.
    const linus = await browser.newContext();
    try {
      const linusPage = await linus.newPage();
      await signIn(linusPage, "linus");
      await linusPage.goto(address);
      await linusPage.getByLabel("Leave a comment").fill("Linus was here.");
      await linusPage.getByRole("button", { name: "Post comment" }).click();
      await expect(comments(linusPage).getByText("Linus was here.")).toBeVisible();
    } finally {
      await linus.close();
    }

    // Ada owns the page and has to live with what is on it.
    await page.goto(address);
    await expect(comments(page).getByText("Linus was here.")).toBeVisible();
    await comments(page).getByRole("button", { name: "Delete" }).click();

    await expect(comments(page).getByText("Linus was here.")).toBeHidden();
  });

  test("a stranger is not even offered the button", async ({ page, browser }) => {
    const { address } = await publishedRecipe(page, "Stranger comment");

    await page.goto(address);
    await page.getByLabel("Leave a comment").fill("Ada's own comment on Ada's own recipe.");
    await page.getByRole("button", { name: "Post comment" }).click();
    await expect(comments(page).getByText("Ada's own comment on Ada's own recipe.")).toBeVisible();

    const linus = await browser.newContext();
    try {
      const linusPage = await linus.newPage();
      await signIn(linusPage, "linus");
      await linusPage.goto(address);

      /*
       * Linus is an author with recipes of his own, and on this page that
       * counts for nothing. Writing recipes is not a moderation role.
       *
       * This asserts what is *drawn*. What is enforced is asserted next door
       * in `authorization.spec.ts`, by replaying the request -- because a
       * missing button is a courtesy and not a check.
       */
      await expect(comments(linusPage).getByText("Ada's own comment")).toBeVisible();
      await expect(comments(linusPage).getByRole("button", { name: "Delete" })).toHaveCount(0);
    } finally {
      await linus.close();
    }
  });
});
