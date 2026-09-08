# Animal Colony Manager

**Live demo:** https://animal-colony-manager.vercel.app
**Demo video:** [`docs/demo.mp4`](docs/demo.mp4) — walkthrough, phone and desktop

Phone-first colony management for a research vivarium — mice, cages, husbandry
and staff coverage. Built for [Task 2](https://github.com/salk-airc/rse-takehome-2026/blob/main/tasks/02-colony-manager.md)
of the Salk AIRC RSE take-home.

It replaces the shared Google Sheet a lab manager currently keeps for ~400 mice
across six racks, with something usable one-handed in gloves, that remembers who
changed what, and can be handed over when someone goes on holiday.

## What it does

- **Location as history, not a snapshot.** "Who was in B-04-12 on June 3rd" is
  an ordinary query, not an archaeology project.
- **Printable, QR-linked cage cards** — scan one with a phone camera and the
  cage record opens. No app to install.
- **One-tap husbandry logging**, with an offline queue for dead spots behind a
  rack.
- **Spreadsheet import** with column mapping, a dry run, per-row errors,
  in-browser cell editing and idempotent re-upload. Sample sheets to try it on
  are in [`examples/`](examples/).
- **GitHub sign-in with role-scoped permissions** (PI, lab manager,
  technician, undergrad, vet, auditor) plus time-bounded coverage handoff.
- **Undo — and redo — of any change**, as one action, from an activity log.
- Soft deletes, full audit trail, and a verified backup/restore path.

## Quick start

Node 22+ is the only prerequisite. No Docker, no Python, no local Postgres
install.

```bash
git clone https://github.com/E1400/Animal-Colony-Manager.git
cd Animal-Colony-Manager
cp .env.example .env
npm install          # postinstall runs `prisma generate`

npm run db:up        # local Postgres — paste the URL it prints into .env
npm run db:deploy    # migrations
npm run db:seed      # 415 animals, 128 cages, breeding pairs, litters
npm run dev          # http://localhost:3000
```

`npm run db:down` stops it; `npm run db:reset` drops, re-migrates and re-seeds.
The seed is deterministic, so the demo, screenshots and tests all describe the
same colony.

## Tests

```bash
npm run db:up:test   # second server — put its URL in .env as TEST_DATABASE_URL
npm test             # 74 tests
```

The suite truncates every table, so it needs its own database **server**. A
different database name or `?schema=` on the dev server is not isolation — that
server routes every name to the same store. Global setup refuses to run if it
finds the seeded colony in the target.

## Deployment

Vercel + Neon. `vercel-build` runs `prisma migrate deploy && next build`, so a
deploy carrying schema changes applies them first and fails the build rather
than serving new code against an old schema.

| Variable | For | Notes |
| --- | --- | --- |
| `DATABASE_URL` | everything | Pooled connection string |
| `DIRECT_DATABASE_URL` | migrations | Unpooled. Strongly recommended — see below |
| `AUTH_SECRET` | sign-in | `npx auth secret` |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | sign-in | GitHub OAuth App |

Three things that will bite otherwise:

- **The database must support `btree_gist`.** The placement constraints need
  it. Neon and Prisma Postgres provide it; a provider that doesn't fails on the
  second migration.
- **Migrations must not run through a pooler.** `prisma migrate deploy` takes
  an advisory lock that pgbouncer doesn't support in transaction mode.
  `prisma7.config.ts` prefers `DIRECT_DATABASE_URL`, then
  `DATABASE_URL_UNPOOLED`, then `POSTGRES_URL_NON_POOLING`, falling back to
  `DATABASE_URL` locally.
- **Seeding a hosted database** requires `SEED_ALLOW_REMOTE=1`, and the seed
  refuses a database that already holds a lab. To bootstrap a fresh deployment
  without copying credentials around, add `SEED_ALLOW_REMOTE=1 prisma db seed`
  to `vercel-build`, deploy once, then remove it.

## Backup and restore

```bash
npm run db:export -- backups/colony.json    # full JSON snapshot
npm run db:restore -- backups/colony.json   # refuses a non-empty database
```

Exported and restored table-by-table in dependency order inside one
transaction, so foreign keys hold throughout and a half-restore is impossible.
Restore compares every table's row count against the snapshot and fails loudly
on a mismatch.

Run for real between two Postgres instances — 4,238 rows out and back, every
table matching. Neon's point-in-time restore covers actual disaster recovery;
this covers moving providers, handing a lab its own data, and being something
anyone can verify.

## Data model

The brief calls the data model the assignment, so here is the reasoning.

**Location is a timestamped fact, not a column.** No `currentCageId` on
`Animal`, no `rackPositionId` on `Cage`. Both are half-open intervals —
`[startedAt, endedAt)`, null end meaning "still there" — in `CagePlacement` and
`AnimalCagePlacement`. "Now" and "as of June 3rd" are then the same query with a
different timestamp. The query layer has exactly one time predicate (`activeAt`);
a separate `endedAt IS NULL` fast path would be a second definition of current
state, free to drift. Two placement tables rather than one address means moving
a cage between racks changes every occupant's location without touching an
animal row.

**Overlap is enforced by Postgres.** An animal can't be in two cages at once,
and a rack slot can't hold two cages:

```sql
EXCLUDE USING gist (animal_id WITH =, tstzrange(started_at, ended_at) WITH &&)
```

Four people editing at once is the actual problem statement, and application
checks lose that race. Four tests bypass the app layer to assert the *database*
refuses the write.

**`occurredAt` and `recordedAt` are separate everywhere.** When it happened
versus when someone typed it in. A death noticed Tuesday that happened Thursday
lands in history on Thursday, and the UI shows the gap ("logged 22d later")
rather than hiding it. The offline queue depends on this. There is deliberately
no CHECK relating the two: late entry is normal, and a `now()`-based check is
non-immutable, so rows valid at insert would fail on restore.

**Ear tags are never primary keys.** They get reused, collide across labs and
are often mistyped. `Animal.id` is a UUID; tags live in `AnimalIdentifier`
scoped by namespace, unique only over *active* rows — so a retired tag can be
reissued and search finds its current holder, not the dead animal.

**Every write belongs to a changeset.** `withChangeset()` opens a transaction
and tags each row with one id, so a weaning that splits a cage into four is one
thing to undo. The audit trail *is* the changeset table, not a parallel log that
could drift. Undo unwinds in reverse order — created rows deleted before closed
intervals reopen — or the exclusion constraint rejects it; there's a test for
the ordering, not just the result.

**All 53 temporal columns are `timestamptz`.** Prisma defaults to `timestamp`
*without* zone, which would shift "as of June 3rd" under DST.

### Deliberately not normalised

- **`RackPosition.label`** duplicates its side/row/column. Derived from fixed
  geometry, not occupancy, and it's what people read off a rack and type into
  search.
- **`HusbandryEvent.payload` is JSON.** A weight has grams, a treatment has a
  drug and dose, a plug check has neither. A column per type means a migration
  every time the vet invents a form; payloads are validated per type in the app.
- **Genotype is a row per assay.** Results arrive late, get re-run, and
  disagree. `supersededAt` retires a result rather than overwriting it.
- **`pupCountAtBirth` and `pupCountAtWean` are separate.** The difference is
  real information, and the later number must not erase the earlier one.
- **`BreedingPair` has members, not sire/dam columns.** Trios and harems are
  normal.
- **Soft delete on `Animal` and `Cage` only.** Events and placements are
  removed wholesale by undoing their changeset, which records that it happened.

## Known limitations

**Out of scope on purpose**

- The offline queue covers only flat, append-only actions. Structural changes
  (moving animals, weaning) need a connection and say so — merging those
  offline is a real distributed-systems problem, and getting it subtly wrong
  corrupts history invisibly.
- `DEMO_AUTO_MEMBERSHIP` grants a role to first-time visitors so evaluators can
  exercise permissions. Off unless set, never applied to existing members, not
  for a real lab.
- Import recognises dam/sire columns but doesn't yet build pedigree links.
- Authorization is lab-scoped plus coverage delegation; no per-cage ACLs.

**Rough edges**

- The import wizard round-trips the parsed sheet to the server on each
  re-mapping. Fine at colony scale; a ten-thousand-row file would want the
  parse cached server-side.
- Genotype imported from a sheet uses the strain column as `locus`, which is a
  guess rather than a real locus name.

## Where the data goes, and what it costs

**What leaves the machine.** Colony data goes to one place: a Neon Postgres
database in `us-west-1`, reached only by this app's server. Sign-in is an OAuth
round trip to GitHub, which returns a user id, name, email and avatar and
nothing else — GitHub never sees colony data, and no role is stored there.
Vercel's edge sees request metadata as any host would. No analytics, no
third-party scripts, no AI or external API calls at runtime. Animal records
leave only through the export you run yourself.

**Keys and cost.** A free GitHub OAuth App, Neon's free tier (0.5 GB; the
entire seeded colony is 4,238 rows) and Vercel hobby. No paid API anywhere, and
nothing is held back behind one. The only secrets are `DATABASE_URL`,
`AUTH_SECRET` and the GitHub client id and secret — all in environment
variables, none committed, `.env` gitignored with only `.env.example` tracked.
If Neon vanished tomorrow, `npm run db:export` and `npm run db:restore` move the
colony to any other Postgres, and that path is tested rather than asserted.

## License

MIT — see `LICENSE`.
