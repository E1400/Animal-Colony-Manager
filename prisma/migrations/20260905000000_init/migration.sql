-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "role" AS ENUM ('PI', 'LAB_MANAGER', 'VETERINARIAN', 'RESEARCHER', 'TECHNICIAN', 'UNDERGRAD', 'AUDITOR');

-- CreateEnum
CREATE TYPE "coverage_scope" AS ENUM ('LAB', 'ROOM', 'RACK');

-- CreateEnum
CREATE TYPE "cage_status" AS ENUM ('ACTIVE', 'EMPTY', 'RETIRED');

-- CreateEnum
CREATE TYPE "sex" AS ENUM ('MALE', 'FEMALE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "animal_source" AS ENUM ('BORN_IN_HOUSE', 'VENDOR', 'TRANSFER_IN', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "date_precision" AS ENUM ('DAY', 'MONTH', 'YEAR', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "identifier_scheme" AS ENUM ('EAR_TAG', 'EAR_PUNCH', 'TOE_CLIP', 'TAIL_MARK', 'TATTOO', 'RFID', 'VENDOR_ID', 'LEGACY_SPREADSHEET');

-- CreateEnum
CREATE TYPE "placement_reason" AS ENUM ('INITIAL', 'CAGE_CHANGE', 'WEANING', 'BREEDING_SETUP', 'BREEDING_END', 'SEPARATION', 'OVERCROWDING', 'HEALTH_ISOLATION', 'TRANSFER', 'IMPORT', 'CORRECTION');

-- CreateEnum
CREATE TYPE "genotype_result" AS ENUM ('WT', 'HET', 'HOM', 'HEMI', 'NEGATIVE', 'POSITIVE', 'PENDING', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "breeding_status" AS ENUM ('ACTIVE', 'RESTING', 'RETIRED');

-- CreateEnum
CREATE TYPE "breeding_role" AS ENUM ('SIRE', 'DAM');

-- CreateEnum
CREATE TYPE "husbandry_event_type" AS ENUM ('CAGE_CHANGE', 'HEALTH_CHECK', 'WEIGHT', 'WEANING', 'TAIL_SNIP', 'EAR_PUNCH', 'TREATMENT', 'BREEDING_SETUP', 'PLUG_CHECK', 'LITTER_BORN', 'GENOTYPE_SAMPLED', 'DEATH', 'EUTHANASIA', 'TRANSFER_IN', 'TRANSFER_OUT', 'NOTE');

-- CreateEnum
CREATE TYPE "changeset_kind" AS ENUM ('MANUAL', 'IMPORT', 'SEED', 'REVERT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "import_status" AS ENUM ('DRY_RUN', 'COMMITTED', 'FAILED', 'REVERTED');

-- CreateEnum
CREATE TYPE "import_row_status" AS ENUM ('CREATED', 'UPDATED', 'SKIPPED_DUPLICATE', 'SKIPPED_BLANK', 'FLAGGED', 'ERROR');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "email_verified" TIMESTAMPTZ(3),
    "image" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("provider","provider_account_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "session_token" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("session_token")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("identifier","token")
);

-- CreateTable
CREATE TABLE "labs" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pi_name" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "labs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "lab_id" UUID NOT NULL,
    "role" "role" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coverage_assignments" (
    "id" UUID NOT NULL,
    "lab_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "covering_user_id" UUID NOT NULL,
    "scope" "coverage_scope" NOT NULL DEFAULT 'LAB',
    "room_id" UUID,
    "rack_id" UUID,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3),
    "reason" TEXT,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changeset_id" UUID,

    CONSTRAINT "coverage_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "building" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "racks" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "lab_id" UUID,
    "code" TEXT NOT NULL,
    "label" TEXT,
    "row_count" INTEGER NOT NULL,
    "col_count" INTEGER NOT NULL,
    "sides" TEXT[] DEFAULT ARRAY['A', 'B']::TEXT[],
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "racks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rack_positions" (
    "id" UUID NOT NULL,
    "rack_id" UUID NOT NULL,
    "side" TEXT NOT NULL,
    "row" INTEGER NOT NULL,
    "col" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "retired" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "rack_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cages" (
    "id" UUID NOT NULL,
    "lab_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "cage_type" TEXT,
    "status" "cage_status" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "retired_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,
    "delete_reason" TEXT,

    CONSTRAINT "cages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cage_placements" (
    "id" UUID NOT NULL,
    "cage_id" UUID NOT NULL,
    "rack_position_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_recorded_at" TIMESTAMPTZ(3),
    "started_by_id" UUID,
    "ended_by_id" UUID,
    "reason" TEXT,
    "changeset_id" UUID,
    "end_changeset_id" UUID,

    CONSTRAINT "cage_placements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strains" (
    "id" UUID NOT NULL,
    "lab_id" UUID,
    "name" TEXT NOT NULL,
    "common_name" TEXT,
    "background" TEXT,
    "jax_stock_number" TEXT,

    CONSTRAINT "strains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "animals" (
    "id" UUID NOT NULL,
    "lab_id" UUID NOT NULL,
    "species" TEXT NOT NULL DEFAULT 'Mus musculus',
    "sex" "sex" NOT NULL DEFAULT 'UNKNOWN',
    "strain_id" UUID,
    "birth_date" DATE,
    "birth_date_precision" "date_precision" NOT NULL DEFAULT 'DAY',
    "source" "animal_source" NOT NULL DEFAULT 'UNKNOWN',
    "acquired_at" TIMESTAMPTZ(3),
    "dam_id" UUID,
    "sire_id" UUID,
    "litter_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,
    "delete_reason" TEXT,

    CONSTRAINT "animals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "animal_identifiers" (
    "id" UUID NOT NULL,
    "animal_id" UUID NOT NULL,
    "namespace" TEXT NOT NULL,
    "scheme" "identifier_scheme" NOT NULL,
    "value" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL,
    "retired_at" TIMESTAMPTZ(3),
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "changeset_id" UUID,

    CONSTRAINT "animal_identifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "animal_cage_placements" (
    "id" UUID NOT NULL,
    "animal_id" UUID NOT NULL,
    "cage_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_recorded_at" TIMESTAMPTZ(3),
    "started_by_id" UUID,
    "ended_by_id" UUID,
    "reason" "placement_reason" NOT NULL DEFAULT 'CAGE_CHANGE',
    "notes" TEXT,
    "changeset_id" UUID,
    "end_changeset_id" UUID,

    CONSTRAINT "animal_cage_placements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genotypes" (
    "id" UUID NOT NULL,
    "animal_id" UUID NOT NULL,
    "locus" TEXT NOT NULL,
    "expected" "genotype_result" NOT NULL DEFAULT 'UNKNOWN',
    "result" "genotype_result" NOT NULL DEFAULT 'PENDING',
    "assayed_at" TIMESTAMPTZ(3),
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmed_at" TIMESTAMPTZ(3),
    "source" TEXT,
    "superseded_at" TIMESTAMPTZ(3),
    "notes" TEXT,
    "changeset_id" UUID,

    CONSTRAINT "genotypes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "breeding_pairs" (
    "id" UUID NOT NULL,
    "lab_id" UUID NOT NULL,
    "name" TEXT,
    "cage_id" UUID,
    "set_up_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "breeding_status" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "changeset_id" UUID,

    CONSTRAINT "breeding_pairs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "breeding_pair_members" (
    "id" UUID NOT NULL,
    "pair_id" UUID NOT NULL,
    "animal_id" UUID NOT NULL,
    "role" "breeding_role" NOT NULL,
    "joined_at" TIMESTAMPTZ(3) NOT NULL,
    "left_at" TIMESTAMPTZ(3),

    CONSTRAINT "breeding_pair_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "litters" (
    "id" UUID NOT NULL,
    "pair_id" UUID,
    "born_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "weaned_at" TIMESTAMPTZ(3),
    "pup_count_at_birth" INTEGER,
    "pup_count_at_wean" INTEGER,
    "notes" TEXT,
    "changeset_id" UUID,

    CONSTRAINT "litters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "husbandry_events" (
    "id" UUID NOT NULL,
    "lab_id" UUID NOT NULL,
    "type" "husbandry_event_type" NOT NULL,
    "animal_id" UUID,
    "cage_id" UUID,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recorded_by_id" UUID,
    "notes" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "changeset_id" UUID,

    CONSTRAINT "husbandry_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "changesets" (
    "id" UUID NOT NULL,
    "lab_id" UUID,
    "actor_id" UUID,
    "kind" "changeset_kind" NOT NULL DEFAULT 'MANUAL',
    "summary" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reverted_at" TIMESTAMPTZ(3),
    "reverted_by_changeset_id" UUID,

    CONSTRAINT "changesets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "lab_id" UUID NOT NULL,
    "uploaded_by_id" UUID,
    "changeset_id" UUID,
    "filename" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "source_format" TEXT NOT NULL,
    "status" "import_status" NOT NULL DEFAULT 'DRY_RUN',
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "created_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "status" "import_row_status" NOT NULL,
    "raw" JSONB NOT NULL,
    "normalized" JSONB,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "animal_id" UUID,
    "cage_id" UUID,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "labs_slug_key" ON "labs"("slug");

-- CreateIndex
CREATE INDEX "memberships_lab_id_role_idx" ON "memberships"("lab_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_lab_id_key" ON "memberships"("user_id", "lab_id");

-- CreateIndex
CREATE INDEX "coverage_assignments_lab_id_starts_at_idx" ON "coverage_assignments"("lab_id", "starts_at");

-- CreateIndex
CREATE INDEX "coverage_assignments_covering_user_id_starts_at_idx" ON "coverage_assignments"("covering_user_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_code_key" ON "rooms"("code");

-- CreateIndex
CREATE UNIQUE INDEX "racks_room_id_code_key" ON "racks"("room_id", "code");

-- CreateIndex
CREATE INDEX "rack_positions_label_idx" ON "rack_positions"("label");

-- CreateIndex
CREATE UNIQUE INDEX "rack_positions_rack_id_side_row_col_key" ON "rack_positions"("rack_id", "side", "row", "col");

-- CreateIndex
CREATE UNIQUE INDEX "rack_positions_rack_id_label_key" ON "rack_positions"("rack_id", "label");

-- CreateIndex
CREATE UNIQUE INDEX "cages_code_key" ON "cages"("code");

-- CreateIndex
CREATE INDEX "cages_lab_id_status_idx" ON "cages"("lab_id", "status");

-- CreateIndex
CREATE INDEX "cages_deleted_at_idx" ON "cages"("deleted_at");

-- CreateIndex
CREATE INDEX "cage_placements_cage_id_started_at_idx" ON "cage_placements"("cage_id", "started_at");

-- CreateIndex
CREATE INDEX "cage_placements_rack_position_id_started_at_idx" ON "cage_placements"("rack_position_id", "started_at");

-- CreateIndex
CREATE INDEX "cage_placements_ended_at_idx" ON "cage_placements"("ended_at");

-- CreateIndex
CREATE UNIQUE INDEX "strains_lab_id_name_key" ON "strains"("lab_id", "name");

-- CreateIndex
CREATE INDEX "animals_lab_id_sex_idx" ON "animals"("lab_id", "sex");

-- CreateIndex
CREATE INDEX "animals_strain_id_idx" ON "animals"("strain_id");

-- CreateIndex
CREATE INDEX "animals_birth_date_idx" ON "animals"("birth_date");

-- CreateIndex
CREATE INDEX "animals_deleted_at_idx" ON "animals"("deleted_at");

-- CreateIndex
CREATE INDEX "animals_litter_id_idx" ON "animals"("litter_id");

-- CreateIndex
CREATE INDEX "animal_identifiers_animal_id_idx" ON "animal_identifiers"("animal_id");

-- CreateIndex
CREATE INDEX "animal_identifiers_scheme_value_idx" ON "animal_identifiers"("scheme", "value");

-- CreateIndex
CREATE INDEX "animal_identifiers_namespace_value_idx" ON "animal_identifiers"("namespace", "value");

-- CreateIndex
CREATE INDEX "animal_cage_placements_animal_id_started_at_idx" ON "animal_cage_placements"("animal_id", "started_at");

-- CreateIndex
CREATE INDEX "animal_cage_placements_cage_id_started_at_idx" ON "animal_cage_placements"("cage_id", "started_at");

-- CreateIndex
CREATE INDEX "animal_cage_placements_ended_at_idx" ON "animal_cage_placements"("ended_at");

-- CreateIndex
CREATE INDEX "genotypes_animal_id_locus_idx" ON "genotypes"("animal_id", "locus");

-- CreateIndex
CREATE INDEX "genotypes_result_idx" ON "genotypes"("result");

-- CreateIndex
CREATE INDEX "breeding_pairs_lab_id_status_idx" ON "breeding_pairs"("lab_id", "status");

-- CreateIndex
CREATE INDEX "breeding_pair_members_animal_id_idx" ON "breeding_pair_members"("animal_id");

-- CreateIndex
CREATE UNIQUE INDEX "breeding_pair_members_pair_id_animal_id_key" ON "breeding_pair_members"("pair_id", "animal_id");

-- CreateIndex
CREATE INDEX "litters_pair_id_born_at_idx" ON "litters"("pair_id", "born_at");

-- CreateIndex
CREATE INDEX "litters_born_at_idx" ON "litters"("born_at");

-- CreateIndex
CREATE INDEX "husbandry_events_animal_id_occurred_at_idx" ON "husbandry_events"("animal_id", "occurred_at");

-- CreateIndex
CREATE INDEX "husbandry_events_cage_id_occurred_at_idx" ON "husbandry_events"("cage_id", "occurred_at");

-- CreateIndex
CREATE INDEX "husbandry_events_lab_id_type_occurred_at_idx" ON "husbandry_events"("lab_id", "type", "occurred_at");

-- CreateIndex
CREATE INDEX "husbandry_events_occurred_at_idx" ON "husbandry_events"("occurred_at");

-- CreateIndex
CREATE INDEX "husbandry_events_recorded_at_idx" ON "husbandry_events"("recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "changesets_reverted_by_changeset_id_key" ON "changesets"("reverted_by_changeset_id");

-- CreateIndex
CREATE INDEX "changesets_lab_id_created_at_idx" ON "changesets"("lab_id", "created_at");

-- CreateIndex
CREATE INDEX "changesets_actor_id_created_at_idx" ON "changesets"("actor_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "import_batches_changeset_id_key" ON "import_batches"("changeset_id");

-- CreateIndex
CREATE INDEX "import_batches_lab_id_started_at_idx" ON "import_batches"("lab_id", "started_at");

-- CreateIndex
CREATE INDEX "import_batches_content_hash_idx" ON "import_batches"("content_hash");

-- CreateIndex
CREATE INDEX "import_rows_batch_id_status_idx" ON "import_rows"("batch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "import_rows_batch_id_row_number_key" ON "import_rows"("batch_id", "row_number");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "labs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coverage_assignments" ADD CONSTRAINT "coverage_assignments_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "labs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coverage_assignments" ADD CONSTRAINT "coverage_assignments_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coverage_assignments" ADD CONSTRAINT "coverage_assignments_covering_user_id_fkey" FOREIGN KEY ("covering_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coverage_assignments" ADD CONSTRAINT "coverage_assignments_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coverage_assignments" ADD CONSTRAINT "coverage_assignments_rack_id_fkey" FOREIGN KEY ("rack_id") REFERENCES "racks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coverage_assignments" ADD CONSTRAINT "coverage_assignments_changeset_id_fkey" FOREIGN KEY ("changeset_id") REFERENCES "changesets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "racks" ADD CONSTRAINT "racks_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "racks" ADD CONSTRAINT "racks_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "labs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rack_positions" ADD CONSTRAINT "rack_positions_rack_id_fkey" FOREIGN KEY ("rack_id") REFERENCES "racks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cages" ADD CONSTRAINT "cages_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "labs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cages" ADD CONSTRAINT "cages_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cage_placements" ADD CONSTRAINT "cage_placements_cage_id_fkey" FOREIGN KEY ("cage_id") REFERENCES "cages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cage_placements" ADD CONSTRAINT "cage_placements_rack_position_id_fkey" FOREIGN KEY ("rack_position_id") REFERENCES "rack_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cage_placements" ADD CONSTRAINT "cage_placements_started_by_id_fkey" FOREIGN KEY ("started_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cage_placements" ADD CONSTRAINT "cage_placements_ended_by_id_fkey" FOREIGN KEY ("ended_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cage_placements" ADD CONSTRAINT "cage_placements_changeset_id_fkey" FOREIGN KEY ("changeset_id") REFERENCES "changesets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cage_placements" ADD CONSTRAINT "cage_placements_end_changeset_id_fkey" FOREIGN KEY ("end_changeset_id") REFERENCES "changesets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strains" ADD CONSTRAINT "strains_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "labs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animals" ADD CONSTRAINT "animals_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "labs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animals" ADD CONSTRAINT "animals_strain_id_fkey" FOREIGN KEY ("strain_id") REFERENCES "strains"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animals" ADD CONSTRAINT "animals_dam_id_fkey" FOREIGN KEY ("dam_id") REFERENCES "animals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animals" ADD CONSTRAINT "animals_sire_id_fkey" FOREIGN KEY ("sire_id") REFERENCES "animals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animals" ADD CONSTRAINT "animals_litter_id_fkey" FOREIGN KEY ("litter_id") REFERENCES "litters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animals" ADD CONSTRAINT "animals_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animal_identifiers" ADD CONSTRAINT "animal_identifiers_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animal_identifiers" ADD CONSTRAINT "animal_identifiers_changeset_id_fkey" FOREIGN KEY ("changeset_id") REFERENCES "changesets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animal_cage_placements" ADD CONSTRAINT "animal_cage_placements_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animal_cage_placements" ADD CONSTRAINT "animal_cage_placements_cage_id_fkey" FOREIGN KEY ("cage_id") REFERENCES "cages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animal_cage_placements" ADD CONSTRAINT "animal_cage_placements_started_by_id_fkey" FOREIGN KEY ("started_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animal_cage_placements" ADD CONSTRAINT "animal_cage_placements_ended_by_id_fkey" FOREIGN KEY ("ended_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animal_cage_placements" ADD CONSTRAINT "animal_cage_placements_changeset_id_fkey" FOREIGN KEY ("changeset_id") REFERENCES "changesets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animal_cage_placements" ADD CONSTRAINT "animal_cage_placements_end_changeset_id_fkey" FOREIGN KEY ("end_changeset_id") REFERENCES "changesets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genotypes" ADD CONSTRAINT "genotypes_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "genotypes" ADD CONSTRAINT "genotypes_changeset_id_fkey" FOREIGN KEY ("changeset_id") REFERENCES "changesets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "breeding_pairs" ADD CONSTRAINT "breeding_pairs_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "labs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "breeding_pairs" ADD CONSTRAINT "breeding_pairs_cage_id_fkey" FOREIGN KEY ("cage_id") REFERENCES "cages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "breeding_pairs" ADD CONSTRAINT "breeding_pairs_changeset_id_fkey" FOREIGN KEY ("changeset_id") REFERENCES "changesets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "breeding_pair_members" ADD CONSTRAINT "breeding_pair_members_pair_id_fkey" FOREIGN KEY ("pair_id") REFERENCES "breeding_pairs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "breeding_pair_members" ADD CONSTRAINT "breeding_pair_members_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "litters" ADD CONSTRAINT "litters_pair_id_fkey" FOREIGN KEY ("pair_id") REFERENCES "breeding_pairs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "litters" ADD CONSTRAINT "litters_changeset_id_fkey" FOREIGN KEY ("changeset_id") REFERENCES "changesets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "husbandry_events" ADD CONSTRAINT "husbandry_events_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "labs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "husbandry_events" ADD CONSTRAINT "husbandry_events_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "husbandry_events" ADD CONSTRAINT "husbandry_events_cage_id_fkey" FOREIGN KEY ("cage_id") REFERENCES "cages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "husbandry_events" ADD CONSTRAINT "husbandry_events_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "husbandry_events" ADD CONSTRAINT "husbandry_events_changeset_id_fkey" FOREIGN KEY ("changeset_id") REFERENCES "changesets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "changesets" ADD CONSTRAINT "changesets_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "labs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "changesets" ADD CONSTRAINT "changesets_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "changesets" ADD CONSTRAINT "changesets_reverted_by_changeset_id_fkey" FOREIGN KEY ("reverted_by_changeset_id") REFERENCES "changesets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "labs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_changeset_id_fkey" FOREIGN KEY ("changeset_id") REFERENCES "changesets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_cage_id_fkey" FOREIGN KEY ("cage_id") REFERENCES "cages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
