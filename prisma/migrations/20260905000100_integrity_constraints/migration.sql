-- Integrity constraints that Prisma's schema language cannot express.
--
-- The placement tables are the source of truth for location, so their
-- invariants have to be enforced by the database rather than by application
-- code. Application-level checks lose to concurrency, and "four people editing
-- at once" is the actual problem statement for this app.

-- gist indexes over scalar types (uuid) alongside range types.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- Intervals must be well-formed.
-- ---------------------------------------------------------------------------

ALTER TABLE "cage_placements"
  ADD CONSTRAINT "cage_placements_interval_ordered"
  CHECK ("ended_at" IS NULL OR "ended_at" > "started_at");

ALTER TABLE "animal_cage_placements"
  ADD CONSTRAINT "animal_cage_placements_interval_ordered"
  CHECK ("ended_at" IS NULL OR "ended_at" > "started_at");

-- ---------------------------------------------------------------------------
-- No overlapping placements.
--
-- tstzrange(started_at, ended_at) is half-open [start, end): a cage that leaves
-- a slot at 09:00 and another that arrives at 09:00 do not conflict. A NULL
-- ended_at yields an unbounded upper bound, so two open rows for the same
-- subject always overlap — which is exactly the "one current location" rule,
-- enforced for all of history rather than just the present.
-- ---------------------------------------------------------------------------

-- An animal lives in one cage at a time.
ALTER TABLE "animal_cage_placements"
  ADD CONSTRAINT "animal_cage_placements_no_overlap"
  EXCLUDE USING gist (
    "animal_id" WITH =,
    tstzrange("started_at", "ended_at") WITH &&
  );

-- A cage sits in one rack position at a time.
ALTER TABLE "cage_placements"
  ADD CONSTRAINT "cage_placements_no_overlap_per_cage"
  EXCLUDE USING gist (
    "cage_id" WITH =,
    tstzrange("started_at", "ended_at") WITH &&
  );

-- A rack position holds one cage at a time. This is the constraint that makes
-- a reused address ("B-04-12 again, two years later") safe instead of
-- ambiguous.
ALTER TABLE "cage_placements"
  ADD CONSTRAINT "cage_placements_no_overlap_per_position"
  EXCLUDE USING gist (
    "rack_position_id" WITH =,
    tstzrange("started_at", "ended_at") WITH &&
  );

-- ---------------------------------------------------------------------------
-- Partial indexes for the two hot read paths.
-- ---------------------------------------------------------------------------

-- "Where is this cage / who is in this cage, right now."
CREATE INDEX "cage_placements_open_idx"
  ON "cage_placements" ("cage_id")
  WHERE "ended_at" IS NULL;

CREATE INDEX "animal_cage_placements_open_by_cage_idx"
  ON "animal_cage_placements" ("cage_id")
  WHERE "ended_at" IS NULL;

-- ---------------------------------------------------------------------------
-- Lab-local identifiers.
--
-- Uniqueness holds only over *active* identifiers: an ear tag is routinely
-- reissued after the animal wearing it dies, and history has to keep both.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX "animal_identifiers_active_unique"
  ON "animal_identifiers" ("namespace", "scheme", "value")
  WHERE "retired_at" IS NULL;

CREATE UNIQUE INDEX "animal_identifiers_one_primary_per_animal"
  ON "animal_identifiers" ("animal_id")
  WHERE "retired_at" IS NULL AND "is_primary";

-- ---------------------------------------------------------------------------
-- An event has to be about something.
-- ---------------------------------------------------------------------------

ALTER TABLE "husbandry_events"
  ADD CONSTRAINT "husbandry_events_has_subject"
  CHECK ("animal_id" IS NOT NULL OR "cage_id" IS NOT NULL);

-- Deliberately NOT constrained: the relationship between occurred_at and
-- recorded_at. Late entry ("this happened three weeks ago and I noticed
-- today") is the normal case, and a sanity check against now() would be
-- non-immutable — rows valid at insert time would fail revalidation on
-- restore, breaking the backup story. Plausibility of dates is an app-layer
-- warning, not a database constraint.
