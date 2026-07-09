import { describe, expect, it } from "vitest";

import { createAuthAdapter } from "@/server/auth/adapter";

import { cleanDatabasePerTest } from "./setup/database";
import { makeUser } from "./setup/factories";

/**
 * The NextAuth Prisma adapter, against real Postgres.
 *
 * **This suite exists because `createAuthAdapter` contains a type assertion.**
 * `@next-auth/prisma-adapter` types its argument as the `PrismaClient` from
 * `@prisma/client`, whose type entry point re-exports `.prisma/client`, which
 * only the legacy generator produced and Prisma 7 no longer ships. The
 * assertion silences a type that cannot be satisfied -- and with it, every
 * check that the client and the adapter agree about anything.
 *
 * So the checks move here. The adapter's implementation is purely structural:
 * it reaches for `p.user.create`, `p.account.findUnique` and a compound key it
 * spells `provider_providerAccountId`, none of which the compiler is still
 * verifying. Each test below drives one step a GitHub sign-in actually walks
 * through, in the order NextAuth walks it, and asserts on the rows rather than
 * on the return values.
 */

const db = cleanDatabasePerTest();

/**
 * What GitHub's `profile()` yields once NextAuth has stripped the `id`.
 *
 * The stripping is not incidental: next-auth destructures `const { id: _,
 * ...newUser } = { ...profile, emailVerified: null }` before calling
 * `createUser`, which is the only reason a GitHub numeric id never reaches a
 * `@db.Uuid` primary key.
 */
function githubProfile(overrides: { name?: string; email?: string } = {}) {
  return {
    name: "Ada Lindqvist",
    email: "ada@example.com",
    image: "https://avatars.githubusercontent.com/u/584231?v=4",
    emailVerified: null,
    ...overrides,
  };
}

/**
 * What NextAuth hands `linkAccount`: `{ provider, type, providerAccountId,
 * ...tokens }` with `userId` added, where `tokens` is the token response
 * verbatim. A GitHub **OAuth App** returns exactly these three; a GitHub App
 * would add `refresh_token_expires_in`, which is not a column here.
 */
function githubAccount(userId: string, providerAccountId = "584231") {
  return {
    userId,
    type: "oauth" as const,
    provider: "github",
    providerAccountId,
    access_token: "gho_16C7e42F292c6912E7710c838347Ae178B4a",
    token_type: "bearer",
    scope: "read:user,user:email",
  };
}

