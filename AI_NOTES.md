# AI_NOTES.md

## Tools and setup

- Built with Claude (Cowork) against files in this folder, with a `CLAUDE.md`
  giving it the schema conventions and stack decisions up front.
- **No subagents, no MCP servers.** Google Drive, Gmail and Calendar connectors
  were available and irrelevant. Two skills loaded: `webapp-testing` (where the
  Playwright approach came from) and `prisma-cli` during the Prisma 7 setup.
- **CLIs it drove directly:** Prisma (migrations, seeding, local Postgres),
  `gh` (pushes, CI, reading Vercel deploy results), Vercel (project linking,
  production env vars), Playwright and axe-core (browser and accessibility
  checks), and OpenCV once, to decode the cage-card QR out of a screenshot.
- **What it could not do:** create the Vercel and Neon accounts, register the
  GitHub OAuth app, or test the camera on a real iPhone. It was blocked from
  `vercel login` and from deleting files, and said so rather than working
  around either.

## Where it went wrong, or we disagreed

**`npm install prisma` installed a release candidate.** npm's `latest` for the
`prisma` CLI points at `8.0.0-rc.13` while `@prisma/client` is a stable
`7.10.0`, so the obvious command silently produced a mismatched pair — and
Prisma 8's CLI has no `migrate` command at all. Not an install error; a
*successful* install of the wrong thing.

**Prisma's default timestamps have no time zone.** The first migration emitted
`TIMESTAMP(3)` throughout. For an app whose headline query is "which mice were
in B-04-12 on June 3rd", that answer shifts under DST. Caught by reading the
generated DDL rather than trusting the schema file; all 53 `DateTime` fields
are now `@db.Timestamptz(3)`.

**A constraint I wrote and then removed.** I added a CHECK asserting
`recorded_at <= now() + interval '1 day'`. Wrong twice: `now()` is not
immutable, so rows valid at insert can fail on dump/restore — which would have
broken the backup path this project has to *demonstrate*. Date plausibility
belongs in the app layer as a warning.

**Where the AI wanted a column and the schema says no.** The recurring pressure
was to cache current location on `Animal`/`Cage` for query convenience.
`CLAUDE.md` forbids it, and the resolution was to push the invariant *down*:
exclusion constraints over `tstzrange` with `btree_gist`, so the database
refuses an animal in two cages rather than app code that loses to concurrent
writes.

**The constraint then caught my own seed data.** The first seed run failed on
`animal_cage_placements_interval_ordered` — death dates were picked
independently of placement dates, so some animals died before they arrived.
Exactly the nonsense a spreadsheet absorbs silently. The constraint found a
real bug within minutes of existing.

**Test isolation that looked right and wasn't.** I pointed the suite at a
`colony_test` database on the dev server. Everything corroborated it: the
runner logged the right database, migrations applied, 16 tests passed. Then a
routine count showed the development colony had 415 animals replaced by 3 — the
suite had been truncating the seeded data all along. That server routes every
database *and* schema name to one store. Every signal was consistent with
isolation working and none of them tested the claim; the check that found it
was counting rows in the database I was trying to protect. Tests now use a
separate server instance, and global setup refuses to start if it finds the
seeded colony.

**Narrowing the offline queue on purpose.** "Queue every write" is the obvious
reading and the wrong product: merging offline *structural* changes — moving
animals, weaning a litter — is a real distributed-systems problem, and getting
it subtly wrong corrupts history invisibly. The queue covers only flat,
append-only actions; structural moves require a connection and say so.

**A lint rule I argued with and then agreed with.**
`react-hooks/set-state-in-effect` flagged the queue-drain effect. I thought it a
false positive since `drain()` only sets state after an `await` — but the fix it
pushed me toward, deferring the flush rather than running it inline on mount, is
genuinely better. A network round trip has no business between mount and first
paint.

**Two bugs only a cold clone could find.** After everything was built, tested
and deployed, I cloned from GitHub into an empty directory and followed my own
README. It failed on the second command: `.env.example` ships
`DIRECT_DATABASE_URL=""`, and the config used `??`, which treats `""` as a
value — so a blank variable shadowed a working `DATABASE_URL`. Every test
passed, CI was green, production was live, and the documented setup path was
broken for anyone following it exactly.

**The backup verification caught the backup.** Restore compares row counts
against the snapshot and fails on mismatch. The first real run reported
`user: expected 6, got 7`, because I had decided emptiness by counting the
`labs` table alone and leftover rows elsewhere survived the wipe. Without that
check it would have produced a subtly wrong colony and reported success.

## What I checked before believing it worked

- **The constraints, by trying to violate them.** Four tests bypass the
  operations layer entirely and assert the *database* refuses overlapping
  placements, a double-booked slot, an inverted interval and a duplicate active
  ear tag. Testing through the app would only prove the app remembered to check.
- **As-of queries against a moving animal**, and the half-open boundary: at the
  instant of a handover the animal is in exactly one cage, not zero and not both.
- **Transactional rollback**, by forcing a bulk move to fail partway and
  asserting nothing survived.
- **Migrations from empty** via `prisma migrate deploy` against real Postgres,
  so CI and production run what was tested.
- **That the suite does not touch the development colony**, by counting its rows
  before and after a full `npm test`. That check is the only reason the
  isolation bug was caught.
- **The mobile layout at 390×844**, not a narrowed desktop window — zero
  horizontal overflow, every target ≥44px. Found two buttons at 38px.
- **That the QR actually scans**, decoded back out of a rendered screenshot with
  OpenCV rather than trusting that a thing shaped like a QR code is one.
- **The offline queue by going offline**: dropped the connection, confirmed the
  write landed in `localStorage`, restored it, confirmed the queue drained.
- **Camera capture on real iOS Safari** — carried as an explicit unknown until
  the end, since `getUserMedia` needs HTTPS and had only run in headless
  Chromium. Confirmed on a physical iPhone against the deployed URL.

### What the accessibility pass turned up

axe-core across all nine pages beat reading the markup. Three real violations,
none of which I would have caught by eye:

- Search inputs used `flex-1` without `min-w-0`, so they could not shrink below
  their placeholder text. At 200% zoom that pushed 289px of horizontal overflow
  onto every page with a search box — a WCAG 1.4.4 failure that looks perfect at
  100%.
- The cage-card QR carried `aria-label` on a bare `<div>`, where ARIA attributes
  are prohibited without a role.
- The amber "undone" badge missed 4.5:1 against its own tint, by about 0.06.

## Vendored agent skills

`prisma init` silently installed nine Prisma-authored skill packs into
`.claude/skills/`, `.agents/` and `.windsurf/`. Those are upstream vendor docs,
not this project's AI setup, and committing them under `.claude/` would
misrepresent what is in this repo — so they are gitignored (regenerate with
`npx prisma skills sync`).
