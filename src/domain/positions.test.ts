import { describe, expect, it } from "vitest";

import {
  isDense,
  move,
  moveBy,
  removeAt,
  renumber,
  sortByPosition,
  type Positioned,
} from "./positions";

type Step = Positioned & { id: string; text: string };

/** `list("a", "b")` -- two steps already numbered 0, 1. */
function list(...ids: string[]): Step[] {
  return ids.map((id, position) => ({ id, position, text: `step ${id}` }));
}

const ids = (items: readonly Step[]): string[] => items.map((item) => item.id);
const positions = (items: readonly Positioned[]): number[] => items.map((item) => item.position);

describe("renumber", () => {
  it("leaves an empty list empty", () => {
    expect(renumber([])).toEqual([]);
  });

  it("numbers a list 0..n-1 in array order", () => {
    expect(positions(renumber(list("a", "b", "c")))).toEqual([0, 1, 2]);
  });

  it("closes gaps left by a deletion", () => {
    const sparse: Step[] = [
      { id: "a", position: 0, text: "" },
      { id: "b", position: 5, text: "" },
      { id: "c", position: 9, text: "" },
    ];
    expect(positions(renumber(sparse))).toEqual([0, 1, 2]);
  });

  it("trusts array order over the stored position", () => {
    // The load-bearing decision: `move` splices the array and hands the result
    // here, so re-sorting by the *old* positions would make every reorder a
    // no-op. Turning rows into display order is `sortByPosition`'s job, and it
    // is a separate, explicit call for exactly this reason.
    const reversed: Step[] = [
      { id: "c", position: 2, text: "" },
      { id: "b", position: 1, text: "" },
      { id: "a", position: 0, text: "" },
    ];
    const result = renumber(reversed);
    expect(ids(result)).toEqual(["c", "b", "a"]);
    expect(positions(result)).toEqual([0, 1, 2]);
  });

  it("keeps every other field", () => {
    const [first] = renumber(list("a"));
    expect(first).toEqual({ id: "a", position: 0, text: "step a" });
  });

  it("does not mutate its input", () => {
    const input = list("a", "b", "c").reverse();
    const before = positions(input);
    renumber(input);
    expect(positions(input)).toEqual(before);
  });
});

describe("sortByPosition", () => {
  it("puts rows into display order", () => {
    const rows: Step[] = [
      { id: "c", position: 2, text: "" },
      { id: "a", position: 0, text: "" },
      { id: "b", position: 1, text: "" },
    ];
    expect(ids(sortByPosition(rows))).toEqual(["a", "b", "c"]);
  });

  it("is stable when two rows share a position", () => {
    // Not hypothetical: the position constraints are DEFERRABLE INITIALLY
    // DEFERRED, so a read inside a reordering transaction can legitimately see
    // a duplicate before COMMIT. A stable sort keeps that read deterministic
    // instead of scrambling the list.
    const rows: Step[] = [
      { id: "first", position: 1, text: "" },
      { id: "second", position: 1, text: "" },
      { id: "zero", position: 0, text: "" },
    ];
    expect(ids(sortByPosition(rows))).toEqual(["zero", "first", "second"]);
  });

  it("does not mutate its input", () => {
    const rows = list("a", "b", "c").reverse();
    sortByPosition(rows);
    expect(ids(rows)).toEqual(["c", "b", "a"]);
  });
});

