"use client";

import { SessionProvider, signOut, useSession } from "next-auth/react";
import Link from "next/link";

import styles from "./HeaderAuth.module.css";

/**
 * The signed-in state in the site header, and **the only client-side session
 * consumer in the app**.
 *
 * Phase 02 left a warning on the header that this honours: a header that
 * reaches for the session on the server makes every page that renders it
 * dynamic, because reading the session cookie opts a route out of static
 * rendering. The header sits in the root layout, so that would be every route
 * -- `/`, `/tags` and both prerendered recipe pages included.
 *
 * That trade is worth naming rather than defaulting into. Reading it on the
 * client costs a fetch after hydration and means a signed-in visitor with
 * JavaScript disabled sees the signed-out header. Nothing depends on it: the
 * whole public site reads correctly signed out, and every page that actually
 * needs a user -- the studio, from Phase 12 -- is dynamic anyway and guarded
 * on the server by `requireUser`. **A header link is not a permission**, so
 * getting it wrong for a moment costs nothing, whereas making every page
 * dynamic would cost the caching story Phase 16 is built to demonstrate.
 *
 * `SessionProvider` is scoped to exactly this subtree for the same reason.
 */

function AuthState() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    // Reserve the space rather than collapsing it, so the nav does not shift
    // sideways when the answer arrives a moment later.
    return <span className={styles.placeholder} aria-hidden="true" />;
  }

  if (session === null) {
    return (
      <Link href="/signin" className={styles.signIn}>
        Sign in
      </Link>
    );
  }

  return (
    <div className={styles.account}>
      {/*
       * The name is the way into the studio. A header link is not a
       * permission -- `/studio` reads the session itself and redirects, and
       * every mutation behind it is guarded server-side -- so this is
       * navigation, nothing more.
       */}
      <Link href="/studio" className={styles.who}>
        {session.user.name ?? session.user.email}
      </Link>
      <button
        type="button"
        className={styles.signOut}
        onClick={() => {
          void signOut({ callbackUrl: "/" });
        }}
      >
        Sign out
      </button>
    </div>
  );
}

export function HeaderAuth() {
  return (
    <SessionProvider>
      <AuthState />
    </SessionProvider>
  );
}
