"use client";

import { useActionState, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { describeMove, listReducer, type Keyed, type ListAction } from "@/domain/list-editor";
import { LIST_LIMITS, type IngredientInput, type StepInput } from "@/domain/recipe-lists";

import { saveRecipeListsAction } from "@/app/studio/actions";

import styles from "./RecipeListsEditor.module.css";

/**
 * The ingredient and step editor.
 *
 * **Everything interesting about it is somewhere else**, which is the point.
 * The ordering rules are `src/domain/positions.ts`, the reducer is
 * `src/domain/list-editor.ts`, and the payload's rules are
 * `src/domain/recipe-lists.ts` -- all pure, all unit-tested, none of them
 * reachable only through a browser. What is left here is the parts a browser
 * is genuinely required for: focus, announcements, and a form.
 *
 * **The component holds the authoritative list**, so it posts the whole list
 * as JSON in one hidden field rather than as a spray of indexed inputs. The
 * row inputs carry no `name` at all -- they are React state, not form fields,
 * and reconstructing the order from DOM position would be a second source of
 * truth for the thing this component exists to decide.
 *
 * The cost is that this form needs JavaScript. That is the right trade for an
 * authoring tool whose central interaction is reordering, and it is not a
 * trade the public site makes: every reading surface renders on the server and
 * is covered by the no-js Playwright project.
 */

type IngredientRow = Keyed & IngredientInput;
type StepRow = Keyed & StepInput;

/** Rows as they arrive from the database: the row id is the key. */
type SavedIngredient = { id: string } & IngredientInput;
type SavedStep = { id: string } & StepInput;

export function RecipeListsEditor({
  recipeId,
  ingredients: savedIngredients,
  steps: savedSteps,
}: {
  recipeId: string;
  ingredients: SavedIngredient[];
  steps: SavedStep[];
}) {
  const [state, formAction, pending] = useActionState(saveRecipeListsAction, {
    status: "idle",
  });

  const [ingredients, setIngredients] = useState<IngredientRow[]>(() =>
    savedIngredients.map(({ id, ...rest }) => ({ key: id, ...rest })),
  );
  const [steps, setSteps] = useState<StepRow[]>(() =>
    savedSteps.map(({ id, ...rest }) => ({ key: id, ...rest })),
  );

  /*
   * Keys for rows that have never been saved.
   *
   * A counter rather than `crypto.randomUUID()`: it needs no secure context,
   * it cannot collide within one editor, and the value is never persisted --
   * the server assigns real ids and the next page load reads those.
   */
  const nextKey = useRef(0);
  const newKey = () => `new-${String((nextKey.current += 1))}`;

  const [announcement, setAnnouncement] = useState("");

  /*
   * **Focus follows the row, and `key={row.key}` is the only thing making it
   * do so.** Measured, because the obvious guess is wrong in both directions:
   * an effect that re-focused the button by hand turned out to change nothing
   * -- Chromium keeps focus on a node React moves -- while replacing the key
   * with the array index breaks it, and breaks it silently. With index keys
   * React updates the rows in place instead of moving them, so focus stays on
   * a *position* while the row it belonged to moves out from under it: the
   * second press then reorders whatever landed there. That is the stale-index
   * bug the reducer avoids by addressing rows by key, reappearing one layer up
   * in the render. `tests/e2e/recipe-lists.spec.ts` presses twice for exactly
   * this reason.
   */
  function moveRow<T extends Keyed & { position: number }>(
    items: T[],
    setItems: (next: T[]) => void,
    key: string,
    label: string,
    delta: number,
  ) {
    const next = listReducer(items, { type: "move", key, delta });
    setItems(next);
    setAnnouncement(describeMove(items, next, key, label));
  }

  const payload = useMemo(
    () =>
      JSON.stringify({
        // The key is the editor's business and means nothing to the server.
        ingredients: ingredients.map(({ key: _key, ...rest }) => rest),
        steps: steps.map(({ key: _key, ...rest }) => rest),
      }),
    [ingredients, steps],
  );

  return (
    <form action={formAction} className={styles.editor}>
      <input type="hidden" name="id" value={recipeId} />
      <input type="hidden" name="lists" value={payload} />

      {/*
       * One live region for both lists. Announcements are one at a time, and
       * two regions would race each other on a page where only one list can be
       * moving.
       */}
      <p aria-live="polite" className={styles.srOnly}>
        {announcement}
      </p>

      {state.status === "saved" ? (
        <p className={styles.saved} role="status">
          Saved.
        </p>
      ) : null}

      <section className={styles.list} aria-labelledby="ingredients-heading">
        <div className={styles.listHead}>
          <h2 id="ingredients-heading" className={styles.listTitle}>
            Ingredients
          </h2>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setIngredients(
                listReducer(ingredients, {
                  type: "append",
                  item: {
                    key: newKey(),
                    position: 0,
                    quantity: null,
                    unit: null,
                    item: "",
                    note: null,
                  },
                } satisfies ListAction<IngredientRow>),
              )
            }
          >
            Add ingredient
          </Button>
        </div>

        {state.status === "invalid" && state.errors.ingredients !== undefined ? (
          <p className={styles.problem} role="alert">
            {state.errors.ingredients}
          </p>
        ) : null}

        {ingredients.length === 0 ? (
          <p className={styles.none}>No ingredients yet.</p>
        ) : (
          <ol className={styles.rows}>
            {ingredients.map((row, index) => (
              <li key={row.key} className={styles.row}>
                <RowControls
                  index={index}
                  total={ingredients.length}
                  label={row.item === "" ? `Ingredient ${String(index + 1)}` : row.item}
                  onMove={(delta) =>
                    moveRow(
                      ingredients,
                      setIngredients,
                      row.key,
                      row.item === "" ? `Ingredient ${String(index + 1)}` : row.item,
                      delta,
                    )
                  }
                  onRemove={() =>
                    setIngredients(listReducer(ingredients, { type: "remove", key: row.key }))
                  }
                />

                <div className={styles.ingredientFields}>
                  <RowInput
                    label={`Quantity for ingredient ${String(index + 1)}`}
                    placeholder="500"
                    value={row.quantity ?? ""}
                    maxLength={LIST_LIMITS.ingredient.quantity}
                    className={styles.short}
                    onChange={(quantity) =>
                      setIngredients(
                        listReducer(ingredients, {
                          type: "update",
                          key: row.key,
                          patch: { quantity },
                        }),
                      )
                    }
                  />
                  <RowInput
                    label={`Unit for ingredient ${String(index + 1)}`}
                    placeholder="g"
                    value={row.unit ?? ""}
                    maxLength={LIST_LIMITS.ingredient.unit}
                    className={styles.short}
                    onChange={(unit) =>
                      setIngredients(
                        listReducer(ingredients, { type: "update", key: row.key, patch: { unit } }),
                      )
                    }
                  />
                  <RowInput
                    label={`Ingredient ${String(index + 1)}`}
                    placeholder="strong white flour"
                    value={row.item}
                    maxLength={LIST_LIMITS.ingredient.item}
                    onChange={(item) =>
                      setIngredients(
                        listReducer(ingredients, { type: "update", key: row.key, patch: { item } }),
                      )
                    }
                  />
                  <RowInput
                    label={`Note for ingredient ${String(index + 1)}`}
                    placeholder="at room temperature"
                    value={row.note ?? ""}
                    maxLength={LIST_LIMITS.ingredient.note}
                    onChange={(note) =>
                      setIngredients(
                        listReducer(ingredients, { type: "update", key: row.key, patch: { note } }),
                      )
                    }
                  />
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className={styles.list} aria-labelledby="steps-heading">
        <div className={styles.listHead}>
          <h2 id="steps-heading" className={styles.listTitle}>
            Method
          </h2>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setSteps(
                listReducer(steps, {
                  type: "append",
                  item: { key: newKey(), position: 0, text: "" },
                } satisfies ListAction<StepRow>),
              )
            }
          >
            Add step
          </Button>
        </div>

        {state.status === "invalid" && state.errors.steps !== undefined ? (
          <p className={styles.problem} role="alert">
            {state.errors.steps}
          </p>
        ) : null}

        {steps.length === 0 ? (
          <p className={styles.none}>No steps yet.</p>
        ) : (
          <ol className={styles.rows}>
            {steps.map((row, index) => (
              <li key={row.key} className={styles.row}>
                <RowControls
                  index={index}
                  total={steps.length}
                  label={`Step ${String(index + 1)}`}
                  onMove={(delta) =>
                    moveRow(steps, setSteps, row.key, `Step ${String(index + 1)}`, delta)
                  }
                  onRemove={() => setSteps(listReducer(steps, { type: "remove", key: row.key }))}
                />

                <label className={styles.srOnly} htmlFor={`step-${row.key}`}>
                  {`Step ${String(index + 1)}`}
                </label>
                <textarea
                  id={`step-${row.key}`}
                  className={styles.stepText}
                  rows={2}
                  placeholder="Fold every thirty minutes for three hours."
                  maxLength={LIST_LIMITS.step.text}
                  value={row.text}
                  onChange={(event) =>
                    setSteps(
                      listReducer(steps, {
                        type: "update",
                        key: row.key,
                        patch: { text: event.target.value },
                      }),
                    )
                  }
                />
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className={styles.actions}>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : "Save ingredients and method"}
        </Button>
      </div>
    </form>
  );
}

/**
 * The reorder and remove controls, shared by both lists.
 *
 * **Both move buttons stay enabled at either end.** Disabling one removes the
 * focused element from the tab order and the focus with it, so somebody
 * pressing "up" repeatedly would be dumped on the document body exactly when
 * the row arrived first. `moveBy` clamps, so the press is a no-op, and
 * `describeMove` says so out loud instead.
 */
function RowControls({
  index,
  total,
  label,
  onMove,
  onRemove,
}: {
  index: number;
  total: number;
  label: string;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className={styles.controls}>
      <span className={styles.number} aria-hidden="true">
        {index + 1}
      </span>

      {/*
       * Accessible names say which row, because "Move up" repeated eight times
       * down a list is eight identically named buttons.
       */}
      <button
        type="button"
        className={styles.control}
        aria-label={`Move ${label} up`}
        onClick={() => {
          onMove(-1);
        }}
      >
        <span aria-hidden="true">↑</span>
      </button>

      <button
        type="button"
        className={styles.control}
        aria-label={`Move ${label} down`}
        onClick={() => {
          onMove(1);
        }}
      >
        <span aria-hidden="true">↓</span>
      </button>

      <button
        type="button"
        className={styles.control}
        aria-label={`Remove ${label}`}
        onClick={onRemove}
      >
        <span aria-hidden="true">×</span>
      </button>

      <span className={styles.srOnly}>{`${String(index + 1)} of ${String(total)}`}</span>
    </div>
  );
}

/** A labelled input with no visible label, because the row is the label. */
function RowInput({
  label,
  value,
  onChange,
  className,
  ...rest
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
} & Omit<React.ComponentPropsWithoutRef<"input">, "value" | "onChange" | "className">) {
  return (
    <input
      {...rest}
      className={`${styles.input ?? ""} ${className ?? ""}`}
      aria-label={label}
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  );
}
