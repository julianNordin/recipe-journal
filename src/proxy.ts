import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

import { signInPath } from "@/domain/safe-redirect";
import { env } from "@/env";

/**
 * Sends signed-out visitors from the studio to the sign-in page.
 *
 * **`proxy.ts`, not `middleware.ts`.** Next 16 renamed the convention: the
 * file is `proxy`, the export is `proxy`, and `skipMiddlewareUrlNormalize`
 * became `skipProxyUrlNormalize`. Anything copied from a pre-16 tutorial is
 * wrong in three ways at once.
 *
 * **In `src/`, not the project root.** Next resolves this file relative to the
 * directory holding `app` -- so with a `src` directory it looks in `src/` and
 * nowhere else. A `proxy.ts` at the repository root is not an error, not a
 * warning, and not run.
 *
 * **Written by hand rather than with `next-auth/middleware`.** That wrapper
 * exists to paper over the edge runtime, where NextAuth cannot reach a
 * database and its config has to be split in two. Next 16's proxy is Node-only
 * and not configurable, so the problem it solves is not one this project has.
 * What is left is twelve lines that say what they do.
 *
 * ---
 *
 * **This is a redirect for humans. It is not the authorization.**
 *
 * Worth saying plainly, because a file that turns unauthenticated requests
 * away looks exactly like a security boundary and is not one. It knows who is
 * asking and nothing about what they are asking for -- not which recipe a
 * Server Action is about to write to, not whether this author owns it. It also
 * only sees what the router sees, which is the shape of the flaw that made
 * CVE-2025-29927 possible: a request that skips the proxy skips everything the
 * proxy decided.
 *
 * So the point of this file is that a signed-out person following a link into
 * the studio gets a sign-in page and then the page they wanted, instead of an
 * empty dashboard. The real check lives on the single seam every mutation
 * passes through -- `requireRecipeAuthor` in `src/server/session.ts` -- and
 * Phase 14 is where it gets written and then removed again to prove it was
 * doing the work.
 */
export const config = {
  matcher: ["/studio/:path*"],
};

export async function proxy(request: NextRequest): Promise<NextResponse> {
  /*
   * `getToken` reads and decrypts the session cookie. The secret comes from
   * the validated environment rather than from `process.env` so that a missing
   * one stops the process at boot -- left to its default, an absent secret
   * fails at the first request into the studio, and looks like a signed-in
   * user being bounced.
   *
   * It picks the right cookie name on its own: NextAuth prefixes it
   * `__Secure-` under https, and `getToken` decides from NEXTAUTH_URL.
   */
  const token = await getToken({ req: request, secret: env.NEXTAUTH_SECRET });

  if (token !== null) return NextResponse.next();

  /*
   * `signInPath` rather than a URL built here, because `/studio` builds the
   * same thing when the proxy did not run at all -- and two spellings of the
   * query parameter's name would drift silently, the sign-in page quietly
   * falling back to `/` with nothing reporting an error. It also validates the
   * destination with the rule that page reads it back through.
   */
  const destination = new URL(
    signInPath(request.nextUrl.pathname + request.nextUrl.search),
    request.url,
  );

  return NextResponse.redirect(destination);
}
