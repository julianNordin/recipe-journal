/**
 * How a date is written everywhere in this application.
 *
 * Extracted when a third caller appeared, and the third caller is not the
 * reason it is worth having. **`timeZone: "UTC"` is.** A server component
 * formats on the server and React re-renders on the client, in a browser whose
 * time zone is somebody else's. Without a fixed zone, an instant late enough
 * in the day formats as two different dates in the two places, and React
 * reports the difference as a hydration mismatch -- on a project whose entire
 * claim is that the server rendered the page.
 *
 * Pure, so the zone handling is a test rather than a comment.
 *
 * Deliberately absolute rather than relative. "2 days ago" reads better and
 * needs a clock, which makes it non-deterministic to test, wrong the moment
 * the page is cached, and a hydration mismatch of its own.
 */
const DAY_FORMAT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
};

/**
 * The long form, for a page with room for it.
 *
 * The month width is the only difference, and it is a presentation choice per
 * surface -- a card in a grid wants "Jul", a recipe's byline wants "July".
 * What is *not* a per-surface choice is the zone and the locale, which is the
 * reason both live here instead of being spelled out where they are used.
 */
const LONG_DAY_FORMAT: Intl.DateTimeFormatOptions = { ...DAY_FORMAT, month: "long" };

/** A date as "14 Jul 2026". */
export function formatDay(date: Date): string {
  return date.toLocaleDateString("en-GB", DAY_FORMAT);
}

/** A date as "14 July 2026". */
export function formatLongDay(date: Date): string {
  return date.toLocaleDateString("en-GB", LONG_DAY_FORMAT);
}
