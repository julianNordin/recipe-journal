import { describe, expect, it } from "vitest";

import { describeMove, listReducer, type ListAction } from "./list-editor";

/**
 * The reducer behind the ingredient and step editor.
 *
 * **Pure, and tested here rather than through the component**, for the reason
 * the whole project is arranged this way: there is no way to unit test an
 * async Server Component, and by the time a reducer is inside a `useReducer`
 * it can only be reached through a browser. Reordering has more edge cases
 * than any other interaction in this application -- both ends, one item, an
 * item that is not there -- and each of those is a 30-millisecond test here
 * and a page load in Playwright.
 *
 * Everything below composes `src/domain/positions.ts`. Nothing in the reducer
 * does index arithmetic of its own.
 */

type Row = { key: string; position: number; text: string };

const row = (key: string, position: number, text = key): Row => ({ key, position, text });

/** Three rows, correctly numbered. */
const three = (): Row[] => [row("a", 0), row("b", 1), row("c", 2)];

const apply = (items: readonly Row[], ...actions: ListAction<Row>[]): Row[] =>
  actions.reduce<Row[]>((current, action) => listReducer(current, action), [...items]);

const order = (items: readonly Row[]) => items.map((item) => item.key);
const positions = (items: readonly Row[]) => items.map((item) => item.position);

describe("append", () => {
  it("puts the new row last and numbers it", () => {
    const result = apply(three(), { type: "append", item: row("d", 99) });

    // The caller's position is ignored: a new row goes on the end, and the
    // list decides what number that is.
    expect(order(result)).toEqual(["a", "b", "c", "d"]);
    expect(positions(result)).toEqual([0, 1, 2, 3]);
  });

  it("works on an empty list", () => {
    const result = apply([], { type: "append", item: row("a", 7) });

    expect(positions(result)).toEqual([0]);
  });
});

describe("update", () => {
  it("patches the row with that key and leaves the rest alone", () => {
    const result = apply(three(), { type: "update", key: "b", patch: { text: "changed" } });

    expect(result.map((r) => r.text)).toEqual(["a", "changed", "c"]);
    expect(positions(result)).toEqual([0, 1, 2]);
  });

  it("ignores a key that is not in the list", () => {
    // A keystroke arriving for a row that was just removed. Dropping it beats
    // throwing inside an onChange handler.
    expect(apply(three(), { type: "update", key: "zz", patch: { text: "x" } })).toEqual(three());
  });

  it("cannot be used to change the position", () => {
    /*
     * `patch` is `Partial<T>` and `T` has a `position`, so this compiles. It
     * must not take effect: positions are the reducer's to assign, and a patch
     * that could set one would be a second way to reorder that skips every
     * rule in positions.ts.
     */
    const result = apply(three(), { type: "update", key: "a", patch: { position: 5 } });

    expect(positions(result)).toEqual([0, 1, 2]);
  });
});

describe("remove", () => {
  it("closes the gap it leaves", () => {
    const result = apply(three(), { type: "remove", key: "b" });

    expect(order(result)).toEqual(["a", "c"]);
    expect(positions(result)).toEqual([0, 1]);
  });

  it("can empty the list", () => {
    const result = apply(
      three(),
      { type: "remove", key: "a" },
      { type: "remove", key: "b" },
      {
        type: "remove",
        key: "c",
      },
    );

    expect(result).toEqual([]);
  });

  it("ignores a key that is not in the list", () => {
    expect(apply(three(), { type: "remove", key: "zz" })).toEqual(three());
  });
});

