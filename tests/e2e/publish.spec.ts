import { expect, test, type Page } from "@playwright/test";

import { slugify } from "@/domain/slug";

import { signIn } from "./support/authors";
import { fieldsForm, newDraft, publishableDraft, publishPanel } from "./support/studio";

/**
 * Publishing and renaming, from the studio.
 *
 * The rules are unit-tested and the two statements that carry them out are
 * covered against real Postgres. What only a browser shows is the part in
 * between: that the panel asks the server rather than deciding for itself, and
 * that a refusal comes back as something an author can act on rather than as
 * an error.
 */

/**
 * Editor URLs this worker put on the public site, so it can take them back off.
 *
 * These are the first tests in the suite that publish anything, and a
 * published recipe is not private debris: it joins every paginated collection,
 * for the tests running beside this one and for whoever opens the development
 * site afterwards. The assertions elsewhere were made independent of the
 * corpus when this first bit -- this is the other half, and it is about not
 * leaving a mess rather than about correctness.
 */
const published: string[] = [];

test.afterEach(async ({ page }) => {
  for (const editUrl of published.splice(0)) {
    try {
      await page.goto(editUrl);
      await publishPanel(page).getByRole("button", { name: "Unpublish" }).click({ timeout: 5000 });
      await expect(publishPanel(page).getByRole("button", { name: "Publish" })).toBeVisible();
    } catch {
      // Best effort. A test that has already failed should report its own
      // reason rather than be replaced by a tidy-up that failed after it.
    }
  }
});

test.describe("publishing a recipe", () => {
  test("refuses an unfinished draft and lists everything that is missing", async ({ page }) => {
    await signIn(page);
    await newDraft(page, "Unfinished");

    await page.getByRole("button", { name: "Publish" }).click();

    const blocked = publishPanel(page).getByRole("alert");
    await expect(blocked).toContainText("Not ready to publish yet");

    // All of them, in one answer. An author told about one omission at a time
    // pays a round trip per mistake and never learns how far off they are.
    await expect(blocked).toContainText("A recipe needs a short summary");
    await expect(blocked).toContainText("A recipe needs an introduction");
    await expect(blocked).toContainText("Add at least one ingredient.");
    await expect(blocked).toContainText("Add at least one step.");

    // And it is still a draft. A refusal that half-published would be worse
    // than one that did nothing.
    await expect(publishPanel(page).getByText("Draft", { exact: true })).toBeVisible();
  });

  test("publishes a complete one and offers its public address", async ({ page, request }) => {
    await signIn(page);
    const { title, editUrl } = await publishableDraft(page, "Publishable");
    published.push(editUrl);

    await page.getByRole("button", { name: "Publish" }).click();

    // The badge follows the server's answer with no reload, because nothing is
    // revalidated on publish and the page around the panel does not re-render.
    await expect(publishPanel(page).getByText("Published", { exact: true })).toBeVisible();

    const href = await page
      .getByRole("link", { name: "View the public page" })
      .getAttribute("href");
    expect(href).not.toBeNull();

    const response = await request.get(href ?? "");
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain(title);
  });

  test("a reload agrees with the panel", async ({ page }) => {
    await signIn(page);
    const { editUrl } = await publishableDraft(page, "Reloaded");
    published.push(editUrl);

    await page.getByRole("button", { name: "Publish" }).click();
    await expect(publishPanel(page).getByText("Published", { exact: true })).toBeVisible();

    // The panel holds client state, so on its own it proves only that the
    // action answered. This is the assertion that it was written down.
    await page.goto(editUrl);
    await expect(publishPanel(page).getByText("Published", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Unpublish" })).toBeVisible();
  });

  test("unpublishing returns it to draft", async ({ page }) => {
    await signIn(page);
    const { editUrl } = await publishableDraft(page, "Unpublishable");

    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByRole("button", { name: "Unpublish" })).toBeVisible();

    await page.getByRole("button", { name: "Unpublish" }).click();
    await expect(publishPanel(page).getByText("Draft", { exact: true })).toBeVisible();

    await page.goto(editUrl);
    await expect(publishPanel(page).getByText("Draft", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish" })).toBeVisible();
  });

  test("a published recipe is on the author's dashboard under Published", async ({ page }) => {
    await signIn(page);
    const { title, editUrl } = await publishableDraft(page, "Dashboard");
    published.push(editUrl);

    await page.getByRole("button", { name: "Publish" }).click();
    await expect(publishPanel(page).getByText("Published", { exact: true })).toBeVisible();

    await page.goto("/studio");

    // The dashboard is dynamic, so it answers correctly on the next request.
    // The public collections are not, and do not -- which is phase 16's.
    await expect(
      page.getByRole("region", { name: "Published" }).getByRole("link", { name: title }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Drafts" }).getByText(title)).toBeHidden();
  });
});

test.describe("renaming a published recipe", () => {
  /** Fill the title and save, without reloading the page around it. */
  async function rename(page: Page, to: string) {
    await page.getByLabel("Title").fill(to);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(fieldsForm(page).getByRole("status")).toHaveText("Saved.");
  }

  test("moves its address and leaves a permanent redirect behind", async ({ page, request }) => {
    await signIn(page);
    const { title, editUrl } = await publishableDraft(page, "Renamed");
    published.push(editUrl);

    await page.getByRole("button", { name: "Publish" }).click();
    await expect(publishPanel(page).getByText("Published", { exact: true })).toBeVisible();

    /*
     * Renamed twice, with no reload in between, and the assertion is about the
     * *middle* address.
     *
     * The panel is client state, so after the first rename it still shows the
     * first address and never renders a link to the second -- which means Next
     * never prefetches it, and the request below is the first anything has
     * asked for that URL. That matters: `/recipes/[slug]` is statically
     * rendered, so an address the studio has already linked has been rendered
     * and cached, and answers from the cache whatever the database now says.
     * The test underneath this one pins that down; it is phase 16's to fix,
     * and hiding from it here would delete the evidence.
     */
    const second = `${title} two`;
    const third = `${title} three`;
    await rename(page, second);
    await rename(page, third);

    /*
     * Not followed. A redirect and a page are different answers, and a client
     * that merges them cannot tell "the old address moved" from "the old
     * address still works", which is the whole assertion.
     *
     * 308 rather than 302: a rename is permanent, and a temporary redirect
     * leaves every browser and crawler asking again forever.
     */
    const moved = await request.get(`/recipes/${slugify(second)}`, { maxRedirects: 0 });

    expect(moved.status()).toBe(308);
    expect(moved.headers()["location"]).toContain(slugify(third));

    const followed = await request.get(`/recipes/${slugify(third)}`);
    expect(followed.status()).toBe(200);
    expect(await followed.text()).toContain(third);

    // And the studio agrees, once it is reloaded and reads the database again.
    await page.goto(editUrl);
    await expect(
      publishPanel(page).getByRole("link", { name: "View the public page" }),
    ).toHaveAttribute("href", `/recipes/${slugify(third)}`);
  });

  /*
   * There was a second test here until phase 16, asserting that an address
   * somebody had already read went on serving the old page after a rename --
   * a **200** where a 308 belonged, written as an assertion so that phase had
   * something to turn around rather than a comment to find. It lives in
   * `revalidation.spec.ts` now, turned around.
   */
});
