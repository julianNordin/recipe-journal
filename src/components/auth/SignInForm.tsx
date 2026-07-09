"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";

import styles from "./SignInForm.module.css";

/**
 * Email and password, posted through NextAuth's client helper.
 *
 * `redirect: false` so a failure comes back as a value instead of a bounce to
 * NextAuth's own error page. That keeps the wrong-password case on this form,
 * with the address still filled in.
 *
 * `signIn` needs no `SessionProvider`: it posts to the auth endpoint and reads
 * nothing from context. Only `useSession` needs the provider, which is why the
 * only one in this app wraps the header.
 */
export function SignInForm({ callbackUrl }: { callbackUrl: string }) {
  const router = useRouter();
  // Ids still come from here rather than from Field, because the form-level
  // error is one message about the pair -- both inputs point at it, so it
  // cannot live inside either field.
  const errorId = useId();
  const emailId = useId();
  const passwordId = useId();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const result = await signIn("credentials", { email, password, redirect: false });

    if (result?.ok !== true) {
      /*
       * One message for every failure. NextAuth reports a bad password and an
       * unknown address identically -- and it should: saying "no account with
       * that address" turns the sign-in form into a way to ask whether
       * somebody has an account here. The constant-time work in
       * verifyPasswordOrDummy exists for the same reason.
       */
      setError("That email and password do not match an account.");
      setPending(false);
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  }

  return (
    // `void` rather than handing an async function straight to onSubmit: the
    // handler returns a promise nothing awaits, and an unhandled rejection in
    // it would be silent. Everything that can fail here is already caught.
    <form
      className={styles.form}
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      noValidate
    >
      {error === null ? null : (
        // aria-live so it is announced when it appears, and referenced by both
        // inputs so a screen reader reaches it from either field.
        <p className={styles.error} id={errorId} role="alert">
          {error}
        </p>
      )}

      <Field
        id={emailId}
        invalid={error !== null}
        describedBy={error === null ? undefined : errorId}
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />

      <Field
        id={passwordId}
        invalid={error !== null}
        describedBy={error === null ? undefined : errorId}
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
