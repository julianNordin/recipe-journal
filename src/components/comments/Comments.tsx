import { SessionScope } from "@/components/auth/SessionScope";
import { CommentActions } from "@/components/comments/CommentActions";
import { CommentForm } from "@/components/comments/CommentForm";
import { formatLongDay } from "@/domain/format-date";
import { db } from "@/server/db";
import { listCommentsForRecipe } from "@/server/comments/queries";

import styles from "./Comments.module.css";

/**
 * A recipe's comments, and the box for adding one.
 *
 * **The list is server-rendered and cached with the page; only the controls
 * are client-side.** That split is the whole design: the comments are the same
 * for everybody, so they belong in the HTML the server sends, while who may
 * delete which one depends on who is looking and would take the route dynamic
 * if it were asked on the server. Same reasoning as the header, written up at
 * length in `HeaderAuth`.
 *
 * **Bodies are plain text, deliberately.** The recipe body goes through
 * `renderMarkdown` and its sanitiser, and that is a considered exception for
 * content its own author wrote. A comment is written by a stranger, and the
 * cheapest correct answer to "what may a stranger put on this page" is
 * "words". `white-space: pre-wrap` keeps their line breaks; nothing else is
 * interpreted, so there is no allowlist to get wrong and no sanitiser mutation
 * test to keep re-running.
 */
export async function Comments({
  recipeId,
  recipeAuthorId,
}: {
  recipeId: string;
  recipeAuthorId: string;
}) {
  const comments = await listCommentsForRecipe(db, recipeId);

  return (
    <SessionScope>
      <section className={styles.comments} aria-labelledby="comments">
        <h2 id="comments" className={styles.heading}>
          {comments.length === 0
            ? "Comments"
            : `${String(comments.length)} ${comments.length === 1 ? "comment" : "comments"}`}
        </h2>

        {comments.length === 0 ? (
          <p className={styles.none}>Nobody has said anything yet.</p>
        ) : (
          <ol className={styles.list}>
            {comments.map((comment) => (
              <li key={comment.id} className={styles.comment}>
                <p className={styles.byline}>
                  <span className={styles.who}>{comment.author.name ?? "Someone"}</span>
                  {" · "}
                  <time dateTime={comment.createdAt.toISOString()}>
                    {formatLongDay(comment.createdAt)}
                  </time>
                </p>
                <p className={styles.body}>{comment.body}</p>
                <CommentActions
                  commentId={comment.id}
                  commentAuthorId={comment.author.id}
                  recipeAuthorId={recipeAuthorId}
                />
              </li>
            ))}
          </ol>
        )}

        <CommentForm recipeId={recipeId} />
      </section>
    </SessionScope>
  );
}
