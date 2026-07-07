import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword, verifyPasswordOrDummy } from "./password";

const PASSWORD = "correct horse battery staple";

describe("hashPassword", () => {
  it("produces an argon2id hash carrying its own parameters", async () => {
    const hash = await hashPassword(PASSWORD);

    // The parameters travel inside the string, which is what lets them be
    // raised later without invalidating every existing password: an old hash
    // still verifies under the settings it was made with.
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it("never produces the same hash twice", async () => {
    // A random salt per hash. Without one, two people with the same password
    // have the same hash, and one leaked table tells an attacker which
    // accounts to attack once rather than one at a time.
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });

  it("fits the column", async () => {
    // passwordHash is VarChar(255) in the schema. If the parameters are ever
    // raised, this is what notices before Postgres does.
    expect((await hashPassword(PASSWORD)).length).toBeLessThanOrEqual(255);
  });
});

describe("verifyPassword", () => {
  it("accepts the right password", async () => {
    expect(await verifyPassword(await hashPassword(PASSWORD), PASSWORD)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    expect(await verifyPassword(await hashPassword(PASSWORD), "wrong")).toBe(false);
  });

  it("rejects an empty attempt against a real hash", async () => {
    expect(await verifyPassword(await hashPassword(PASSWORD), "")).toBe(false);
  });

  it("is case sensitive and whitespace sensitive", async () => {
    const hash = await hashPassword(PASSWORD);

    expect(await verifyPassword(hash, PASSWORD.toUpperCase())).toBe(false);
    expect(await verifyPassword(hash, ` ${PASSWORD}`)).toBe(false);
  });

  it.each([
    ["empty", ""],
    ["not a hash at all", "hunter2"],
    ["truncated", "$argon2id$v=19$m=19456,t=2"],
    ["a bcrypt hash", "$2b$12$abcdefghijklmnopqrstuv"],
  ])("returns false rather than throwing on a %s stored value", async (_label, stored) => {
    // A malformed row should fail the sign-in, not take the process down. The
    // library throws on an unparseable hash, so this has to be caught -- and
    // an uncaught throw here would be a 500 on the sign-in form.
    await expect(verifyPassword(stored, PASSWORD)).resolves.toBe(false);
  });
});

describe("verifyPasswordOrDummy", () => {
  it("behaves like verifyPassword when there is a hash", async () => {
    const hash = await hashPassword(PASSWORD);

    expect(await verifyPasswordOrDummy(hash, PASSWORD)).toBe(true);
    expect(await verifyPasswordOrDummy(hash, "wrong")).toBe(false);
  });

  it("returns false for an account with no password", async () => {
    // Null is the ordinary state for an account that only ever signs in
    // through GitHub. It must not be treated as "no password required".
    expect(await verifyPasswordOrDummy(null, PASSWORD)).toBe(false);
    expect(await verifyPasswordOrDummy(null, "")).toBe(false);
  });

  it("costs about the same whether or not the account exists", async () => {
    // User enumeration: if a missing account fails instantly and a real one
    // takes 40ms, the response time answers "is this address registered?" for
    // anybody who asks. Hashing against a dummy on the miss keeps the two
    // paths comparable.
    const hash = await hashPassword(PASSWORD);

    const timeOf = async (fn: () => Promise<unknown>): Promise<number> => {
      const started = performance.now();
      await fn();
      return performance.now() - started;
    };

    const real = await timeOf(() => verifyPasswordOrDummy(hash, "wrong"));
    const missing = await timeOf(() => verifyPasswordOrDummy(null, "wrong"));

    // A deliberately loose bound. The point is that the miss does real work,
    // not that the two are equal -- asserting a tight ratio on a shared CI
    // runner is how a test starts failing for reasons nobody can reproduce.
    expect(missing).toBeGreaterThan(real / 10);
  });
});
