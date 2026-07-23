import { describe, expect, it } from "vitest";

import { COMMENT_RATE_LIMIT } from "@/domain/comment";
import { createComment, deleteComment } from "@/server/comments/commands";
import {
  countCommentsSince,
  findCommentContext,
  listCommentsForRecipe,
} from "@/server/comments/queries";

import { cleanDatabasePerTest } from "./setup/database";
import { makePublishedRecipe, makeRecipe, makeUser } from "./setup/factories";

import type { PrismaClient, User } from "@/generated/prisma/client";

/**
 * Comments against real Postgres.
 *
 * Two rules here need the database to answer and so cannot live in the domain
 * layer: whether the recipe is open for comment, and whether this person has
 * posted too many too quickly. The second is the interesting one -- it is
 * counted from rows on purpose, and a test that only exercised an in-memory
 * counter would prove nothing about the thing that ships.
 */

const db = cleanDatabasePerTest();

const NOW = new Date("2026-07-23T19:30:00.000Z");

/** Inside the window `NOW` is asked about, and outside it. */
const RECENTLY = new Date("2026-07-23T19:28:00.000Z");
const LONG_AGO = new Date("2026-07-23T19:00:00.000Z");

async function commentAt(
  client: PrismaClient,
  params: { recipeId: string; author: User; createdAt: Date },
) {
  return client.comment.create({
    data: {
      recipeId: params.recipeId,
      authorId: params.author.id,
      body: "Seeded directly, to place it in time.",
      createdAt: params.createdAt,
    },
    select: { id: true },
  });
}

describe("createComment", () => {
  it("posts a comment on a published recipe", async () => {
    const recipe = await makePublishedRecipe(db());
    const reader = await makeUser(db());

    const result = await createComment(db(), {
      recipeId: recipe.id,
      authorId: reader.id,
      body: "Tried this with spelt.",
      now: NOW,
    });

    expect(result.ok).toBe(true);
    expect(await listCommentsForRecipe(db(), recipe.id)).toMatchObject([
      { body: "Tried this with spelt.", author: { id: reader.id } },
    ]);
  });

  it("refuses a draft, and writes nothing", async () => {
    const draft = await makeRecipe(db());
    const reader = await makeUser(db());

    /*
     * **A draft has no comment form, and that is not a check.** There is no
     * page to put one on -- but the recipe id arrives in a request somebody
     * wrote, and "the interface does not offer it" is exactly the reasoning
     * phase 14 exists to take apart.
     */
    expect(
      await createComment(db(), {
        recipeId: draft.id,
        authorId: reader.id,
        body: "Can I see this?",
        now: NOW,
      }),
    ).toEqual({ ok: false, problem: "not-commentable" });

    expect(await db().comment.count()).toBe(0);
  });

  it("refuses a recipe that does not exist", async () => {
    const reader = await makeUser(db());

    expect(
      await createComment(db(), {
        recipeId: "0197c1ea-4d1e-7000-8000-000000000000",
        authorId: reader.id,
        body: "Hello?",
        now: NOW,
      }),
    ).toEqual({ ok: false, problem: "not-commentable" });
  });

  it("refuses once the author has posted a windowful", async () => {
    const recipe = await makePublishedRecipe(db());
    const reader = await makeUser(db());

    for (let i = 0; i < COMMENT_RATE_LIMIT.max; i += 1) {
      await commentAt(db(), { recipeId: recipe.id, author: reader, createdAt: RECENTLY });
    }

    expect(
      await createComment(db(), {
        recipeId: recipe.id,
        authorId: reader.id,
        body: "One more.",
        now: NOW,
      }),
    ).toEqual({ ok: false, problem: "rate-limited" });

    expect(await db().comment.count()).toBe(COMMENT_RATE_LIMIT.max);
  });

  it("counts the window, not the lifetime", async () => {
    const recipe = await makePublishedRecipe(db());
    const reader = await makeUser(db());

    // A windowful, but all of it older than the window. The control on the
    // test above: a limit that never forgot would refuse everybody eventually,
    // and it would take days of use to notice.
    for (let i = 0; i < COMMENT_RATE_LIMIT.max; i += 1) {
      await commentAt(db(), { recipeId: recipe.id, author: reader, createdAt: LONG_AGO });
    }

    expect(
      (
        await createComment(db(), {
          recipeId: recipe.id,
          authorId: reader.id,
          body: "Still allowed.",
          now: NOW,
        })
      ).ok,
    ).toBe(true);
  });

  it("counts per person, not per site", async () => {
    const recipe = await makePublishedRecipe(db());
    const loud = await makeUser(db());
    const quiet = await makeUser(db());

    for (let i = 0; i < COMMENT_RATE_LIMIT.max; i += 1) {
      await commentAt(db(), { recipeId: recipe.id, author: loud, createdAt: RECENTLY });
    }

    // The other control. A limit keyed on the wrong column silences the whole
    // site the moment one person is noisy, and the noisy person is the only
    // one who would not notice.
    expect(
      (
        await createComment(db(), {
          recipeId: recipe.id,
          authorId: quiet.id,
          body: "First thing I have said.",
          now: NOW,
        })
      ).ok,
    ).toBe(true);
  });
});

