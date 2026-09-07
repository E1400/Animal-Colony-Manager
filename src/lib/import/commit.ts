import { prisma } from "@/lib/db";
import type { GenotypeResult, Sex } from "@/generated/prisma/client";
import type { ImportPlan } from "@/lib/import/plan";
import type { Mapping } from "@/lib/import/mapping";

/**
 * Applies a dry run.
 *
 * Everything lands in one transaction under one changeset, so an import is a
 * single entry in the activity log and a single thing to undo. A half-applied
 * import is the worst possible outcome: nobody can tell which half.
 *
 * Rows that errored in the plan are recorded and skipped rather than blocking
 * the rest. Refusing an entire 400-row sheet because two rows have a bad date
 * is how people give up and go back to the spreadsheet.
 */
export async function commitImport(opts: {
  plan: ImportPlan;
  labId: string;
  actorId: string;
  filename: string;
  sourceFormat: string;
  mapping: Mapping;
}) {
  const { plan, labId, actorId, filename, sourceFormat, mapping } = opts;

  if (plan.duplicateOfBatchId) {
    throw new Error(
      "This exact file has already been imported. Re-uploading it would change nothing.",
    );
  }

  return prisma.$transaction(
    async (tx) => {
      const changeset = await tx.changeset.create({
        data: {
          labId,
          actorId,
          kind: "IMPORT",
          summary: `Imported ${filename}`,
          reason: `${plan.counts.CREATED + plan.counts.FLAGGED} new, ${plan.counts.UPDATED} updated, ${plan.counts.ERROR} rejected`,
        },
        select: { id: true },
      });

      const batch = await tx.importBatch.create({
        data: {
          labId,
          uploadedById: actorId,
          changesetId: changeset.id,
          filename,
          contentHash: plan.contentHash,
          sourceFormat,
          status: "COMMITTED",
          mapping: mapping as object,
          rowCount: plan.rows.length,
          createdCount: plan.counts.CREATED + plan.counts.FLAGGED,
          updatedCount: plan.counts.UPDATED,
          skippedCount: plan.counts.SKIPPED_BLANK + plan.counts.SKIPPED_DUPLICATE,
          errorCount: plan.counts.ERROR,
          finishedAt: new Date(),
        },
        select: { id: true },
      });

      // Cages referenced by the sheet, created once up front.
      const cageIdByCode = new Map<string, string>();
      for (const code of plan.newCageCodes) {
        const cage = await tx.cage.create({
          data: { labId, code, notes: `Created by import of ${filename}` },
          select: { id: true, code: true },
        });
        cageIdByCode.set(cage.code, cage.id);
      }
      const referenced = [
        ...new Set(
          plan.rows
            .map((r) => r.normalized?.cageCode)
            .filter((c): c is string => !!c && !cageIdByCode.has(c)),
        ),
      ];
      if (referenced.length) {
        const found = await tx.cage.findMany({
          where: { labId, code: { in: referenced }, deletedAt: null },
          select: { id: true, code: true },
        });
        for (const c of found) cageIdByCode.set(c.code, c.id);
      }

      const now = new Date();

      for (const row of plan.rows) {
        if (!row.normalized || row.status === "ERROR" || row.status === "SKIPPED_BLANK") {
          await tx.importRow.create({
            data: {
              batchId: batch.id,
              rowNumber: row.rowNumber,
              status: row.status,
              raw: row.raw,
              messages: row.issues as object,
            },
          });
          continue;
        }

        const n = row.normalized;
        let animalId = row.existingAnimalId;

        if (animalId) {
          // Update only fields the sheet actually carried. A blank cell means
          // "not stated here", not "erase what we know".
          await tx.animal.update({
            where: { id: animalId },
            data: {
              ...(n.sex ? { sex: n.sex as Sex } : {}),
              ...(n.birthDate
                ? {
                    birthDate: n.birthDate,
                    birthDatePrecision: n.birthDatePrecision as never,
                  }
                : {}),
              ...(n.notes ? { notes: n.notes } : {}),
            },
          });
        } else {
          const created = await tx.animal.create({
            data: {
              labId,
              sex: (n.sex ?? "UNKNOWN") as Sex,
              birthDate: n.birthDate,
              ...(n.birthDatePrecision
                ? { birthDatePrecision: n.birthDatePrecision as never }
                : {}),
              source: "UNKNOWN",
              notes: n.notes,
            },
            select: { id: true },
          });
          animalId = created.id;

          await tx.animalIdentifier.create({
            data: {
              animalId,
              namespace: n.namespace,
              scheme: "EAR_TAG",
              value: n.tag!,
              isPrimary: true,
              assignedAt: n.birthDate ?? now,
              changesetId: changeset.id,
            },
          });
        }

        if (n.cageCode) {
          const cageId = cageIdByCode.get(n.cageCode);
          if (cageId) {
            const open = await tx.animalCagePlacement.findFirst({
              where: { animalId, endedAt: null },
              select: { id: true, cageId: true },
            });
            if (!open) {
              await tx.animalCagePlacement.create({
                data: {
                  animalId,
                  cageId,
                  startedAt: n.birthDate ?? now,
                  startedById: actorId,
                  reason: "IMPORT",
                  changesetId: changeset.id,
                },
              });
            } else if (open.cageId !== cageId) {
              await tx.animalCagePlacement.update({
                where: { id: open.id },
                data: { endedAt: now, endedById: actorId, endRecordedAt: now, endChangesetId: changeset.id },
              });
              await tx.animalCagePlacement.create({
                data: {
                  animalId,
                  cageId,
                  startedAt: now,
                  startedById: actorId,
                  reason: "IMPORT",
                  changesetId: changeset.id,
                },
              });
            }
          }
        }

        if (n.genotype) {
          await tx.genotype.create({
            data: {
              animalId,
              locus: n.strain ?? "imported",
              result: normalizeGenotype(n.genotype),
              source: `Import: ${filename}`,
              changesetId: changeset.id,
            },
          });
        }

        await tx.importRow.create({
          data: {
            batchId: batch.id,
            rowNumber: row.rowNumber,
            status: row.status,
            raw: row.raw,
            normalized: { ...n, birthDate: n.birthDate?.toISOString() ?? null } as object,
            messages: row.issues as object,
            animalId,
          },
        });
      }

      return { batchId: batch.id, changesetId: changeset.id, counts: plan.counts };
    },
    // Hundreds of rows, each a few statements — well past the 5s default.
    { timeout: 120_000, maxWait: 10_000 },
  );
}

function normalizeGenotype(text: string): GenotypeResult {
  const t = text.trim().toUpperCase();
  if (["WT", "HET", "HOM", "HEMI", "POSITIVE", "NEGATIVE", "PENDING", "FAILED"].includes(t)) {
    return t as GenotypeResult;
  }
  return "UNKNOWN";
}
