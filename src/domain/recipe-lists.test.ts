import { describe, expect, it } from "vitest";

import { LIST_LIMITS, parseRecipeLists, parseRecipeListsJson } from "./recipe-lists";

/**
 * The ingredient and step payload, as it arrives from the editor.
 *
 * The editor is a Client Component holding the authoritative list, so it posts
 * that list verbatim -- positions included -- as JSON in one hidden field.
 * Which means the Server Action receives a string somebody else could have
 * written, and every case below is written as if they had.
 */

function ingredient(overrides: Record<string, unknown> = {}) {
  return {
    position: 0,
    quantity: "500",
    unit: "g",
    item: "strong white flour",
    note: null,
    ...overrides,
  };
}

function step(overrides: Record<string, unknown> = {}) {
  return { position: 0, text: "Mix the flour and water.", ...overrides };
}

function lists(overrides: Record<string, unknown> = {}) {
  return { ingredients: [ingredient()], steps: [step()], ...overrides };
}

function valueOf(raw: unknown) {
  const result = parseRecipeLists(raw);
  if (!result.ok) throw new Error(`expected valid, got ${JSON.stringify(result.errors)}`);
  return result.value;
}

function errorsOf(raw: unknown) {
  const result = parseRecipeLists(raw);
  if (result.ok) throw new Error("expected invalid, got a value");
  return result.errors;
}

describe("a well-formed payload", () => {
  it("comes back with both lists", () => {
    const value = valueOf(lists());

    expect(value.ingredients).toEqual([
      { position: 0, quantity: "500", unit: "g", item: "strong white flour", note: null },
    ]);
    expect(value.steps).toEqual([{ position: 0, text: "Mix the flour and water." }]);
  });

  it("accepts two empty lists, because a new draft has none", () => {
    const value = valueOf({ ingredients: [], steps: [] });

    expect(value.ingredients).toEqual([]);
    expect(value.steps).toEqual([]);
  });

  it("trims, and turns an emptied optional field into null", () => {
    const value = valueOf({
      ingredients: [ingredient({ quantity: "  2  ", unit: "", note: "   " })],
      steps: [step({ text: "  Rest for an hour.  " })],
    });

    expect(value.ingredients[0]?.quantity).toBe("2");
    expect(value.ingredients[0]?.unit).toBeNull();
    expect(value.ingredients[0]?.note).toBeNull();
    expect(value.steps[0]?.text).toBe("Rest for an hour.");
  });

  it("keeps the order the positions describe", () => {
    const value = valueOf({
      ingredients: [ingredient({ position: 1, item: "water" }), ingredient({ position: 0 })],
      steps: [],
    });

    // Not reordered here. The command writes positions, and a row's position
    // is the column, not its place in an array.
    expect(value.ingredients.map((i) => i.position)).toEqual([1, 0]);
  });
});

describe("positions", () => {
  it("must be dense from zero", () => {
    // The whole contract in one assertion: `isDense` is what the database's
    // deferrable unique constraints will otherwise refuse at COMMIT, with a
    // message about an index rather than about a list.
    expect(errorsOf({ ingredients: [ingredient({ position: 1 })], steps: [] }).ingredients).toMatch(
      /position/i,
    );
  });

  it("rejects a gap", () => {
    const raw = {
      ingredients: [ingredient({ position: 0 }), ingredient({ position: 2 })],
      steps: [],
    };
    expect(errorsOf(raw).ingredients).toBeDefined();
  });

  it("rejects a duplicate", () => {
    const raw = {
      ingredients: [ingredient({ position: 0 }), ingredient({ position: 0 })],
      steps: [],
    };
    expect(errorsOf(raw).ingredients).toBeDefined();
  });

  it("rejects a negative or fractional position", () => {
    expect(errorsOf({ ingredients: [ingredient({ position: -1 })], steps: [] })).toBeDefined();
    expect(errorsOf({ ingredients: [ingredient({ position: 0.5 })], steps: [] })).toBeDefined();
  });

  it("checks the steps too, not just the ingredients", () => {
    // Two lists, one rule. Easy to apply to the first and forget the second.
    const raw = { ingredients: [], steps: [step({ position: 3 })] };
    expect(errorsOf(raw).steps).toMatch(/position/i);
  });

  it("accepts a long dense list", () => {
    const many = Array.from({ length: 30 }, (_, position) => step({ position }));
    expect(valueOf({ ingredients: [], steps: many }).steps).toHaveLength(30);
  });
});

