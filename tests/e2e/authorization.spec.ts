import { expect, test, type Page } from "@playwright/test";

import { signIn, signedInAs, type SignedInState } from "./support/authors";
import {
  captureAction,
  replayAction,
  reportsASave,
  withField,
  type CapturedAction,
} from "./support/server-action";
import { newDraft, publishableDraft, publishPanel } from "./support/studio";

/**
 * Whether the caller may write to *this* recipe.
 *
 * `action-boundary.spec.ts` next door establishes the premise: a Server Action
 * is a POST anybody can send, the proxy is not on its path, and a captured
 * request runs again perfectly well. Everything here follows from that. If a
 * request can be sent by anyone, then being signed in is not an answer to
 * "whose recipe is this" -- and being signed in is all `requireUser` ever
 * established.
 *
 * **The hole these tests close was left open through phases 12 and 13 on
 * purpose, and it was watched writing before it was shut.** Before the guard:
 * Linus's cookies on Ada's captured request returned `{"status":"saved"}` and
 * her draft came back with his text in it, on both actions. That measurement
 * is the reason the tests are worth having; a fix nobody watched fail is a fix
 * nobody can show is working.
 *
 * The interesting part is *why* it survived two phases of review. The editor
 * page fetches through `findAuthoredRecipe`, which is scoped by author, so
 * nobody can reach another author's editor and the form cannot be made to
 * carry the wrong id. Every path through the interface is correct. "Only
 * reachable through a page that refuses it" is exactly the reasoning that
 * makes this the most common real Next.js security bug: it is true, and it is
 * about the interface rather than about the endpoint.
 */

/** Ada, a draft of her own, and the request her editor sends when she saves. */
async function adasDraft(
  page: Page,
  label: string,
  submit: (page: Page) => Promise<void>,
): Promise<{ editUrl: string; captured: CapturedAction }> {
  await signIn(page, "ada");
  const { editUrl } = await newDraft(page, label);

  const captured = await captureAction(page, () => submit(page));
  await expect(page.getByText("Saved.")).toBeVisible();

  return { editUrl, captured };
}

const saveTheFields = async (page: Page) => {
  await page.getByLabel("Summary").fill("Ada wrote this");
  await page.getByRole("button", { name: "Save changes" }).click();
};

const saveTheLists = async (page: Page) => {
  await page.getByRole("button", { name: "Add step" }).click();
  await page.getByLabel("Step 1", { exact: true }).fill("Ada wrote this step");
  await page.getByRole("button", { name: "Save ingredients and method" }).click();
};

/** True when `setRecipePublishedAction` answered that it moved the recipe. */
const reportsAChange = (result: { status: number; body: string }): boolean =>
  result.status === 200 && result.body.includes('"status":"changed"');

/** What was actually stored, read back through the page that renders it. */
async function stored(page: Page, editUrl: string, field: "summary" | "step"): Promise<string> {
  await page.goto(editUrl);
  return field === "summary"
    ? page.getByLabel("Summary").inputValue()
    : page.getByLabel("Step 1", { exact: true }).inputValue();
}

