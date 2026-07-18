import { expect, test } from "@playwright/test";

import { slugify } from "@/domain/slug";

import { signIn } from "./support/authors";
import { fieldsForm, publishableDraft, publishPanel } from "./support/studio";

/**
 * What the framework goes on serving after the database has changed.
 *
 * **Every one of these failed before the actions were told what they had made
 * stale, and none of them failed in a way anyone would notice.** The database
 * was right, the queries were right, the pages were right; the responses never
 * reached any of them. A route rendered once at build keeps answering with
 * what it was built with, and nothing about writing the mutation suggests
 * otherwise -- which is what makes this the correctness twin of phase 14's
 * security lesson. Both are about a boundary that does not look like one.
 *
 * Measured before the fix, on a production build:
 *
 * | Route | Rendering | A recipe published now |
 * | --- | --- | --- |
 * | `/` | static, at build | **absent** |
 * | `/tags` | static, at build | counts **stale** |
 * | `/recipes/<slug>` | SSG plus on-demand, then cached | **stale once read** |
 * | `/recipes` | dynamic | correct already |
 *
 * The last row is why the fix is a list of paths rather than a blanket: the
 * build's route table says which routes are cached, and revalidating a dynamic
 * one is a call that does nothing while looking like insurance.
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

test.describe("what a mutation invalidates", () => {
  test("a recipe published now is on the home page", async ({ page, request }) => {
    await signIn(page);
    const { title, editUrl } = await publishableDraft(page, "Revalidated");
    published.push(editUrl);

    // The home page before. It has been rendered since the build, so this is
    // not a first-request fluke -- the entry exists and does not have it.
    expect(await (await request.get("/")).text()).not.toContain(title);

    await page.getByRole("button", { name: "Publish" }).click();
    await expect(publishPanel(page).getByText("Published", { exact: true })).toBeVisible();

    // No restart, no rebuild. The home page shows the latest three recipes and
    // was rendered once at build; this is the whole demonstration.
    expect(await (await request.get("/")).text()).toContain(title);
  });

  test("an edit to a published recipe reaches its public page", async ({ page, request }) => {
    await signIn(page);
    const { title, editUrl } = await publishableDraft(page, "Edited");
    published.push(editUrl);

    await page.getByRole("button", { name: "Publish" }).click();
    await expect(publishPanel(page).getByText("Published", { exact: true })).toBeVisible();

    // Somebody reads it. The response is now in the route cache, which is what
    // makes the assertion at the end of this test mean anything.
    const address = `/recipes/${slugify(title)}`;
    expect(await (await request.get(address)).text()).toContain("Complete enough to publish.");

    await page.getByLabel("Summary").fill("Rewritten after somebody read it.");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(fieldsForm(page).getByRole("status")).toHaveText("Saved.");

    const after = await (await request.get(address)).text();
    expect(after).toContain("Rewritten after somebody read it.");
    expect(after).not.toContain("Complete enough to publish.");
  });

  test("a renamed recipe's old address redirects even after it has been read", async ({
    page,
    request,
  }) => {
    await signIn(page);
    const { title, editUrl } = await publishableDraft(page, "Moved");
    published.push(editUrl);

    await page.getByRole("button", { name: "Publish" }).click();
    await expect(publishPanel(page).getByText("Published", { exact: true })).toBeVisible();

    const before = `/recipes/${slugify(title)}`;
    expect((await request.get(before)).status()).toBe(200);

    const renamed = `${title} moved`;
    await page.getByLabel("Title").fill(renamed);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(fieldsForm(page).getByRole("status")).toHaveText("Saved.");

    /*
     * **This assertion used to be `toBe(200)`**, in `publish.spec.ts`, written
     * that way on purpose so this phase would have something to turn around
     * rather than a comment to find. A rename has to invalidate *two*
     * addresses -- the one it moved to and the one it moved from -- which is
     * why `updateRecipe` hands back both.
     */
    const moved = await request.get(before, { maxRedirects: 0 });
    expect(moved.status()).toBe(308);
    expect(moved.headers()["location"]).toContain(slugify(renamed));
  });

  test("unpublishing takes it back off the home page", async ({ page, request }) => {
    await signIn(page);
    const { title, editUrl } = await publishableDraft(page, "Withdrawn");
    published.push(editUrl);

    await page.getByRole("button", { name: "Publish" }).click();
    await expect(publishPanel(page).getByText("Published", { exact: true })).toBeVisible();
    expect(await (await request.get("/")).text()).toContain(title);

    await page.getByRole("button", { name: "Unpublish" }).click();
    await expect(publishPanel(page).getByText("Draft", { exact: true })).toBeVisible();

    // The control on the first test, and the half that is easy to forget: an
    // invalidation that only ran on the way up would leave a withdrawn recipe
    // advertised on the front page indefinitely.
    expect(await (await request.get("/")).text()).not.toContain(title);
  });
});
