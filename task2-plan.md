# Task 2 — Animal Colony Manager: Project Plan

## Context

Task 1 (Barnes maze) is essentially done. There's ~4 days left until the Sep 8, 9am PT deadline. The brief explicitly allows and rewards submitting more than one task ("the quality and range of everything you submit"), so we're building Task 2 to full scope, structured so the bottom of the milestone list is the first thing cut if time runs out — same pattern as `task1-plan.md`.

Task 2 leans **software engineering**: full-stack, real auth, a real database with migrations, and a phone-first UI — the opposite muscle from Task 1's static client-only CV tool. The brief is explicit that **the data model is the actual assignment** ("every homegrown version of this that we have seen fail, failed here rather than in the UI") — so most of the design effort below goes into the schema and its temporal/event-log shape, not the UI.

## Source of truth

- Task brief: `tasks/02-colony-manager.md` in https://github.com/salk-airc/rse-takehome-2026
- Cross-cutting requirements (auth, usability, "it has to run", AI notes, data/cost, accessibility) apply from the same repo's top-level README
- Submit: new repo (not a fork), email link to talmo@salk.edu by 2026-09-08 9:00am PT, add `talmo` as collaborator if private

## What "excellent" means here (from the rubric + brief)

- **The schema survives contact with reality**: an animal moving cages, a cage splitting at weaning, an animal that dies, a record entered wrong three weeks ago and noticed today, "which mice were in cage B-04-12 on June 3rd."
- **Location is not identity** — never store a rack position as a column on the animal or the cage; it has to be a first-class, time-stamped fact.
- **Time is a first-class dimension** — this is an event log with derived current state, not a table of current state. Event date ≠ record date.
- **Ingestion is core, not a stretch feature** — a working importer against genuinely ugly fixture spreadsheets is required, not optional.
- **The five-second test**: someone standing at a rack, one-handed, gloved, logs a cage change without thinking about it. Tested on real iOS Safari, not a resized desktop window.
- **Undo a scared user can find** — every write attributable and reversible, soft deletes, a demonstrated backup/restore path.
- **Auth ≠ authorization** — OIDC via GitHub gets you identity; the interesting part is that a PI, lab manager, undergrad, and vet have genuinely different permissions over the same records.
- **Seeded realistically** — hundreds of animals, multiple racks, breeding pairs and litters in flight, visible within ~60 seconds of a reviewer opening it cold.
- Cross-cutting, same as Task 1: `AI_NOTES.md` with real disagreement moments, data/cost section, accessibility pass, live deployment, real commit history, license, `.claude/` committed.

## Proposed architecture

**Next.js (App Router) + TypeScript, Postgres via Prisma, deployed on Vercel with a Neon (serverless Postgres) database.** Auth via Auth.js (NextAuth) with the GitHub provider — a real OIDC/OAuth flow, not a black-box managed-auth product, so it's defensible in the interview. Tailwind for a mobile-first UI. Zero paid APIs required for the core product (GitHub OAuth App + Neon free tier are both free at this scale) — matches the "keys and cost" cross-cutting requirement cleanly.

Why this stack over the alternatives: SQLite is "completely respectable" per the brief, but Postgres gives real concurrent-write semantics (four people editing at once is literally the problem statement) and Neon's branching/point-in-time restore is a legitimate, demonstrable backup story instead of a hand-rolled one. Next.js gives one deployable artifact for frontend + API routes + server actions, which keeps "it has to run from a cold clone" simple — one README, one `vercel deploy` or `npm run build && npm start`.

### Data model — the core of this task

Event-sourced-ish: **placement history tables are the source of truth; "current location" is always a derived query** (latest placement row with no end), never a cached column that can drift. This is what makes "who was in B-04-12 on June 3rd" and "put it back" both fall out for free instead of needing bolted-on point-in-time logic later.

