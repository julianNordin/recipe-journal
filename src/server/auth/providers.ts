import GitHubProvider from "next-auth/providers/github";
import type { GithubProfile } from "next-auth/providers/github";
import type { OAuthConfig } from "next-auth/providers/oauth";

import { isGitHubEnabled, type ServerEnv } from "@/env.schema";

/**
 * The third-party sign-ins on offer, decided from the environment.
 *
 * Its own module, and a function of `env` rather than a read of it, for the
 * same reason the query functions take a Prisma client: `authOptions` imports
 * the `server-only` database singleton, so anything living beside it can only
 * be tested through a browser. This decision is two strings and a branch, and
 * it is tested in the fast tier -- see `./providers.test.ts`.
 *
 * **GitHub is optional on purpose.** Credentials cover the seeded demo
 * accounts, so a fresh clone signs in and works with no OAuth app registered
 * anywhere. Offering a button that cannot complete its handshake would be
 * worse than offering nothing: the failure lands on github.com, after a
 * redirect, with an error about a client id the visitor has never heard of.
 */
export function oauthProviders(env: ServerEnv): OAuthConfig<GithubProfile>[] {
  if (!isGitHubEnabled(env)) return [];

  return [
    GitHubProvider({
      clientId: env.GITHUB_ID,
      clientSecret: env.GITHUB_SECRET,
    }),
  ];
}