test.describe("a recipe can only be changed by its author", () => {
  let linus: SignedInState;

  test.beforeEach(async ({ browser }) => {
    linus = await signedInAs(browser, "linus");
  });

  test("another author cannot save changes to a draft that is not theirs", async ({
    page,
    playwright,
  }) => {
    const { editUrl, captured } = await adasDraft(page, "Ownership", saveTheFields);

    const result = await replayAction(playwright, captured, {
      as: linus,
      body: withField(captured.body, "summary", "Linus wrote this"),
    });

    // Signed in, past the proxy, holding a real session -- and still refused,
    // because none of that says anything about whose recipe this is.
    expect(reportsASave(result)).toBe(false);
    expect(await stored(page, editUrl, "summary")).toBe("Ada wrote this");
  });

  test("nor its ingredients and method", async ({ page, playwright }) => {
    const { editUrl, captured } = await adasDraft(page, "Ownership lists", saveTheLists);

    const lists = JSON.stringify({
      ingredients: [],
      steps: [{ position: 0, text: "Linus wrote this step" }],
    });
    const result = await replayAction(playwright, captured, {
      as: linus,
      body: withField(captured.body, "lists", lists),
    });

    /*
     * The second action, because one guard is not the rule.
     *
     * `saveRecipeListsAction` carried the identical hole and would have been
     * easy to forget: it is a second endpoint on the same page, doing a write
     * that looks like part of the first one. Every `"use server"` export is
     * its own endpoint, and each one is authorized or it is not.
     */
    expect(reportsASave(result)).toBe(false);
    expect(await stored(page, editUrl, "step")).toBe("Ada wrote this step");
  });

  test("and an id that is nobody's recipe is refused the same way", async ({
    page,
    playwright,
  }) => {
    const { captured } = await adasDraft(page, "Made-up id", saveTheFields);

    /*
     * Ada's own session, on ids she has no claim to.
     *
     * **This one passed before the guard as well, and that is worth saying
     * rather than letting it look like new protection.** Prisma raised on an
     * update to a row that is not there, and Postgres raised on a uuid it
     * could not parse -- two unhandled errors that happened to write nothing.
     * The same observable outcome by accident. Now it is the guard answering,
     * before any query runs, and `tests/db/recipe-ownership.test.ts` is where
     * the difference between the two is actually pinned down.
     */
    for (const id of ["0197c1ea-4d1e-7000-8000-000000000000", "not-a-uuid"]) {
      const result = await replayAction(playwright, captured, {
        as: await page.context().storageState(),
        body: withField(withField(captured.body, "id", id), "summary", "invented"),
      });

      expect(reportsASave(result), `id ${id} was accepted`).toBe(false);
    }
  });

  test("and cannot take another author's recipe off the site", async ({ page, playwright }) => {
    // A publishable draft, published by its author, with that request kept.
    await signIn(page, "ada");
    const { editUrl } = await publishableDraft(page, "Publish replay");

    const captured = await captureAction(page, async () => {
      await page.getByRole("button", { name: "Publish" }).click();
    });
    await expect(page.getByRole("button", { name: "Unpublish" })).toBeVisible();

    /*
     * **The promise Phase 14 made: every new mutating action gets a replay.**
     *
     * `setRecipePublishedAction` is a third endpoint, published the day it was
     * written, and the direction it moves is an ordinary form field -- so the
     * captured publish is also an unpublish, with one word changed. Nothing
     * about the guard is new; what is new is that the guard was written at the
     * same time as the action rather than two phases later.
     */
    const asUnpublish = withField(captured.body, "intent", "unpublish");

    expect(
      reportsAChange(await replayAction(playwright, captured, { as: linus, body: asUnpublish })),
    ).toBe(false);

    await page.goto(editUrl);
    await expect(page.getByRole("button", { name: "Unpublish" })).toBeVisible();

    // The control: the same request, from the author, does take it down. Three
    // assertions that nothing happened are worth nothing without it.
    expect(
      reportsAChange(
        await replayAction(playwright, captured, {
          as: await page.context().storageState(),
          body: asUnpublish,
        }),
      ),
    ).toBe(true);

    await page.goto(editUrl);
    await expect(page.getByRole("button", { name: "Publish" })).toBeVisible();
  });

  test("while the author herself is refused nothing", async ({ page, playwright }) => {
    const { editUrl, captured } = await adasDraft(page, "Still allowed", saveTheFields);

    /*
     * The control, and it is not a formality.
     *
     * Three tests above assert that a save did not happen. A guard that
     * refused everybody would pass all three, and the editor would be broken
     * for the only person entitled to use it. This is the test that fails when
     * the guard is too wide, and it is the one to read first when it does.
     */
    const result = await replayAction(playwright, captured, {
      as: await page.context().storageState(),
      body: withField(captured.body, "summary", "Ada wrote this, again"),
    });

    expect(reportsASave(result)).toBe(true);
    expect(await stored(page, editUrl, "summary")).toBe("Ada wrote this, again");
  });
});

