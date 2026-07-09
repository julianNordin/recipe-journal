import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { useId } from "react";

import styles from "./Field.module.css";

/**
 * A labelled form control, with its hint and its error wired to it.
 *
 * The plumbing is the reason this exists rather than the styling. Getting a
 * field right means a `<label>` whose `htmlFor` matches the input's `id`, an
 * `aria-describedby` naming *both* the hint and the error when both are
 * present, and `aria-invalid` set only when something is actually wrong.
 * Hand-written per form, one of those is always missing -- and the failure is
 * invisible unless somebody is listening to the page rather than looking at
 * it.
 *
 * Ids come from `useId`, so a form can render twice on one page without two
 * labels pointing at the same input.
 *
 * A server component. Nothing here needs client JavaScript; the form that
 * holds it may, but a labelled input does not.
 */
export function Field({
  label,
  hint,
  error,
  invalid: invalidProp,
  describedBy: extraDescribedBy,
  id,
  ...input
}: {
  label: string;
  hint?: ReactNode;
  /** A message about this field, rendered beneath it. */
  error?: string | null;
  /**
   * Mark the control invalid without rendering a message here.
   *
   * For a form-level error that is about several fields at once -- "that email
   * and password do not match" belongs to the pair, so repeating it under each
   * input would say it twice and imply each is separately wrong.
   */
  invalid?: boolean;
  /** Extra ids to reference, such as that form-level error's. */
  describedBy?: string;
} & Omit<ComponentPropsWithoutRef<"input">, "id"> & { id?: string }) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;

  const hasOwnError = error !== null && error !== undefined && error !== "";
  const invalid = hasOwnError || invalidProp === true;

  // Everything that describes this control, in the order it should be read:
  // the error first, because it is the most urgent, then the hint.
  const describedBy = [
    hasOwnError ? errorId : null,
    extraDescribedBy ?? null,
    hint === undefined ? null : hintId,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={styles.field}>
      <label htmlFor={fieldId} className={styles.label}>
        {label}
      </label>

      <input
        {...input}
        id={fieldId}
        className={styles.input}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        aria-invalid={invalid ? true : undefined}
      />

      {hint === undefined ? null : (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}

      {hasOwnError ? (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
