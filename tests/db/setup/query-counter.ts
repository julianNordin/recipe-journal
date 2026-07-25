import type { PrismaClient } from "@/generated/prisma/client";

/**
 * A Prisma client that counts the queries run through it.
 *
 * **The instrument the N+1 test needs, and it lives in the test tier on
 * purpose.** Counting queries in production would be observability -- a
 * different job, with different requirements, and not something to bolt on to
 * make an assertion possible. What ships is the fixed query; what measures it
 * is here.
 *
 * A `$extends` query extension rather than the `query` log event: the event is
 * asynchronous and arrives whenever the driver gets round to it, so a test
 * reading the count straight after an `await` would race it. The extension
 * runs inline, in the same call.
 *
 * `$allOperations` on `$allModels` sees one call per Prisma operation, which
 * is the number that matters here. It is not the same as one SQL statement --
 * a `findMany` with nested relations is one operation and several statements,
 * and a `$transaction` is several operations -- so the count is "how many times
 * did the application ask the database something", which is exactly the
 * quantity an N+1 is about.
 */
export type QueryCounter = {
  /** Use this in place of the client under test. */
  client: PrismaClient;
  /** Operations since the last `reset()`. */
  count: () => number;
  reset: () => void;
};

export function countingClient(base: PrismaClient): QueryCounter {
  let seen = 0;

  const extended = base.$extends({
    query: {
      $allModels: {
        $allOperations({ args, query }) {
          seen += 1;
          return query(args);
        },
      },
    },
  });

  return {
    /*
     * `$extends` returns a client without `$extends`, `$on` and friends, so it
     * is not a `PrismaClient` by type even though every model method on it is
     * identical. The query functions under test take a `PrismaClient` and use
     * only model methods, so the assertion is narrow and true -- and it is a
     * test helper, where the cost of being wrong is a failing test rather than
     * a broken page.
     */
    client: extended as unknown as PrismaClient,
    count: () => seen,
    reset: () => {
      seen = 0;
    },
  };
}
