import { moveBy, removeAt, renumber, sortByPosition, type Positioned } from "./positions";

/**
 * The reducer behind the ingredient and step editor.
 *
 * **Pure, and in the domain layer, because that is the only way it gets
 * tested.** Reordering has more edge cases than anything else in this
 * application -- both ends, a single row, a key that is no longer there -- and
 * inside a `useReducer` every one of them costs a browser. Here they cost a
 * millisecond each, and the component that uses this is thin enough for
 * Playwright to cover by walking through it once.
 *
 * **Everything is addressed by `key`, never by index.** An index read from a
 * closure is stale the moment the list reorders, which is exactly what this
 * reducer spends its time doing -- and it is the classic way a "move up"
 * button starts moving the wrong row after the second press. The key also
 * gives React a stable identity across reorders, so an input keeps its
 * selection when its row moves.
 *
 * All the ordering itself is `src/domain/positions.ts`. Nothing here does
 * index arithmetic of its own, which is why "up on the first row" needs no
 * guard: `moveBy` clamps, so it is a no-op rather than an error.
 */

/** Anything the editor holds: a stable identity plus a position. */
export type Keyed = { key: string };

export type ListAction<T extends Keyed & Positioned> =
  /** Add a row at the end. Its `position` is assigned here, not by the caller. */
  | { type: "append"; item: T }
  /** Change one row's fields. Its position is not among them. */
  | { type: "update"; key: string; patch: Partial<T> }
  | { type: "remove"; key: string }
  /** Nudge a row `delta` places, stopping at either end. */
  | { type: "move"; key: string; delta: number };

export function listReducer<T extends Keyed & Positioned>(
  items: readonly T[],
  action: ListAction<T>,
): T[] {
  /*
   * Position order first, every time.
   *
   * Rows arrive from the database in whatever order the query gave them, and
   * this reducer works in array order -- so a list that has not been sorted
   * would reorder itself the first time anything moved. Cheap, and it makes
   * every action below independent of how the caller happened to hold the
   * list.
   */
  const current = sortByPosition(items);
  const index = "key" in action ? current.findIndex((item) => item.key === action.key) : -1;

  switch (action.type) {
    case "append":
      return renumber([...current, action.item]);

    case "update": {
      if (index === -1) return current;
      return current.map((item) =>
        item.key === action.key
          ? // `position` is stripped out of the patch, not trusted to be
            // absent. `Partial<T>` permits it, and a patch that could set one
            // would be a second way to reorder that skips every rule in
            // positions.ts.
            { ...item, ...action.patch, position: item.position }
          : item,
      );
    }

    case "remove":
      return index === -1 ? current : removeAt(current, index);

    case "move":
      return index === -1 ? current : moveBy(current, index, action.delta);
  }
}

/**
 * What to announce after a move.
 *
 * **A move that changed nothing still has to say something.** The buttons stay
 * enabled at both ends -- disabling one takes the focus with it, so pressing
 * "up" repeatedly would dump the reader on the body the moment the row arrived
 * first -- which means "up" on the first row is a real interaction with no
 * visible result. Silence there reads as a broken button to anyone not looking
 * at the screen.
 *
 * Positions are announced from one, because that is what the row is labelled
 * with.
 */
export function describeMove<T extends Keyed & Positioned>(
  before: readonly T[],
  after: readonly T[],
  key: string,
  label: string,
): string {
  const from = before.findIndex((item) => item.key === key);
  const to = after.findIndex((item) => item.key === key);
  if (from === -1 || to === -1) return "";

  if (from === to) {
    if (after.length === 1) return `${label} is the only one.`;
    return `${label} is already ${from === 0 ? "first" : "last"}.`;
  }

  return `Moved ${label} to position ${String(to + 1)} of ${String(after.length)}.`;
}
