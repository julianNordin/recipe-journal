/**
 * Running a query that may have no database to talk to.
 *
 * **This exists for one moment: `next build` inside a container image, where
 * Postgres is not running and never will be.** Several routes read the
 * database while being prerendered -- the front page, the tag index, the
 * sitemap, and `generateStaticParams` for every recipe -- so without this the
 * image cannot be built at all without standing a database up beside the
 * builder, which is a strange thing to require of `docker build`.
 *
 * **It must never be used to make a runtime failure quiet.** A request that
 * cannot reach the database should fail loudly: that is a 500 somebody needs
 * to see, and `/api/health` reports it as a 503 so an orchestrator can act.
 * The distinction is that a build has no user waiting and no request to
 * answer, so falling back to "nothing yet" costs a stale page that the first
 * revalidation replaces -- and every one of these routes is revalidated by the
 * actions that change it.
 *
 * Narrow on purpose: it catches everything, so it goes only where an empty
 * answer is genuinely the right answer for a build.
 */
export async function orEmptyDuringBuild<T>(query: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await query();
  } catch (error) {
    // Said out loud in the build log. A silent fallback here would mean an
    // image that builds happily and serves an empty site, with nothing
    // anywhere explaining why.
    console.warn(
      "[build] the database was unreachable; rendering an empty result.",
      error instanceof Error ? error.message : error,
    );

    return fallback;
  }
}
