import { prisma } from "@/lib/db";
import { activeAt } from "@/lib/queries/placement";

/**
 * Read models for the cage and animal screens.
 *
 * These deliberately do their own joins in a fixed number of queries rather
 * than calling the per-entity helpers in a loop: a rack view asks "where is it
 * and who is in it" for a hundred cages at once, and the naive version is a
 * hundred round trips. Current state is still derived from placement history
 * every time — nothing here is cached on a parent row.
 */

export type CageSummary = {
  id: string;
  code: string;
  address: string | null;
  rackCode: string | null;
  roomCode: string | null;
  occupantCount: number;
};

export async function listCages(opts: {
  labId?: string;
  asOf?: Date;
  search?: string;
  limit?: number;
} = {}): Promise<CageSummary[]> {
  const asOf = opts.asOf ?? new Date();

  const cages = await prisma.cage.findMany({
    where: {
      deletedAt: null,
      ...(opts.labId ? { labId: opts.labId } : {}),
      ...(opts.search
        ? { code: { contains: opts.search, mode: "insensitive" as const } }
        : {}),
    },
    orderBy: { code: "asc" },
    take: opts.limit ?? 200,
    select: { id: true, code: true },
  });

  if (cages.length === 0) return [];
  const ids = cages.map((c) => c.id);

  const [placements, counts] = await Promise.all([
    prisma.cagePlacement.findMany({
      where: { cageId: { in: ids }, ...activeAt(asOf) },
      select: {
        cageId: true,
        rackPosition: {
          select: { label: true, rack: { select: { code: true, room: { select: { code: true } } } } },
        },
      },
    }),
    prisma.animalCagePlacement.groupBy({
      by: ["cageId"],
      where: { cageId: { in: ids }, ...activeAt(asOf), animal: { deletedAt: null } },
      _count: { _all: true },
    }),
  ]);

  const byCage = new Map(placements.map((p) => [p.cageId, p.rackPosition]));
  const countByCage = new Map(counts.map((c) => [c.cageId, c._count._all]));

  return cages.map((c) => {
    const pos = byCage.get(c.id);
    return {
      id: c.id,
      code: c.code,
      address: pos?.label ?? null,
      rackCode: pos?.rack.code ?? null,
      roomCode: pos?.rack.room.code ?? null,
      occupantCount: countByCage.get(c.id) ?? 0,
    };
  });
}