describe("countCommentsSince", () => {
  it("counts only what is inside the window", async () => {
    const recipe = await makePublishedRecipe(db());
    const reader = await makeUser(db());

    await commentAt(db(), { recipeId: recipe.id, author: reader, createdAt: RECENTLY });
    await commentAt(db(), { recipeId: recipe.id, author: reader, createdAt: LONG_AGO });

    const since = new Date("2026-07-23T19:25:00.000Z");
    expect(await countCommentsSince(db(), { authorId: reader.id, since })).toBe(1);
  });
});

describe("listCommentsForRecipe", () => {
  it("returns a recipe's comments oldest first", async () => {
    const recipe = await makePublishedRecipe(db());
    const reader = await makeUser(db());

    await commentAt(db(), {
      recipeId: recipe.id,
      author: reader,
      createdAt: new Date("2026-07-23T19:10:00.000Z"),
    });
    const second = await db().comment.create({
      data: {
        recipeId: recipe.id,
        authorId: reader.id,
        body: "Answering myself.",
        createdAt: new Date("2026-07-23T19:20:00.000Z"),
      },
      select: { id: true },
    });

    const comments = await listCommentsForRecipe(db(), recipe.id);

    /*
     * A conversation reads downwards. Newest-first is right for a feed of
     * unrelated things and wrong for a page where the second comment may be
     * answering the first.
     *
     * This one bites without help, unlike the recipe ordering tests that need
     * `seqScanOnlyDb`: the index on `comments` is `(recipe_id, created_at
     * DESC)`, so an index scan hands rows back in exactly the *opposite* order
     * to the one asserted. Measured -- deleting the `orderBy` fails this test
     * and only this test.
     */
    expect(comments.map((c) => c.id).at(-1)).toBe(second.id);
  });

  it("returns nobody else's comments", async () => {
    const mine = await makePublishedRecipe(db());
    const theirs = await makePublishedRecipe(db());
    const reader = await makeUser(db());

    await commentAt(db(), { recipeId: theirs.id, author: reader, createdAt: RECENTLY });

    expect(await listCommentsForRecipe(db(), mine.id)).toEqual([]);
  });

  it("does not hand a component the commenter's email or password hash", async () => {
    const recipe = await makePublishedRecipe(db());
    const reader = await makeUser(db(), { passwordHash: "not-a-real-hash" });
    await commentAt(db(), { recipeId: recipe.id, author: reader, createdAt: RECENTLY });

    // Columns are selected rather than the relation included, so this stays
    // true when the query grows. The same assertion guards the recipe detail
    // query, and for the same reason.
    const serialised = JSON.stringify(await listCommentsForRecipe(db(), recipe.id));

    expect(serialised).not.toContain("not-a-real-hash");
    expect(serialised).not.toContain(reader.email);
  });

  it("answers empty for an id that is not a uuid", async () => {
    // The id reaches this from a URL segment. Straight to Prisma it is
    // `invalid input syntax for type uuid`, which is a 500 where the honest
    // answer is "no comments".
    expect(await listCommentsForRecipe(db(), "not-a-uuid")).toEqual([]);
  });
});

describe("findCommentContext", () => {
  it("returns both ids the deletion rule compares", async () => {
    const cook = await makeUser(db());
    const reader = await makeUser(db());
    const recipe = await makePublishedRecipe(db(), { author: cook });
    const comment = await commentAt(db(), {
      recipeId: recipe.id,
      author: reader,
      createdAt: RECENTLY,
    });

    expect(await findCommentContext(db(), comment.id)).toEqual({
      commentAuthorId: reader.id,
      recipeAuthorId: cook.id,
      recipeId: recipe.id,
    });
  });

  it("returns null for a comment that is not there, and for a malformed id", async () => {
    expect(await findCommentContext(db(), "0197c1ea-4d1e-7000-8000-000000000000")).toBeNull();
    expect(await findCommentContext(db(), "not-a-uuid")).toBeNull();
  });
});

describe("deleteComment", () => {
  it("removes it", async () => {
    const recipe = await makePublishedRecipe(db());
    const reader = await makeUser(db());
    const comment = await commentAt(db(), {
      recipeId: recipe.id,
      author: reader,
      createdAt: RECENTLY,
    });

    await deleteComment(db(), { id: comment.id });

    expect(await db().comment.count()).toBe(0);
  });

  it("is a no-op on one that is already gone", async () => {
    // Two people pressing Delete on the same comment is an ordinary race on a
    // page they can both see, and the second has got what they wanted. A
    // `delete` would raise P2025 and turn that into an error page.
    await expect(
      deleteComment(db(), { id: "0197c1ea-4d1e-7000-8000-000000000000" }),
    ).resolves.toBeUndefined();
  });

  it("goes when the recipe goes", async () => {
    const recipe = await makePublishedRecipe(db());
    const reader = await makeUser(db());
    await commentAt(db(), { recipeId: recipe.id, author: reader, createdAt: RECENTLY });

    await db().recipe.delete({ where: { id: recipe.id } });

    // `onDelete: Cascade` from the schema. Worth an assertion because the
    // alternative -- rows pointing at a recipe that is not there -- is the kind
    // of thing that surfaces months later as a query that cannot join.
    expect(await db().comment.count()).toBe(0);
  });
});
