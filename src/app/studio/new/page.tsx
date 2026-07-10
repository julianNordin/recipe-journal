import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RecipeForm } from "@/components/studio/RecipeForm";
import { Card, Container } from "@/components/ui/Surfaces";
import { signInPath } from "@/domain/safe-redirect";
import { getSession } from "@/server/session";

import { createRecipeAction } from "../actions";
import styles from "../page.module.css";

export const metadata: Metadata = {
  title: "New recipe",
  robots: { index: false, follow: false },
};

/**
 * A server component wrapping one client form.
 *
 * The session check is here as well as in `src/proxy.ts` for the reason the
 * dashboard gives at length: the proxy runs beside the router, not inside it,
 * and a page that leaned on it would be trusting something that can be skipped.
 *
 * `createRecipeAction` is passed down as a prop. That is the ordinary way to
 * hand a Server Action to a client component, and it is worth noticing what it
 * does *not* do: the client never learns anything about the action beyond an
 * id it can post to -- which is also true of anyone else who watches the
 * request go by.
 */
export default async function NewRecipePage() {
  const user = await getSession();
  if (user === null) redirect(signInPath("/studio/new"));

  return (
    <Container>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>New recipe</h1>
          <p className={styles.who}>
            It starts as a draft. Nothing is public until you publish it.
          </p>
        </div>
      </header>

      <div className={styles.section}>
        <Card>
          <RecipeForm action={createRecipeAction} submitLabel="Create draft" cancelHref="/studio" />
        </Card>
      </div>
    </Container>
  );
}