describe("move", () => {
  it("moves a row up", () => {
    expect(order(apply(three(), { type: "move", key: "c", delta: -1 }))).toEqual(["a", "c", "b"]);
  });

  it("moves a row down", () => {
    expect(order(apply(three(), { type: "move", key: "a", delta: 1 }))).toEqual(["b", "a", "c"]);
  });

  it("renumbers as it goes", () => {
    const result = apply(three(), { type: "move", key: "c", delta: -2 });

    expect(order(result)).toEqual(["c", "a", "b"]);
    expect(positions(result)).toEqual([0, 1, 2]);
  });

  it("is a no-op at the top", () => {
    /*
     * **The reason the keyboard handler needs no bounds guard.** `moveBy`
     * clamps, so "up" on the first row is an answer rather than an error, and
     * the button can stay enabled and keep announcing where the row is.
     */
    expect(apply(three(), { type: "move", key: "a", delta: -1 })).toEqual(three());
  });

  it("is a no-op at the bottom", () => {
    expect(apply(three(), { type: "move", key: "c", delta: 1 })).toEqual(three());
  });

  it("stops at the end rather than wrapping", () => {
    expect(order(apply(three(), { type: "move", key: "a", delta: 99 }))).toEqual(["b", "c", "a"]);
  });

  it("ignores a key that is not in the list", () => {
    expect(apply(three(), { type: "move", key: "zz", delta: 1 })).toEqual(three());
  });

  it("is reversible", () => {
    // Down then up puts everything back, which is what a person pressing the
    // wrong arrow expects and the cheapest possible undo.
    const result = apply(
      three(),
      { type: "move", key: "a", delta: 1 },
      {
        type: "move",
        key: "a",
        delta: -1,
      },
    );

    expect(result).toEqual(three());
  });
});

describe("a list that arrives out of order", () => {
  it("is sorted by position before anything else happens", () => {
    /*
     * Rows come back from the database in whatever order the query returned,
     * and the deferrable constraints mean a read mid-transaction can even see
     * two rows sharing a position. The reducer works in array order, so the
     * list has to be put in position order before it is touched.
     */
    const scrambled = [row("c", 2), row("a", 0), row("b", 1)];

    const result = apply(scrambled, { type: "move", key: "a", delta: 1 });

    expect(order(result)).toEqual(["b", "a", "c"]);
  });
});

describe("what the reducer never does", () => {
  it("does not mutate the list it was given", () => {
    const original = three();
    const copy = three();

    listReducer(original, { type: "move", key: "a", delta: 1 });
    listReducer(original, { type: "remove", key: "a" });

    // React compares by reference. A reducer that edited in place would render
    // once and then stop, which is a bug that looks like a broken button.
    expect(original).toEqual(copy);
  });

  it("leaves the list dense after any sequence of actions", () => {
    const result = apply(
      three(),
      { type: "append", item: row("d", 0) },
      { type: "move", key: "d", delta: -2 },
      { type: "remove", key: "a" },
      { type: "append", item: row("e", 0) },
      { type: "move", key: "e", delta: -99 },
      { type: "remove", key: "zz" },
    );

    // The invariant the database enforces at COMMIT, held at every step so no
    // save can ever be refused for it.
    expect(positions(result)).toEqual([...result.keys()]);
  });
});

describe("describeMove", () => {
  const moved = (key: string, delta: number) => {
    const before = three();
    return { before, after: apply(before, { type: "move", key, delta }) };
  };

  it("says where the row ended up", () => {
    const { before, after } = moved("a", 1);
    expect(describeMove(before, after, "a", "Flour")).toBe("Moved Flour to position 2 of 3.");
  });

  it("says so when nothing moved, rather than nothing", () => {
    /*
     * The buttons stay enabled at both ends -- disabling one takes the focus
     * with it -- so this is a real interaction with no visible result. Silence
     * here reads as a broken button to anyone not looking at the screen.
     */
    const { before, after } = moved("a", -1);
    expect(describeMove(before, after, "a", "Flour")).toBe("Flour is already first.");
  });

  it("knows which end it is at", () => {
    const { before, after } = moved("c", 1);
    expect(describeMove(before, after, "c", "Salt")).toBe("Salt is already last.");
  });

  it("does not call a lone row first", () => {
    // It is also last, so neither word is the useful one.
    const before = [row("a", 0)];
    const after = apply(before, { type: "move", key: "a", delta: -1 });
    expect(describeMove(before, after, "a", "Flour")).toBe("Flour is the only one.");
  });

  it("has nothing to say about a row that is not there", () => {
    expect(describeMove(three(), three(), "zz", "Ghost")).toBe("");
  });
});