test.describe("a draft is not published, and that is a different rule", () => {
  /** Ada's, seeded as a draft, and with a slug of its own from the moment it existed. */
  const DRAFT = { slug: "brown-butter-cardamom-buns", title: "Brown butter cardamom buns" };
  const PUBLISHED = { slug: "no-knead-sourdough", title: "No-knead sourdough" };

  test("its public page is 404 to another author", async ({ page }) => {
    await signIn(page, "linus");

    const response = await page.goto(`/recipes/${DRAFT.slug}`);

    // A real 404, not a page that renders and hides things. Every notFound()
    // in this application answers with the status code, which was measured
    // rather than assumed -- the framework returns 200 for a notFound() raised
    // after a response has begun streaming, so this is a property of how the
    // page is written.
    expect(response?.status()).toBe(404);
    await expect(page.getByText(DRAFT.title)).toBeHidden();
  });

  test("and 404 to the author who wrote it, which is the point", async ({ page }) => {
    await signIn(page, "ada");

    const response = await page.goto(`/recipes/${DRAFT.slug}`);

    /*
     * **Publication and ownership are two rules, enforced in two places, and
     * conflating them is how one of them ends up not enforced at all.**
     *
     * `/recipes/<slug>` asks whether a recipe is published. It has nothing to
     * do with who is asking, so it answers 404 to the author as readily as to
     * a stranger. Ownership is a question for the studio and for the actions,
     * and it is answered there.
     *
     * A detail page that quietly rendered a draft "because it is yours" would
     * be the same page for everyone the moment the query stopped being scoped,
     * and a reviewer looking at it would see a page that works.
     */
    expect(response?.status()).toBe(404);

    // Her editor, meanwhile, opens it -- so none of this is a missing recipe.
    await page.goto("/studio");
    await expect(
      page.getByRole("region", { name: "Drafts" }).getByRole("link", { name: DRAFT.title }),
    ).toBeVisible();
  });

  test("it is in no public collection either", async ({ request }) => {
    /*
     * The tag page carries the strong form of this, and it is the only one of
     * the three that can.
     *
     * `bread` is on the draft and on the seeded sourdough and on nothing else,
     * so one of them must be present and the other must not, whatever else the
     * suite has published while this ran. That pair is the assertion: without
     * the second half, a tag page that had simply broken would pass.
     */
    const tagged = await (await request.get("/tags/bread")).text();

    expect(tagged, "the tag page leaked the draft").not.toContain(DRAFT.title);
    expect(tagged, "the tag page is not showing anything").toContain(PUBLISHED.title);

    /*
     * The site-wide collections are paginated and the publish suite adds to
     * them, so "the sourdough is on page one" is not a stable control here --
     * it was, until publishing existed, and it failed the first time these
     * suites ran together. What is still stable is that a card rendered at
     * all, which is what `min` is standing in for: every card prints a time.
     */
    for (const path of ["/", "/recipes"]) {
      const html = await (await request.get(path)).text();

      expect(html, `${path} leaked the draft`).not.toContain(DRAFT.title);
      expect(html, `${path} rendered no recipes`).toContain(" min");
    }
  });

  /*
   * The surface this phase cannot cover yet.
   *
   * The rule is meant to hold in three shapes -- a rendered page, a route
   * handler and a Server Action -- and only one of the three looks like an
   * endpoint. Two of them are above. `/api/recipes` does not exist until phase
   * 18, and **it inherits the same assertion**: a draft is absent from it, for
   * a stranger and for its author alike, exactly as it is absent from the
   * collections tested here. Phase 18 builds the route; it does not get to
   * decide whether that test is worth writing.
   */
});

