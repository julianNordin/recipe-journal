import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

import styles from "./Surfaces.module.css";

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* --- Container ---------------------------------------------------------- */

export function Container({
  prose = false,
  as: Tag = "div",
  className,
  children,
}: {
  prose?: boolean;
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag className={cx(styles.container, prose && styles.containerProse, className)}>
      {children}
    </Tag>
  );
}

/* --- Card --------------------------------------------------------------- */

export function Card({
  interactive = false,
  as: Tag = "div",
  className,
  children,
  ...rest
}: {
  interactive?: boolean;
  as?: ElementType;
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"div">, "className" | "children">) {
  return (
    <Tag className={cx(styles.card, interactive && styles.cardInteractive, className)} {...rest}>
      {children}
    </Tag>
  );
}

/* --- Badge -------------------------------------------------------------- */

export type BadgeTone = "neutral" | "accent" | "success" | "danger";

// CSS Module exports are an index signature, so under noUncheckedIndexedAccess
// every lookup is string | undefined. cx() already drops falsy parts; the
// annotation just has to tell the truth about what it is holding.
const badgeTone: Record<BadgeTone, string | undefined> = {
  neutral: styles.badgeNeutral,
  accent: styles.badgeAccent,
  success: styles.badgeSuccess,
  danger: styles.badgeDanger,
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return <span className={cx(styles.badge, badgeTone[tone], className)}>{children}</span>;
}

/* --- EmptyState --------------------------------------------------------- */

/**
 * Shown wherever a list can legitimately be empty. Every such place gets one:
 * a bare empty <ul> reads as a bug to the person looking at it, and there are
 * several genuinely-empty states in this app (no drafts, no comments, a search
 * with no matches).
 */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{title}</p>
      {children ? <p className={styles.emptyBody}>{children}</p> : null}
      {action}
    </div>
  );
}
