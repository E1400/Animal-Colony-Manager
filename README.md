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

**Seeding a hosted database.** The seed refuses to touch a database that
already contains a lab, and refuses a hosted `DATABASE_URL` outright unless
`SEED_ALLOW_REMOTE=1` is set — it truncates every table, which is right for an
empty database and catastrophic for one in use. To bootstrap a fresh
deployment without copying credentials onto a laptop, temporarily insert the
seed into the build:

```
"vercel-build": "prisma migrate deploy && SEED_ALLOW_REMOTE=1 prisma db seed && next build"
```

deploy once, then take it back out. The build environment already holds
`DATABASE_URL`, so nothing sensitive has to move. `SEED_FORCE=1` overrides the
already-populated check, and is the only way to wipe a live colony.

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

## Backup and restore

A backup nobody has restored is a rumour, so this one is demonstrable in two
commands and covered by tests.

```bash
npm run db:export -- backups/colony.json     # full logical snapshot
npm run db:restore -- backups/colony.json    # refuses a non-empty database
```

The snapshot is JSON, exported table by table in dependency order and restored
in the same order inside a single transaction, so foreign keys hold at every
step without disabling constraints and a half-restored colony is impossible.
After restoring, every table's row count is compared against the snapshot and
the command fails loudly if any differ.

This was run for real between two separate Postgres instances: 4,238 rows out
of the development colony and back in, every table matching. **The verification
caught a bug in the restore itself** — emptiness was being decided from the
`labs` table alone, so leftover rows elsewhere survived the wipe and inflated
the counts. That is the entire argument for verifying rather than asserting.

Neon also provides point-in-time restore, which is the right tool for actual
disaster recovery. This export exists for what PITR does not cover: moving a
colony to another provider, handing a lab its own data, and being something
anyone can run and check.

## Data model — what I chose and why

The brief says the data model is the assignment, so this is the long section.

### Location is a fact with a timestamp, not a column

There is no `currentCageId` on `Animal` and no `rackPositionId` on `Cage`.
Where a cage sits and which cage an animal lives in are stored as half-open
intervals in `CagePlacement` and `AnimalCagePlacement`:

```
[startedAt, endedAt)   endedAt IS NULL means "still there"
```

"Who is in B-04-12 now" and "who was in it on June 3rd" are then the same
query with a different timestamp, and there is only one definition of current
state to get wrong. The query layer has exactly one time predicate (`activeAt`
in `src/lib/queries/placement.ts`) and "now" is `activeAt(new Date())` — a
separate `endedAt IS NULL` fast path would be a second definition that could
drift, which is the failure this shape exists to prevent.

Two placement tables rather than one denormalised address means moving a cage
between racks changes every occupant's address without touching a single
animal row. There is a test asserting exactly that.

### Overlap is enforced by Postgres, not by application code

An animal cannot be in two cages at once, and a rack slot cannot hold two
cages at once. Those are exclusion constraints over `tstzrange(started_at,
ended_at)` using `btree_gist`, not `if` statements:

```sql
ALTER TABLE animal_cage_placements
  ADD CONSTRAINT animal_cage_placements_no_overlap
  EXCLUDE USING gist (animal_id WITH =, tstzrange(started_at, ended_at) WITH &&);
```

Four people editing at once is the actual problem statement, and application
checks lose that race. Four tests deliberately bypass the app layer and assert
the *database* refuses the write.

### Event time and record time are different columns, everywhere

`occurredAt` is when something happened in the vivarium; `recordedAt` is when
a human typed it in. Facts arrive late and out of order — a death noticed on
Tuesday that happened last Thursday has to land in history at Thursday. The UI
shows the gap ("logged 22d later") rather than hiding it, and the offline
write queue depends on this being expressible: an entry tapped behind a rack
with no signal syncs later and still records the time of the tap.

There is deliberately **no** CHECK constraint relating the two. Late entry is
normal, and a `now()`-based check is non-immutable — rows valid at insert time
would fail revalidation on restore, breaking the backup path.

### Lab-local identifiers are never primary keys

Ear tags get reused after an animal dies, two labs use the same numbering, and
transcription errors are routine. `Animal.id` is an opaque UUID; ear tags live
in `AnimalIdentifier`, scoped by namespace, with uniqueness enforced only over
*active* rows:

```sql
CREATE UNIQUE INDEX animal_identifiers_active_unique
  ON animal_identifiers (namespace, scheme, value) WHERE retired_at IS NULL;
```

So a retired tag can legitimately be reissued, and search finds its current
holder rather than the dead animal that used to wear it.

### Every write belongs to a changeset

`withChangeset()` opens a transaction and tags every row it writes with one
changeset id. A weaning that splits one cage into four is a single action to
the person who did it, so it has to be a single thing to undo. That also means
the audit trail *is* the changeset table rather than a parallel log that could
drift from the writes it describes.

