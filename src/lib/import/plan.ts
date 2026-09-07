import { createHash } from "node:crypto";

import { prisma } from "@/lib/db";
import type { ImportRowStatus } from "@/generated/prisma/client";
import type { Mapping } from "@/lib/import/mapping";
import type { Sheet } from "@/lib/import/parse";
import {
  blank,
  parseCageCode,
  parseDate,
  parseIdentifier,
  parseSex,
  sniffGenotype,
  type DateOrder,
  type Issue,
} from "@/lib/import/normalize";

/**
 * The dry run.
 *
 * Nothing here writes. It produces, for every row, exactly what would happen
 * and why — so a person can look at the diff before committing rather than
 * after. An importer that writes first and reports second is one nobody trusts
 * enough to use on real data.
 */

export type PlannedRow = {
  rowNumber: number;
  status: ImportRowStatus;
  raw: Record<string, string>;
  issues: Issue[];
  normalized: {
    namespace: string;
    tag: string | null;
    sex: string | null;
    birthDate: Date | null;
    birthDatePrecision: string | null;
    cageCode: string | null;
    strain: string | null;
    genotype: string | null;
    notes: string | null;
  } | null;
  /** Set when this row matches an animal that already exists. */
  existingAnimalId?: string;
};

export type ImportPlan = {
  contentHash: string;
  rows: PlannedRow[];
  counts: Record<ImportRowStatus, number>;
  /** Cage codes referenced by the sheet that do not exist yet. */
  newCageCodes: string[];
  /** A previous committed batch with identical content, if any. */
  duplicateOfBatchId?: string;
};

export function hashContent(data: Buffer | Uint8Array): string {
  return createHash("sha256").update(Buffer.from(data)).digest("hex");
}

const emptyCounts = (): Record<ImportRowStatus, number> => ({
  CREATED: 0,
  UPDATED: 0,
  SKIPPED_DUPLICATE: 0,
  SKIPPED_BLANK: 0,
  FLAGGED: 0,
  ERROR: 0,
});