Core entities:
- `Room` → `Rack` (belongs to room) → `RackPosition` (side/row/column address — a property of the *slot*, not of whatever cage currently sits there)
- `Cage` — a physical object with a lifecycle (created, retired, address reused); its position over time lives in `CagePlacement` (cage_id, rack_position_id, moved_at, moved_by), never a foreign key column on `Cage` itself
- `Animal` — a system-generated identity (UUID), completely separate from lab-local ear tags/punches/toe numbers, which live in `AnimalIdentifier` (animal_id, scheme, value, lab/namespace) so the same messy, non-unique local ID scheme from five different labs can coexist without collisions
- `AnimalCagePlacement` (animal_id, cage_id, moved_at, moved_by, reason) — same pattern as cage placement; "which animals are in this cage right now" and "on June 3rd" are the same query with a different `AS OF` timestamp
- `HusbandryEvent` (type: cage_change/health_check/weaning/tail_snip/weight/treatment/death/transfer; subject animal_id or cage_id; `occurred_at` vs `recorded_at` as distinct columns — this is the late/out-of-order-facts requirement; recorded_by; notes; typed payload)
- `Genotype` (animal_id, locus, expected, confirmed, confirmed_at, source) — separate from the animal row precisely because it arrives weeks late
- `BreedingPair` / `Litter` — pair setup, plug observed, born_at, pup count, later resolved into individually-tagged `Animal` rows
- `User` (from GitHub OIDC) with a `Role` per lab/scope (PI / lab manager / undergrad / vet) — authorization is scoped to labs and/or specific cages, not global
- `CoverageAssignment` (owner_user_id, covering_user_id, scope, start, end) — the vacation-handoff feature
- `ImportBatch` / `ImportRow` — tracks every ingestion run for dry-run, undo, and idempotency
- Soft deletes (`deleted_at`, `deleted_by`, `delete_reason`) on `Animal` and `Cage` — a dead animal and a mis-entered animal are different things and neither disappears from history
- Every write happens inside an app-level "changeset" (a group of row insertions tagged with one action id) — bulk-undo means reversing one changeset's rows, which is what gives the "tired grad student at 11pm" undo button real teeth instead of being per-row only

Real Prisma migrations (not `db push`), with FK constraints and indices on the query patterns above (current-placement lookups, "as of" lookups, identifier search), and a README section explaining what was deliberately *not* normalized and why.

### Auth & authorization

Auth.js GitHub provider for OIDC/OAuth sign-in. Role/permission data lives in our own DB, not in GitHub — a user's role is a fact about our system, resolved after sign-in and enforced in server actions/API routes, not just hidden in the UI. Reconciling "no account creation friction" (cross-cutting req #3: something real within 60 seconds) with "auth required" (Task 2's own requirement): GitHub sign-in is seconds, not account creation for *this* app, and the DB is pre-seeded with hundreds of animals so a reviewer sees a populated colony immediately after signing in. README says this explicitly so it doesn't read as a contradiction.

### Mobile

Mobile is the primary target, desktop is secondary. Tailwind mobile-first breakpoints, large tap targets, the "log a cage change" action reachable in 1-2 taps from launch. QR code per cage (generated server-side, printable on the cage-card view) scanned client-side via the device camera (`@zxing/browser` or similar) to jump straight to that cage's record. Offline gets a real, stated decision rather than a default: read-through cache of recently-viewed cages (so a dead WiFi patch behind a rack doesn't blank the screen) plus a local write queue for the small set of common actions (cage change, weight, note) that syncs when connectivity returns, with a visible "pending sync" indicator — never a silent failure. This is explicitly the first thing to simplify if time is short (falls back to "clear error, try again" instead of a queue).

Testing note: iOS Safari specifically, on a real device, per the brief — this needs to happen against the live Vercel deployment, not localhost.

### Spreadsheet ingestion

