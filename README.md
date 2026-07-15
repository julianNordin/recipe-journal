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
- [x] 05 — Test harness: Vitest projects and Testcontainers
- [x] 06 — Hand-written constraints, each with its proving test
- [x] 07 — Domain layer: the pure rules
- [x] 08 — Recipe detail, the SSR proof and Playwright
- [x] 09 — Listing, tags and paging
- [x] 10 — Authentication: NextAuth and credentials
- [x] 11 — Authentication: GitHub OAuth and route protection
- [x] 12 — Studio: dashboard and the create/edit actions
- [x] 13 — The ingredient and step editor
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

Four kinds of constraint the schema language cannot express are hand-written into
migration SQL, each with a test that was watched to fail first:

| Constraint                        | Why Prisma cannot express it                                  |
| --------------------------------- | ------------------------------------------------------------- |
| `ux_recipe_slug_current`          | Partial index — `UNIQUE (recipe_id) WHERE is_current`         |
| `ux_users_email_lower`            | Functional index — `UNIQUE (lower(email))`                    |
| `ux_recipe_*_position`            | `DEFERRABLE INITIALLY DEFERRED`, so a swap can commit         |
| `ck_recipes_published_consistent` | `CHECK ((status = 'PUBLISHED') = (published_at IS NOT NULL))` |

The deferrable pair is the interesting one. Only constraints can be deferred, not
indexes, so Prisma's generated unique indexes are dropped and re-added as
constraints checked at `COMMIT` rather than per statement.

That the tests genuinely bite was confirmed by mutation: removing `DEFERRABLE`
from the migration fails exactly the three reorder tests and nothing else.

Consequently **`prisma db push` is not used in this repository** — it reconciles the
database to the schema file and would silently drop all of them. Only `migrate dev`
and `migrate deploy`, which replay the migration history verbatim.

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

## Authentication

Two ways in, and one of them is optional.

**Email and password**, hashed with Argon2id at OWASP's current parameters — 19 MiB, two
passes, one lane, stated rather than defaulted. The seed creates two demo authors, so a
fresh clone signs in with nothing else configured. Everything that decides who someone is
lives in `authenticate(db, input)` and is tested against real Postgres, including nine
shapes of input no form would send; the provider's `authorize` is a one-liner calling it,
because that endpoint is public and its body is whatever the caller chose to post.

**GitHub**, when `GITHUB_ID` and `GITHUB_SECRET` are both set. Half a pair is rejected at
boot rather than at the callback. With neither set, the provider is absent and so is the
button — offering a handshake that dead-ends on somebody else's error page is worse than
offering nothing.

**Sessions are JWTs, and not by preference.** NextAuth refuses database sessions whenever a
credentials provider is configured: there is no session row it can revoke for a login it did
not create. So `session.strategy` is forced to `jwt`, and **the adapter's `sessions` table
is created by a migration and read by nothing.** Saying so here, in the schema and in a doc
comment beats shipping a table that looks load-bearing and is not.

One consequence worth knowing: a role change does not take effect until the next sign-in.
The claims are copied onto the token once, on the request that signs in, because that is the
only request where the user is in hand. That is a property of JWT sessions rather than of
this code.

### The adapter, and what checks it now

`@next-auth/prisma-adapter` was last published in 2023 and types its argument as the
`PrismaClient` from `@prisma/client`. That type no longer exists: the package's entry point
re-exports `.prisma/client`, which only the legacy generator wrote, and Prisma 7 does not
ship it.

The expectation was a documented cast. There is nothing to cast: **an import that does not
resolve degrades to `any`**, so the adapter accepts this client, a string, or anything else,
with no assertion to write and nothing to explain. That is worse than a cast, which is at
least visible enough to attract a comment.

So the checking moved to a test. `tests/db/auth-adapter.test.ts` drives the adapter against
real Postgres in the order a GitHub sign-in walks it — create a user from a profile carrying
no id, link an account row, find the user back through the compound key, unlink, delete.
That it bites was measured: renaming that compound key so the adapter and the client
disagree fails exactly three of its twelve cases, while `tsc --noEmit` stays green.

### `proxy.ts` is a redirect, not a guard

Next 16 renamed `middleware.ts` to `proxy.ts` and dropped edge-runtime support there, which
also removes the reason `next-auth/middleware` exists — that wrapper solves an edge problem
this project does not have. What is left is twelve explicit lines: read the token, or send
the visitor to `/signin` with a `callbackUrl` built through the same rule the sign-in page
validates it with.

