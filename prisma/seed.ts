/**
 * Seeds a realistic colony: a few hundred animals across four racks, with
 * placement history deep enough that "who was in B-04-12 on June 3rd" returns
 * something different from "who is in it now".
 *
 * Deterministic by design — a fixed PRNG seed means the demo, the screenshots
 * and the tests all describe the same colony. Re-running produces byte-identical
 * data rather than a new random one.
 *
 * Run with: npm run db:seed
 */
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

import { PrismaClient } from "../src/generated/prisma/client";
import type {
  GenotypeResult,
  HusbandryEventType,
  IdentifierScheme,
  PlacementReason,
  Sex,
} from "../src/generated/prisma/client";

// --- deterministic randomness ---------------------------------------------

/** mulberry32 — small, fast, and reproducible across machines. */
function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(20260905);

const int = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)];
const chance = (p: number) => rng() < p;

/** Deterministic UUIDs, so ids are stable between runs too. */
function uuid(): string {
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 32; i++) {
    if (i === 12) out += "4";
    else if (i === 16) out += hex[(int(0, 15) & 0x3) | 0x8];
    else out += hex[int(0, 15)];
  }
  return [
    out.slice(0, 8),
    out.slice(8, 12),
    out.slice(12, 16),
    out.slice(16, 20),
    out.slice(20),
  ].join("-");
}

// --- time helpers ----------------------------------------------------------

