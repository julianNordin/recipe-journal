"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

/**
 * A `SessionProvider` a server component can wrap things in.
 *
 * The session is read on the client throughout this application, and the
 * reason is worth repeating because it is easy to undo by accident: reading it
 * on the server opts a route out of static rendering, and the two places that
 * want it -- the header and the comment controls -- sit on pages that are
 * cached on purpose. See `HeaderAuth` for the long version.
 *
 * Scoped rather than mounted at the root, so nothing else in the tree quietly
 * gains the ability to reach for a session and take a route dynamic with it.
 */
export function SessionScope({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
