import { describe, expect, it } from "vitest";

import {
  COMMENT_LIMITS,
  COMMENT_RATE_LIMIT,
  mayDeleteComment,
  parseCommentBody,
  rateLimitWindowStart,
} from "./comment";

/**
 * The two rules a comment has, and the window a rate limit counts over.
 *
 * All pure, so all of it is here rather than reachable only through a browser.
 * `mayDeleteComment` in particular has four distinct answers and one of them --
 * "another author may not" -- is the one a reasonable person gets wrong.
 */

describe("parseCommentBody", () => {
  it("accepts something written", () => {
    expect(parseCommentBody("Tried this with spelt.")).toEqual({
      ok: true,
      body: "Tried this with spelt.",
    });
  });

  it("trims before it stores", () => {
    // Trailing whitespace is invisible in the form and not invisible in a
    // 2000-character column.
    expect(parseCommentBody("  spaced out  ")).toEqual({ ok: true, body: "spaced out" });
  });

  it("treats whitespace as nothing at all", () => {
    // Trimmed before measured, so this is empty rather than long enough.
    for (const raw of ["", "   ", "\n\t "]) {
      expect(parseCommentBody(raw)).toEqual({ ok: false, problem: "empty" });
    }
  });

  it("refuses anything that is not a string", () => {
    // The action reads this out of a FormData, which can hand back a File.
    for (const raw of [null, undefined, 42, {}, []]) {
      expect(parseCommentBody(raw)).toEqual({ ok: false, problem: "empty" });
    }
  });

  it("refuses more than the column holds", () => {
    const limit = COMMENT_LIMITS.body;

    expect(parseCommentBody("a".repeat(limit))).toEqual({ ok: true, body: "a".repeat(limit) });
    expect(parseCommentBody("a".repeat(limit + 1))).toEqual({ ok: false, problem: "too-long" });
  });

  it("measures the trimmed length, not the submitted one", () => {
    // Otherwise a comment that fits is refused for the spaces around it.
    const padded = `  ${"a".repeat(COMMENT_LIMITS.body)}  `;

    expect(parseCommentBody(padded).ok).toBe(true);
  });
});

describe("rateLimitWindowStart", () => {
  it("goes back exactly one window", () => {
    const now = new Date("2026-07-20T12:00:00.000Z");

    expect(rateLimitWindowStart(now)).toEqual(
      new Date(now.getTime() - COMMENT_RATE_LIMIT.windowMinutes * 60_000),
    );
  });

  it("takes the moment it is given rather than reading a clock", () => {
    // The whole reason this is a function of `now`: a test that had to freeze
    // the system clock to ask this question would be testing the clock.
    const earlier = rateLimitWindowStart(new Date("2026-06-21T08:00:00.000Z"));

    expect(earlier.toISOString()).toBe("2026-06-21T07:55:00.000Z");
  });
});

describe("mayDeleteComment", () => {
  const commentAuthorId = "comment-author";
  const recipeAuthorId = "recipe-author";

  it("lets the person who wrote it remove it", () => {
    expect(mayDeleteComment({ commentAuthorId, recipeAuthorId, userId: commentAuthorId })).toBe(
      true,
    );
  });

  it("lets the author of the recipe remove anything on their page", () => {
    expect(mayDeleteComment({ commentAuthorId, recipeAuthorId, userId: recipeAuthorId })).toBe(
      true,
    );
  });

  it("refuses everybody else", () => {
    /*
     * **The case a reasonable person gets wrong.** `somebody-else` may well be
     * an author with recipes of their own -- `UserRole` is `USER` or `AUTHOR`,
     * and writing recipes is not a moderation role. On this page they are a
     * reader like any other.
     */
    expect(mayDeleteComment({ commentAuthorId, recipeAuthorId, userId: "somebody-else" })).toBe(
      false,
    );
  });

  it("refuses a signed-out visitor", () => {
    expect(mayDeleteComment({ commentAuthorId, recipeAuthorId, userId: null })).toBe(false);
  });

  it("does not confuse the two ids when one person is both", () => {
    // An author commenting on their own recipe. Both rules say yes, and the
    // answer must not depend on which one is checked first.
    const both = "one-person";

    expect(mayDeleteComment({ commentAuthorId: both, recipeAuthorId: both, userId: both })).toBe(
      true,
    );
    expect(
      mayDeleteComment({ commentAuthorId: both, recipeAuthorId: both, userId: "anyone-else" }),
    ).toBe(false);
  });
});
