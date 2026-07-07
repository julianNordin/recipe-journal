import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

import { env } from "@/env";
import { db } from "@/server/db";

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
