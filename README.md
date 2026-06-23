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
- [ ] 03 — Postgres, Prisma and the core models
- [ ] 04 — Full schema, relations and seed data
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

Requires Node 24. A database is not needed until phase 03.

## Scripts

| Script                 | What it does                               |
| ---------------------- | ------------------------------------------ |
| `npm run dev`          | Development server                         |
| `npm run build`        | Production build                           |
| `npm run lint`         | ESLint, including type-aware rules         |
| `npm run typecheck`    | Generates route types, then `tsc --noEmit` |
| `npm run format`       | Prettier, writing in place                 |
| `npm run format:check` | Prettier, failing on any drift             |

## Notes on the toolchain

Three versions are pinned exactly rather than left on a caret range, each for a reason worth
recording:

- **TypeScript is pinned to 5.9.3.** The current `latest` is 7.x, the native compiler, which ships
  no programmatic compiler API. Type-aware lint rules need one.
- **ESLint is pinned to 9.39.5.** Version 10 removes a context API that `eslint-plugin-react` still
  calls, and `eslint-config-next` bundles that plugin, so the linter fails to start on 10.
- **`npm run typecheck` runs `next typegen` first.** Next generates `PageProps` and `LayoutProps`
  into `.next/types`, so a bare `tsc --noEmit` fails on a clean checkout while `next build` passes.
