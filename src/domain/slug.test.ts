import { describe, expect, it } from "vitest";

import { slugSearchPrefix, slugify, uniqueSlug } from "./slug";

describe("slugify", () => {
  it("lowercases and joins words with hyphens", () => {
    expect(slugify("No Knead Sourdough")).toBe("no-knead-sourdough");
  });

  it("collapses runs of punctuation into a single hyphen", () => {
    expect(slugify("Soup!!!  Really --- good")).toBe("soup-really-good");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  ...Bread...  ")).toBe("bread");
  });

  it("keeps accented letters readable rather than deleting them", () => {
    // The failure this guards against is "cr-me-br-l-e".
    expect(slugify("Crème Brûlée")).toBe("creme-brulee");
    expect(slugify("Jalapeño Poppers")).toBe("jalapeno-poppers");
  });

  it("handles Swedish letters", () => {
    expect(slugify("Räksmörgås")).toBe("raksmorgas");
    expect(slugify("Ärtsoppa på tisdag")).toBe("artsoppa-pa-tisdag");
  });

  it("transliterates letters that do not decompose", () => {
    expect(slugify("Straße")).toBe("strasse");
    expect(slugify("Smørrebrød")).toBe("smorrebrod");
  });

  it("keeps digits", () => {
    expect(slugify("5 minute pesto")).toBe("5-minute-pesto");
  });

  it("returns an empty string when nothing survives", () => {
    expect(slugify("!!!")).toBe("");
    expect(slugify("   ")).toBe("");
  });

  it("truncates to the column width without a trailing hyphen", () => {
    const slug = slugify("a ".repeat(200));
    expect(slug.length).toBeLessThanOrEqual(120);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("uniqueSlug", () => {
  it("returns the plain slug when nothing has taken it", () => {
    expect(uniqueSlug("Sourdough", [])).toBe("sourdough");
  });

  it("suffixes with -2 on the first collision", () => {
    expect(uniqueSlug("Sourdough", ["sourdough"])).toBe("sourdough-2");
  });

  it("keeps counting past a run of collisions", () => {
    expect(uniqueSlug("Sourdough", ["sourdough", "sourdough-2", "sourdough-3"])).toBe(
      "sourdough-4",
    );
  });

  it("skips a gap rather than reusing a freed number", () => {
    // Predictability matters more than density here.
    expect(uniqueSlug("Sourdough", ["sourdough", "sourdough-3"])).toBe("sourdough-2");
  });

  it("falls back to a usable slug when the title yields nothing", () => {
    expect(uniqueSlug("!!!", [])).toBe("recipe");
    expect(uniqueSlug("!!!", ["recipe"])).toBe("recipe-2");
  });

  it("stays inside the column width when suffixing a maximal slug", () => {
    const long = "a".repeat(130);
    const first = uniqueSlug(long, []);
    const second = uniqueSlug(long, [first]);

    expect(first.length).toBeLessThanOrEqual(120);
    expect(second.length).toBeLessThanOrEqual(120);
    expect(second).not.toBe(first);
  });

  it("is deterministic for a given set of taken slugs", () => {
    const taken = ["soup", "soup-2"];
    expect(uniqueSlug("Soup", taken)).toBe(uniqueSlug("Soup", taken));
  });
});

describe("slugSearchPrefix", () => {
  it("is the whole slug for an ordinary title", () => {
    expect(slugSearchPrefix("Cardamom buns")).toBe("cardamom-buns");
  });

  it("survives a title with nothing sluggable in it", () => {
    expect(slugSearchPrefix("!!! ???")).toBe("recipe");
  });

  it("prefixes every slug uniqueSlug can return, including the truncated ones", () => {
    /*
     * The coupling this function exists for, asserted rather than described.
     * A long base is shortened before the suffix goes on, so `base + "-"` is
     * not a prefix of the result -- and a caller that queried for that prefix
     * would miss the collision it was looking for.
     */
    const title = `${"Cardamom ".repeat(20)}buns`;
    const prefix = slugSearchPrefix(title);
    const taken = new Set<string>();

    for (let n = 0; n < 12; n += 1) {
      const slug = uniqueSlug(title, taken);
      expect(slug.startsWith(prefix)).toBe(true);
      taken.add(slug);
    }

    expect(taken.size).toBe(12);
  });
});
