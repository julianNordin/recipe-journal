import "server-only";

import { getServerSession } from "next-auth";

import { authOptions } from "@/server/auth/options";
import type { SessionUser } from "@/server/auth/types";
import { db } from "@/server/db";
import { findRecipeAuthorId } from "@/server/recipes/queries";

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
 * for which recipe ids are real. That is what the single `!==` below is doing
 * -- `findRecipeAuthorId` returns null for an absent recipe, for an id that is
 * not a uuid, and for one this database never issued, and none of those can
 * equal a signed-in user's id.
 *
 * The read itself lives in `src/server/recipes/queries.ts` so that it can be
 * driven against real Postgres with the input an action actually receives,
 * which is a string somebody posted. This module cannot be: it is
 * `server-only` and reaches for the singleton, which is right for a session
 * helper and fatal for a test.
 */
export async function requireRecipeAuthor(recipeId: string): Promise<SessionUser> {
  const user = await requireUser();

  const authorId = await findRecipeAuthorId(db, recipeId);

  if (authorId !== user.id) {
    throw new NotAuthorizedError("That recipe is not yours");
  }

  return user;
}
