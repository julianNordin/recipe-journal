import { Container } from "@/components/ui/Surfaces";

import styles from "./loading.module.css";

/**
 * The streaming fallback. Its real job starts in Phase 16, where the shell is
 * sent immediately and the slow query resolves inside a Suspense boundary --
 * this file is what the browser paints in the meantime.
 *
 * Skeleton blocks rather than a spinner: they reserve the space the content
 * will occupy, so nothing jumps when it arrives.
 */
export default function Loading() {
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