Client + server pipeline: parse (CSV via `papaparse`, XLSX via `exceljs`) → heuristic column-mapping UI with manual override → per-row validation with typed, row-numbered errors → **dry-run diff view** (what will be created / skipped / flagged) before any write → commit creates one `ImportBatch`. Idempotency and dedup work off `AnimalIdentifier` (namespace + value), never off a raw column value, which is what makes "someone uploads the same file twice" and "two sheets disagree" both tractable. Build 2-3 deliberately ugly fixture spreadsheets (mixed date formats, merged headers, sex as M/male/♂, genotype hiding in a Notes column, blank separator rows) and commit them plus the importer eating them successfully.

### Versioning, undo, backups

Falls mostly out of the event-log schema: audit trail = the placement/event tables themselves (who/when/before/after is what they *are*, not a bolted-on log). Bulk undo = revert one changeset. Backups: Neon gives point-in-time restore natively; also build an explicit "export a full snapshot" action and document + actually demonstrate a restore in the README/video rather than just asserting Neon handles it, since "a backup nobody has ever restored is a rumor."

### Testing & CI

Vitest for the schema/query layer (current-placement correctness, as-of queries, import validation logic) — this is where a colony manager actually breaks, so it's where the tests should concentrate, not on UI snapshot tests. Playwright for an end-to-end smoke run including a mobile viewport pass (the five-second test) and the import flow against the ugly fixtures. GitHub Actions CI: lint, typecheck, test, build; separate Vercel deploy.

## Phased milestones (cut from the bottom if time runs short)

1. **Scaffold** — new repo, Next.js/TS, Prisma + Neon Postgres, Auth.js GitHub OIDC wired end to end, CI skeleton, `CLAUDE.md`/`AI_NOTES.md`/README skeletons, license, empty shell deployed to Vercel. ✅ **Done** (repo scaffolded, git initialized with first commit, CI workflow written; Prisma/Auth.js/Vercel deploy still pending — see below).
2. **Core schema + seed** — rooms/racks/positions, cages, animals, identifiers, placement event logs, husbandry events, real migrations with constraints/indices; a seed script generating a realistic colony. ✅ **Done.** 21 tables + 15 enums in `prisma/schema.prisma`; two migrations (`_init`, `_integrity_constraints`) verified against a live Postgres. Exclusion constraints over `tstzrange` + `btree_gist` enforce non-overlapping placements in the database, not in app code. Deterministic seed (`prisma/seed.ts`) builds 415 animals, 128 cages, 408 rack slots, 1713 husbandry events, 14 breeding pairs and 19 litters with pre-wean litters still in flight. Query layer in `src/lib/queries/placement.ts` (one `activeAt` predicate; "now" is not a special case), write operations in `src/lib/operations/placement.ts`, changeset wrapper in `src/lib/changeset.ts`. 16 Vitest tests green against a real Postgres, covering as-of queries, half-open interval boundaries, backdated entry, constraint enforcement, transactional rollback and identifier reuse. CI runs the suite against a `postgres:17` service container.
3. **Cage & animal views** — current-state derived views, digital cage card (view + print-friendly), QR code generation, mobile-first layout end to end. ✅ **Done.** Routes: `/` (summary + search), `/cages` (list with derived address and live occupant count), `/cages/[code]` (cage card with occupants, recent activity and late-entry flags), `/cages/[code]/print` (physical cage card with server-rendered SVG QR), `/animals/[id]` (identifiers, genotype, full placement history, event log), `/search` (one box for cage code, rack slot or ear tag). Read models in `src/lib/queries/views.ts` do fixed-query-count joins rather than N+1. Verified on a real 390×844 mobile viewport with Playwright: no horizontal overflow on any route, every tap target ≥44px, and the printed QR decoded back out of a screenshot to the correct URL. 25 Vitest tests green.
4. **QR scan + mobile pass** — camera scan → cage record, one/two-tap common actions, offline read-cache + write-queue decision implemented, real iOS Safari test pass. **Mostly done; one part genuinely blocked.** `/scan` decodes cage-card QR codes with ZXing (chosen over the built-in `BarcodeDetector`, which iOS Safari does not implement), loaded lazily so the decoder is not in everyone's bundle, with manual code entry as a fallback for denied permissions, no camera, or a non-HTTPS origin. One-tap "Cage changed" and a health-check note are wired through server actions into `logEvent`, each in its own changeset. Offline write queue is implemented and verified end to end in a real browser: going offline queues to `localStorage` and shows a pending count, and reconnecting drains it to zero. Queued entries carry the timestamp of the tap, and the server bounds it against clock skew — so a note written behind a rack with no signal lands in history at the time it happened, not the time it uploaded. **Still outstanding: the real iOS Safari pass on a physical device**, which needs an HTTPS origin and therefore the Vercel + Neon deployment. Camera capture has not been exercised on real hardware; everything else on this milestone has.
5. **Husbandry events, coverage, RBAC, undo** — event logging UI, coverage/on-call assignment and handoff, role-scoped permissions (PI/manager/undergrad/vet), soft delete, changeset-based bulk undo, audit trail view. **Not started.**
6. **Spreadsheet import** — mapping UI, validation, dry-run diff, commit, idempotency, 2-3 ugly fixture sheets committed and passing, CSV/XLSX census/per-diem export. **Not started.**
7. **Compliance + ship** — backup/restore demonstrated, accessibility pass, README, `AI_NOTES.md` finalized, cold-clone verification, demo video. ✅ **Done except the video.** Backup/restore is two commands, covered by four tests, and was run for real between two separate Postgres instances (4,238 rows out and back, every table matching) — the verification immediately caught a bug in the restore itself. Accessibility: axe-core across all nine pages at WCAG 2.1 A/AA reports zero violations, down from three, and 200% text zoom no longer overflows. README carries the schema rationale, what was deliberately left denormalised, known limitations split into unverified / out-of-scope / rough edges, and the data-and-cost section. Cold-clone verified by cloning from GitHub into an empty directory and following the README exactly — which found a real bug where a blank `DIRECT_DATABASE_URL` shadowed `DATABASE_URL` and broke migrations for anyone starting fresh. **Outstanding: the demo video, and the real-iOS-Safari camera test**, both of which need a physical phone.
8. **Stretch, only if time remains** — breeding/cross planner, genotype-pending tracking, weaning/overdue-change alerts, OCR of paper cage cards, MCP server for "which cages need changing today." **Not started.**

