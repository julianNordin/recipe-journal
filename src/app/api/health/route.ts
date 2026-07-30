import { db } from "@/server/db";

/**
 * `GET /api/health` -- what the container's healthcheck polls.
 *
 * **It asks the database a question rather than reporting that this process is
 * running.** A handler that returned `{ ok: true }` unconditionally answers
 * "the web server accepted a connection", which the orchestrator already knew
 * by connecting -- and it stays green while every page returns a 500 because
 * the pool is exhausted or Postgres is down. The cheapest query that proves a
 * round trip is the honest one.
 *
 * `SELECT 1` rather than counting a table: it needs no rows, no indexes and no
 * permissions beyond connecting, so it fails only when the thing being tested
 * has failed.
 *
 * **503, not 500.** The difference is what a load balancer does with it: 503
 * with `Retry-After` says "not now, ask again", and this is a condition that
 * recovers on its own the moment the database comes back. There is no restart
 * to trigger, and a healthcheck that provokes one turns a thirty-second
 * database blip into a restart loop.
 *
 * Route handlers are dynamic by default, so nothing here is cached -- which is
 * the one thing a health endpoint must never be.
 */
export async function GET(): Promise<Response> {
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    /*
     * The error itself is deliberately not returned. A health endpoint is
     * reachable by anyone who can reach the site, and a Postgres error names
     * the host, the database and often the user.
     */
    return Response.json(
      { status: "unavailable", database: "unreachable" },
      { status: 503, headers: { "retry-after": "5", "cache-control": "no-store" } },
    );
  }

  return Response.json(
    { status: "ok", database: "reachable" },
    { headers: { "cache-control": "no-store" } },
  );
}