const NOW = new Date("2026-09-05T17:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY);
const addDays = (t: Date, d: number) => new Date(t.getTime() + d * DAY);

/**
 * Record time = event time plus a lag. Most entries are same-day, but a real
 * vivarium has entries typed in days later, and the schema has to carry that
 * rather than pretend recorded_at is occurred_at.
 */
function recordedFor(occurredAt: Date): Date {
  if (chance(0.75)) return new Date(occurredAt.getTime() + int(5, 240) * 60 * 1000);
  if (chance(0.8)) return addDays(occurredAt, int(1, 3));
  return addDays(occurredAt, int(7, 24)); // noticed weeks later
}

// --- reference data --------------------------------------------------------

const STRAINS = [
  { name: "C57BL/6J", common: "B6", jax: "000664", background: "C57BL/6J" },
  { name: "B6.Cg-Tg(Camk2a-cre)T29-1Stl/J", common: "Camk2a-Cre", jax: "005359", background: "C57BL/6J" },
  { name: "B6.Cg-Gt(ROSA)26Sor^tm9(CAG-tdTomato)Hze/J", common: "Ai9", jax: "007909", background: "C57BL/6J" },
  { name: "B6.129S6-Chat^tm2(cre)Lowl/J", common: "ChAT-Cre", jax: "006410", background: "C57BL/6J" },
  { name: "NOD.Cg-Prkdc^scid Il2rg^tm1Wjl/SzJ", common: "NSG", jax: "005557", background: "NOD" },
] as const;

const LOCI = ["Camk2a-Cre", "Ai9", "ChAT-Cre", "Prkdc"] as const;

const CAGE_TYPES = ["Optimice IVC", "Tecniplast GM500", "Allentown NexGen"] as const;

const HEALTH_NOTES = [
  "Coat condition normal, active.",
  "Slight barbering observed on cagemate.",
  "Nesting material adequate.",
  "Mild dermatitis on dorsal surface — monitoring.",
  "Body condition score 3/5.",
  "Malocclusion checked, teeth trimmed.",
] as const;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  if (/neon\.tech|amazonaws|supabase/.test(connectionString) && !process.env.SEED_ALLOW_REMOTE) {
    throw new Error(
      "DATABASE_URL looks like a hosted database. The seed truncates every table.\n" +
        "Set SEED_ALLOW_REMOTE=1 if that is genuinely what you want.",
    );
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  // Refuse to overwrite a colony that already exists.
  //
  // The seed truncates every table, which is right for bootstrapping an empty
  // database and catastrophic for one in use. Exiting successfully rather than
  // failing means this can sit in a deploy pipeline as a one-time bootstrap
  // without turning every subsequent deploy into a data loss event.
  const existingLabs = await prisma.lab.count();
  if (existingLabs > 0 && !process.env.SEED_FORCE) {
    console.log(
      `Database already contains ${existingLabs} lab(s) — leaving it alone.\n` +
        "Set SEED_FORCE=1 to wipe and reseed anyway.",
    );
    await prisma.$disconnect();
    return;
  }

  console.log("Clearing existing data…");
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length) {
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }

  // --- people ------------------------------------------------------------
  const labId = uuid();
  const otherLabId = uuid();

  await prisma.lab.createMany({
    data: [
      { id: labId, slug: "kaplan", name: "Kaplan Lab", piName: "Dr. Miriam Kaplan" },
      { id: otherLabId, slug: "okonkwo", name: "Okonkwo Lab", piName: "Dr. Ada Okonkwo" },
    ],
  });

  const people = [
    { id: uuid(), name: "Miriam Kaplan", email: "mkaplan@example.edu", role: "PI" as const },
    { id: uuid(), name: "Dev Raghunathan", email: "draghunathan@example.edu", role: "LAB_MANAGER" as const },
    { id: uuid(), name: "Sofia Marchetti", email: "smarchetti@example.edu", role: "TECHNICIAN" as const },
    { id: uuid(), name: "Jonah Weiss", email: "jweiss@example.edu", role: "UNDERGRAD" as const },
    { id: uuid(), name: "Priya Anand DVM", email: "panand@example.edu", role: "VETERINARIAN" as const },
    { id: uuid(), name: "Ada Okonkwo", email: "aokonkwo@example.edu", role: "PI" as const },
  ];

  await prisma.user.createMany({
    data: people.map((p) => ({ id: p.id, name: p.name, email: p.email })),
  });

  await prisma.membership.createMany({
    data: people.map((p, i) => ({
      id: uuid(),
      userId: p.id,
      // Last person belongs to the other lab — proves roles are scoped, and
      // gives the authorization work something real to exclude.
      labId: i === people.length - 1 ? otherLabId : labId,
      role: p.role,
    })),
  });

  const staff = people.slice(0, 5).map((p) => p.id);
  const manager = people[1].id;
  const tech = people[2].id;
  const vet = people[4].id;

  // The vet covers for the lab manager over a conference week.
  await prisma.coverageAssignment.create({
    data: {
      id: uuid(),
      labId,
      ownerUserId: manager,
      coveringUserId: vet,
      scope: "LAB",
      startsAt: daysAgo(4),
      endsAt: addDays(NOW, 3),
      reason: "SfN travel",
    },
  });

  // --- facility ----------------------------------------------------------
  console.log("Building rooms, racks and slots…");

  const rooms = [
    { id: uuid(), code: "VIV-A", name: "Vivarium A", building: "Bio Sciences" },
    { id: uuid(), code: "VIV-B", name: "Vivarium B (quarantine)", building: "Bio Sciences" },
  ];
  await prisma.room.createMany({ data: rooms });

  const rackSpecs = [
    { code: "A", roomId: rooms[0].id, rows: 6, cols: 10 },
    { code: "B", roomId: rooms[0].id, rows: 6, cols: 10 },
    { code: "C", roomId: rooms[0].id, rows: 6, cols: 10 },
    { code: "Q1", roomId: rooms[1].id, rows: 4, cols: 6 },
  ];

  const racks = rackSpecs.map((r) => ({
    id: uuid(),
    roomId: r.roomId,
    labId,
    code: r.code,
    label: `Rack ${r.code}`,
    rowCount: r.rows,
    colCount: r.cols,
    sides: ["A", "B"],
  }));
  await prisma.rack.createMany({ data: racks });

  type Slot = { id: string; label: string };
  const slots: Slot[] = [];
  const slotRows = racks.flatMap((rack, i) => {
    const spec = rackSpecs[i];
    const out = [];
    for (const side of ["A", "B"]) {
      for (let row = 1; row <= spec.rows; row++) {
        for (let col = 1; col <= spec.cols; col++) {
          const id = uuid();
          const label = `${rack.code}${side}-${String(row).padStart(2, "0")}-${String(col).padStart(2, "0")}`;
          slots.push({ id, label });
          out.push({ id, rackId: rack.id, side, row, col, label });
        }
      }
    }
    return out;
  });
  await prisma.rackPosition.createMany({ data: slotRows });
  console.log(`  ${slotRows.length} rack slots`);

  // --- strains -----------------------------------------------------------
  const strains = STRAINS.map((s) => ({
    id: uuid(),
    labId,
    name: s.name,
    commonName: s.common,
    background: s.background,
    jaxStockNumber: s.jax,
  }));
  await prisma.strain.createMany({ data: strains });

  // --- changesets --------------------------------------------------------
  // The seed writes through changesets like any other actor would, so the
  // audit trail is populated rather than showing a mysterious gap at t=0.
  const seedChangesetId = uuid();
  const moveChangesetId = uuid();
  await prisma.changeset.createMany({
    data: [
      {
        id: seedChangesetId,
        labId,
        actorId: manager,
        kind: "SEED",
        summary: "Initial colony import from spreadsheet",
        createdAt: daysAgo(420),
      },
      {
        id: moveChangesetId,
        labId,
        actorId: tech,
        kind: "SEED",
        summary: "Routine cage changes and moves",
        createdAt: daysAgo(60),
      },
    ],
  });

  // --- cages and their placement history ---------------------------------
  console.log("Creating cages and placement history…");

  const CAGE_COUNT = 128;
  const shuffledSlots = [...slots].sort(() => rng() - 0.5);

  const cages: { id: string; code: string; startedAt: Date }[] = [];
  const cageRows = [];
  const cagePlacementRows = [];

  for (let i = 0; i < CAGE_COUNT; i++) {
    const id = uuid();
    const code = `CG-${String(1000 + i)}`;
    const placedAt = daysAgo(int(60, 400));
    cages.push({ id, code, startedAt: placedAt });
    cageRows.push({
      id,
      labId,
      code,
      cageType: pick(CAGE_TYPES),
      status: "ACTIVE" as const,
    });

    const firstSlot = shuffledSlots[i];

    // A fifth of cages have been moved at least once, so cage placement
    // history is not trivially one row per cage.
    if (chance(0.2)) {
      const movedAt = addDays(placedAt, int(20, 120));
      if (movedAt < NOW) {
        const secondSlot = shuffledSlots[CAGE_COUNT + i];
        cagePlacementRows.push({
          id: uuid(),
          cageId: id,
          rackPositionId: firstSlot.id,
          startedAt: placedAt,
          endedAt: movedAt,
          recordedAt: recordedFor(placedAt),
          endRecordedAt: recordedFor(movedAt),
          startedById: manager,
          endedById: tech,
          reason: "Rack reorganization",
          changesetId: seedChangesetId,
          endChangesetId: moveChangesetId,
        });
        cagePlacementRows.push({
          id: uuid(),
          cageId: id,
          rackPositionId: secondSlot.id,
          startedAt: movedAt,
          recordedAt: recordedFor(movedAt),
          startedById: tech,
          reason: "Rack reorganization",
          changesetId: moveChangesetId,
        });
        continue;
      }
    }

    cagePlacementRows.push({
      id: uuid(),
      cageId: id,
      rackPositionId: firstSlot.id,
      startedAt: placedAt,
      recordedAt: recordedFor(placedAt),
      startedById: manager,
      reason: "Initial placement",
      changesetId: seedChangesetId,
    });
  }

  await prisma.cage.createMany({ data: cageRows });
  await prisma.cagePlacement.createMany({ data: cagePlacementRows });
  console.log(`  ${cageRows.length} cages, ${cagePlacementRows.length} cage placements`);

  // --- animals -----------------------------------------------------------
  console.log("Creating animals, identifiers, genotypes…");

  const animalRows = [];
  const identifierRows = [];
  const genotypeRows = [];
  const animalPlacementRows = [];
  const eventRows = [];

  let tagCounter = 1;
  const animals: {
    id: string;
    cageId: string;
    sex: Sex;
    bornAt: Date;
    placedAt: Date;
  }[] = [];

  // Most cages hold a small same-sex group; a handful are single-housed.
  for (const cage of cages) {
    const groupSize = chance(0.1) ? 1 : int(2, 5);
    const cageSex: Sex = chance(0.5) ? "MALE" : "FEMALE";
    const strain = pick(strains);

    for (let n = 0; n < groupSize; n++) {
      const id = uuid();
      const bornAt = addDays(cage.startedAt, -int(21, 120));
      const movedIn = cage.startedAt;

      animals.push({ id, cageId: cage.id, sex: cageSex, bornAt, placedAt: movedIn });

      animalRows.push({
        id,
        labId,
        species: "Mus musculus",
        sex: cageSex,
        strainId: strain.id,
        birthDate: bornAt,
        birthDatePrecision: chance(0.85) ? ("DAY" as const) : ("MONTH" as const),
        source: chance(0.7) ? ("BORN_IN_HOUSE" as const) : ("VENDOR" as const),
        acquiredAt: movedIn,
      });

      identifierRows.push({
        id: uuid(),
        animalId: id,
        namespace: "kaplan",
        scheme: "EAR_TAG" as IdentifierScheme,
        value: String(2000 + tagCounter++),
        isPrimary: true,
        assignedAt: addDays(bornAt, 21),
        recordedAt: recordedFor(addDays(bornAt, 21)),
        changesetId: seedChangesetId,
      });

      // A minority also carry the number from the old spreadsheet — the same
      // animal under two schemes, which is exactly why identifiers are a table.
      if (chance(0.25)) {
        identifierRows.push({
          id: uuid(),
          animalId: id,
          namespace: "legacy-sheet",
          scheme: "LEGACY_SPREADSHEET" as IdentifierScheme,
          value: `M${int(100, 999)}-${int(1, 9)}`,
          isPrimary: false,
          assignedAt: addDays(bornAt, 21),
          recordedAt: recordedFor(addDays(bornAt, 21)),
          changesetId: seedChangesetId,
        });
      }

      // Genotypes: mostly resolved, some still pending weeks later.
      if (strain.commonName !== "B6") {
        const assayedAt = chance(0.85) ? addDays(bornAt, int(21, 40)) : null;
        const pending = assayedAt === null || chance(0.15);
        genotypeRows.push({
          id: uuid(),
          animalId: id,
          locus: pick(LOCI),
          expected: pick(["HET", "WT", "UNKNOWN"] as const) as GenotypeResult,
          result: (pending ? "PENDING" : pick(["WT", "HET", "HOM"] as const)) as GenotypeResult,
          assayedAt,
          recordedAt: assayedAt ? recordedFor(addDays(assayedAt, int(3, 14))) : NOW,
          confirmed: !pending,
          confirmedAt: pending ? null : addDays(assayedAt!, int(3, 14)),
          source: "Transnetyx",
          changesetId: seedChangesetId,
        });
      }

      animalPlacementRows.push({
        id: uuid(),
        animalId: id,
        cageId: cage.id,
        startedAt: movedIn,
        recordedAt: recordedFor(movedIn),
        startedById: manager,
        reason: "INITIAL" as PlacementReason,
        changesetId: seedChangesetId,
      });
    }
  }

  await prisma.animal.createMany({ data: animalRows });
  await prisma.animalIdentifier.createMany({ data: identifierRows });
  await prisma.genotype.createMany({ data: genotypeRows });
  await prisma.animalCagePlacement.createMany({ data: animalPlacementRows });
  console.log(`  ${animalRows.length} animals, ${identifierRows.length} identifiers`);

  // --- husbandry events --------------------------------------------------
  console.log("Logging husbandry events…");

  for (const cage of cages) {
    // Cage changes roughly every two weeks going back a few months.
    let t = daysAgo(int(2, 14));
    while (t > daysAgo(150)) {
      const occurredAt = t;
      eventRows.push({
        id: uuid(),
        labId,
        type: "CAGE_CHANGE" as HusbandryEventType,
        cageId: cage.id,
        occurredAt,
        recordedAt: recordedFor(occurredAt),
        recordedById: pick(staff),
        payload: {},
        changesetId: moveChangesetId,
      });
      t = addDays(t, -int(10, 18));
    }
  }

  for (const animal of animals) {
    if (chance(0.55)) {
      const occurredAt = daysAgo(int(1, 90));
      eventRows.push({
        id: uuid(),
        labId,
        type: "WEIGHT" as HusbandryEventType,
        animalId: animal.id,
        occurredAt,
        recordedAt: recordedFor(occurredAt),
        recordedById: pick(staff),
        payload: { grams: Number((18 + rng() * 14).toFixed(1)) },
      });
    }
    if (chance(0.3)) {
      const occurredAt = daysAgo(int(1, 60));
      eventRows.push({
        id: uuid(),
        labId,
        type: "HEALTH_CHECK" as HusbandryEventType,
        animalId: animal.id,
        occurredAt,
        recordedAt: recordedFor(occurredAt),
        recordedById: chance(0.3) ? vet : pick(staff),
        notes: pick(HEALTH_NOTES),
        payload: { bodyConditionScore: int(2, 4) },
      });
    }
  }

  await prisma.husbandryEvent.createMany({ data: eventRows });
  console.log(`  ${eventRows.length} husbandry events`);

  // --- breeding, with litters still in flight ----------------------------
  console.log("Setting up breeding pairs and litters…");

  const females = animals.filter((a) => a.sex === "FEMALE");
  const males = animals.filter((a) => a.sex === "MALE");

  const pairRows = [];
  const memberRows = [];
  const litterRows = [];
  const litterEventRows = [];

  const PAIR_COUNT = 14;
  for (let i = 0; i < PAIR_COUNT; i++) {
    const dam = females[i * 3 % females.length];
    const sire = males[i * 5 % males.length];
    if (!dam || !sire) continue;

    const pairId = uuid();
    const setUpAt = daysAgo(int(40, 180));

    pairRows.push({
      id: pairId,
      labId,
      name: `BP-${String(i + 1).padStart(2, "0")}`,
      cageId: dam.cageId,
      setUpAt,
      recordedAt: recordedFor(setUpAt),
      status: "ACTIVE" as const,
      changesetId: seedChangesetId,
    });

    memberRows.push(
      { id: uuid(), pairId, animalId: dam.id, role: "DAM" as const, joinedAt: setUpAt },
      { id: uuid(), pairId, animalId: sire.id, role: "SIRE" as const, joinedAt: setUpAt },
    );

    // One or two litters per pair; the most recent may be pre-wean, which is
    // what "in flight" means — pups exist but are not yet individual records.
    const litterCount = int(1, 2);
    for (let l = 0; l < litterCount; l++) {
      const bornAt = addDays(setUpAt, 21 + l * 35 + int(0, 6));
      if (bornAt > NOW) continue;

      const ageDays = (NOW.getTime() - bornAt.getTime()) / DAY;
      const weaned = ageDays > 21;
      const born = int(4, 9);

      litterRows.push({
        id: uuid(),
        pairId,
        bornAt,
        recordedAt: recordedFor(bornAt),
        weanedAt: weaned ? addDays(bornAt, 21) : null,
        pupCountAtBirth: born,
        // Deliberately allowed to differ from the birth count: loss and culling
        // are real, and the later number must not overwrite the earlier one.
        pupCountAtWean: weaned ? Math.max(0, born - int(0, 2)) : null,
        changesetId: seedChangesetId,
      });

      litterEventRows.push({
        id: uuid(),
        labId,
        type: "LITTER_BORN" as HusbandryEventType,
        cageId: dam.cageId,
        occurredAt: bornAt,
        recordedAt: recordedFor(bornAt),
        recordedById: pick(staff),
        payload: { pupCount: born },
        changesetId: seedChangesetId,
      });
    }
  }

  await prisma.breedingPair.createMany({ data: pairRows });
  await prisma.breedingPairMember.createMany({ data: memberRows });
  await prisma.litter.createMany({ data: litterRows });
  await prisma.husbandryEvent.createMany({ data: litterEventRows });
  console.log(`  ${pairRows.length} breeding pairs, ${litterRows.length} litters`);

  // --- deaths ------------------------------------------------------------
  // A handful of animals have died. They keep their placement history and are
  // never hard-deleted; the death is an event with its own occurred/recorded
  // split, and the placement is closed at the moment of death.
  const deceased = animals.filter(() => chance(0.04));
  for (const animal of deceased) {
    // Death has to fall inside the animal's residency. The interval CHECK
    // constraint caught this when the first draft picked a date independently
    // of when the animal arrived, producing animals that died before they
    // were placed.
    const residentDays = Math.floor((NOW.getTime() - animal.placedAt.getTime()) / DAY);
    if (residentDays < 3) continue;
    const occurredAt = addDays(animal.placedAt, int(1, residentDays - 1));
    await prisma.husbandryEvent.create({
      data: {
        id: uuid(),
        labId,
        type: chance(0.5) ? "DEATH" : "EUTHANASIA",
        animalId: animal.id,
        occurredAt,
        recordedAt: recordedFor(occurredAt),
        recordedById: chance(0.4) ? vet : pick(staff),
        notes: chance(0.5) ? "Found deceased during morning check." : "Endpoint reached per protocol.",
        payload: {},
        changesetId: moveChangesetId,
      },
    });
    await prisma.animalCagePlacement.updateMany({
      where: { animalId: animal.id, endedAt: null },
      data: { endedAt: occurredAt, endedById: vet, endRecordedAt: recordedFor(occurredAt) },
    });
  }
  console.log(`  ${deceased.length} deaths recorded`);

  const liveCount = await prisma.animalCagePlacement.count({
    where: { endedAt: null },
  });

  console.log(
    `\nDone. ${animalRows.length} animals total, ${liveCount} currently placed, ` +
      `across ${cageRows.length} cages and ${slotRows.length} rack slots.`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
