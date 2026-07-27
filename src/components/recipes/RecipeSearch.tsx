"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { RECIPE_SORT_LABELS, RECIPE_SORTS, type RecipeSort } from "@/domain/recipe-sort";

import styles from "./RecipeSearch.module.css";

/**
 * The search box on the recipe index, and the only thing in this application
 * that fetches.
 *
 * **It is a real GET form first and a typeahead second, and the order matters.**
 * With scripting off it submits to `/recipes`, the server filters and renders,
 * and the result is a URL that can be bookmarked and shared. The suggestions
 * are an enhancement on top of that -- they save a round trip, they are not how
 * the feature works.
 *
 * That is why this is the only client-side fetch here and why it is worth
 * pointing at. Every other read in the project happens in a Server Component
 * because there is a page to navigate to; a box that filters between
 * keystrokes has nothing to navigate to, which is the honest reason for an
 * endpoint rather than a habit.
 *
 * The request is debounced and every earlier one is aborted, so typing eight
 * characters costs one query rather than eight -- and, more importantly, a slow
 * early response cannot arrive after a fast late one and overwrite it. That
 * race is the classic typeahead bug and it looks like a caching problem.
 */

type Suggestion = { slug: string; title: string; author: string | null };

const DEBOUNCE_MS = 200;

export function RecipeSearch({ query, sort }: { query: string; sort: RecipeSort }) {
  const [term, setTerm] = useState(query);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const trimmed = term.trim();
  const showing = open && suggestions.length > 0 && trimmed !== "" && trimmed !== query.trim();
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = term.trim();

    /*
     * Nothing typed, or nothing changed since the page was rendered: no
     * request, and nothing to suggest over a result set that already matches.
     *
     * It returns without clearing the list rather than calling `setState` here.
     * Whether suggestions are *shown* is derived at render from the same two
     * conditions, so there is nothing for an effect to synchronise -- and an
     * effect whose job is to set state that could have been computed is the
     * shape `react-hooks/set-state-in-effect` exists to catch.
     */
    if (trimmed === "" || trimmed === query.trim()) return;

    const timer = setTimeout(() => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      void fetch(`/api/recipes?pageSize=5&q=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : { items: [] }))
        .then((body: { items: Suggestion[] }) => {
          setSuggestions(body.items);
          setOpen(true);
        })
        .catch(() => {
          // An aborted request is the ordinary case here, not a failure: it
          // means the reader kept typing. Anything else leaves the last
          // suggestions in place, which is better than emptying the list
          // under somebody mid-word.
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [term, query]);

  return (
    <form action="/recipes" method="get" role="search" className={styles.search}>
      <div className={styles.row}>
        <label className={styles.label} htmlFor="recipe-search">
          Search recipes
        </label>

        <input
          id="recipe-search"
          type="search"
          name="q"
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
          }}
          onBlur={() => {
            // A moment, so a click on a suggestion lands before the list goes.
            setTimeout(() => {
              setOpen(false);
            }, 150);
          }}
          className={styles.input}
          placeholder="sourdough, soup, cardamom…"
          autoComplete="off"
          /*
           * **A plain search field, not a combobox, and that is a decision.**
           *
           * It carried `role="combobox"` for one commit. The role is a promise
           * about keyboard interaction -- arrow keys through the options,
           * `aria-activedescendant` tracking which one is current, Escape to
           * dismiss -- and none of that was implemented. A half-built combobox
           * is worse than no combobox: it tells assistive technology to expect
           * a pattern that is not there, and a reader who follows the promise
           * finds the arrow keys moving the caret instead.
           *
           * What is here instead works completely: a labelled search input, a
           * live region that announces suggestions as they arrive, and links
           * that are reachable with Tab because they come next in the document.
           * Less ambitious, entirely true.
           */
          aria-describedby={listId}
        />

        {/*
         * Immediately after the input in document order, so Tab from the field
         * reaches the suggestions rather than the sort control. It is
         * positioned over the page, so where it sits in the markup is free.
         */}
        <div id={listId} className={styles.suggestions} aria-live="polite">
          {showing ? (
            <ul className={styles.list}>
              {suggestions.map((suggestion) => (
                <li key={suggestion.slug}>
                  <Link href={`/recipes/${suggestion.slug}`} className={styles.suggestion}>
                    <span className={styles.suggestionTitle}>{suggestion.title}</span>
                    {suggestion.author === null ? null : (
                      <span className={styles.suggestionAuthor}>{suggestion.author}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <label className={styles.label} htmlFor="recipe-sort">
          Order
        </label>
        <select id="recipe-sort" name="sort" defaultValue={sort} className={styles.select}>
          {RECIPE_SORTS.map((name) => (
            <option key={name} value={name}>
              {RECIPE_SORT_LABELS[name]}
            </option>
          ))}
        </select>

        {/* The form works without any of the above. This is how. */}
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </div>
    </form>
  );
}
