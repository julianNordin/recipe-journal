import { describe, expect, it } from "vitest";

import { HERO_IMAGE_HOSTS } from "./hero-image-hosts";
import { RECIPE_LIMITS, parseRecipeInput } from "./recipe-input";

/**
 * The one description of what a recipe's fields may contain.
 *
 * Pure, and tested here rather than through a form, because this is the module
 * both ends read: the studio form takes its `maxLength`, `min` and `max`
 * attributes from `RECIPE_LIMITS`, and the Server Action runs
 * `parseRecipeInput` on whatever actually arrives. A browser cannot be trusted
 * to have honoured the first, which is why the second exists and why every
 * case below is written as if nothing sanitised the input beforehand.
 *
 * The values arrive as `FormData` entries, so everything is a string. A test
 * that passes a real number would be testing a call that cannot happen.
 */

/** A complete, valid submission. Each test invalidates exactly one thing. */
function validInput(): Record<string, unknown> {
  return {
    title: "Brown butter cardamom buns",
    summary: "Still working out the proving time.",
    body: "The second prove is the part that is not right yet.",
    heroImageUrl: "",
    servings: "12",
    prepMinutes: "60",
    cookMinutes: "20",
    difficulty: "HARD",
  };
}

/** The parsed value, or a failure the test did not expect. */
function parseOrThrow(raw: Record<string, unknown>) {
  const result = parseRecipeInput(raw);
  if (!result.ok) throw new Error(`expected valid input, got ${JSON.stringify(result.errors)}`);
  return result.value;
}

/** The errors, or a failure to fail. */
function errorsOf(raw: Record<string, unknown>) {
  const result = parseRecipeInput(raw);
  if (result.ok) throw new Error("expected invalid input, got a value");
  return result.errors;
}

describe("a complete submission", () => {
  it("comes back with every field converted", () => {
    const value = parseOrThrow(validInput());

    expect(value).toEqual({
      title: "Brown butter cardamom buns",
      summary: "Still working out the proving time.",
      body: "The second prove is the part that is not right yet.",
      heroImageUrl: null,
      // Strings in, numbers out. The database column is an integer and the
      // form is text; somebody has to convert, and it should be the layer
      // that also decides whether the result is allowed.
      servings: 12,
      prepMinutes: 60,
      cookMinutes: 20,
      difficulty: "HARD",
    });
  });

  it("ignores anything it was not asked about", () => {
    // The action passes the whole form. A hidden `id`, a CSRF token, or a
    // field someone appended by hand must not reach the database, and must
    // not be an error either -- rejecting unknown keys would break the form
    // the moment it grows one.
    const value = parseOrThrow({ ...validInput(), id: "not-mine", status: "PUBLISHED" });

    expect(value).not.toHaveProperty("id");
    expect(value).not.toHaveProperty("status");
  });
});

describe("the title", () => {
  it("is required", () => {
    expect(errorsOf({ ...validInput(), title: "" }).title).toMatch(/needs a title/i);
  });

  it("is required even when it is only spaces", () => {
    // Trimmed before it is measured, or " " is a title and the recipe has no
    // readable name anywhere it is listed.
    expect(errorsOf({ ...validInput(), title: "   " }).title).toMatch(/needs a title/i);
  });

  it("is trimmed", () => {
    expect(parseOrThrow({ ...validInput(), title: "  Buns  " }).title).toBe("Buns");
  });

  it("accepts exactly the column width", () => {
    const value = parseOrThrow({ ...validInput(), title: "a".repeat(RECIPE_LIMITS.title) });
    expect(value.title).toHaveLength(RECIPE_LIMITS.title);
  });

  it("rejects one character more", () => {
    // The boundary in both directions, because an off-by-one here is a 500
    // from Postgres rather than a message on the form.
    expect(errorsOf({ ...validInput(), title: "a".repeat(RECIPE_LIMITS.title + 1) }).title).toMatch(
      /at most/i,
    );
  });
});

describe("the summary", () => {
  it("is optional, and an empty one is null rather than an empty string", () => {
    // Null and "" are the same thing to a reader and different things to a
    // query. Deciding here means nothing downstream has to check for both.
    expect(parseOrThrow({ ...validInput(), summary: "" }).summary).toBeNull();
    expect(parseOrThrow({ ...validInput(), summary: "   " }).summary).toBeNull();
  });

  it("is optional when absent altogether", () => {
    const { summary: _summary, ...withoutSummary } = validInput();
    expect(parseOrThrow(withoutSummary).summary).toBeNull();
  });

  it("respects the column width", () => {
    expect(
      errorsOf({ ...validInput(), summary: "a".repeat(RECIPE_LIMITS.summary + 1) }).summary,
    ).toMatch(/at most/i);
  });
});

describe("the body", () => {
  it("is allowed to be empty, because a draft starts empty", () => {
    // Publishing needs one -- that rule lives in `publish.ts` and is checked
    // when publishing, not when saving. A form that refused to save an
    // unfinished recipe would be a worse tool than a text file.
    expect(parseOrThrow({ ...validInput(), body: "" }).body).toBe("");
  });

  it("is bounded anyway", () => {
    // `body` is an unbounded text column, so nothing but this stops a
    // megabyte arriving. It is a public endpoint; the limit is the point.
    expect(errorsOf({ ...validInput(), body: "a".repeat(RECIPE_LIMITS.body + 1) }).body).toMatch(
      /at most/i,
    );
  });
});

