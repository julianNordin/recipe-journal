import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SignInForm } from "@/components/auth/SignInForm";
import { Card, Container } from "@/components/ui/Surfaces";
import { safeRedirectPath } from "@/domain/safe-redirect";
import { getSession } from "@/server/session";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Sign in",
  // Nothing here belongs in a search result, and the page has no content of
  // its own to rank for.
  robots: { index: false },
};

/**
 * A server component wrapping one client form.
 *
 * `callbackUrl` arrives in the query string, so it is validated rather than
 * passed through -- `safeRedirectPath` carries the reasoning, and it is a
 * domain rule with its own tests because Phase 11's `proxy.ts` writes the
 * value this page later reads back.
 */
/**
 * Where sign-in lands when nothing asked for somewhere specific.
 *
 * The home page for now; Phase 12 points it at `/studio`, which is where an
 * author actually wants to be and which does not exist yet. Sending people to
 * a 404 immediately after a successful sign-in would be a poor first
 * impression of the one flow that has to feel solid.
 */
const DEFAULT_DESTINATION = "/";

export default async function SignInPage(props: PageProps<"/signin">) {
  const [searchParams, user] = await Promise.all([props.searchParams, getSession()]);
  const callbackUrl = safeRedirectPath(searchParams.callbackUrl, DEFAULT_DESTINATION);

  // Already signed in: there is nothing to do here.
  if (user !== null) redirect(callbackUrl);

  return (
    <Container>
      <div className={styles.wrap}>
        <h1 className={styles.title}>Sign in</h1>
        <Card>
          <SignInForm callbackUrl={callbackUrl} />
        </Card>
      </div>
    </Container>
  );
}
