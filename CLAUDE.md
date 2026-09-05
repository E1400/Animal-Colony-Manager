# CLAUDE.md

Guidance for Claude (or any agent) working in this repo.

## What this is

Task 2 of the Salk AIRC RSE take-home: a mobile-first colony management app
replacing a shared spreadsheet. **Read `task2-plan.md` in this repo root
first** — it has the full architecture reasoning, the data model, and a
running status of what's done vs. not, so you don't have to re-derive
decisions or guess what's already built. Update its milestone checklist as
you complete things so it stays a true status doc, not just a plan.

## Stack

- Next.js (App Router) + TypeScript, Tailwind for styling.
- Prisma ORM against Neon (serverless Postgres) — real migrations
  (`prisma migrate dev` / `prisma migrate deploy`), never `db push` once a
  migration exists.
- Auth.js (NextAuth) with the GitHub provider for OIDC sign-in. Roles/permissions
  live in our own DB, resolved server-side — never trust a client-supplied role.
- Deployed on Vercel.

## The data model is the point of this task

Placement/location history (`CagePlacement`, `AnimalCagePlacement`) is an
append-only event log. **Never add a "current location" foreign key column
directly on `Animal` or `Cage`.** Current state is always a derived query
(latest placement row with no end date). If you're tempted to cache current
location on the parent row for query convenience, don't — write a DB view or
an indexed query instead; the cache-drift bug is exactly the failure mode this
schema exists to avoid.

Similarly: `occurred_at` (when a husbandry event really happened) and
`recorded_at` (when someone typed it in) are separate columns everywhere —
facts arrive late and out of order in a real vivarium.

Lab-local animal identifiers (ear tag/punch/toe number) are never a primary
key — they live in `AnimalIdentifier`, scoped by namespace, because the same
scheme is reused across labs and is sometimes wrong.

## Conventions

- Every write that a human can undo should happen inside a "changeset" — use
  `withChangeset()` from `src/lib/changeset.ts`, which opens a transaction and
  tags every row it writes with one changeset id, so bulk-undo has something
  coherent to revert. Write through the transaction handle it gives you, never
  the module-level `prisma`.
- Read placement history through `src/lib/queries/placement.ts`. It has one
  time predicate (`activeAt`) and "now" is just `activeAt(new Date())` — do not
  add an `endedAt: null` shortcut, because a second definition of "current" is
  exactly what drifts.
- Soft delete (`deletedAt`/`deletedBy`/`deleteReason`) on `Animal` and `Cage` —
  never a hard delete of either.
- Mobile-first: build the small-viewport layout first, let desktop follow.
- Tests: Vitest for schema/query correctness (this is where a colony manager
  actually breaks), Playwright for E2E + a mobile-viewport pass.

## Running locally

No Postgres install and no cloud account needed — Prisma ships a local one.

```bash
cp .env.example .env     # the default DATABASE_URL matches the command below
npm install              # postinstall runs `prisma generate`
npm run db:up            # local Postgres; prints a URL — paste it into .env
npm run db:deploy        # apply migrations
npm run db:seed          # ~415 animals, 128 cages, breeding pairs, litters
npm run dev
```

`npm run db:down` stops the database. `npm run db:reset` drops, re-migrates and
re-seeds it.

Tests need a **second database server**, because the suite truncates every
table between tests:

```bash
npm run db:up:test       # prints a URL — put it in .env as TEST_DATABASE_URL
npm test
```

A different database name or `?schema=` on the *same* dev server is not
isolation: that server routes every database and schema name to one store, so
both look correct and silently share the development colony. Global setup
refuses to run if it detects the seeded colony in the target, so a
misconfiguration fails loudly instead of destroying data.

The seed is deterministic (fixed PRNG seed), so the demo, screenshots and tests
all describe the same colony. Re-running produces identical data.
