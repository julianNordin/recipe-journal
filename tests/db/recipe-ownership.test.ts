import { describe, expect, it } from "vitest";

import { findRecipeAuthorId } from "@/server/recipes/queries";

import { cleanDatabasePerTest } from "./setup/database";
import { makePublishedRecipe, makeRecipe, makeUser } from "./setup/factories";

/**
 * The read an authorization decision is made from.
 *
 * `requireRecipeAuthor` is three lines on top of this: fetch the author, and
 * refuse unless it is the caller. That makes this function the whole factual
 * content of the decision, and the reason it takes its client rather than
 * reaching for the singleton -- a guard that can only be exercised through a
 * browser is a guard whose edge cases nobody has looked at.
 *
 * The awkward cases are the subject. A recipe id arrives inside a form body
 * that anybody can write, so "a uuid nobody used" and "not a uuid at all" are
 * ordinary inputs here rather than things that should not happen.
 */

const db = cleanDatabasePerTest();

describe("findRecipeAuthorId", () => {
  it("names the author of a recipe that exists", async () => {
    const author = await makeUser(db());
    const recipe = await makeRecipe(db(), { author });

    expect(await findRecipeAuthorId(db(), recipe.id)).toBe(author.id);
  });

  it("answers for a draft exactly as it does for a published recipe", async () => {
    const author = await makeUser(db());
    const draft = await makeRecipe(db(), { author });
    const published = await makePublishedRecipe(db(), { author });

    // Ownership and visibility are different questions. A draft has an author
    // in precisely the same way a published recipe does, and an authorization
    // check that quietly returned null for drafts would refuse the one person
    // who is allowed to edit it.
    expect(await findRecipeAuthorId(db(), draft.id)).toBe(author.id);
    expect(await findRecipeAuthorId(db(), published.id)).toBe(author.id);
  });

  it("keeps two authors' recipes apart", async () => {
    const ada = await makeUser(db());
    const linus = await makeUser(db());
    const hers = await makeRecipe(db(), { author: ada });
    const his = await makeRecipe(db(), { author: linus });

    expect(await findRecipeAuthorId(db(), hers.id)).toBe(ada.id);
    expect(await findRecipeAuthorId(db(), his.id)).toBe(linus.id);
  });

  it("returns null for a well-formed id that is nobody's recipe", async () => {
    await makeRecipe(db());

    // A real uuid, and not one this database has ever issued. The caller turns
    // this into the same refusal it gives for somebody else's recipe, so a
    // stranger cannot use the difference to find out which ids are real.
    expect(await findRecipeAuthorId(db(), "0197c1ea-4d1e-7000-8000-000000000000")).toBeNull();
  });

  it("returns null for an id that is not a uuid at all", async () => {
    await makeRecipe(db());

    /*
     * **The case that bites, and it was measured.** The column is `@db.Uuid`,
     * so handing Postgres `not-a-uuid` raises `invalid input syntax for type
     * uuid` rather than returning no rows. Deleting the guard in
     * `findRecipeAuthorId` fails this test and only this test, with that error
     * -- which in an action is an unhandled 500 where the honest answer is
     * "no". The refusal has to be a refusal, including for input nobody
     * expected.
     */
    expect(await findRecipeAuthorId(db(), "not-a-uuid")).toBeNull();
    expect(await findRecipeAuthorId(db(), "")).toBeNull();
    expect(await findRecipeAuthorId(db(), "' OR 1=1 --")).toBeNull();
  });
});
