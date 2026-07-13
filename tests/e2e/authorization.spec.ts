import { expect, test, type Page } from "@playwright/test";

import { newDraft, signIn, signedInAs, type SignedInState } from "./support/authors";
import {
  captureAction,
  replayAction,
  reportsASave,
  withField,
  type CapturedAction,
} from "./support/server-action";

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
