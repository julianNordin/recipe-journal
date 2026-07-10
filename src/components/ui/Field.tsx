import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { useId } from "react";

import styles from "./Field.module.css";

/**
 * A labelled form control, with its hint and its error wired to it.
 *
 * The plumbing is the reason this exists rather than the styling. Getting a
 * field right means a `<label>` whose `htmlFor` matches the control's `id`, an
 * `aria-describedby` naming *both* the hint and the error when both are
 * present, and `aria-invalid` set only when something is actually wrong.
 * Hand-written per form, one of those is always missing -- and the failure is
 * invisible unless somebody is listening to the page rather than looking at
 * it.
 *
 * Ids come from `useId`, so a form can render twice on one page without two
 * labels pointing at the same control.
 *
 * **Three controls, one set of plumbing.** An input, a textarea and a select
 * differ in one element and share every accessibility concern, so the shared
 * part is a shell they all render into. Writing the second one by hand is how
 * a form ends up with two of them labelled and one not.
 *
 * Server components. Nothing here needs client JavaScript; the form that holds
 * them may, but a labelled control does not.
 */

type Shared = {
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
  id?: string;
};

/** Everything the shell and the control have to agree about. */
function useFieldPlumbing({ id, hint, error, invalid, describedBy }: Omit<Shared, "label">) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  const hasOwnError = error !== null && error !== undefined && error !== "";

  // Everything that describes this control, in the order it should be read:
  // the error first, because it is the most urgent, then the hint.
  const described = [
    hasOwnError ? `${fieldId}-error` : null,
    describedBy ?? null,
    hint === undefined ? null : `${fieldId}-hint`,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    fieldId,
    hasOwnError,
    control: {
      id: fieldId,
      "aria-describedby": described === "" ? undefined : described,
      "aria-invalid": hasOwnError || invalid === true ? (true as const) : undefined,
    },
  };
}

function FieldShell({
  fieldId,
  label,
  hint,
  error,
  hasOwnError,
  children,
}: {
  fieldId: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
  hasOwnError: boolean;
  children: ReactNode;
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={fieldId} className={styles.label}>
        {label}
      </label>

      {children}

      {hint === undefined ? null : (
        <p id={`${fieldId}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}

      {hasOwnError ? (
        <p id={`${fieldId}-error`} className={styles.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  invalid,
  describedBy,
  id,
  ...input
}: Shared & Omit<ComponentPropsWithoutRef<"input">, "id">) {
  const { fieldId, hasOwnError, control } = useFieldPlumbing({
    id,
    hint,
    error,
    invalid,
    describedBy,
  });

  return (
    <FieldShell fieldId={fieldId} label={label} hint={hint} error={error} hasOwnError={hasOwnError}>
      <input {...input} {...control} className={styles.input} />
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  invalid,
  describedBy,
  id,
  ...textarea
}: Shared & Omit<ComponentPropsWithoutRef<"textarea">, "id">) {
  const { fieldId, hasOwnError, control } = useFieldPlumbing({
    id,
    hint,
    error,
    invalid,
    describedBy,
  });

  return (
    <FieldShell fieldId={fieldId} label={label} hint={hint} error={error} hasOwnError={hasOwnError}>
      <textarea
        {...textarea}
        {...control}
        className={`${styles.input ?? ""} ${styles.textarea ?? ""}`}
      />
    </FieldShell>
  );
}

export function SelectField({
  label,
  hint,
  error,
  invalid,
  describedBy,
  id,
  options,
  ...select
}: Shared &
  Omit<ComponentPropsWithoutRef<"select">, "id" | "children"> & {
    options: { value: string; label: string }[];
  }) {
  const { fieldId, hasOwnError, control } = useFieldPlumbing({
    id,
    hint,
    error,
    invalid,
    describedBy,
  });

  return (
    <FieldShell fieldId={fieldId} label={label} hint={hint} error={error} hasOwnError={hasOwnError}>
      {/*
       * No empty first option. Every select in this form has a real default,
       * and a blank one that means "not chosen" is a second way to say what
       * the schema already refuses.
       */}
      <select {...select} {...control} className={`${styles.input ?? ""} ${styles.select ?? ""}`}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}