## Open items still to resolve

- **Local dev database** — solved without Neon or Docker: `npm run db:up` (`prisma dev -d -n colony`) starts a throwaway local Postgres and prints a URL for `.env`. `npm run db:down` stops it. This is what the migrations were verified against. Neon is still needed for deployment, not for local work.
- **Neon Postgres project** — not yet created. Needs a free Neon account + project, and the connection string as `DATABASE_URL` in `.env` (not committed). Confirm Neon allows `CREATE EXTENSION btree_gist` — the placement exclusion constraints depend on it. (It is on Neon's supported-extensions list; verify on the actual instance before assuming.)
- **GitHub OAuth App** — not yet created. GitHub Settings → Developer settings → OAuth Apps → New OAuth App. Homepage URL and callback URL will depend on the dev/prod split (`http://localhost:3000/api/auth/callback/github` for local dev; the Vercel URL + same path once deployed — Auth.js may need two OAuth Apps, one per environment, or one app with both callback URLs registered depending on GitHub's rules). Client ID + secret go in `.env` as `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`, plus a random `AUTH_SECRET` (`npx auth secret` or `openssl rand -base64 32`).
- **Vercel deployment** — not yet set up. `vercel link` / `vercel deploy` once there's something worth deploying (after Prisma + a basic page exist), with the same env vars added in the Vercel project settings.
- Log `AI_NOTES.md` disagreement moments live during the build (user confirmed: yes) rather than reconstructed at the end — there's already one worth logging: the sandboxed device shell used to build this couldn't background long-running installs across calls (die-with-parent process groups) and initially couldn't delete stale files during `npm install`, which is why the first Prisma install attempt left `node_modules` populated but no `package-lock.json`.
