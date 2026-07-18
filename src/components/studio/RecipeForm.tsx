"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button } from "@/components/ui/Button";
import { Field, SelectField, TextAreaField } from "@/components/ui/Field";
import { HERO_IMAGE_HOSTS } from "@/domain/hero-image-hosts";
import { RECIPE_LIMITS, type RecipeInput } from "@/domain/recipe-input";

import styles from "./RecipeForm.module.css";

import type { RecipeFormState } from "@/app/studio/actions";

/**
 * The recipe form, shared by creating one and editing one.
 *
 * **Every constraint on it comes from `RECIPE_LIMITS`**, which is the same
 * module the Server Action validates against. That is what "one schema shared
 * by the form and the action" buys: `maxLength` here and `.max()` there cannot
 * drift into a form that accepts more than the column holds, which turns a
 * typo into a Postgres error after the author has typed the whole thing.
 *
 * The native attributes are an enhancement, not the check. A browser will stop
 * most mistakes before a round trip and none of it is trusted -- the action
 * re-parses whatever actually arrives, because it is a public endpoint and the
 * body is whatever the sender chose.
 *
 * `useActionState` rather than `useState` and a fetch: the form posts to the
 * action, the action's answer comes back as `state`, and `pending` is managed
 * for us. It also degrades -- with JavaScript off, and in the window before
 * hydration, the form posts natively and the same action runs.
 *
 * **That degradation is why a refusal carries the submitted values back.** On
 * the hydrated path the DOM keeps whatever was typed and nothing needs to be
 * restored; on the native path the server renders a fresh form, and without
 * the echo below the author gets their error message and an empty form. The
 * test that was supposed to catch this passed for two phases because
 * hydration usually won the race -- it failed roughly one run in five, which
 * is exactly the frequency at which a real defect gets called a flake.
 */

const DIFFICULTIES = [
  { value: "EASY", label: "Easy" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HARD", label: "Hard" },
];

/** The fields as the form holds them: strings, because that is what a form has. */
export type RecipeFormDefaults = {
  id?: string;
} & Partial<Record<keyof RecipeInput, string | number | null>>;

export function RecipeForm({
  action,
  defaults = {},
  submitLabel,
  cancelHref,
}: {
  action: (state: RecipeFormState, formData: FormData) => Promise<RecipeFormState>;
  defaults?: RecipeFormDefaults;
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });

  const errors = state.status === "invalid" ? state.errors : {};
  const submitted = state.status === "invalid" ? state.values : {};

  const text = (value: string | number | null | undefined): string =>
    value === null || value === undefined ? "" : String(value);

  /**
   * What this field should start with: what was just submitted if the server
   * refused it, and the stored value otherwise.
   *
   * `defaultValue` rather than `value`, so these stay uncontrolled -- which is
   * what lets the hydrated path keep what is being typed while a submission is
   * in flight.
   */
  const initial = (name: keyof RecipeInput, stored?: string | number | null): string =>
    submitted[name] ?? text(stored ?? defaults[name]);

  return (
    <form action={formAction} className={styles.form} noValidate>
      {/*
       * The recipe's id, in the open.
       *
       * It is not a secret and treating it as one would be the mistake: this
       * value is attacker-controlled, exactly like every other field, and the
       * action has to authorize whatever it receives rather than trust that it
       * came from this form. Hiding it in an encrypted bound argument would
       * make the request harder to hand-write and no safer.
       */}
      {defaults.id === undefined ? null : <input type="hidden" name="id" value={defaults.id} />}

      {state.status === "saved" ? (
        <p className={styles.saved} role="status">
          Saved.
        </p>
      ) : null}

      {state.status === "invalid" ? (
        // A summary as well as the per-field messages. Somebody who submits a
        // long form and lands back at the top with nothing announced has no
        // idea anything happened.
        <p className={styles.problem} role="alert">
          That did not save. Check the fields marked below.
        </p>
      ) : null}

      <Field
        label="Title"
        name="title"
        defaultValue={initial("title")}
        error={errors.title}
        maxLength={RECIPE_LIMITS.title}
        required
        autoComplete="off"
      />

      <Field
        label="Summary"
        name="summary"
        defaultValue={initial("summary")}
        error={errors.summary}
        maxLength={RECIPE_LIMITS.summary}
        hint="One sentence, shown on cards and in the feed. Needed before publishing."
        autoComplete="off"
      />

      <TextAreaField
        label="Introduction"
        name="body"
        defaultValue={initial("body")}
        error={errors.body}
        maxLength={RECIPE_LIMITS.body}
        hint="Markdown. Headings, emphasis, lists and links."
        rows={10}
      />

      <Field
        label="Hero image URL"
        name="heroImageUrl"
        type="url"
        defaultValue={initial("heroImageUrl")}
        error={errors.heroImageUrl}
        maxLength={RECIPE_LIMITS.heroImageUrl}
        // The allowlist, said out loud rather than discovered by being
        // refused. There is no upload here on purpose; a URL field whose rules
        // are invisible is the worst of both.
        hint={`Optional. https, on ${HERO_IMAGE_HOSTS.join(" or ")}.`}
        autoComplete="off"
      />

      <div className={styles.row}>
        <Field
          label="Servings"
          name="servings"
          type="number"
          inputMode="numeric"
          defaultValue={initial("servings", defaults.servings ?? 4)}
          error={errors.servings}
          min={RECIPE_LIMITS.servings.min}
          max={RECIPE_LIMITS.servings.max}
          step={1}
          required
        />

        <Field
          label="Preparation (minutes)"
          name="prepMinutes"
          type="number"
          inputMode="numeric"
          defaultValue={initial("prepMinutes", defaults.prepMinutes ?? 10)}
          error={errors.prepMinutes}
          min={RECIPE_LIMITS.minutes.min}
          max={RECIPE_LIMITS.minutes.max}
          step={1}
          required
        />

        <Field
          label="Cooking (minutes)"
          name="cookMinutes"
          type="number"
          inputMode="numeric"
          defaultValue={initial("cookMinutes", defaults.cookMinutes ?? 20)}
          error={errors.cookMinutes}
          min={RECIPE_LIMITS.minutes.min}
          max={RECIPE_LIMITS.minutes.max}
          step={1}
          required
        />

        <SelectField
          label="Difficulty"
          name="difficulty"
          defaultValue={initial("difficulty", defaults.difficulty ?? "MEDIUM")}
          error={errors.difficulty}
          options={DIFFICULTIES}
        />
      </div>

      <div className={styles.actions}>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <Link href={cancelHref} className={styles.cancel}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
