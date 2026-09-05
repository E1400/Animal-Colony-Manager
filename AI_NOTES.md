# AI_NOTES.md

## Tools and setup

- Built with Claude (Cowork), working directly against files in this folder
  on my Mac via the desktop app's device bridge, with a `CLAUDE.md` in this
  repo giving it the schema conventions and stack decisions up front.
- Planning happened in a separate claude.ai Project ("Salk Projects") before
  any code was written — see `claude/task2-plan.md` there for the full
  architecture reasoning; this file only covers moments during the build
  itself.
- _TODO: note any subagents/commands/MCP servers actually used as the build
  progresses._

## Moments where we disagreed, or it got something wrong

_Filled in live during the build, not reconstructed at the end._

**`npm install prisma` installed a release candidate.** npm's `latest` dist-tag
for the `prisma` CLI currently points at `8.0.0-rc.13`, while `@prisma/client`'s
`latest` is a stable `7.10.0`. So the obvious command silently produced a
mismatched pair — and Prisma 8's CLI is a different product surface with no
`migrate` command at all (`prisma -v` answered "No command registered for `-v`,
did you mean `dev`?"). That error message was the tell; the fix was pinning
`prisma@^7.10.0` to match the client. Worth recording because the failure mode
wasn't an install error, it was a *successful* install of the wrong thing.

**Prisma's default timestamps have no time zone.** The first generated migration
emitted every temporal column as `TIMESTAMP(3)` — timestamp *without* time zone.
For an app whose headline query is "which mice were in B-04-12 on June 3rd",
that's a latent correctness bug: the answer shifts under DST and across anyone
entering data from a different zone. Caught it by reading the generated DDL
rather than trusting the schema file, and annotated all 53 `DateTime` fields
with `@db.Timestamptz(3)` before any data existed. The general lesson: read the
SQL the ORM actually emits, not just the model you wrote.

**A constraint I wrote and then removed.** I initially added a CHECK on
`husbandry_events` asserting `recorded_at <= now() + interval '1 day'` as a
sanity guard. It's wrong twice over: `now()` is not immutable, so rows valid at
insert time can fail revalidation on dump/restore — which would have quietly
broken the backup/restore path this project has to *demonstrate*, not assert.
Plausibility of dates belongs in the app layer as a warning, not in the database
as a constraint. Left the reasoning as a comment in the migration so the absence
is deliberate rather than an oversight.

**Where the AI wanted a column and the schema says no.** The recurring pressure
throughout was toward caching current location on `Animal`/`Cage` "for query
convenience". `CLAUDE.md` forbids it, and the resolution was to push the
invariant *down* rather than up: Postgres exclusion constraints over
`tstzrange(started_at, ended_at)` with `btree_gist`, so an animal in two cages
at once is refused by the database rather than by application code that loses to
concurrent writes. Verified by attempting the violating insert and confirming
the error, rather than assuming the DDL did what it read like.

## Vendored agent skills

`prisma init` silently installed nine Prisma-authored skill packs into
`.claude/skills/`, `.agents/`, and `.windsurf/`. Those are upstream vendor docs,
not this project's AI setup, and committing them under `.claude/` would
misrepresent what's in this repo — so they're gitignored (regenerate with
`npx prisma skills sync`).

## What I checked before believing it worked

_TODO._
