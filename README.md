# Recipe Journal

A small recipe site with authoring and authentication, built on the Next.js App Router.

The point of the project is the thing a single-page app and a headless API each only do half of:
**the server renders the page and owns the data.** Server Components read the database directly,
Server Actions write through it, and there is no client-side data-fetching layer at all.

## Stack

|           |                                                                   |
| --------- | ----------------------------------------------------------------- |
| Framework | Next.js 16 (App Router), React 19, TypeScript                     |
| Data      | PostgreSQL 18, Prisma 7 with the `pg` driver adapter              |
| Auth      | NextAuth v4 — credentials and GitHub OAuth                        |
| Styling   | CSS Modules over design tokens. No utility framework              |
| Tests     | Vitest (unit + a Testcontainers-backed database tier), Playwright |

## Status

Under construction. The roadmap below is ticked as each phase lands.

- [x] 01 — Scaffold and tooling
- [x] 02 — App shell, design tokens and primitives
- [x] 03 — Postgres, Prisma and the core models
- [x] 04 — Full schema, relations and seed data
- [ ] 05 — Test harness: Vitest projects and Testcontainers
- [ ] 06 — Hand-written constraints, each with its proving test
- [ ] 07 — Domain layer: the pure rules
- [ ] 08 — Recipe detail, the SSR proof and Playwright
- [ ] 09 — Listing, tags and paging
- [ ] 10 — Authentication: NextAuth and credentials
- [ ] 11 — Authentication: GitHub OAuth and route protection
- [ ] 12 — Studio: dashboard and the create/edit actions
- [ ] 13 — The ingredient and step editor
- [ ] 14 — Authorization at the Server Action boundary
- [ ] 15 — The publish workflow and slug history
- [ ] 16 — Caching, revalidation and streaming
- [ ] 17 — Comments and moderation
- [ ] 18 — Search, filters, paging and the N+1
- [ ] 19 — SEO, feeds and social images
- [ ] 20 — Accessibility and the end-to-end journeys
- [ ] 21 — Ship: container, CI and release

## Running it

```bash
npm install
npm run dev
```

Requires Node 24 and Docker.

```bash
npm run db:up        # postgres 18 in a container
npm run db:migrate   # apply migrations
```

## The data model

Two decisions are worth explaining, because both look like over-engineering until
the alternative is tried.

**A recipe has no `slug` column.** `recipe_slugs` holds every slug a recipe has ever
had, keyed by the slug itself, with `is_current` marking the live one. Global
uniqueness therefore comes free from the primary key, and renaming a published
recipe does not break its old URL: the row stays, `is_current` flips, and the old
address permanently redirects to the new one. A partial unique index enforces
exactly one current slug per recipe.

The obvious alternative — a `slug` column plus a history table — has two sources of
truth for the same fact and no way to stop them disagreeing.

**Ingredient and step positions are dense, 0-based, and unique per recipe, with a
`DEFERRABLE` constraint.** Reordering swaps two positions inside one transaction,
and a plain `UNIQUE` rejects the intermediate state where both rows briefly hold
the same number. Deferring the check to `COMMIT` is the fix; the alternative of
renumbering through negative offsets is twice the queries and easy to get wrong.

Four things the schema cannot express in Prisma's language and so are hand-written
into migration SQL: that partial unique index, a `lower(email)` functional index,
the two deferrable position constraints, and a `CHECK` tying `status = 'PUBLISHED'`
to `published_at IS NOT NULL` so no code path can produce a half-published recipe.

Consequently **`prisma db push` is not used in this repository** — it reconciles the
database to the schema file and would silently drop all of them. Only `migrate dev`
and `migrate deploy`, which replay the migration history verbatim.

**The `sessions` table is created and never read.** A credentials provider forces
JWT sessions, which live in a cookie; the NextAuth adapter's contract still requires
the table to exist. It is documented in the schema rather than quietly present.

### Working with the database

```bash
npm run db:up        # postgres 18 in a container
npm run db:migrate   # apply migrations
npm run db:seed      # two authors, three recipes, four tags
npm run db:studio    # browse it
```

The seed is idempotent — every write is an upsert keyed on something stable, so
running it repeatedly is a no-op. Every date in it is a fixed literal, so the
fixture is identical on every run.

## Scripts

| Script                 | What it does                               |
| ---------------------- | ------------------------------------------ |
| `npm run dev`          | Development server                         |
| `npm run build`        | Production build                           |
| `npm run lint`         | ESLint, including type-aware rules         |
| `npm run typecheck`    | Generates route types, then `tsc --noEmit` |
| `npm run format`       | Prettier, writing in place                 |
| `npm run format:check` | Prettier, failing on any drift             |

## Testing

Two tiers, kept apart on purpose.

| Tier   | Command             | Needs Docker | What it covers                                        |
| ------ | ------------------- | ------------ | ----------------------------------------------------- |
| `unit` | `npm run test:unit` | no           | Pure logic — validation, domain rules                 |
| `db`   | `npm run test:db`   | yes          | Real Postgres: queries, constraints, delete behaviour |

The fast tier has no database dependency at all, verified by running it with
`DATABASE_URL` unset. That matters more than it sounds: a fast tier that cannot
run without Docker is not a fast tier, and Docker is not always running.

The database tier starts one Postgres 18 container for the whole run — the same
major the application uses, because the constraints this schema leans on are
version-sensitive — applies migrations with `migrate deploy`, and truncates
between tests.

**Truncation, not `migrate reset`.** Measured here at **23.7 ms** median over 25
runs across 11 tables. A reset drops and replays the whole migration history and
is two orders of magnitude slower. The measurement lives in the suite rather than
in a comment, so it stays current.

The table list is read from `pg_tables` rather than written by hand. A hard-coded
list quietly stops truncating whatever gets added next, and the symptom — a test
that passes alone and fails in a suite — is a long way from the cause.

**Query functions take their Prisma client as an argument.** The application hands
them the `server-only` singleton; tests hand them one pointed at the container.
Without that, the data layer could only be tested through a browser.

## Notes on the toolchain

Three versions are pinned exactly rather than left on a caret range, each for a reason worth
recording:

- **TypeScript is pinned to 5.9.3.** The current `latest` is 7.x, the native compiler, which ships
  no programmatic compiler API. Type-aware lint rules need one.
- **ESLint is pinned to 9.39.5.** Version 10 removes a context API that `eslint-plugin-react` still
  calls, and `eslint-config-next` bundles that plugin, so the linter fails to start on 10.
- **`npm run typecheck` runs `next typegen` first.** Next generates `PageProps` and `LayoutProps`
  into `.next/types`, so a bare `tsc --noEmit` fails on a clean checkout while `next build` passes.