Undo unwinds in reverse order — rows the changeset created are deleted before
rows it closed are reopened — or the reopened interval overlaps the one still
stacked on top and the exclusion constraint rejects the transaction. There is a
test for the ordering, not just the end state.

### What is deliberately not normalised

- **`RackPosition.label`** duplicates its own side/row/column. It is derived
  from immutable slot geometry, not from occupancy, and it is what people read
  off a rack and type into search. Recomputing a display string on every query
  to avoid storing eight characters is a bad trade.
- **`HusbandryEvent.payload` is JSON**, not a column per event type. A weight
  has grams, a treatment has a drug and a dose, a plug check has neither. A
  column per type means a migration every time the vet invents a new form;
  the payload is validated per type in the app layer instead.
- **Genotype is a row per assay, not a field on the animal.** Results arrive
  weeks late, get re-run, and disagree between runs. `supersededAt` retires a
  superseded result rather than overwriting it.
- **`Litter.pupCountAtBirth` and `pupCountAtWean` are separate columns.** The
  difference is real information — culling, loss — and the later number must
  not overwrite the earlier one.
- **`BreedingPair` has members rather than sire/dam columns.** Trios and
  harems are normal; two FK columns would need a second table within a month.
- **Soft delete on `Animal` and `Cage` only.** A dead animal and a
  mis-entered animal are different things and neither may vanish from history.
  Events and placements are not soft-deleted because undoing a changeset
  removes them wholesale and the changeset itself records that it happened.

### Timestamps are `timestamptz`

Prisma's default is `timestamp(3)` — *without* time zone. For an app whose
headline query is "as of June 3rd", that answer shifts under DST and across
anyone entering data from a different zone. All 53 temporal columns are
`@db.Timestamptz(3)`.

## Known limitations

Real gaps, separated from things left out on purpose.

**Not verified**

- **Camera scanning on real iOS Safari.** The scanner uses ZXing precisely
  because Safari does not implement `BarcodeDetector`, and the manual-entry
  fallback is tested — but `getUserMedia` needs an HTTPS origin and the camera
  path has only run in headless Chromium. Treat "scanning works on iPhone" as
  unproven until someone opens the deployed URL on a phone.

**Deliberately out of scope**

- **The offline queue covers only flat, append-only actions** — cage changes
  and health notes. Structural changes (moving animals, weaning a litter)
  require a connection and say so. Merging those offline is a genuine
  distributed-systems problem, and getting it subtly wrong corrupts colony
  history in a way nobody notices until it cannot be unpicked.
- **`DEMO_AUTO_MEMBERSHIP` grants a role to any first-time visitor.** That is
  a demo affordance so an evaluator can exercise the permission system. It is
  off unless the variable is set, never applies to someone who already has a
  membership, and should not be set for a real lab.
- **Import maps a fixed set of fields.** Dam and sire columns are recognised
  and mapped but not yet used to build pedigree links.
- **No per-cage permission grants.** Authorization is scoped to a lab, plus
  time-bounded coverage delegation. Cage-level ACLs were not needed to
  demonstrate that roles differ meaningfully.

**Known rough edges**

- The import wizard sends the parsed sheet back to the server on each
  re-mapping. Fine for the few-hundred-row sheets a colony produces; a
  ten-thousand-row file would want the parse cached server-side.
- Genotype imported from a spreadsheet is stored against `locus` taken from
  the strain column, which is a reasonable guess rather than a real locus name.

## Where the data goes, and what it costs

**What leaves the machine.** Colony data goes to one place: a Neon Postgres
database in `us-west-1`, reached only by this app's server. Sign-in sends an
OAuth round trip to GitHub, which tells us a user id, name, email and avatar
URL and nothing else — GitHub never sees colony data, and no role or
permission is stored there. The app is served from Vercel, so their edge sees
request metadata as any host would. There are no analytics, no third-party
scripts, and no AI or external API calls at runtime: the fonts are the only
other origin, and they are served by Next.js from the same domain. Animal
records never leave the database except through the export you run yourself.

**Keys and cost.** Running this needs a GitHub OAuth App (free), a Neon
project (free tier: 0.5 GB storage, ample for a colony of a few hundred
animals whose entire seeded history is 4,238 rows), and Vercel's hobby tier
(free). No paid API is required for anything, and nothing degrades if you
have no budget — there is no premium path being held back. The only secrets
are `DATABASE_URL`, `AUTH_SECRET` and the GitHub client ID and secret; all
four live in environment variables, none are committed, and `.env` is
gitignored with only `.env.example` tracked. If Neon disappeared tomorrow,
`npm run db:export` produces a complete JSON snapshot and `npm run db:restore`
puts it into any other Postgres — that path is tested, not asserted.

## License

MIT — see `LICENSE`.
