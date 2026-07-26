import { env } from "@/env";

/**
 * The origin this site is served from, in one place.
 *
 * **Derived from `NEXTAUTH_URL` rather than given a variable of its own**, and
 * that is a decision rather than an oversight. It is already required, already
 * validated as an absolute URL, and already has to be the address a browser
 * reaches this application at -- NextAuth builds its callbacks from it, so a
 * wrong value breaks sign-in long before it breaks a sitemap. A second
 * variable would be a second thing to get wrong, defaulting to the first,
 * silently disagreeing with it the day somebody set only one.
 *
 * The two would separate behind a proxy that terminates on a different host
 * than it advertises. If that ever happens this is the one line to change, and
 * the README says so.
 *
 * Trailing slash stripped, so callers can write `${SITE_ORIGIN}/recipes`
 * without thinking about it.
 */
export const SITE_ORIGIN = env.NEXTAUTH_URL.replace(/\/+$/, "");

/** An absolute URL for a path on this site. */
export const siteUrl = (path: string): string =>
  `${SITE_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
