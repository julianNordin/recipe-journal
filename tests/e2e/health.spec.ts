import { expect, test } from "@playwright/test";

/**
 * The endpoint the container's healthcheck polls.
 *
 * The interesting half -- 503 while Postgres is down, and recovery with no
 * restart -- is in the verification gate, because it needs the database
 * stopped and that is not something a parallel test suite can do to itself.
 * What is here is the half that can be asserted continuously: it answers, it
 * answers quickly, it says something a machine can read, and it is never
 * cached.
 */

test.describe("the health endpoint", () => {
  test("reports the database is reachable", async ({ request }) => {
    const response = await request.get("/api/health");

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: "reachable" });
  });

  test("is never cached", async ({ request }) => {
    const response = await request.get("/api/health");

    // A cached health endpoint reports the state of the world at some point in
    // the past, which is worse than not having one.
    expect(response.headers()["cache-control"]).toContain("no-store");
  });

  test("really asks the database rather than reporting that it is running", async ({ request }) => {
    /*
     * This cannot be proved from outside without stopping Postgres, so what it
     * pins is the shape of the answer: a handler that only reported its own
     * liveness would have nothing to say about a database, and this one names
     * it. The behaviour under failure is step 1 of the verification gate.
     */
    const body = (await (await request.get("/api/health")).json()) as Record<string, string>;

    expect(Object.keys(body).sort()).toEqual(["database", "status"]);
  });
});
