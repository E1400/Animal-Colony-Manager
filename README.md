# Animal Colony Manager

**Live demo:** _TODO — Vercel URL_
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

_TODO — filled in as the app takes shape. Will cover: cloning, `npm install`,
the `.env` variables needed (Neon `DATABASE_URL`, GitHub OAuth
`AUTH_GITHUB_ID`/`AUTH_GITHUB_SECRET`, `AUTH_SECRET`), running migrations and
the seed script, and starting the dev server — all without needing Docker,
Python, or a locally-installed database._

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
