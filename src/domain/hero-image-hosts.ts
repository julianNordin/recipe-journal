/**
 * The hosts a hero image may be loaded from.
 *
 * **Its own module, with no imports, because `next.config.ts` reads it too.**
 * The config is compiled and evaluated on its own, outside the application's
 * module graph and before any path alias exists, so anything it imports has to
 * be reachable relatively and cheap to load. Keeping this list free of even a
 * Zod import is what lets one array configure `images.remotePatterns` and
 * validate the form.
 *
 * **Why there is a list at all.** `next/image` fetches and re-encodes whatever
 * URL it is given, on this server. `remotePatterns: [{ hostname: "**" }]` --
 * which is what "accept any image URL" turns into -- makes the image optimiser
 * an open proxy: anyone can hand it any address and have this server fetch it,
 * cache it and serve it back under this origin. The project deliberately has
 * no upload pipeline, so a URL field is the whole feature; an allowlist is
 * what makes that a feature rather than a hole.
 *
 * Two hosts rather than one, so the shape is a list and the next addition is
 * an edit rather than a redesign.
 */
export const HERO_IMAGE_HOSTS = ["images.unsplash.com", "upload.wikimedia.org"] as const;

export type HeroImageHost = (typeof HERO_IMAGE_HOSTS)[number];

/**
 * Whether a URL may be used as a hero image.
 *
 * Host **equality**, never `endsWith` or `includes`: `images.unsplash.com.evil.test`
 * contains an allowed host and is not one. Parsing rather than matching, so
 * `https://images.unsplash.com@evil.test/x` -- which reads as the allowed host
 * and resolves to the other one -- is judged on the host the browser would
 * actually connect to.
 */
export function isAllowedHeroImageUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  // https only. A hero image on http would be mixed content, and the scheme
  // check also disposes of `javascript:` and `data:` without naming them.
  if (url.protocol !== "https:") return false;

  return (HERO_IMAGE_HOSTS as readonly string[]).includes(url.hostname);
}
