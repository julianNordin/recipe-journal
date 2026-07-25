import { describe, expect, it } from "vitest";

import {
  DEFAULT_RECIPE_SORT,
  parseRecipeSort,
  parseSearchTerm,
  RECIPE_SORT_LABELS,
  RECIPE_SORTS,
} from "./recipe-sort";

describe("parseRecipeSort", () => {
  it("accepts every name on the list", () => {
    for (const sort of RECIPE_SORTS) {
      expect(parseRecipeSort(sort)).toBe(sort);
    }
  });

  it("defaults when nothing was asked for", () => {
    // An absent parameter is the ordinary case, not a mistake.
    for (const raw of [null, undefined, ""]) {
      expect(parseRecipeSort(raw)).toBe(DEFAULT_RECIPE_SORT);
    }
  });

  it("refuses anything else rather than falling back", () => {
    /*
     * Null, not the default. A misspelt `?sort=` that quietly returns the
     * default order is a bug report reading "the sort does not work", and the
     * only honest answer is a 400 naming the four that do.
     *
     * The last two are the reason this is a whitelist and not a validator:
     * `id` is a real column and `title; drop table` is what a validator built
     * from "does the column exist" eventually has to think about.
     */
    for (const raw of ["Newest", "NEWEST", "created", "id", "title; drop table recipes"]) {
      expect(parseRecipeSort(raw), raw).toBeNull();
    }
  });

  it("has a label for every name, and no labels for names that are gone", () => {
    // The 400 lists these, so a name without one is a message with a hole in
    // it and a label without a name is a promise the parser will not keep.
    expect(Object.keys(RECIPE_SORT_LABELS).sort()).toEqual([...RECIPE_SORTS].sort());
  });
});

describe("parseSearchTerm", () => {
  it("keeps a real term, trimmed", () => {
    expect(parseSearchTerm("  sourdough ")).toBe("sourdough");
  });

  it("collapses nothing-in-particular to null", () => {
    // One thing for a caller to check rather than two.
    for (const raw of ["", "   ", "\n\t", null, undefined, 42 as unknown as string]) {
      expect(parseSearchTerm(raw)).toBeNull();
    }
  });

  it("keeps a term too short for the index to help with", () => {
    // A trigram index cannot serve a pattern with no whole trigram in it, so
    // this is a sequential scan -- and refusing it would also refuse `ho` from
    // somebody looking for hollandaise.
    expect(parseSearchTerm("ry")).toBe("ry");
  });
});