describe("creating a user from an OAuth profile", () => {
  it("writes a row whose id the database supplied", async () => {
    const adapter = createAuthAdapter(db());

    const user = await adapter.createUser(githubProfile());

    // The profile carried no id, so `uuid(7)` had to fill it. The adapter's
    // own reference schema uses `cuid()`, which would not match `@db.Uuid`.
    expect(user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);

    const row = await db().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.email).toBe("ada@example.com");
    expect(row.name).toBe("Ada Lindqvist");
    expect(row.image).toBe("https://avatars.githubusercontent.com/u/584231?v=4");
    expect(row.emailVerified).toBeNull();
  });

  it("leaves the new user a reader rather than an author", async () => {
    const adapter = createAuthAdapter(db());

    const user = await adapter.createUser(githubProfile());

    // Signing in with GitHub gets an account, not the run of the place. The
    // column default is the only thing deciding this: the adapter passes no
    // role and no OAuth provider could know about one.
    //
    // Asserted on what `createUser` returned rather than on the row, because
    // that value is what the `jwt` callback copies onto the token -- a row
    // that said USER while the return said otherwise would still mint an
    // author.
    expect(user.role).toBe("USER");
    expect((await db().user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe("USER");
  });

  it("refuses a profile whose address differs only in case from an existing one", async () => {
    await makeUser(db(), { email: "Ada@Example.com" });
    const adapter = createAuthAdapter(db());

    // NextAuth lowercases the profile address and looks it up with a
    // case-sensitive `findUnique`, so it misses this account and goes on to
    // create a second one. `ux_users_email_lower` is what stops it.
    expect(await adapter.getUserByEmail("ada@example.com")).toBeNull();
    await expect(adapter.createUser(githubProfile())).rejects.toThrow();

    expect(await db().user.count()).toBe(1);
  });
});

describe("linking a GitHub account", () => {
  it("writes an accounts row against the mapped columns", async () => {
    const adapter = createAuthAdapter(db());
    const user = await adapter.createUser(githubProfile());

    await adapter.linkAccount(githubAccount(user.id));

    // Read back through SQL, not through Prisma: the adapter passes camelCase
    // field names and this schema maps two of them to snake_case columns. A
    // Prisma-level assertion would agree with itself about that mapping.
    const rows = await db().$queryRaw<
      { user_id: string; provider_account_id: string; access_token: string; scope: string }[]
    >`SELECT user_id, provider_account_id, access_token, scope FROM accounts`;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBe(user.id);
    expect(rows[0]?.provider_account_id).toBe("584231");
    expect(rows[0]?.access_token).toBe("gho_16C7e42F292c6912E7710c838347Ae178B4a");
    expect(rows[0]?.scope).toBe("read:user,user:email");
  });

  it("gives the accounts row an id nothing supplied", async () => {
    const adapter = createAuthAdapter(db());
    const user = await adapter.createUser(githubProfile());

    await adapter.linkAccount(githubAccount(user.id));

    const account = await db().account.findFirstOrThrow();
    expect(account.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
  });

  it("links a second provider to a user who already exists", async () => {
    const existing = await makeUser(db(), { email: "linus@example.com" });
    const adapter = createAuthAdapter(db());

    // The path NextAuth takes for someone signed in with a password who then
    // connects GitHub: no new user, one new accounts row.
    await adapter.linkAccount(githubAccount(existing.id, "1024"));

    expect(await db().user.count()).toBe(1);
    expect(await db().account.count({ where: { userId: existing.id } })).toBe(1);
  });

  it("rejects the same GitHub account linked twice", async () => {
    const first = await makeUser(db());
    const second = await makeUser(db());
    const adapter = createAuthAdapter(db());

    await adapter.linkAccount(githubAccount(first.id));

    await expect(adapter.linkAccount(githubAccount(second.id))).rejects.toThrow();
  });
});

describe("finding the user behind a linked account", () => {
  it("returns the user for a provider and account id", async () => {
    const adapter = createAuthAdapter(db());
    const user = await adapter.createUser(githubProfile());
    await adapter.linkAccount(githubAccount(user.id));

    const found = await adapter.getUserByAccount({
      provider: "github",
      providerAccountId: "584231",
    });

    // This is the assertion the cast cost most: the adapter looks the row up
    // through a compound key it spells `provider_providerAccountId`, which is
    // a name Prisma derives from `@@unique([provider, providerAccountId])`.
    // Nothing checks that the two agree except this.
    expect(found?.id).toBe(user.id);
    expect(found?.email).toBe("ada@example.com");
  });

  it("returns null for an account nobody has linked", async () => {
    const adapter = createAuthAdapter(db());
    const user = await adapter.createUser(githubProfile());
    await adapter.linkAccount(githubAccount(user.id));

    // The control. Without it the test above would still pass if
    // `getUserByAccount` ignored its argument and returned the only user.
    const found = await adapter.getUserByAccount({
      provider: "github",
      providerAccountId: "999999",
    });

    expect(found).toBeNull();
  });

  it("stops finding the user once the account is unlinked", async () => {
    const adapter = createAuthAdapter(db());
    const user = await adapter.createUser(githubProfile());
    await adapter.linkAccount(githubAccount(user.id));

    await adapter.unlinkAccount({ provider: "github", providerAccountId: "584231" });

    expect(
      await adapter.getUserByAccount({ provider: "github", providerAccountId: "584231" }),
    ).toBeNull();
    // Unlinking a provider is not deleting the person.
    expect(await db().user.count({ where: { id: user.id } })).toBe(1);
  });
});

describe("the rest of the contract NextAuth reaches for", () => {
  it("finds a user by id and by address", async () => {
    const adapter = createAuthAdapter(db());
    const user = await adapter.createUser(githubProfile());

    expect((await adapter.getUser(user.id))?.email).toBe("ada@example.com");
    expect((await adapter.getUserByEmail("ada@example.com"))?.id).toBe(user.id);
    expect(await adapter.getUserByEmail("nobody@example.com")).toBeNull();
  });

  it("takes the linked accounts with the user it deletes", async () => {
    const adapter = createAuthAdapter(db());
    const user = await adapter.createUser(githubProfile());
    await adapter.linkAccount(githubAccount(user.id));

    const deleted = await adapter.deleteUser(user.id);

    // The return value is typed rather than left `unknown`, so something has
    // to check that it really is the user who was deleted.
    expect(deleted.id).toBe(user.id);
    expect(await db().user.count()).toBe(0);
    expect(await db().account.count()).toBe(0);
  });
});
