import { describe, expect, it } from "vitest";

import { parseEnv } from "@/env.schema";

import { oauthProviders } from "./providers";

/**
 * Which third-party sign-ins are offered, as a function of the environment.
 *
 * A unit test rather than a database or browser one, because that is what the
 * decision is: pure, and made from a validated environment. It is a separate
 * module from `authOptions` for the same reason -- `authOptions` reaches for
 * the Prisma singleton, which is `server-only` and would drag the whole server
 * into the fast tier to ask a question about two strings.
 */

function baseEnv(): Record<string, string | undefined> {
  return {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://user:pw@localhost:5432/recipe_journal",
    NEXTAUTH_SECRET: "0123456789abcdef0123456789abcdef",
    NEXTAUTH_URL: "http://localhost:3000",
  };
}

describe("oauthProviders", () => {
  it("offers nothing when GitHub is not configured", () => {
    // The default, and the one a fresh clone runs in: the app works, it just
    // does not advertise a sign-in it cannot complete.
    expect(oauthProviders(parseEnv(baseEnv()))).toEqual([]);
  });

  it("offers GitHub when both halves are set", () => {
    const env = parseEnv({ ...baseEnv(), GITHUB_ID: "Iv1.abc123", GITHUB_SECRET: "s3cret" });

    const providers = oauthProviders(env);

    expect(providers).toHaveLength(1);
    // The id is the string the sign-in button passes to `signIn()` and the
    // segment NextAuth mounts its callback under. A rename here is a 404
    // halfway through an OAuth handshake.
    expect(providers[0]?.id).toBe("github");
  });

  it("passes the configured credentials through", () => {
    const env = parseEnv({ ...baseEnv(), GITHUB_ID: "Iv1.abc123", GITHUB_SECRET: "s3cret" });

    const [github] = oauthProviders(env);

    /*
     * Read from `options`, not from the top level. The provider factory does
     * not apply what it is given -- it parks it on `options` and NextAuth
     * merges that over the defaults when it initialises. `github.clientId` is
     * therefore `undefined` here and populated in a running app, which is a
     * pleasant way to write an assertion that can never fail.
     */
    expect(github?.options?.clientId).toBe("Iv1.abc123");
    expect(github?.options?.clientSecret).toBe("s3cret");
  });
});