describe("move", () => {
  it("moves an item down the list", () => {
    expect(ids(move(list("a", "b", "c", "d"), 0, 2))).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item up the list", () => {
    expect(ids(move(list("a", "b", "c", "d"), 3, 1))).toEqual(["a", "d", "b", "c"]);
  });

  it("lands the item on the index it was asked for", () => {
    const result = move(list("a", "b", "c", "d"), 0, 2);
    expect(result[2]?.id).toBe("a");
    expect(result[2]?.position).toBe(2);
  });

  it("renumbers even when the order does not change", () => {
    const sparse: Step[] = [
      { id: "a", position: 3, text: "" },
      { id: "b", position: 7, text: "" },
    ];
    expect(positions(move(sparse, 0, 0))).toEqual([0, 1]);
  });

  it("clamps a target past the end", () => {
    expect(ids(move(list("a", "b", "c"), 0, 99))).toEqual(["b", "c", "a"]);
  });

  it("clamps a negative target", () => {
    expect(ids(move(list("a", "b", "c"), 2, -5))).toEqual(["c", "a", "b"]);
  });

  it("ignores a source index that holds no item", () => {
    // `to` clamps because "as far as it will go" is a real answer -- it is what
    // makes moveBy at either end a no-op without a guard at the call site.
    // `from` does not, because there is no item there to move; clamping it
    // would silently move the wrong one. A renumbered no-op keeps the editor
    // alive on a bad index instead of throwing mid-drag.
    expect(ids(move(list("a", "b", "c"), 9, 0))).toEqual(["a", "b", "c"]);
    expect(ids(move(list("a", "b", "c"), -1, 0))).toEqual(["a", "b", "c"]);
  });

  it("copes with an empty list", () => {
    expect(move([], 0, 0)).toEqual([]);
  });

  it("does not mutate its input", () => {
    const input = list("a", "b", "c");
    move(input, 0, 2);
    expect(ids(input)).toEqual(["a", "b", "c"]);
  });

  it("always yields a dense 0-based permutation, for every from/to pair", () => {
    // The invariant Phase 13's editor posts and Phase 06's deferrable
    // constraint accepts. Six items is the reorder case the constraint test
    // uses, and every pair is only 36 combinations -- cheap enough to be
    // exhaustive rather than illustrative.
    const input = list("a", "b", "c", "d", "e", "f");

    for (let from = 0; from < input.length; from += 1) {
      for (let to = 0; to < input.length; to += 1) {
        const result = move(input, from, to);
        expect(isDense(result), `move(${from}, ${to}) was not dense`).toBe(true);
        expect(ids(result).slice().sort(), `move(${from}, ${to}) lost an item`).toEqual(
          ids(input).slice().sort(),
        );
      }
    }
  });
});

describe("moveBy", () => {
  it("moves one step up", () => {
    expect(ids(moveBy(list("a", "b", "c"), 2, -1))).toEqual(["a", "c", "b"]);
  });

  it("moves one step down", () => {
    expect(ids(moveBy(list("a", "b", "c"), 0, 1))).toEqual(["b", "a", "c"]);
  });

  it("is a no-op at either end", () => {
    // Keyboard reordering leans on this: the handler for the up key does not
    // need to know whether it is already at the top.
    expect(ids(moveBy(list("a", "b", "c"), 0, -1))).toEqual(["a", "b", "c"]);
    expect(ids(moveBy(list("a", "b", "c"), 2, 1))).toEqual(["a", "b", "c"]);
  });
});

describe("removeAt", () => {
  it("removes the item and closes the hole", () => {
    const result = removeAt(list("a", "b", "c"), 1);
    expect(ids(result)).toEqual(["a", "c"]);
    expect(positions(result)).toEqual([0, 1]);
  });

  it("leaves the list alone on an index that holds no item", () => {
    expect(ids(removeAt(list("a", "b"), 7))).toEqual(["a", "b"]);
  });

  it("empties a single-item list", () => {
    expect(removeAt(list("a"), 0)).toEqual([]);
  });
});

describe("isDense", () => {
  it("accepts 0..n-1", () => {
    expect(isDense(list("a", "b", "c"))).toBe(true);
  });

  it("accepts an empty list", () => {
    expect(isDense([])).toBe(true);
  });

  it("rejects a gap", () => {
    expect(isDense([{ position: 0 }, { position: 2 }])).toBe(false);
  });

  it("rejects a duplicate", () => {
    expect(isDense([{ position: 0 }, { position: 0 }])).toBe(false);
  });

  it("rejects a list that does not start at zero", () => {
    expect(isDense([{ position: 1 }, { position: 2 }])).toBe(false);
  });

  it("does not care what order the list is in", () => {
    // It is a statement about the set of positions, not about array order --
    // the server action validating an incoming payload has no display order to
    // compare against.
    expect(isDense([{ position: 2 }, { position: 0 }, { position: 1 }])).toBe(true);
  });
});
