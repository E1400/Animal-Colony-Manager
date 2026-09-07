# Example spreadsheet

`demo-import.csv` is a colony sheet for recording a demo against. It uses tag
numbers in the 9000s and cages `CG-3001`–`CG-3003`, none of which exist in the
seeded colony, so importing it adds new records rather than colliding with what
is already there.

It is deliberately untidy in the same ways a real lab sheet is. Nine data rows:
**six import — two of them flagged for a look — and three are rejected.**

| Row | Tag | What it exercises | Outcome |
| --- | --- | --- | --- |
| 5 | 9001 | A clean row | imports |
| 6 | 9002 | `male` spelled out, `06/04/2026`, genotype buried in the notes | imports, **flagged twice**: the date is ambiguous and the genotype was inferred |
| 7 | 9003 | `♀` symbol, lowercase cage code | imports |
| 9 | 9004 | `46180` — a date Excel turned into a serial number | imports, **flagged**: read as 2026-06-07 |
| 10 | 9005 | Padded whitespace, `June 2026` with no day | imports, kept at month precision |
| 11 | 9006 | `#` prefix on the tag, `17/06/2026` day-first | imports — 17 cannot be a month, so there is no ambiguity to warn about |
| 12 | 9007 | `X` in the sex column | **rejected** |
| 13 | 9008 | `2026-13-45` is not a real date | **rejected** |
| 14 | 9001 | The same tag as row 5 | **rejected** |

Rows 1–3 are a title block and row 8 is a blank separator. Neither is data, and
the importer skips them — the header is found on row 4 rather than assumed to
be first.

## Using it

1. Sign in, then open **Import**.
2. Drop the file in, or pick it with the file chooser.
3. You land on the review screen. Nothing has been written yet.
   - The bar at the top says where the header was found and how much preamble
     was skipped.
   - Each column header carries a dropdown showing what it was mapped to.
     Change one and the rows below re-check themselves immediately.
   - The tabs filter to **Will import**, **Needs a look**, or **Rejected**.
   - Every row's verdict sits in the pinned left column, so it stays visible
     while you scroll sideways through the data.
4. Rejected rows explain themselves underneath, quoting the cell.
5. **Dates read as** at the top right resolves ambiguity. `06/04/2026` could be
   June 4th or April 6th; leaving it on *Guess* imports it with a warning,
   while setting month-first or day-first commits to one reading and drops the
   warning.
6. Press **Import 6 rows**. That writes everything in one changeset, so the
   whole import is a single entry in **Activity** and a single thing to undo.

Re-uploading the same file is refused — the importer hashes the rows and will
not create the colony twice.

## The other samples

The Import screen also offers three files from `fixtures/`, which are the ones
the test suite runs against. They overlap with this file but exist for testing
rather than demoing; `merged-headers.xlsx` is the interesting one, since it is
a real `.xlsx` with a merged title row above the header.
