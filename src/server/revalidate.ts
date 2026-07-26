import { revalidatePath } from "next/cache";

/**
 * What a write has to tell Next it invalidated.
 *
 * It lives here, in the server layer, rather than beside the actions that call
 * it -- there are two such modules now (the studio's and the recipe pages'),
 * and a `"use server"` file may export nothing but async functions, so a
 * shared helper could not live in either of them if it wanted to.
 *
 * One place that knows which routes are cached is also the point. The answer
 * comes off the build's route table and changes when the routes do; two copies
 * of it would drift, and the failure is silent in both directions.
 */

/**
 * Invalidate every cached route a change to one recipe can make wrong. a change to one recipe can make wrong.
 *
 * **The list is short because the build's route table says which routes are
 * cached, and only those need anything.** `/` is `○ (Static)` -- rendered once,
 * showing the latest three recipes -- and `/tags` is too, with a count beside
 * each tag. `/recipes/<slug>` is `● (SSG)` for what existed at build and cached
 * on first read for everything since. `/recipes` and `/tags/<slug>` are
 * `ƒ (Dynamic)`: they read `searchParams`, they are rendered per request, and
 * revalidating them would be a call that does nothing while looking like
 * insurance.
 *
 * **Several slugs, because a rename has two addresses.** Invalidating only the
 * new one leaves the old URL serving the recipe instead of redirecting to it --
 * database right, redirect right, answer wrong, nothing reporting a problem.
 * That is why `moveCurrentSlug` returns `previous` at all.
 *
 * `/tags` is invalidated on publish and unpublish because its counts move. It
 * is the one line here with no end-to-end test: nothing in the application can
 * yet put a tag on a recipe, so a recipe the suite creates never changes a
 * count. **Phase 18 adds tag filtering and is where that becomes testable.**
 */
export function revalidateRecipe(options: { slugs: (string | null)[]; tags?: boolean }): void {
  revalidatePath("/");
  /*
   * The sitemap is built from what is published, at build time, like every
   * other static route -- so publishing a recipe that never reaches it is the
   * same bug as publishing one that never reaches the front page, with a
   * longer feedback loop: nobody notices until a crawler does not.
   */
  revalidatePath("/sitemap.xml");
  revalidatePath("/feed.xml");
  if (options.tags === true) revalidatePath("/tags");

  for (const slug of new Set(options.slugs.filter((slug) => slug !== null))) {
    revalidatePath(`/recipes/${slug}`);
  }
}
