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

**The constraint caught my own seed data.** The first run of the seed script
failed on `animal_cage_placements_interval_ordered`: I had picked each death
date independently of when the animal was placed, so some animals died before
they arrived in their cage. That's a class of nonsense a spreadsheet absorbs
silently and then propagates into every downstream count. Worth recording as
the moment the design paid for itself — the constraint wasn't decorative, it
found a real bug within minutes of existing, in data I had written myself.

**Test isolation that looked right and wasn't.** I pointed the suite at a
`colony_test` database on the same local server, and everything corroborated
it: the runner logged `database "colony_test"`, migrations applied there, and
all 16 tests passed. Then a routine count showed the development colony had
415 animals replaced by 3 — the suite had been truncating the seeded data all
along. The local dev server terminates every connection at the same underlying
store regardless of the database in the URL; asking for `/colony_test` silently
lands in the dev database, and `SELECT current_database()` cheerfully answers
`template1` for a database name that was never created. Switching to
`?schema=colony_test` failed the same way, more subtly: the schema was created
and migrated, but writes still landed in `public` — `colony_test.animals` held
0 rows while `public` held 444.

The lesson isn't about Prisma. It's that every signal I had was consistent with
isolation working, and none of them actually tested the claim. The check that
found it was the dumb one: count the rows in the database I was trying to
protect, before and after. Isolation on that server is per *instance*, so tests
now run against a second server on its own port, and global setup refuses to
start if it finds the seeded colony in the target — a misconfiguration now
fails loudly instead of quietly deleting data.

## What I checked before believing it worked

- **The constraints, by trying to violate them.** Four tests deliberately
  bypass the operations layer and write to Prisma directly, asserting the
  *database* refuses overlapping placements, a double-booked rack slot, an
  inverted interval, and a duplicate active ear tag. Testing through the app
  layer would only have proved the app remembered to check.
- **The as-of query against a moving animal**, not just a static one: an animal
  in cage A on June 1 and cage B on June 10 must answer "A" for June 3 and "B"
  for today, from the same code path with a different timestamp.
- **The half-open boundary.** At the exact instant of a handover the animal is
  in exactly one cage, not zero and not both. This is the kind of thing that
  looks fine until a report double-counts.
- **Transactional rollback**, by forcing a bulk move to fail partway and
  asserting the first animal's placement did not survive. A changeset that can
  half-apply is worse than no changeset.
- **Migrations from empty**, applied by `prisma migrate deploy` against a real
  Postgres rather than `db push`, so what CI and production run is what was
  tested.
- **That the test suite does not touch the development colony** — by counting
  its rows before and after a full `npm test`, not by reading the connection
  string and believing it. That check is the only reason the isolation bug
  above was caught.
- **The mobile layout on a real mobile viewport**, driven with Playwright at
  390×844 rather than a narrowed desktop window: asserting zero horizontal
  overflow and that every link, button and input clears 44px. That found two
  buttons at 38px which looked fine to the eye.
- **That the cage-card QR actually scans** — decoded straight back out of the
  rendered screenshot with OpenCV, returning
  `http://localhost:3000/cages/CG-1000`. Server-generated SVG through a browser
  render to a working URL, rather than trusting that a thing shaped like a QR
  code is one.

## Vendored agent skills

`prisma init` silently installed nine Prisma-authored skill packs into
`.claude/skills/`, `.agents/`, and `.windsurf/`. Those are upstream vendor docs,
not this project's AI setup, and committing them under `.claude/` would
misrepresent what's in this repo — so they're gitignored (regenerate with
`npx prisma skills sync`).
