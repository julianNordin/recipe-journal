/**
 * Ordering for the two lists a recipe owns: its ingredients and its steps.
 *
 * Pure. No database, no Prisma types, no clock.
 *
 * The contract with the rest of the stack is one number: **positions are
 * always dense, 0-based and unique within a recipe**. The editor posts a list
 * numbered that way, the command layer writes it, and the database's
 * `DEFERRABLE INITIALLY DEFERRED` unique constraints check it at COMMIT --
 * which is what lets a reorder pass through an intermediate state where two
 * rows briefly share a position. Every function here returns a list satisfying
 * that contract, so no caller has to remember to renumber.
 */

export type Positioned = { position: number };

const clamp = (value: number, max: number): number => Math.min(Math.max(value, 0), max);

/**
 * Number a list 0..n-1 following **array order**, discarding whatever the
 * items claimed before.
 *
 * Array order is the input, deliberately. `move` splices the array and hands
 * the result here, so a version that re-sorted by the incoming `position`
 * values would quietly undo every reorder. Turning database rows into display
 * order is a different job with a different name -- see `sortByPosition`.
 */
export function renumber<T extends Positioned>(items: readonly T[]): T[] {
  return items.map((item, position) => ({ ...item, position }));
}

/**
 * Rows into display order.
 *
 * Stable, and that matters: the position constraints are deferred to COMMIT,
 * so a read inside a reordering transaction can legitimately see two rows
 * sharing a position. A stable sort makes that read deterministic rather than
 * scrambling the list.
 */
export function sortByPosition<T extends Positioned>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.position - b.position);
}

/**
 * Move the item at `from` so that it lands at index `to`, and renumber.
 *
 * `to` is clamped to the list: "as far as it will go" is a real answer, and it
 * is what makes `moveBy` a no-op at either end without a guard at the call
 * site. `from` is not clamped -- there is no item at an out-of-range index, and
 * clamping would silently move the wrong one. An index that holds nothing
 * leaves the order alone, because throwing would take the editor down
 * mid-drag over what is only ever a bug in the caller.
 */
export function move<T extends Positioned>(items: readonly T[], from: number, to: number): T[] {
  const moved = items[from];
  if (moved === undefined) return renumber(items);

  const rest = [...items.slice(0, from), ...items.slice(from + 1)];
  const target = clamp(to, rest.length);

  return renumber([...rest.slice(0, target), moved, ...rest.slice(target)]);
}

/** Nudge an item `delta` places, stopping at the ends. Keyboard reordering. */
export function moveBy<T extends Positioned>(
  items: readonly T[],
  index: number,
  delta: number,
): T[] {
  return move(items, index, index + delta);
}

/** Drop the item at `index` and close the hole it leaves. */
export function removeAt<T extends Positioned>(items: readonly T[], index: number): T[] {
  if (items[index] === undefined) return renumber(items);
  return renumber([...items.slice(0, index), ...items.slice(index + 1)]);
}

/**
 * Whether a list satisfies the contract: positions are exactly 0..n-1, with no
 * gap and no duplicate.
 *
 * A statement about the *set* of positions, not about array order -- a server
 * action validating an incoming payload has no display order to compare it
 * against, and the constraint the database enforces does not care either.
 */
export function isDense(items: readonly Positioned[]): boolean {
  const seen = new Set(items.map((item) => item.position));
  if (seen.size !== items.length) return false;

  return (
    items.every((item) => Number.isInteger(item.position)) &&
    [...seen].every((position) => position >= 0 && position < items.length)
  );
}
