"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Surfaces";
import { isPubliclyVisible, PUBLISH_PROBLEM_MESSAGES } from "@/domain/publish";

import styles from "./PublishPanel.module.css";

import type { PublishFormState } from "@/app/studio/actions";
import { setRecipePublishedAction } from "@/app/studio/actions";

/**
 * Whether a recipe is public, and the one control that changes it.
 *
 * **The panel holds the answer, not the page.** Nothing is revalidated when a
 * recipe is published, so the server component around this does not re-render
 * -- and a panel that read only its `status` prop would go on saying "Draft"
 * after the author had just published, which reads as a broken button.
 * `useActionState` gives it the server's answer directly, and that is what it
 * shows. A reload agrees, because the studio's pages are dynamic.
 *
 * The public list is a different story and stays stale until the next build.
 * That is deliberate and is Phase 16's subject; papering over it here would
 * delete the demonstration.
 */
export function PublishPanel({
  recipeId,
  status,
  slug,
}: {
  recipeId: string;
  status: "DRAFT" | "PUBLISHED";
  slug: string | null;
}) {
  const [state, formAction, pending] = useActionState<PublishFormState, FormData>(
    setRecipePublishedAction,
    { status: "idle" },
  );

  // The server's last word if there is one, and what the page was rendered
  // with otherwise. `isPubliclyVisible` rather than a comparison written out
  // here: "public" is a rule, it lives in the domain module with the rest of
  // them, and a second copy of it in a component is how the two drift.
  const published = state.status === "changed" ? state.published : isPubliclyVisible({ status });
  const intent = published ? "unpublish" : "publish";

  return (
    /*
     * A named region, not a bare div. It gives the panel a landmark of its own
     * in the accessibility tree -- one of three on this page, beside the
     * ingredient and step lists -- and it is what lets a test address this
     * alert rather than Next's route announcer, which is a bare `role="alert"`
     * div and matches first.
     */
    <section className={styles.panel} aria-label="Publishing">
      <div className={styles.state}>
        <Badge tone={published ? "success" : "neutral"}>{published ? "Published" : "Draft"}</Badge>
        <p className={styles.where}>
          {published ? (
            slug === null ? (
              // A published recipe with no slug has no address to offer. It
              // should not be reachable -- createRecipe writes both rows in
              // one transaction -- so saying so plainly beats a dead link.
              "Public, but it has no address yet."
            ) : (
              <Link href={`/recipes/${slug}`}>View the public page</Link>
            )
          ) : (
            "Not public yet. Nobody but you can see it."
          )}
        </p>
      </div>

      {state.status === "blocked" ? (
        <div className={styles.blocked} role="alert">
          {/*
           * Every reason at once. One at a time would mean fix, save, publish,
           * be told the next one -- four round trips for four omissions, and
           * the author has no way to see how far off they are.
           */}
          <p className={styles.blockedTitle}>Not ready to publish yet:</p>
          <ul className={styles.problems}>
            {state.problems.map((problem) => (
              <li key={problem}>{PUBLISH_PROBLEM_MESSAGES[problem]}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <form action={formAction} className={styles.form}>
        {/* Both in the open, both attacker-controlled, both re-checked on the
            server. The id is what `requireRecipeAuthor` is given. */}
        <input type="hidden" name="id" value={recipeId} />
        <input type="hidden" name="intent" value={intent} />

        <Button
          type="submit"
          variant={published ? "secondary" : "primary"}
          size="lg"
          disabled={pending}
        >
          {pending
            ? published
              ? "Unpublishing…"
              : "Publishing…"
            : published
              ? "Unpublish"
              : "Publish"}
        </Button>
      </form>
    </section>
  );
}