test.describe("a comment can only be removed by somebody entitled to", () => {
  /**
   * Ada, a published recipe of hers, and two comments on it.
   *
   * Two, because capturing the delete request means sending it -- so the first
   * comment pays for the capture and the second is the one the replays are
   * aimed at.
   */
  async function twoComments(page: Page) {
    await signIn(page, "ada");
    const { title, editUrl } = await publishableDraft(page, "Comment replay");

    await page.getByRole("button", { name: "Publish" }).click();
    await expect(publishPanel(page).getByRole("button", { name: "Unpublish" })).toBeVisible();

    const address = `/recipes/${title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;
    await page.goto(address);

    for (const body of ["The first one, which pays for the capture.", "The second one."]) {
      await page.getByLabel("Leave a comment").fill(body);
      await page.getByRole("button", { name: "Post comment" }).click();
      await expect(page.getByText(body)).toBeVisible();
    }

    return { address, editUrl };
  }

  test("another reader cannot delete one, however the request is sent", async ({
    page,
    browser,
    playwright,
  }) => {
    const linus = await signedInAs(browser, "linus");
    const { address, editUrl } = await twoComments(page);

    // The second comment's id, read off the form the page drew for it.
    const survivor = await page
      .locator("form")
      .filter({ has: page.getByRole("button", { name: "Delete" }) })
      .last()
      .locator("input[name='commentId']")
      .inputValue();

    // Capturing means sending: the first comment is really deleted here.
    const captured = await captureAction(page, async () => {
      await page.getByRole("button", { name: "Delete" }).first().click();
    });
    await expect(page.getByText("The first one, which pays for the capture.")).toBeHidden();

    const atTheSurvivor = withField(captured.body, "commentId", survivor);

    await replayAction(playwright, captured, { as: linus, body: atTheSurvivor });

    /*
     * Linus is signed in, and he is an author with recipes of his own. On
     * somebody else's page that counts for nothing -- writing recipes is not a
     * moderation role. The missing Delete button in `comments.spec.ts` is a
     * courtesy; this is the check.
     */
    await page.goto(address);
    await expect(page.getByText("The second one.")).toBeVisible();

    // The control. Three assertions that nothing happened are worth nothing
    // without one that something can.
    await replayAction(playwright, captured, {
      as: await page.context().storageState(),
      body: atTheSurvivor,
    });

    await page.goto(address);
    await expect(page.getByText("The second one.")).toBeHidden();

    await page.goto(editUrl);
    await publishPanel(page).getByRole("button", { name: "Unpublish" }).click();
    await expect(publishPanel(page).getByRole("button", { name: "Publish" })).toBeVisible();
  });

  test("and a comment cannot be posted on a draft", async ({ page, playwright }) => {
    await signIn(page, "ada");

    // A draft of Ada's own, so this is not about whose recipe it is.
    const { editUrl: draftUrl } = await newDraft(page, "Uncommentable");
    const draftId = /\/studio\/([0-9a-f-]+)\/edit/.exec(draftUrl)?.[1] ?? "";
    expect(draftId).not.toBe("");

    /*
     * A published recipe of this test's own, not the seeded one.
     *
     * The first version of this posted its comment on `no-knead-sourdough`,
     * which every other spec reads. Repeats piled identical comments onto a
     * shared fixture until the cleanup could no longer tell them apart -- and
     * a test that writes to a fixture other tests assert on is a test that
     * fails somewhere else.
     */
    const { title, editUrl } = await publishableDraft(page, "Commentable");
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(publishPanel(page).getByRole("button", { name: "Unpublish" })).toBeVisible();

    await page.goto(`/recipes/${title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`);
    const captured = await captureAction(page, async () => {
      await page.getByLabel("Leave a comment").fill("Posted where a form exists.");
      await page.getByRole("button", { name: "Post comment" }).click();
    });
    await expect(page.getByText("Posted where a form exists.")).toBeVisible();

    /*
     * The same request, aimed at a recipe that has no comment form because it
     * has no page. **"There is no form" is not a check** -- the recipe id
     * arrives in a body somebody wrote, and the command is what refuses it.
     */
    const result = await replayAction(playwright, captured, {
      as: await page.context().storageState(),
      body: withField(
        withField(captured.body, "recipeId", draftId),
        "body",
        "Posted where no form exists.",
      ),
    });

    expect(result.body).toContain("not-commentable");
    expect(result.body).not.toContain('"status":"posted"');

    // Back off the public site, taking its comment with it.
    await page.goto(editUrl);
    await publishPanel(page).getByRole("button", { name: "Unpublish" }).click();
    await expect(publishPanel(page).getByRole("button", { name: "Publish" })).toBeVisible();
  });
});
