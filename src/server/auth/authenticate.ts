import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";

import { verifyPasswordOrDummy } from "./password";
import type { SessionUser } from "./types";

/**
 * The credential check behind the Credentials provider.
 *
 * A plain function taking a client, so it can be tested against real Postgres
 * without standing up an HTTP handler. `authOptions` does nothing here but
 * hand over what was posted -- which matters, because this is the code that
 * decides who anybody is.
 */

/**
 * `authorize` receives whatever was posted to a public endpoint, so the input
 * is `unknown` and is parsed rather than trusted. Arrays, numbers, missing
 * fields and absent bodies all have to end as `null`, not as a throw.
 */
const credentialsSchema = z.object({
  // Trimmed because autofill and copy-paste both bring whitespace, and the
  // address is not ambiguous. Lowercased to agree with the unique index on
  // lower(email): an address that cannot be registered twice must not fail to
  // sign in because it was typed with a capital.
  email: z.string().trim().toLowerCase().pipe(z.email()),
  // A minimum of 1, not 8. This is the sign-in form, not the sign-up form --
  // rejecting a short password here would only tell an attacker that the
  // policy changed after this account was made.
  password: z.string().min(1),
});

export async function authenticate(db: PrismaClient, input: unknown): Promise<SessionUser | null> {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) return null;

  const { email, password } = parsed.data;

  const user = await db.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      role: true,
      passwordHash: true,
    },
  });

  // Always verify, even when there is no user. Returning early on a miss makes
  // an unregistered address fail in microseconds while a real one takes tens
  // of milliseconds, and that gap answers "does this person have an account
  // here?" for anybody willing to time it.
  const ok = await verifyPasswordOrDummy(user?.passwordHash ?? null, password);
  if (!ok || user === null) return null;

  // Rebuilt field by field rather than spread-minus-passwordHash. A spread
  // would carry any column added to the select later straight into the JWT.
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    role: user.role,
  };
}
