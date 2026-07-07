import type { DefaultSession } from "next-auth";

import type { UserRole } from "@/generated/prisma/client";

/**
 * NextAuth's own `Session.user` is name/email/image and nothing else, and its
 * JWT is a bag of optional strings. This project puts `id` and `role` on both
 * in the callbacks, so the types have to say so -- otherwise every call site
 * that reads `session.user.role` needs a cast, and a cast is where the
 * compiler stops helping.
 *
 * Declaration merging rather than a wrapper type: the values genuinely are
 * there at runtime, so the honest fix is to correct the library's description
 * of them rather than to describe something else alongside it.
 */
declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      role: UserRole;
    };
  }

  /** What `authorize` returns and what the `jwt` callback receives. */
  interface User {
    role: UserRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
  }
}
