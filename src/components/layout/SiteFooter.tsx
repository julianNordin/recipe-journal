import { Container } from "@/components/ui/Surfaces";

import styles from "./SiteFooter.module.css";

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <Container>
        <div className={styles.inner}>
          <p>Recipe Journal — a Next.js App Router demonstration.</p>
          <p className={styles.muted}>Server-rendered. No client-side data layer.</p>
        </div>
      </Container>
    </footer>
  );
}
