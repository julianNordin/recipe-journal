/**
 * Validating a redirect target that came from a query string.
 *
 * Pure, and in the domain layer because it is a rule rather than a page: the
 * sign-in page uses it now, and Phase 11's `proxy.ts` builds the
 * `?callbackUrl=` it will later read back.
 *
 * **The vulnerability this closes is an open redirect**, and a sign-in page is
 * the worst place to have one. The victim follows a link to the real site,
 * sees the real domain, signs in for real -- and is then handed to wherever
 * the query string said. Every signal a careful person checks is genuine right
 * up to the moment they are somewhere else.
 *
 * The rule is deliberately a whitelist: a single leading slash, then nothing
 * that could make a browser read the rest as a host or a scheme. Trying to
 * enumerate bad inputs instead ends up chasing `//`, `/\`, `/\/`, tabs,
 * newlines and whatever the next parser quirk turns out to be.
 */

const SPACE = 0x20;
const DEL = 0x7f;

/**
 * Any control character, space, or DEL.
 *
 * A loop over code points rather than a regular expression, because the regex
 * spelling of this class wants literal NUL and DEL bytes in the source. They
 * render as nothing, so the class reads as an empty-looking range that no
 * reviewer can check and no editor will show -- and a byte lost to a
 * copy-paste would be silent. This says what it means in plain ASCII, and
 * needs no lint suppression to do it.
 */
function hasControlOrSpace(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= SPACE || code === DEL) return true;
  }
  return false;
}

export function safeRedirectPath(raw: string | string[] | undefined, fallback: string): string {
  // A repeated query parameter arrives as an array. The first value is the one
  // considered -- picking whichever one passes would let an attacker append a
  // harmless second value to smuggle the first past a careless reader.
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (value === undefined || value === "") return fallback;

  // No spaces, tabs, newlines or other control characters anywhere. Besides
  // the parser tricks, a newline in a redirect target has historically meant
  // an attacker-chosen extra response header.
  if (hasControlOrSpace(value)) return fallback;

  // Must be a path on this site: one leading slash, and the next character
  // must not turn it into an authority. "//host" is protocol-relative; "/\"
  // and "/\/" are read the same way by some browsers.
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;

  return value;
}
