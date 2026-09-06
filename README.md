# Animal Colony Manager

**Live demo:** https://animal-colony-manager.vercel.app
**Demo video:** _TODO — 2-3 min walkthrough_

A phone-friendly system for tracking mice, cages, husbandry, and staff coverage
in a vivarium — built for [Task 2](https://github.com/salk-airc/rse-takehome-2026/blob/main/tasks/02-colony-manager.md)
of the Salk AIRC Research Software Engineer take-home.

## Who this is for

A lab manager or grad student standing in the vivarium in gloves, one hand
free, who currently tracks ~400 mice across six racks in a shared Google
Sheet. This replaces that sheet with something that works one-handed on a
phone, remembers who changed what, and can be handed off when someone goes on
vacation.

## What it does

- Tracks where every animal is (cage) and where every cage is (rack position),
  as a time-stamped history, not a snapshot — "which mice were in B-04-12 on
  June 3rd" is an ordinary query.
- Digital, printable, QR-linked cage cards.
- Husbandry event logging (cage changes, health checks, weaning, tail snips,
  weights, treatments, deaths, transfers) with who/when and easy correction.
- Coverage/on-call assignment for handoffs.
- Sign-in via GitHub (OIDC), with role-scoped permissions (PI / lab manager /
  undergrad / vet) — not just a login screen.
- Spreadsheet ingestion with column mapping, dry-run preview, partial success,
  and idempotent re-upload — built and tested against deliberately messy
  fixture sheets in `fixtures/`.
- Soft deletes, an audit trail, and changeset-based undo for bulk mistakes.

## Setup (cold clone)

No Docker, no Python, no locally-installed Postgres. Node 22+ is the only
prerequisite.

```bash
git clone https://github.com/E1400/Animal-Colony-Manager.git
cd Animal-Colony-Manager
cp .env.example .env
npm install            # postinstall runs `prisma generate`

npm run db:up          # starts a local Postgres, prints a URL
                       # paste it into .env as DATABASE_URL
npm run db:deploy      # apply migrations
npm run db:seed        # ~415 animals, 128 cages, breeding pairs, litters

npm run dev            # http://localhost:3000
```

`npm run db:down` stops the database; `npm run db:reset` drops, re-migrates and
re-seeds it.

The seed is deterministic — a fixed PRNG seed — so the demo, the screenshots
and the tests all describe the same colony.

### Running the tests

The suite truncates every table between tests, so it needs its own database
**server** — a different database name or `?schema=` on the dev server is not
isolation, because that server routes every name to the same store.

```bash
npm run db:up:test     # second server; put its URL in .env as TEST_DATABASE_URL
npm test
```

Global setup refuses to run if it finds the seeded colony in the target, so a
misconfiguration fails loudly instead of destroying data.

## Deployment

Deployed on Vercel against managed Postgres. Two things are non-obvious:

**The database must support `btree_gist`.** The placement tables enforce
non-overlapping intervals with Postgres exclusion constraints, which need that
extension. Neon and Prisma Postgres both provide it; a provider that does not
will fail on the second migration. This has been verified end to end — the full
test suite, including the four tests that assert the *database* rejects
overlapping placements, passes against managed Postgres, not just locally.

**Migrations run at deploy, not by hand.** `vercel-build` runs
`prisma migrate deploy && next build`, so a deploy that ships schema changes
applies them first and fails the build rather than serving code against an
older schema.

Environment variables to set in the Vercel project:

| Variable | Needed for | Notes |
| --- | --- | --- |
| `DATABASE_URL` | everything | Pooled connection string; used by the app at runtime |
| `DIRECT_DATABASE_URL` | migrations | Unpooled connection. Optional but strongly recommended — see below |
| `AUTH_SECRET` | sign-in | `npx auth secret` or `openssl rand -base64 32` |
| `AUTH_GITHUB_ID` | sign-in | GitHub OAuth App client ID |
| `AUTH_GITHUB_SECRET` | sign-in | GitHub OAuth App client secret |

**Migrations must not run through a connection pooler.** `prisma migrate deploy`
takes a Postgres advisory lock, which pgbouncer in transaction-pooling mode does
not support, so the migration hangs or fails confusingly. `prisma7.config.ts`
therefore prefers `DIRECT_DATABASE_URL`, then `DATABASE_URL_UNPOOLED`, then
`POSTGRES_URL_NON_POOLING`, falling back to `DATABASE_URL` for local development
where no pooler is involved. Vercel's Neon integration sets the unpooled
variable automatically, so this usually needs no action — but if you paste a
connection string in by hand, paste the unpooled one too.

GitHub allows one callback URL per OAuth App, so register two apps — one for
`http://localhost:3000/api/auth/callback/github` and one for
`https://<your-domain>/api/auth/callback/github`.

Note that `node-postgres` now warns that `sslmode=require` will stop implying
certificate verification. Prefer `sslmode=verify-full` on the production
connection string.

## Data model — what I chose and why

_TODO — schema diagram/notes, plus what was deliberately not normalized._

## Known limitations

_TODO — filled in honestly as the build progresses; distinguishes real defects
from deliberately excluded scope._

## Where the data goes, and what it costs

_TODO — two short paragraphs per the brief: what leaves the user's machine
(GitHub OAuth for sign-in; Neon Postgres for storage — no other third party),
and keys/cost (a free GitHub OAuth App + Neon free tier; no paid API required
for the core product; degrade path if that ever changes)._

## License

MIT — see `LICENSE`.
