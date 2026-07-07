import { describe, expect, it } from "vitest";

import { authenticate } from "@/server/auth/authenticate";
import { hashPassword } from "@/server/auth/password";

import { cleanDatabasePerTest } from "./setup/database";
import { makeUser } from "./setup/factories";

const db = cleanDatabasePerTest();

const PASSWORD = "correct horse battery staple";

async function makeAccount(email = "ada@example.com") {
  return makeUser(db(), {
    email,
    name: "Ada",
    role: "AUTHOR",
    passwordHash: await hashPassword(PASSWORD),
  });
}

/**
 * The credential check, tested directly rather than through NextAuth.
 *
 * This is the security-critical path, so it is a plain function taking a
 * client and returning a user or null -- `authOptions` only wires it up.
 * Testing it through the provider would mean standing up an HTTP handler to
 * assert on a boolean.
 */
describe("authenticate", () => {
  it("accepts the right email and password", async () => {
    const user = await makeAccount();

    const result = await authenticate(db(), { email: "ada@example.com", password: PASSWORD });

    expect(result).toEqual({
      id: user.id,
      email: "ada@example.com",
      name: "Ada",
      image: null,
      role: "AUTHOR",
    });
  });

  it("never returns the password hash", async () => {
    await makeAccount();

    const result = await authenticate(db(), { email: "ada@example.com", password: PASSWORD });

    // Whatever this returns ends up in a JWT and in the session a component
    // reads. The hash must not make that trip.
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("rejects the wrong password", async () => {
    await makeAccount();

    expect(await authenticate(db(), { email: "ada@example.com", password: "wrong" })).toBeNull();
  });

  it("rejects an email nobody has", async () => {
    await makeAccount();

    expect(await authenticate(db(), { email: "nobody@example.com", password: PASSWORD })).toBeNull();
  });

  it("matches the email case-insensitively", async () => {
    // The database has a unique index on lower(email), so "Ada@Example.com"
    // and "ada@example.com" cannot both exist. Sign-in has to agree with that,
    // or an address that could not be registered twice would still fail to
    // sign in when typed with a capital.
    await makeAccount("ada@example.com");

    for (const typed of ["Ada@Example.com", "ADA@EXAMPLE.COM", "aDa@ExAmPlE.cOm"]) {
      expect(await authenticate(db(), { email: typed, password: PASSWORD }), typed).not.toBeNull();
    }
  });

  it("ignores surrounding whitespace in the email", async () => {
    // Autofill and copy-paste both do this, and the address is not ambiguous.
    await makeAccount();

    expect(
      await authenticate(db(), { email: "  ada@example.com  ", password: PASSWORD }),
    ).not.toBeNull();
  });

  it("refuses an account that has no password", async () => {
    // The ordinary state for someone who only ever signs in through GitHub.
    // A null hash must read as "cannot sign in this way", never as "no
    // password needed".
    await makeUser(db(), { email: "oauth@example.com", passwordHash: null });

    expect(await authenticate(db(), { email: "oauth@example.com", password: "" })).toBeNull();
    expect(await authenticate(db(), { email: "oauth@example.com", password: PASSWORD })).toBeNull();
  });

  it.each([
    ["nothing at all", undefined],
    ["an empty object", {}],
    ["no password", { email: "ada@example.com" }],
    ["no email", { password: PASSWORD }],
    ["an empty password", { email: "ada@example.com", password: "" }],
    ["a non-string password", { email: "ada@example.com", password: 12345 }],
    ["a non-string email", { email: 42, password: PASSWORD }],
    ["an email that is not one", { email: "not-an-email", password: PASSWORD }],
    ["arrays", { email: ["ada@example.com"], password: [PASSWORD] }],
  ])("rejects %s without throwing", async (_label, credentials) => {
    // NextAuth hands `authorize` whatever was posted. It is a public endpoint,
    // so the input is arbitrary and must be parsed rather than trusted -- and
    // a throw here would be a 500 on the sign-in form.
    await makeAccount();

    await expect(authenticate(db(), credentials)).resolves.toBeNull();
  });
});