export async function planImport(opts: {
  sheet: Sheet;
  mapping: Mapping;
  labId: string;
  namespace: string;
  contentHash: string;
  dateOrder?: DateOrder;
}): Promise<ImportPlan> {
  const { sheet, mapping, labId, namespace, contentHash, dateOrder } = opts;

  // Re-uploading the same file is a no-op, checked on the bytes before any row
  // is interpreted. This is the cheap half of idempotency; the per-identifier
  // check below is the half that survives someone re-exporting the same data.
  const priorBatch = await prisma.importBatch.findFirst({
    where: { labId, contentHash, status: "COMMITTED" },
    select: { id: true },
  });

  const cell = (row: Record<string, string>, field: keyof Mapping): string => {
    const header = mapping[field];
    return header ? (row[header] ?? "") : "";
  };

  // Everything the sheet references, resolved in two queries rather than per row.
  const tags = new Set<string>();
  const cageCodes = new Set<string>();
  for (const row of sheet.rows) {
    const tag = parseIdentifier(cell(row, "tag")).value;
    if (tag) tags.add(tag);
    const cage = parseCageCode(cell(row, "cageCode")).value;
    if (cage) cageCodes.add(cage);
  }

  const [existingIdentifiers, existingCages] = await Promise.all([
    prisma.animalIdentifier.findMany({
      where: { namespace, value: { in: [...tags] }, retiredAt: null },
      select: { value: true, animalId: true },
    }),
    prisma.cage.findMany({
      where: { labId, code: { in: [...cageCodes] }, deletedAt: null },
      select: { code: true },
    }),
  ]);

  const animalByTag = new Map(existingIdentifiers.map((i) => [i.value, i.animalId]));
  const knownCages = new Set(existingCages.map((c) => c.code));

  const seenInFile = new Map<string, number>();
  const rows: PlannedRow[] = [];
  const counts = emptyCounts();

  for (let i = 0; i < sheet.rows.length; i++) {
    const raw = sheet.rows[i];
    const rowNumber = sheet.rowNumbers[i];
    const issues: Issue[] = [];

    // A row with nothing in any mapped column is padding, not a failure.
    const allBlank = Object.values(mapping).every((h) => !h || blank(raw[h]));
    if (allBlank) {
      rows.push({ rowNumber, status: "SKIPPED_BLANK", raw, issues, normalized: null });
      counts.SKIPPED_BLANK++;
      continue;
    }

    const tagField = parseIdentifier(cell(raw, "tag"), "tag");
    issues.push(...tagField.issues);

    const sexField = parseSex(cell(raw, "sex"));
    issues.push(...sexField.issues);

    const dobField = parseDate(cell(raw, "birthDate"), {
      field: "birthDate",
      order: dateOrder,
    });
    issues.push(...dobField.issues);

    const cageField = parseCageCode(cell(raw, "cageCode"));
    issues.push(...cageField.issues);

    const strain = cell(raw, "strain").trim() || null;
    const notes = cell(raw, "notes").trim() || null;

    let genotype = cell(raw, "genotype").trim() || null;
    if (!genotype && notes) {
      const sniffed = sniffGenotype(notes);
      if (sniffed) {
        genotype = sniffed.result;
        issues.push({
          level: "warning",
          field: "genotype",
          raw: sniffed.matched,
          message: `Genotype read out of the notes column ("${sniffed.matched}"). Confirm before committing.`,
        });
      }
    }

    if (dobField.value?.date && dobField.value.date.getTime() > Date.now()) {
      issues.push({
        level: "error",
        field: "birthDate",
        message: "Date of birth is in the future.",
      });
    }

    if (cageField.value && !knownCages.has(cageField.value)) {
      issues.push({
        level: "info",
        field: "cageCode",
        raw: cageField.value,
        message: `Cage ${cageField.value} does not exist yet and will be created.`,
      });
    }

    const hasError = issues.some((x) => x.level === "error");
    const tag = tagField.value;

    // The same tag twice in one file is a mistake in the file, and importing
    // both would create two animals that are really one.
    if (tag && seenInFile.has(tag)) {
      issues.push({
        level: "error",
        field: "tag",
        raw: tag,
        message: `Tag ${tag} also appears on row ${seenInFile.get(tag)} of this file.`,
      });
      rows.push({ rowNumber, status: "ERROR", raw, issues, normalized: null });
      counts.ERROR++;
      continue;
    }
    if (tag) seenInFile.set(tag, rowNumber);

    if (hasError || !tag) {
      rows.push({ rowNumber, status: "ERROR", raw, issues, normalized: null });
      counts.ERROR++;
      continue;
    }

    const normalized = {
      namespace,
      tag,
      sex: sexField.value,
      birthDate: dobField.value?.date ?? null,
      birthDatePrecision: dobField.value?.precision ?? null,
      cageCode: cageField.value,
      strain,
      genotype,
      notes,
    };

    const existingAnimalId = animalByTag.get(tag);
    const status: ImportRowStatus = existingAnimalId
      ? "UPDATED"
      : issues.some((x) => x.level === "warning")
        ? "FLAGGED"
        : "CREATED";

    if (existingAnimalId) {
      issues.push({
        level: "warning",
        field: "tag",
        raw: tag,
        message: `An animal with tag ${tag} already exists — it will be updated, not duplicated.`,
      });
    }

    rows.push({ rowNumber, status, raw, issues, normalized, existingAnimalId });
    counts[status]++;
  }

  // Only cages belonging to rows that will actually be written. Deriving this
  // from the whole sheet would create a cage for a row that was rejected,
  // leaving an empty cage nobody asked for.
  const cagesToCreate = [
    ...new Set(
      rows
        .filter((r) => r.normalized && r.status !== "ERROR" && r.status !== "SKIPPED_BLANK")
        .map((r) => r.normalized!.cageCode)
        .filter((c): c is string => !!c && !knownCages.has(c)),
    ),
  ];

  return {
    contentHash,
    rows,
    counts,
    newCageCodes: cagesToCreate,
    duplicateOfBatchId: priorBatch?.id,
  };
}
