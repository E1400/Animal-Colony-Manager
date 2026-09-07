"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";

import { requireActor } from "@/lib/actor";
import { resolveGrant } from "@/lib/auth/grants";
import { can } from "@/lib/auth/permissions";
import { commitImport } from "@/lib/import/commit";
import { guessMapping, type Mapping } from "@/lib/import/mapping";
import type { DateOrder, Issue } from "@/lib/import/normalize";
import { parseSpreadsheet, type Sheet } from "@/lib/import/parse";
import { planImport } from "@/lib/import/plan";

/**
 * Server actions behind the import wizard.
 *
 * The parsed sheet travels back and forth with the client so that re-mapping a
 * column is instant and does not require re-uploading the file. The content
 * hash is always recomputed here from the rows being imported rather than
 * accepted from the client, so duplicate detection cannot be sidestepped by
 * editing a value in flight.
 */

export type SerializableRow = {
  rowNumber: number;
  status: string;
  raw: Record<string, string>;
  issues: Issue[];
  normalized: Record<string, string | null> | null;
};

export type AnalyzeResult =
  | {
      ok: true;
      sheet: Sheet;
      mapping: Mapping;
      unmapped: string[];
      rows: SerializableRow[];
      counts: Record<string, number>;
      newCageCodes: string[];
      duplicateOfBatchId?: string;
      filename: string;
      sourceFormat: string;
    }
  | { ok: false; error: string };

function hashRows(rows: Array<Record<string, string>>): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

async function requireImporter() {
  const actor = await requireActor();
  if (!actor.labId) throw new Error("You do not belong to a lab yet.");
  const grant = await resolveGrant(actor.id, actor.labId);
  if (!can(grant, "import:run")) {
    throw new Error("Your role cannot run imports.");
  }
  return { actor, labId: actor.labId };
}

function serialize(rows: Awaited<ReturnType<typeof planImport>>["rows"]): SerializableRow[] {
  return rows.map((r) => ({
    rowNumber: r.rowNumber,
    status: r.status,
    raw: r.raw,
    issues: r.issues,
    normalized: r.normalized
      ? {
          ...r.normalized,
          birthDate: r.normalized.birthDate?.toISOString().slice(0, 10) ?? null,
        }
      : null,
  }));
}

/** Step 1: read the file, guess a mapping, and dry-run it. Writes nothing. */
export async function analyzeUpload(formData: FormData): Promise<AnalyzeResult> {
  try {
    const { labId } = await requireImporter();

    const file = formData.get("file");
    if (!(file instanceof File)) return { ok: false, error: "No file was uploaded." };
    if (file.size === 0) return { ok: false, error: "That file is empty." };
    if (file.size > 8 * 1024 * 1024) {
      return { ok: false, error: "That file is larger than 8 MB." };
    }

    const data = Buffer.from(await file.arrayBuffer());
    const sheet = await parseSpreadsheet(data, file.name);
    if (sheet.rows.length === 0) {
      return { ok: false, error: "No data rows were found below the header." };
    }

    const { mapping, unmapped } = guessMapping(sheet.headers);
    const plan = await planImport({
      sheet,
      mapping,
      labId,
      namespace: "kaplan",
      contentHash: hashRows(sheet.rows),
    });

    return {
      ok: true,
      sheet,
      mapping,
      unmapped,
      rows: serialize(plan.rows),
      counts: plan.counts,
      newCageCodes: plan.newCageCodes,
      duplicateOfBatchId: plan.duplicateOfBatchId,
      filename: file.name,
      sourceFormat: /\.csv$/i.test(file.name) ? "csv" : "xlsx",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not read that file." };
  }
}

/**
 * Loads one of the committed fixture sheets.
 *
 * These are the deliberately awful files the importer is tested against, and
 * offering them here means someone evaluating the app can see it handle a
 * genuinely messy sheet without having to go and make one.
 */
const SAMPLES: Record<string, string> = {
  "messy-colony.csv": "A census with a title block, blank separator rows, four date formats, and a duplicate tag",
  "legacy-export.csv": "An export from another system: different column names, ambiguous dates, numeric sex coding",
  "merged-headers.xlsx": "An Excel sheet with a merged title row above the real header",
};

export async function listSamples() {
  return Object.entries(SAMPLES).map(([name, description]) => ({ name, description }));
}

export async function analyzeSample(name: string): Promise<AnalyzeResult> {
  if (!Object.hasOwn(SAMPLES, name)) {
    return { ok: false, error: "Unknown sample file." };
  }
  try {
    const { readFile } = await import("node:fs/promises");
    const data = await readFile(`fixtures/${name}`);
    const form = new FormData();
    form.set("file", new File([new Uint8Array(data)], name));
    return analyzeUpload(form);
  } catch {
    return { ok: false, error: "That sample is not available in this deployment." };
  }
}

/** Step 2: re-run the dry run after a human corrects the column mapping. */
export async function replan(
  sheet: Sheet,
  mapping: Mapping,
  dateOrder?: DateOrder,
): Promise<AnalyzeResult | { ok: false; error: string }> {
  try {
    const { labId } = await requireImporter();
    const plan = await planImport({
      sheet,
      mapping,
      labId,
      namespace: "kaplan",
      contentHash: hashRows(sheet.rows),
      dateOrder,
    });
    return {
      ok: true,
      sheet,
      mapping,
      unmapped: sheet.headers.filter((h) => !Object.values(mapping).includes(h)),
      rows: serialize(plan.rows),
      counts: plan.counts,
      newCageCodes: plan.newCageCodes,
      duplicateOfBatchId: plan.duplicateOfBatchId,
      filename: "",
      sourceFormat: "csv",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not re-check the sheet." };
  }
}

/** Step 3: apply it. */
export async function commitUpload(
  sheet: Sheet,
  mapping: Mapping,
  filename: string,
  sourceFormat: string,
  dateOrder?: DateOrder,
): Promise<{ ok: true; batchId: string; counts: Record<string, number> } | { ok: false; error: string }> {
  try {
    const { actor, labId } = await requireImporter();

    // Re-planned server-side immediately before writing: the client's copy is
    // a display artifact, and the decision about what to write is made here.
    const plan = await planImport({
      sheet,
      mapping,
      labId,
      namespace: "kaplan",
      contentHash: hashRows(sheet.rows),
      dateOrder,
    });

    const result = await commitImport({
      plan,
      labId,
      actorId: actor.id,
      filename: filename || "upload.csv",
      sourceFormat,
      mapping,
    });

    revalidatePath("/cages");
    revalidatePath("/activity");
    revalidatePath("/import");

    return { ok: true, batchId: result.batchId, counts: result.counts };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The import failed." };
  }
}