describe("the hero image", () => {
  it("is optional", () => {
    expect(parseOrThrow({ ...validInput(), heroImageUrl: "" }).heroImageUrl).toBeNull();
  });

  it("accepts an https URL on an allowed host", () => {
    const url = `https://${HERO_IMAGE_HOSTS[0]}/photo-1234?w=1200`;
    expect(parseOrThrow({ ...validInput(), heroImageUrl: url }).heroImageUrl).toBe(url);
  });

  it("refuses a host that is not on the list", () => {
    /*
     * The list is not decoration. `next/image` proxies and re-encodes whatever
     * it is pointed at, so an unrestricted `remotePatterns` turns the image
     * optimiser into an open proxy for arbitrary remote content, paid for by
     * this server. The same list configures Next and validates here, so an
     * author gets a message on the form instead of a broken image.
     */
    expect(
      errorsOf({ ...validInput(), heroImageUrl: "https://example.com/photo.jpg" }).heroImageUrl,
    ).toMatch(/images.unsplash.com/);
  });

  it("refuses a lookalike host", () => {
    // `images.unsplash.com.evil.test` ends with nothing useful and starts with
    // something reassuring. Host equality, never `includes` or `endsWith`.
    expect(
      errorsOf({
        ...validInput(),
        heroImageUrl: `https://${HERO_IMAGE_HOSTS[0]}.evil.test/photo.jpg`,
      }).heroImageUrl,
    ).toBeDefined();
  });

  it("refuses a userinfo prefix that hides the real host", () => {
    // https://images.unsplash.com@evil.test/x parses with host evil.test, and
    // reads to a person as the allowed one.
    expect(
      errorsOf({
        ...validInput(),
        heroImageUrl: `https://${HERO_IMAGE_HOSTS[0]}@evil.test/photo.jpg`,
      }).heroImageUrl,
    ).toBeDefined();
  });

  it.each(["http://", "javascript:alert(1)//", "data:image/png;base64,AAAA", "not a url at all"])(
    "refuses %s",
    (prefix) => {
      const raw = prefix.startsWith("http://") ? `http://${HERO_IMAGE_HOSTS[0]}/x.jpg` : prefix;
      expect(errorsOf({ ...validInput(), heroImageUrl: raw }).heroImageUrl).toBeDefined();
    },
  );

  it("respects the column width", () => {
    const long = `https://${HERO_IMAGE_HOSTS[0]}/${"a".repeat(RECIPE_LIMITS.heroImageUrl)}`;
    expect(errorsOf({ ...validInput(), heroImageUrl: long }).heroImageUrl).toMatch(/at most/i);
  });
});

describe("servings and times", () => {
  it("rejects a servings of zero, which the database also rejects", () => {
    // ck_recipes_servings is `servings >= 1`. Without this the form's answer
    // to "0 servings" is a constraint violation with a Postgres error string
    // in it.
    expect(errorsOf({ ...validInput(), servings: "0" }).servings).toBeDefined();
  });

  it("accepts one serving", () => {
    expect(parseOrThrow({ ...validInput(), servings: "1" }).servings).toBe(1);
  });

  it("accepts zero minutes, because not everything is cooked", () => {
    const value = parseOrThrow({ ...validInput(), cookMinutes: "0" });
    expect(value.cookMinutes).toBe(0);
  });

  it.each([
    ["servings", ""],
    ["servings", "   "],
    ["servings", "four"],
    ["servings", "4.5"],
    ["servings", "-2"],
    ["prepMinutes", ""],
    ["prepMinutes", "-1"],
    ["prepMinutes", "1e999"],
    ["cookMinutes", "NaN"],
    ["cookMinutes", "Infinity"],
  ])("rejects %s = %o", (field, raw) => {
    expect(errorsOf({ ...validInput(), [field]: raw })[field as "servings"]).toBeDefined();
  });

  it("rejects an implausibly large number rather than storing it", () => {
    // Postgres integers stop at 2147483647 and the column is an int4. A number
    // past it is a runtime error from the driver, so the bound belongs here.
    expect(errorsOf({ ...validInput(), prepMinutes: "99999999999" }).prepMinutes).toBeDefined();
  });
});

describe("the difficulty", () => {
  it.each(["EASY", "MEDIUM", "HARD"] as const)("accepts %s", (level) => {
    expect(parseOrThrow({ ...validInput(), difficulty: level }).difficulty).toBe(level);
  });

  it.each(["easy", "IMPOSSIBLE", "", "DROP TABLE recipes"])("rejects %o", (level) => {
    expect(errorsOf({ ...validInput(), difficulty: level }).difficulty).toBeDefined();
  });
});

describe("input that is not a form at all", () => {
  /*
   * A Server Action is a public HTTP endpoint. Its body is whatever the caller
   * chose to send, and Phase 14 replays exactly that. Same discipline as
   * `authenticate`: the malformed cases are tested because they are reachable,
   * not because a form could produce them.
   */
  it.each([null, undefined, "a string", 42, [], true])("is rejected: %o", (raw) => {
    const result = parseRecipeInput(raw);
    expect(result.ok).toBe(false);
  });

  it("reports every bad field at once, not just the first", () => {
    // Four round trips for four mistakes is how a form earns a reputation.
    const errors = errorsOf({ ...validInput(), title: "", servings: "nope", difficulty: "x" });

    expect(Object.keys(errors).sort()).toEqual(["difficulty", "servings", "title"]);
  });

  it("does not throw on a value that cannot be turned into a string", () => {
    const result = parseRecipeInput({ ...validInput(), title: { toString: null } });
    expect(result.ok).toBe(false);
  });
});
