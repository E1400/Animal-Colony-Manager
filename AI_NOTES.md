# AI_NOTES.md

## Tools and setup

- Built with Claude (Cowork), working directly against files in this folder
  on my Mac via the desktop app's device bridge, with a `CLAUDE.md` in this
  repo giving it the schema conventions and stack decisions up front.
- Planning happened in a separate claude.ai Project ("Salk Projects") before
  any code was written — see `claude/task2-plan.md` there for the full
  architecture reasoning; this file only covers moments during the build
  itself.
- **No subagents and no MCP servers.** Several MCP connectors were available
  (Google Drive, Gmail, Calendar) and none were relevant; the work stayed in
  one session against this repo. Two Anthropic-authored skills were loaded:
  `webapp-testing`, which is where the Playwright approach came from, and
  `prisma-cli` reference material during the Prisma 7 setup.
- **Command-line tools it drove directly:** the Prisma CLI for migrations,
  seeding and the local Postgres servers; `gh` for pushes, CI status and
  reading Vercel's deployment results; the Vercel CLI for linking the project
  and setting production environment variables; Playwright and axe-core for the
  browser and accessibility checks; and OpenCV once, to decode the cage-card QR
  out of a screenshot.
- **What it could not do**, and where I had to act: creating the Vercel and Neon
  accounts, registering the GitHub OAuth app, and testing the camera on a real
  iPhone. It was blocked from `vercel login` (an interactive prompt it could
  not answer) and initially from deleting files, and said so rather than
  working around either.

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
- **The offline queue by actually going offline**, not by reading the code:
  dropped the browser's connection mid-session, confirmed the write landed in
  `localStorage` and the pending count appeared, then restored the connection
  and confirmed the queue drained to zero and the entry showed up in the cage's
  history.

- **Camera capture on real iOS Safari**, which I could not test myself and
  carried as an explicit unknown until the end. The scanner is written against
  ZXing specifically because iOS Safari lacks `BarcodeDetector`, but
  `getUserMedia` needs an HTTPS origin, so it had only run in headless
  Chromium. Confirmed on a physical iPhone against the deployed URL: scanning
  a printed cage card opens that cage's record.

**Where I narrowed the offline feature on purpose.** The plan called for an
offline write queue. The obvious reading is "queue every write", and that is
the wrong product: merging offline *structural* changes — moving animals
between cages, weaning a litter into four — is a real distributed-systems
problem, and getting it subtly wrong corrupts colony history in a way that is
very hard to notice and impossible to unpick later. So the queue covers only
the flat, append-only actions someone performs standing at a rack, where the
alternative is a spinner that fails and an entry nobody ever writes down.
Structural moves still require a connection and say so. The narrower feature is
the more defensible one.

**A lint rule I argued with and then agreed with.** `react-hooks/set-state-in-effect`
flagged the queue-drain effect. My first instinct was that it was a false
positive, since `drain()` only sets state after an `await`. But the fix it
pushed me toward — deferring the flush with a timeout rather than running it
inline on mount — is genuinely better: flushing is a network round trip and has
no business sitting between mount and first paint. Reading `localStorage` for
the pending count also moved to `useSyncExternalStore`, which is what stops the
server and first client render from disagreeing about queue length.

**Two bugs that only a cold clone could find.** After everything was built,
tested and deployed, I cloned the repo from GitHub into an empty directory and
followed my own README. It failed on the second command. `.env.example` ships
`DIRECT_DATABASE_URL=""`, and the migration config used `??` — an empty string
is not nullish, so a blank variable shadowed a perfectly good `DATABASE_URL`
and `prisma migrate deploy` died with "Connection url is empty". Every test
passed, CI was green, production was live, and the documented setup path was
broken for anyone who followed it exactly. The lesson is narrow and worth
holding: a working machine tells you nothing about a fresh one, and `??`
treats `""` as a value while almost every environment-variable convention
treats it as absence.

**The backup verification caught the backup.** The restore compares row counts
against the snapshot afterwards and fails on a mismatch. The first real run
reported `user: expected 6, got 7` — because I had decided whether the target
was empty by counting the `labs` table alone, so leftover rows in other tables
survived the wipe. Without that check the restore would have quietly produced
a subtly wrong colony and reported success. This is the thing the brief is
pointed about, and it justified itself on first contact.

## What the accessibility pass actually found

Running axe-core across all nine pages beat reading the markup. Three real
violations, none of which I would have spotted by eye:

- Search inputs used `flex-1` without `min-w-0`. Flex items default to
  `min-width: auto`, so they could not shrink below their placeholder text —
  at 200% zoom that pushed 289px of horizontal overflow onto every page with a
  search box. A straight WCAG 1.4.4 failure that looks perfect at 100%.
- The cage-card QR carried `aria-label` on a bare `<div>`, where ARIA
  attributes are prohibited without a role.
- The amber "undone" badge missed 4.5:1 against its own tinted background —
  by about 0.06.

## Vendored agent skills

`prisma init` silently installed nine Prisma-authored skill packs into
`.claude/skills/`, `.agents/`, and `.windsurf/`. Those are upstream vendor docs,
not this project's AI setup, and committing them under `.claude/` would
misrepresent what's in this repo — so they're gitignored (regenerate with
`npx prisma skills sync`).
