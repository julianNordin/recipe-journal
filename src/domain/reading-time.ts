/**
 * How long a recipe body takes to read.
 *
 * Pure, and the smallest module in the domain layer -- but it belongs here
 * rather than in a component for the same reason as the rest: a rule written
 * inside an async server component can only be reached through a browser.
 */

import { toPlainText } from "./markdown";

/**
 * The conventional estimate for adult silent reading of prose. Deliberately at
 * the cautious end of the usual 200-265 range: overstating the time costs a
 * reader nothing, understating it makes the badge a small lie.
 *
 * Exported because it is the number the tests are written against -- an
 * assertion that 200 words reads in a minute should fail if someone retunes
 * the rate, not silently follow it.
 */
export const WORDS_PER_MINUTE = 200;

export type ReadingTime = {
  words: number;
  minutes: number;
};

/**
 * Takes markdown, not plain text, so no caller has to remember to strip it
 * first. Counting the source would charge the reader for every `**` and every
 * URL.
 *
 * An empty body is zero minutes rather than one. Rounding up is right for
 * anything with words in it, but a blank page is not a minute's reading, and
 * returning zero lets the caller decide to show no badge at all.
 */
export function readingTime(markdown: string): ReadingTime {
  const text = toPlainText(markdown);
  // toPlainText collapses runs of whitespace and trims, so a plain split is
  // enough -- but "" splits into one empty string, not none.
  const words = text === "" ? 0 : text.split(" ").length;

  return { words, minutes: Math.ceil(words / WORDS_PER_MINUTE) };
}
