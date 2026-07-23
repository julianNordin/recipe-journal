"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useActionState } from "react";

import { createCommentAction, type CommentFormState } from "@/app/recipes/actions";
import { Button } from "@/components/ui/Button";
import { COMMENT_LIMITS, COMMENT_PROBLEM_MESSAGES } from "@/domain/comment";

import styles from "./Comments.module.css";

/**
 * The box for writing a comment, or an invitation to sign in.
 *
 * A client component for the same reason `HeaderAuth` is one: the page it sits
 * on is cached for everybody, and asking who is reading it on the server would
 * make every recipe page dynamic. The form appears after hydration.
 *
 * **There is deliberately no `router.refresh()` here, and there was.** The
 * reasoning for adding one sounded solid: the action invalidates the server's
 * cached render, the browser is still showing the copy it already has, so the
 * comment would be accepted and not appear. Measured by deleting the effect --
 * the test still passed. A Server Action invoked from a form already returns
 * the re-rendered tree for the current route, so `revalidatePath` inside it
 * updates the caller as well as the cache, and the refresh was a second render
 * of the same page.
 *
 * Recorded rather than quietly removed, because it is the second time this
 * project has written a defence from a plausible mechanism and found the
 * mechanism was already handled. The measurement is the only thing that told
 * the two apart.
 */
const IDLE: CommentFormState = { status: "idle" };

export function CommentForm({ recipeId }: { recipeId: string }) {
  const { data: session, status } = useSession();
  const [state, formAction, pending] = useActionState(createCommentAction, IDLE);

  if (status === "loading") return null;

  if (session === null) {
    return (
      <p className={styles.signedOut}>
        <Link href="/signin?callbackUrl=%2Frecipes">Sign in</Link> to leave a comment.
      </p>
    );
  }

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="recipeId" value={recipeId} />

      <label className={styles.label} htmlFor="comment-body">
        Leave a comment
      </label>
      <textarea
        id="comment-body"
        name="body"
        rows={4}
        maxLength={COMMENT_LIMITS.body}
        className={styles.textarea}
        // Cleared on a successful post by remounting: the key changes with the
        // state, so React gives the field a fresh uncontrolled value. Keeping
        // it filled after a rejection is the same courtesy the recipe form
        // pays, and for the same reason.
        key={state.status === "posted" ? "posted" : "writing"}
        placeholder="Did you try it? What happened?"
      />

      {state.status === "rejected" ? (
        <p className={styles.problem} role="alert">
          {state.problem === "not-commentable"
            ? "This recipe is not open for comments."
            : COMMENT_PROBLEM_MESSAGES[state.problem]}
        </p>
      ) : null}

      {state.status === "posted" ? (
        <p className={styles.posted} role="status">
          Posted.
        </p>
      ) : null}

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Posting…" : "Post comment"}
        </Button>
      </div>
    </form>
  );
}
