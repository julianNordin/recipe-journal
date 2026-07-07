import NextAuth from "next-auth";
import type { NextRequest } from "next/server";

import { authOptions } from "@/server/auth/options";

/**
 * NextAuth's catch-all handler.
 *
 * One handler exported under both verbs, which is the v4 App Router shape:
 * `NextAuth(authOptions)` returns a single function and the router picks the
 * verb. Sign-in and callbacks are POSTs; session and provider lookups are
 * GETs; both land here.
 *
 * **The assertion is the library's fault, not a shortcut.** next-auth v4
 * declares `NextAuth(options: AuthOptions): any` -- literally `any`, because
 * the same name carries three overloads for three router shapes and it gives
 * up on describing the result. Left alone that `any` spreads into both
 * exports, and type-aware lint rejects it. Naming the real signature here is
 * narrower than disabling the rule: the compiler goes on checking that what
 * is exported is something the App Router can call, and Next's own generated
 * `RouteContext` supplies the parameter shape rather than a guess at it.
 */
const handler = NextAuth(authOptions) as (
  request: NextRequest,
  context: RouteContext<"/api/auth/[...nextauth]">,
) => Promise<Response>;

export { handler as GET, handler as POST };