/** Everything the cage card needs, at `asOf`. Null when the code is unknown. */
export async function getCageByCode(code: string, asOf: Date = new Date()) {
  const cage = await prisma.cage.findFirst({
    where: { code, deletedAt: null },
    include: { lab: { select: { name: true, slug: true } } },
  });
  if (!cage) return null;

  const [placement, occupants, events] = await Promise.all([
    prisma.cagePlacement.findFirst({
      where: { cageId: cage.id, ...activeAt(asOf) },
      include: {
        rackPosition: {
          include: { rack: { include: { room: true } } },
        },
      },
    }),
    prisma.animalCagePlacement.findMany({
      where: { cageId: cage.id, ...activeAt(asOf), animal: { deletedAt: null } },
      include: {
        animal: {
          include: {
            strain: true,
            identifiers: { where: { retiredAt: null }, orderBy: { isPrimary: "desc" } },
            genotypes: { where: { supersededAt: null }, orderBy: { recordedAt: "desc" } },
          },
        },
      },
      orderBy: { startedAt: "asc" },
    }),
    prisma.husbandryEvent.findMany({
      where: { cageId: cage.id },
      orderBy: { occurredAt: "desc" },
      take: 12,
      include: { recordedBy: { select: { name: true } } },
    }),
  ]);

  return {
    cage,
    position: placement?.rackPosition ?? null,
    address: placement?.rackPosition.label ?? null,
    rack: placement?.rackPosition.rack ?? null,
    room: placement?.rackPosition.rack.room ?? null,
    since: placement?.startedAt ?? null,
    occupants: occupants.map((o) => o.animal),
    events,
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Animal detail: who it is, where it is, and everything that happened to it. */
export async function getAnimal(id: string, asOf: Date = new Date()) {
  // A malformed id is a 404, not a 500: Postgres rejects a non-uuid string at
  // the type level, so it has to be screened before it reaches the query.
  if (!UUID_RE.test(id)) return null;

  const animal = await prisma.animal.findUnique({
    where: { id },
    include: {
      strain: true,
      lab: { select: { name: true } },
      identifiers: { orderBy: [{ retiredAt: "asc" }, { isPrimary: "desc" }] },
      genotypes: { orderBy: { recordedAt: "desc" } },
      litter: true,
    },
  });
  if (!animal) return null;

  const [placements, events, currentPlacement] = await Promise.all([
    prisma.animalCagePlacement.findMany({
      where: { animalId: id },
      include: { cage: { select: { id: true, code: true } } },
      orderBy: { startedAt: "desc" },
    }),
    prisma.husbandryEvent.findMany({
      where: { animalId: id },
      orderBy: { occurredAt: "desc" },
      take: 25,
      include: { recordedBy: { select: { name: true } } },
    }),
    prisma.animalCagePlacement.findFirst({
      where: { animalId: id, ...activeAt(asOf) },
      include: { cage: { select: { id: true, code: true } } },
    }),
  ]);

  let address: string | null = null;
  if (currentPlacement) {
    const cagePos = await prisma.cagePlacement.findFirst({
      where: { cageId: currentPlacement.cageId, ...activeAt(asOf) },
      select: { rackPosition: { select: { label: true } } },
    });
    address = cagePos?.rackPosition.label ?? null;
  }

  // Death is an event, not a column — status is derived like everything else.
  const terminal = events.find(
    (e) => e.type === "DEATH" || e.type === "EUTHANASIA" || e.type === "TRANSFER_OUT",
  );

  return {
    animal,
    currentCage: currentPlacement?.cage ?? null,
    address,
    placements,
    events,
    status: animal.deletedAt ? "DELETED" : terminal ? terminal.type : "ALIVE",
    terminalEvent: terminal ?? null,
  };
}

export type SearchHit =
  | { kind: "cage"; code: string; label: string; detail: string }
  | { kind: "animal"; id: string; label: string; detail: string };

/**
 * One box that accepts whatever is written on the rack: a cage code, a rack
 * address, or an ear-tag number. Ear tags are matched through AnimalIdentifier
 * rather than any column on Animal, because the same number is reused across
 * labs and over time.
 */
export async function searchColony(q: string, limit = 20): Promise<SearchHit[]> {
  const query = q.trim();
  if (query.length < 1) return [];

  const [cages, positions, identifiers] = await Promise.all([
    prisma.cage.findMany({
      where: { deletedAt: null, code: { contains: query, mode: "insensitive" } },
      take: limit,
      select: { code: true },
    }),
    prisma.rackPosition.findMany({
      where: { label: { contains: query, mode: "insensitive" } },
      take: limit,
      select: {
        label: true,
        placements: {
          where: { endedAt: null },
          select: { cage: { select: { code: true } } },
          take: 1,
        },
      },
    }),
    prisma.animalIdentifier.findMany({
      where: { value: { contains: query, mode: "insensitive" }, retiredAt: null },
      take: limit,
      include: { animal: { select: { id: true, sex: true, deletedAt: true } } },
    }),
  ]);

  const hits: SearchHit[] = [];

  for (const c of cages) {
    hits.push({ kind: "cage", code: c.code, label: c.code, detail: "Cage" });
  }
  for (const p of positions) {
    const occupant = p.placements[0]?.cage.code;
    if (occupant) {
      hits.push({ kind: "cage", code: occupant, label: occupant, detail: `Slot ${p.label}` });
    }
  }
  for (const i of identifiers) {
    if (i.animal.deletedAt) continue;
    hits.push({
      kind: "animal",
      id: i.animal.id,
      label: i.value,
      detail: `${i.scheme.replace(/_/g, " ").toLowerCase()} · ${i.animal.sex.toLowerCase()}`,
    });
  }

  // A cage matched by both its code and its slot should appear once.
  const seen = new Set<string>();
  return hits
    .filter((h) => {
      const key = h.kind === "cage" ? `c:${h.code}` : `a:${h.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

/** Headline numbers for the home screen. */
export async function colonySummary(asOf: Date = new Date()) {
  const [animals, cages, pendingGenotypes, recentLitters] = await Promise.all([
    prisma.animalCagePlacement.count({
      where: { ...activeAt(asOf), animal: { deletedAt: null } },
    }),
    prisma.cage.count({ where: { deletedAt: null } }),
    prisma.genotype.count({ where: { result: "PENDING", supersededAt: null } }),
    prisma.litter.count({ where: { weanedAt: null } }),
  ]);
  return { animals, cages, pendingGenotypes, littersInFlight: recentLitters };
}
