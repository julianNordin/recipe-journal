import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

import { env } from "@/env";
import { db } from "@/server/db";

import { createAuthAdapter } from "./adapter";
import { authenticate } from "./authenticate";

/**
 * The one place `authOptions` is defined, and -- via `src/server/session.ts`
 * -- very nearly the one place it is imported.
 *
 * NextAuth v4 has no universal `auth()`, so without that wrapper every page,
 * route handler and Server Action would import this module to ask who is
 * signed in. Paying the tax once is what makes Phase 14's guard a single
 * change rather than an audit.
 */
export const authOptions: NextAuthOptions = {
  secret: env.NEXTAUTH_SECRET,

  /**
   * Wired in unconditionally, though only OAuth uses it.
   *
   * A credentials sign-in never touches the adapter -- NextAuth branches on
   * the account type and reads the user straight out of `authorize` -- so with
   * GitHub unconfigured this does nothing at all. It is still here rather than
   * behind the same flag as the provider, because two shapes of `authOptions`
   * is two things to reason about, and the one that runs in production would
   * be the one with no test naming it.
   *
   * What it does when GitHub *is* configured: creates the user on a first
   * sign-in, writes the `accounts` row that links a GitHub identity to that
   * user, and finds them again by that row on every sign-in after. See
   * `./adapter.ts` for why none of that is type-checked, and
   * `tests/db/auth-adapter.test.ts` for what checks it instead.
   */
  adapter: createAuthAdapter(db),

  /**
   * JWT, and not by preference: **NextAuth refuses database sessions whenever
   * a Credentials provider is configured.** It has no way to revoke a
   * credential session it did not create a row for, so it declines to pretend
   * otherwise. The adapter's `Session` table therefore goes unused -- said out
   * loud in the schema and in the README rather than left as a table that
   * looks load-bearing and is not.
   */
  session: { strategy: "jwt" },

  // Our own sign-in page, not NextAuth's generated one. The default is fine
  // for a prototype and looks nothing like the rest of the site.
  pages: { signIn: "/signin" },

  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      /**
       * Deliberately a one-liner. Everything that decides who someone is lives
       * in `authenticate`, which takes a client and is tested against real
       * Postgres -- including the cases where the input is not what a form
       * would have sent, because this is a public endpoint and the body is
       * whatever the caller chose to post.
       */
      authorize: (credentials) => authenticate(db, credentials),
    }),
  ],

  callbacks: {
    /**
     * `user` is present only on the request that signs in; afterwards the
     * token is all there is. So the claims are copied once and then carried,
     * which is also why a role change does not take effect until the next
     * sign-in -- a property of JWT sessions rather than of this code, and one
     * worth knowing before Phase 14 leans on `role`.
     */
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },

    session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      return session;
    },
  },
};
