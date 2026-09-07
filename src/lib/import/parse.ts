import ExcelJS from "exceljs";
import Papa from "papaparse";

/**
 * Getting a grid of cells out of a file, before any interpretation.
 *
 * Real colony spreadsheets are not tidy rectangles. They open with a title
 * row, carry blank separator rows between racks, have merged header cells, and
 * trail off into empty columns. This layer's whole job is to find the header
 * row and hand back records; deciding what the columns *mean* happens later.
 */

export type Grid = string[][];

export type Sheet = {
  /** Header text, trimmed, in column order. */
  headers: string[];
  /** One record per data row, keyed by header. */
  rows: Array<Record<string, string>>;
  /** Spreadsheet row number (1-based) each record came from, for error messages. */
  rowNumbers: number[];
  /** 1-based row where the header was found. */
  headerRow: number;
  /** Rows above the header that were skipped as preamble. */
  preambleRows: number;
  sheetName?: string;
};

const cellText = (value: unknown): string => {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    // ExcelJS rich text / formula / hyperlink cells.
    const v = value as { text?: string; result?: unknown; richText?: Array<{ text: string }> };
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
    if (typeof v.text === "string") return v.text;
    if (v.result != null) return String(v.result);
    return "";
  }
  return String(value);
};

export async function readGrid(data: Buffer | Uint8Array, filename: string): Promise<{ grid: Grid; sheetName?: string }> {
  const isCsv = /\.csv$/i.test(filename) || /\.txt$/i.test(filename);

  if (isCsv) {
    const text = Buffer.from(data).toString("utf8").replace(/^﻿/, "");
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false });
    return { grid: (parsed.data as string[][]).map((r) => r.map((c) => (c ?? "").trim())) };
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(data) as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("The workbook has no sheets.");

  const grid: Grid = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    // row.values is 1-indexed with a leading hole.
    const values = row.values as unknown[];
    for (let i = 1; i < values.length; i++) cells.push(cellText(values[i]).trim());
    grid.push(cells);
  });

  return { grid, sheetName: sheet.name };
}

/**
 * Known column names, used only to *locate* the header row. Actual mapping is
 * a separate, overridable step — this just needs to recognise a plausible
 * header when it sees one.
 */
const HEADERISH =
  /^(animal|mouse|id|ear[\s_-]?tag|tag|cage|sex|gender|dob|birth|born|strain|line|genotype|geno|notes?|comments?|room|rack|position|slot|dam|sire|mother|father|weight|status)/i;

function headerScore(row: string[]): number {
  const filled = row.filter((c) => c !== "");
  if (filled.length < 2) return 0;
  const matches = filled.filter((c) => HEADERISH.test(c)).length;
  // Prefer rows that look like labels rather than data: mostly non-numeric.
  const nonNumeric = filled.filter((c) => !/^\d+(\.\d+)?$/.test(c)).length;
  return matches * 3 + nonNumeric;
}

/**
 * Finds the header row by scoring the first several rows rather than assuming
 * row 1. A sheet that starts "Kaplan Lab — colony as of June 2024" would
 * otherwise produce a table whose only column is that sentence.
 */
export function findHeaderRow(grid: Grid, searchDepth = 15): number {
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(grid.length, searchDepth); i++) {
    const score = headerScore(grid[i] ?? []);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/**
 * Fills blanks in a header row from the cell to their left.
 *
 * Merged cells in Excel report their value once and leave the rest empty, so
 * a two-cell "Genotype" header arrives as ["Genotype", ""]. Without this the
 * second column becomes unnamed and its data is silently dropped.
 */
function fillMergedHeaders(header: string[]): string[] {
  const out: string[] = [];
  let last = "";
  for (let i = 0; i < header.length; i++) {
    const cell = header[i] ?? "";
    if (cell !== "") {
      last = cell;
      out.push(cell);
    } else {
      // Only inherit if there is data-bearing structure to the right; a run of
      // trailing blanks is just an empty tail, not a merge.
      out.push(last && header.slice(i + 1).some((c) => c !== "") ? `${last} (2)` : "");
    }
  }
  return out;
}

function dedupeHeaders(header: string[]): string[] {
  const seen = new Map<string, number>();
  return header.map((h, i) => {
    const base = h || `column ${i + 1}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base} (${n + 1})`;
  });
}

export function toSheet(grid: Grid, sheetName?: string): Sheet {
  const headerRow = findHeaderRow(grid);
  const rawHeader = grid[headerRow] ?? [];
  const headers = dedupeHeaders(fillMergedHeaders(rawHeader));

  const rows: Array<Record<string, string>> = [];
  const rowNumbers: number[] = [];

  for (let i = headerRow + 1; i < grid.length; i++) {
    const cells = grid[i] ?? [];
    // Blank separator rows are structure, not data.
    if (cells.every((c) => (c ?? "").trim() === "")) continue;

    const record: Record<string, string> = {};
    headers.forEach((h, col) => {
      if (!h) return;
      record[h] = (cells[col] ?? "").trim();
    });
    rows.push(record);
    rowNumbers.push(i + 1);
  }

  return {
    headers: headers.filter(Boolean),
    rows,
    rowNumbers,
    headerRow: headerRow + 1,
    preambleRows: headerRow,
    sheetName,
  };
}

export async function parseSpreadsheet(
  data: Buffer | Uint8Array,
  filename: string,
): Promise<Sheet> {
  const { grid, sheetName } = await readGrid(data, filename);
  if (grid.length === 0) throw new Error("The file appears to be empty.");
  return toSheet(grid, sheetName);
}