describe("the fields themselves", () => {
  it("requires an ingredient to name something", () => {
    expect(errorsOf({ ingredients: [ingredient({ item: "  " })], steps: [] }).ingredients).toMatch(
      /1/,
    );
  });

  it("requires a step to say something", () => {
    expect(errorsOf({ ingredients: [], steps: [step({ text: "" })] }).steps).toBeDefined();
  });

  it("names the row that is wrong, counting from one", () => {
    // "Ingredient 3" is findable on screen. "index 2" is not.
    const raw = {
      ingredients: [
        ingredient({ position: 0 }),
        ingredient({ position: 1 }),
        ingredient({ position: 2, item: "" }),
      ],
      steps: [],
    };
    expect(errorsOf(raw).ingredients).toMatch(/Ingredient 3/);
  });

  it.each([
    ["item", LIST_LIMITS.ingredient.item],
    ["quantity", LIST_LIMITS.ingredient.quantity],
    ["unit", LIST_LIMITS.ingredient.unit],
    ["note", LIST_LIMITS.ingredient.note],
  ])("bounds an ingredient's %s at the column width", (field, limit) => {
    const raw = { ingredients: [ingredient({ [field]: "a".repeat(limit + 1) })], steps: [] };
    expect(errorsOf(raw).ingredients).toBeDefined();
  });

  it("bounds a step at the column width", () => {
    const raw = { ingredients: [], steps: [step({ text: "a".repeat(LIST_LIMITS.step.text + 1) })] };
    expect(errorsOf(raw).steps).toBeDefined();
  });

  it("refuses a list longer than the cap", () => {
    // A public endpoint with an unbounded array is an invitation. The cap is
    // far above any real recipe and far below anything worth worrying about.
    const many = Array.from({ length: LIST_LIMITS.maxItems + 1 }, (_, position) =>
      step({ position }),
    );
    expect(errorsOf({ ingredients: [], steps: many }).steps).toMatch(/at most/i);
  });
});

describe("input that is not a payload at all", () => {
  it.each([null, undefined, "a string", 42, [], true, {}])("is rejected: %o", (raw) => {
    expect(parseRecipeLists(raw).ok).toBe(false);
  });

  it("rejects a list that is not a list", () => {
    expect(parseRecipeLists({ ingredients: "flour", steps: [] }).ok).toBe(false);
  });

  it("ignores keys it was not asked about", () => {
    // The editor may grow a field before this schema does, and an unknown key
    // must not take the save down.
    const value = valueOf({ ...lists(), extra: "ignored" });
    expect(value.ingredients).toHaveLength(1);
  });
});

describe("parseRecipeListsJson", () => {
  it("decodes and validates in one step", () => {
    const result = parseRecipeListsJson(JSON.stringify(lists()));
    expect(result.ok).toBe(true);
  });

  it.each(["", "{", "not json", "[1,2,3]", "null"])("refuses %o without throwing", (raw) => {
    // `JSON.parse` throws on malformed input, and a Server Action that throws
    // is a 500 rather than a message. This is the layer that has to catch it.
    const result = parseRecipeListsJson(raw);
    expect(result.ok).toBe(false);
  });

  it("refuses a value that is not a string", () => {
    // `formData.get` returns `File | string | null`.
    expect(parseRecipeListsJson(null).ok).toBe(false);
    expect(parseRecipeListsJson(undefined).ok).toBe(false);
  });
});
