import "server-only";

import { getServerSession } from "next-auth";

import { authOptions } from "@/server/auth/options";
import type { SessionUser } from "@/server/auth/types";
import { db } from "@/server/db";

export type { SessionUser };

/**
 * Who is signed in, and what they are allowed to do.
 *
 * **This module is the tax `next-auth@4` charges, paid once.** v4 has no
 * universal `auth()`: left alone, every page, route handler and Server Action
 * would import `authOptions` and call `getServerSession` itself. Three
 * functions here mean one import of `authOptions` in the whole codebase, and
 * -- the part that matters -- **one seam every mutation is forced through**.
 *
 * That seam is the point. Phase 14's authorization work is a change to
 * `requireRecipeAuthor` and nothing else, and its mutation test is the removal
 * of one guard rather than an audit of every call site.
 *
 * `server-only`, because a Client Component reaching for any of this should be
 * a build error rather than a bundle containing the session logic.
 */

/** Thrown when nobody is signed in. Callers turn it into a redirect or a 401. */
export class NotAuthenticatedError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "NotAuthenticatedError";
  }
}

/**
 * Thrown when somebody is signed in and still may not do this.
 *
 * Distinct from `NotAuthenticatedError` because the answers differ: the first
 * means "sign in and try again", this one means "no". Collapsing them sends a
 * signed-in user to a sign-in page they are already past.
 */
export class NotAuthorizedError extends Error {
  constructor(message = "Not allowed") {
    super(message);
    this.name = "NotAuthorizedError";
  }
}

/** The signed-in user, or null. */
export async function getSession(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  if (session === null) return null;

  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? null,
    image: session.user.image ?? null,
    role: session.user.role,
  };
}

/** The signed-in user, or throw. For anything that must not run anonymously. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSession();
  if (user === null) throw new NotAuthenticatedError();
  return user;
}

/**
 * The signed-in user, provided they own the recipe.
 *
 * **The guard every mutation on a recipe goes through.** A Server Action is a
 * public endpoint with a stable id, so "the editor only renders for the
 * author" is not a check -- it is a decoration on top of one. This is the
 * check.
 *
 * A recipe that does not exist and a recipe belonging to somebody else raise
 * the same error, on purpose: distinguishing them would let a stranger probe
 * for which recipe ids are real.
 */
export async function requireRecipeAuthor(recipeId: string): Promise<SessionUser> {
  const user = await requireUser();

  const recipe = await db.recipe.findUnique({
    where: { id: recipeId },
    select: { authorId: true },
  });

  if (recipe === null || recipe.authorId !== user.id) {
    throw new NotAuthorizedError("That recipe is not yours");
  }

  return user;
}
