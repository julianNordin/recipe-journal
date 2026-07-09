import { PrismaAdapter } from "@next-auth/prisma-adapter";
import type { AdapterAccount, AdapterUser } from "next-auth/adapters";

import type { PrismaClient } from "@/generated/prisma/client";

/**
 * The NextAuth database adapter, and the one place in this codebase where the
 * compiler has stopped checking something.
 *
 * `@next-auth/prisma-adapter` was last published in 2023 and types its
 * argument as the `PrismaClient` exported by `@prisma/client`. That type no
 * longer exists: `@prisma/client/default.d.ts` is a bare re-export of
 * `.prisma/client/default`, a path only the legacy `prisma-client-js`
 * generator ever wrote, and Prisma 7 does not ship that generator.
 *
 * **The interesting part is what TypeScript does about that, which is
 * nothing.** An import that does not resolve is not an error at the call site;
 * it degrades to `any`. So `PrismaAdapter` accepts a string, this client, or a
 * shopping list, with no assertion to write and nothing to explain. That is
 * strictly worse than the cast this was expected to need -- a cast is at least
 * visible, and visible enough to attract a comment saying who checks it
 * instead.
 *
 * Nobody was going to, so `tests/db/auth-adapter.test.ts` does: every method
 * below, driven against real Postgres in the order a GitHub sign-in walks
 * them. The adapter's behaviour is purely structural -- `p.user.create`,
 * `p.account.findUnique`, a compound key it spells
 * `provider_providerAccountId` -- so a schema that disagreed would fail there
 * and nowhere earlier.
 */

/**
 * The methods this application's sign-in flows walk through, spelled out.
 *
 * next-auth's own `Adapter` cannot be used to call anything: every method on
 * it is optional -- an adapter may implement a subset -- and three are typed
 * through `@auth/core/adapters`, which v4 names in its types without depending
 * on, so it is not installed and those three are `any` as well.
 *
 * Writing the contract down is the point rather than a workaround. It is what
 * the assertion at the bottom of this file promises, and what the database
 * test checks.
 *
 * The object really returned carries the session and verification-token
 * methods too. They are left out because nothing calls them: a Credentials
 * provider forces JWT sessions, so the `sessions` table is written by nothing
 * and read by nothing.
 */
export type AuthAdapter = {
  /**
   * `Omit<AdapterUser, "id">` would be the obvious parameter type and it is
   * wrong here, in a way worth naming. `AdapterUser` extends next-auth's
   * `User`, which `src/types/next-auth.d.ts` augments with a required `role` --
   * true of every user that comes *out* of the adapter, and never true of what
   * goes in. NextAuth builds this argument from the provider's profile, and no
   * OAuth provider knows about this application's roles. The role is the
   * database's to assign, which is exactly what the column default does.
   */
  createUser: (profile: Omit<AdapterUser, "id" | "role">) => Promise<AdapterUser>;
  getUser: (id: string) => Promise<AdapterUser | null>;
  getUserByEmail: (email: string) => Promise<AdapterUser | null>;
  getUserByAccount: (
    key: Pick<AdapterAccount, "provider" | "providerAccountId">,
  ) => Promise<AdapterUser | null>;
  /**
   * The linking calls hand back the row they wrote, and nothing reads it --
   * `unknown` rather than a shape, because the shape would be Prisma's
   * `Account` and next-auth's `AdapterAccount` disagrees with it about whether
   * an absent token is `null` or missing. Claiming either would be a claim no
   * caller needs and no test could justify.
   */
  linkAccount: (account: AdapterAccount) => Promise<unknown>;
  unlinkAccount: (key: Pick<AdapterAccount, "provider" | "providerAccountId">) => Promise<unknown>;
  deleteUser: (id: string) => Promise<AdapterUser>;
};

/**
 * Takes the client rather than importing it, so the database tier can hand in
 * one pointed at its container. Not a testing convenience: with the parameter
 * type gone to `any`, a test running the real thing is the only check left.
 */
export function createAuthAdapter(client: PrismaClient): AuthAdapter {
  /*
   * The assertion, and the only one. It narrows `Adapter`'s all-optional,
   * partly-`any` members to the seven concrete signatures above -- which is a
   * claim about what this object does, made where a reader can see it and
   * verified by the database test rather than by the compiler.
   */
  return PrismaAdapter(client) as AuthAdapter;
}
