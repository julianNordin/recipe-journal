import type { UserRole } from "@/generated/prisma/client";

/**
 * The user as the rest of the application sees them.
 *
 * Its own module so that nothing needs to import `authOptions` to name a
 * signed-in user -- `authOptions` pulls in the whole NextAuth provider chain,
 * and a type should not cost that.
 *
 * Note what is absent: no `passwordHash`, and nothing else off the `users` row
 * that a page has no business rendering. Everything that reaches a component
 * or a JWT is spelled out here.
 */
export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: UserRole;
};