**It is not a security boundary, and the distinction is the point of the project.** A proxy
knows who is asking and nothing about what they are asking for — not which recipe a Server
Action is about to write to, not whether this author owns it — and it only sees what the
router sees. The real check goes on the single seam every mutation passes through.

It also has to live in `src/`, beside `app/`, because that is the only directory Next looks
in. A `proxy.ts` at the repository root builds clean, typechecks clean, lints clean and
never runs. The build's route table prints `Proxy (Middleware)` when it has been found.

## Authorization

**A Server Action is a public HTTP endpoint.** Writing `"use server"` above a function
publishes it: a POST, to any route on the site, identified by a stable id in a
`Next-Action` header, with a body the sender writes. Nothing about calling it from a form
suggests any of that, which is what makes this the most common real mistake in an App
Router codebase.

The project demonstrates it rather than asserting it. `tests/e2e/action-boundary.spec.ts`
watches the request the editor sends when an author saves, and then sends it again by hand.
What that measured, against a production build:

| Sent again                                              | Result                             |
| ------------------------------------------------------- | ---------------------------------- |
| with the author's own cookies                           | writes                             |
| posted at `/` or `/recipes` instead of the editor's URL | writes                             |
| with `Origin` or `Next-Router-State-Tree` removed       | writes                             |
| with no cookies at all, at `/`                          | refused by the action              |
| with no cookies at all, at the editor's URL             | **307 to `/signin`, by the proxy** |

The last two rows are the same request. Aimed at the studio it is redirected, and a client
that followed redirects would record that as a refusal. Aimed one path to the left it
reaches the action untouched, because `src/proxy.ts` matches `/studio/:path*` and the action
id resolves on every route. **A proxy is an optimistic redirect for humans, not a security
boundary** — the shape of CVE-2025-29927, whose patch is in this version and is not the
lesson.

### Where the check actually lives

`src/server/session.ts`, which is the one seam every mutation already passes through, and
one line in each action:

```ts
await requireRecipeAuthor(id); // not requireUser()
```

Authentication says somebody is signed in. It says nothing about whose recipe the `id` in
the form names — and that id travels in a plain hidden input, in the open, because it is
attacker-controlled either way and hiding it would be a decoration rather than a defence.

Both editing actions shipped without the check on purpose, so the hole could be watched
instead of described. A request captured from one author's editor and sent again with the
other's cookies answered `{"status":"saved"}` and left his text in her draft.
`tests/e2e/authorization.spec.ts` is that replay, and removing either guard fails it again.

Nothing about the interface was wrong, and that is the part worth keeping. The editor page
reads through `findAuthoredRecipe`, scoped by author, so no form the application renders can
be made to carry somebody else's id. "Unreachable through the interface" was true — and the
replayed request never went near the interface.

The refusal collapses _absent_, _not a uuid_ and _somebody else's_ into one answer, so a
stranger cannot use the difference to find out which recipe ids are real.

### Two rules, not one

Publication and ownership are separate, enforced in separate places, and conflating them is
how one of them ends up unenforced:

- **Ownership** decides who may edit. It is checked in the action, and in the studio's
  queries, which are scoped by author in the `where` rather than filtered afterwards.
- **Publication** decides what is public. `/recipes/<slug>` asks only whether a recipe is
  published, so a draft is 404 there to its own author as readily as to a stranger.

A detail page that rendered a draft "because it is yours" would be one scoping mistake away
from rendering it for everybody, while looking like a page that works.

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

Three tiers, kept apart on purpose.

| Tier   | Command             | Needs Docker | What it covers                                        |
| ------ | ------------------- | ------------ | ----------------------------------------------------- |
| `unit` | `npm run test:unit` | no           | Pure logic — validation, domain rules                 |
| `db`   | `npm run test:db`   | yes          | Real Postgres: queries, constraints, delete behaviour |
| `e2e`  | `npm run test:e2e`  | yes          | A production build in a browser, and one without JS   |

Tests are written inside the phase that adds the feature, never deferred to a testing phase
at the end. The browser tier exists because some things have no smaller test: an async
Server Component cannot be rendered by any React testing library, and a proxy is compiled
into its own bundle and cannot be imported at all.

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
