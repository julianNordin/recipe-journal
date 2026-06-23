import Link from "next/link";

import { Container } from "@/components/ui/Surfaces";

import styles from "./SiteHeader.module.css";

/**
 * A plain server component. The signed-in state arrives in Phase 10 and will
 * be passed down as a prop rather than fetched here -- a header that reaches
 * for the session itself makes every page that renders it dynamic.
 */
export function SiteHeader() {
  return (
    <header className={styles.header}>
      <Container>
        <div className={styles.inner}>
          <Link href="/" className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">
              ◆
            </span>
            Recipe Journal
          </Link>

          <nav className={styles.nav} aria-label="Main">
            <Link href="/recipes" className={styles.navLink}>
              Recipes
            </Link>
            <Link href="/tags" className={styles.navLink}>
              Tags
            </Link>
          </nav>
        </div>
      </Container>
    </header>
  );
}
