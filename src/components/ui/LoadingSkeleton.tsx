import { Container } from "@/components/ui/Surfaces";

import styles from "./LoadingSkeleton.module.css";

/**
 * A streaming fallback, for use as a `<Suspense fallback>` around a genuinely
 * slow part of a page.
 *
 * **It lived at `src/app/loading.tsx` and was moved here in Phase 08, because
 * a root `loading.tsx` is a segment-level Suspense boundary around every page
 * in the app**, and that turned out to cost more than it bought:
 *
 *  - With scripting off, every page was this skeleton forever. Next sends the
 *    fallback in the first flush and streams the real content into a hidden
 *    container that inline scripts move into place; with no scripts, it never
 *    moves. The recipe was in the HTML and invisible on the screen -- which
 *    is a strange thing for a project whose point is that the server renders
 *    the page. The accessibility snapshot said `main: status: Loading`.
 *  - It also fires before anything is known to be slow. Nothing here is slow
 *    yet; the boundary was speculative.
 *
 * Phase 16 puts streaming back deliberately and narrowly: check what needs
 * checking first, call `notFound()` before opening a boundary, then wrap only
 * the slow component in `<Suspense>` with this as the fallback. That keeps the
 * shell -- heading, ingredients, method -- in the first flush where a reader
 * without JavaScript can still see it.
 *
 * Skeleton blocks rather than a spinner: they reserve the space the content
 * will occupy, so nothing jumps when it arrives.
 */
export function LoadingSkeleton() {
  return (
    <Container>
      <div className={styles.wrap} role="status" aria-live="polite">
        <span className="visually-hidden">Loading</span>
        <div className={styles.title} />
        <div className={styles.line} />
        <div className={styles.line} />
        <div className={`${styles.line} ${styles.short}`} />
      </div>
    </Container>
  );
}
