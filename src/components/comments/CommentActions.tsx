"use client";

import { useSession } from "next-auth/react";

import { deleteCommentAction } from "@/app/recipes/actions";
import { mayDeleteComment } from "@/domain/comment";

import styles from "./Comments.module.css";

/**
 * The Delete button, drawn only for somebody who may use it.
 *
 * **`mayDeleteComment` is the same function the action calls.** That is the
 * whole reason it is pure and in the domain layer: this component and that
 * endpoint have to agree, and two implementations of "may this person delete
 * this" would eventually not. The one here decides what is drawn; the one
 * there decides what happens, and only the second is a check.
 *
 * A client component because the answer depends on who is looking, and the
 * page it sits on is cached for everybody. The button appears after hydration.
 * Nothing rests on it: a button that is briefly missing costs a moment, and a
 * button that is wrongly present is refused by the endpoint.
 */
export function CommentActions({
  commentId,
  commentAuthorId,
  recipeAuthorId,
}: {
  commentId: string;
  commentAuthorId: string;
  recipeAuthorId: string;
}) {
  const { data: session } = useSession();
  const userId = session?.user.id ?? null;

  if (!mayDeleteComment({ commentAuthorId, recipeAuthorId, userId })) return null;

  return (
    <form action={deleteCommentAction} className={styles.deleteForm}>
      <input type="hidden" name="commentId" value={commentId} />
      <button type="submit" className={styles.delete}>
        Delete
      </button>
    </form>
  );
}
