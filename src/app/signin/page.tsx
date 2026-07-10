import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SignInForm } from "@/components/auth/SignInForm";
import { Card, Container } from "@/components/ui/Surfaces";
import { safeRedirectPath } from "@/domain/safe-redirect";
import { env, isGitHubEnabled } from "@/env";
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
 * The studio: somebody who signed in without being sent here by a link came to
 * write something. A `callbackUrl` still wins, so the far more common route --
 * following a link into the studio and being bounced here by the proxy -- ends
 * up exactly where it started.
 */
const DEFAULT_DESTINATION = "/studio";

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
          {/*
           * Read on the server and handed down, because the environment is
           * server-only and this is a client component. Reached through the
           * same predicate `oauthProviders` uses, so the button and the
           * provider list cannot disagree about whether GitHub exists.
           */}
          <SignInForm callbackUrl={callbackUrl} githubEnabled={isGitHubEnabled(env)} />
        </Card>
      </div>
    </Container>
  );
}
