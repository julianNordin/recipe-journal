/**
 * Slug generation.
 *
 * Pure: no database, no clock, no I/O. Collision handling is expressed as a
 * function of the slugs already taken, which the caller supplies -- that keeps
 * the interesting logic testable without a database and leaves the query in
 * the layer that owns queries.
 */

const MAX_SLUG_LENGTH = 120;

/**
 * Characters that look like letters to a person and are not ASCII. Normalising
 * to NFD and stripping combining marks turns "Crème Brûlée" into
 * "creme-brulee" rather than "cr-me-br-l-e", which is the difference between a
 * readable URL and a broken one.
 */
function stripDiacritics(input: string): string {
  return input.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Swedish and German letters that NFD does not decompose into a base letter. */
const TRANSLITERATIONS: Record<string, string> = {
  ß: "ss",
  æ: "ae",
  ø: "o",
  œ: "oe",
  đ: "d",
  ð: "d",
  þ: "th",
  ł: "l",
};

export function slugify(input: string): string {
  const transliterated = [...input.toLowerCase()].map((ch) => TRANSLITERATIONS[ch] ?? ch).join("");

  return stripDiacritics(transliterated)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
}

/**
 * A slug that is not already taken.
 *
 * Suffixes with -2, -3, ... rather than a random string or a timestamp: the
 * result stays readable and is stable for a given set of existing slugs, which
 * makes it testable and makes two authors publishing the same title produce
 * predictable URLs.
 *
 * `taken` is supplied by the caller. A recipe renaming to a slug it already
 * owns should pass its own slugs in as available, which is why this takes a
 * set rather than reaching for a query.
 */
export function uniqueSlug(input: string, taken: Iterable<string>): string {
  const base = slugify(input) || "recipe";
  const used = new Set(taken);

  if (!used.has(base)) return base;

  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    // Keep the whole thing inside the column width even after suffixing.
    const trimmed = base.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/g, "");
    const candidate = `${trimmed}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}
