import Link from "next/link";

import { HeaderAuth } from "@/components/auth/HeaderAuth";
import { Container } from "@/components/ui/Surfaces";

import styles from "./SiteHeader.module.css";

/**
 * A server component, and it stays one.
 *
 * The signed-in state is a client component inside it rather than a prop, for
 * the reason this comment carried from Phase 02: reading the session cookie on
 * the server opts a route out of static rendering, and this header sits in the
 * root layout -- so it would be every route. HeaderAuth explains the trade in
 * full.
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
            <HeaderAuth />
          </nav>
        </div>
      </Container>
    </header>
  );
}
