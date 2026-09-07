import type { DatePrecision, Sex } from "@/generated/prisma/client";

/**
 * Turning what people actually typed into what the schema requires.
 *
 * The governing rule here: never guess silently. A cell that could mean two
 * things produces a value *and* a warning, so the dry run can show it and a
 * human can decide. Quietly picking one interpretation is how a colony ends up
 * with a hundred animals born in the wrong month and no way to tell.
 */

/**
 * `info` records something that will happen as a consequence of importing, and
 * needs no decision — a cage being created, for instance. `warning` means a
 * human should look before committing. Keeping them apart matters: on a first
 * import every cage is new, and treating that as a warning would flag every
 * row and make the flag worthless.
 */
export type IssueLevel = "error" | "warning" | "info";

export type Issue = {
  level: IssueLevel;
  field: string;
  message: string;
  /** What was in the cell, quoted back so an error can point at the sheet. */
  raw?: string;
};

export type Field<T> = { value: T | null; issues: Issue[] };

const ok = <T>(value: T, issues: Issue[] = []): Field<T> => ({ value, issues });
const bad = <T>(issues: Issue[]): Field<T> => ({ value: null, issues });

export function blank(raw: unknown): boolean {
  return raw == null || String(raw).trim() === "";
}

// ---------------------------------------------------------------------------
// Sex
// ---------------------------------------------------------------------------

const SEX_TOKENS: Record<string, Sex> = {
  m: "MALE",
  male: "MALE",
  "♂": "MALE",
  b: "MALE", // "buck"
  buck: "MALE",
  f: "FEMALE",
  female: "FEMALE",
  "♀": "FEMALE",
  d: "FEMALE", // "doe"
  doe: "FEMALE",
  u: "UNKNOWN",
  unk: "UNKNOWN",
  unknown: "UNKNOWN",
  "?": "UNKNOWN",
  "-": "UNKNOWN",
  "n/a": "UNKNOWN",
};

export function parseSex(raw: unknown, field = "sex"): Field<Sex> {
  if (blank(raw)) return ok<Sex>("UNKNOWN");
  const token = String(raw).trim().toLowerCase();

  const direct = SEX_TOKENS[token];
  if (direct) return ok(direct);

  // Numeric coding is real and genuinely ambiguous between labs — 1 means male
  // in some sheets and female in others. Refuse rather than pick.
  if (/^[0-9]+$/.test(token)) {
    return bad([
      {
        level: "error",
        field,
        raw: String(raw),
        message:
          "Numeric sex coding is ambiguous — 1 means male in some labs, female in others.",
      },
    ]);
  }

  return bad([
    { level: "error", field, raw: String(raw), message: `Unrecognized sex "${raw}".` },
  ]);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export type DateOrder = "MDY" | "DMY";

export type ParsedDate = { date: Date; precision: DatePrecision };

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d));
}

function validYMD(y: number, m: number, d: number): boolean {
  if (m < 0 || m > 11 || d < 1 || d > 31) return false;
  const probe = utc(y, m, d);
  return probe.getUTCMonth() === m && probe.getUTCDate() === d;
}

/**
 * Parses the date formats that actually turn up in colony spreadsheets.
 *
 * Handles ISO, month names, bare months and years, and Excel's serial numbers
 * — a column formatted as "Date" in Excel arrives as 45219, and treating that
 * as a year is a classic silent corruption.
 *
 * Slash dates are the hard case. 03/04/2024 is March 4th or April 3rd
 * depending on who typed it, and both are valid. `order` says which convention
 * the sheet uses; without one, an ambiguous date still parses but carries a
 * warning so the dry run can surface it. Where only one reading is valid —
 * 25/12/2024 — that reading is used and noted.
 */
export function parseDate(
  raw: unknown,
  opts: { field?: string; order?: DateOrder } = {},
): Field<ParsedDate> {
  const field = opts.field ?? "date";
  if (blank(raw)) return ok<ParsedDate>(null as unknown as ParsedDate, []);

  const text = String(raw).trim();

  // Excel serial date. Its epoch is 1899-12-30 because of a deliberate leap
  // year bug Excel kept for Lotus compatibility.
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial > 20000 && serial < 60000) {
      const ms = Math.round(serial * 86_400_000);
      const date = new Date(Date.UTC(1899, 11, 30) + ms);
      return ok(
        { date, precision: "DAY" as DatePrecision },
        [
          {
            level: "warning",
            field,
            raw: text,
            message: `Read ${text} as an Excel serial date (${date.toISOString().slice(0, 10)}).`,
          },
        ],
      );
    }
  }

  // ISO-ish: 2024-06-03, 2024/06/03
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) {
    const [, y, m, d] = iso.map(Number);
    if (!validYMD(y, m - 1, d)) {
      return bad([{ level: "error", field, raw: text, message: `Not a real date.` }]);
    }
    return ok({ date: utc(y, m - 1, d), precision: "DAY" as DatePrecision });
  }

  // Month name forms: "Jun 3 2024", "3 Jun 2024", "June 2024"
  const named = text.toLowerCase().match(
    /^(?:(\d{1,2})\s+)?([a-z]{3,9})\.?\s+(?:(\d{1,2}),?\s+)?(\d{4})$/,
  );
  if (named) {
    const [, dayBefore, monthWord, dayAfter, yearStr] = named;
    const month = MONTHS.indexOf(monthWord.slice(0, 3));
    if (month >= 0) {
      const year = Number(yearStr);
      const day = Number(dayBefore ?? dayAfter ?? 0);
      if (!day) {
        // "June 2024" — real information is the month, not a made-up 1st.
        return ok({ date: utc(year, month, 1), precision: "MONTH" as DatePrecision });
      }
      if (!validYMD(year, month, day)) {
        return bad([{ level: "error", field, raw: text, message: "Not a real date." }]);
      }
      return ok({ date: utc(year, month, day), precision: "DAY" as DatePrecision });
    }
  }

  // Bare year
  if (/^\d{4}$/.test(text)) {
    const year = Number(text);
    if (year >= 1990 && year <= 2100) {
      return ok({ date: utc(year, 0, 1), precision: "YEAR" as DatePrecision });
    }
  }

  // Slash/dash numeric: the ambiguous case.
  const numeric = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    let year = Number(numeric[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;

    const asMDY = validYMD(year, a - 1, b);
    const asDMY = validYMD(year, b - 1, a);

    if (!asMDY && !asDMY) {
      return bad([{ level: "error", field, raw: text, message: "Not a real date." }]);
    }

    if (asMDY && asDMY) {
      const order = opts.order ?? "MDY";
      const [m, d] = order === "MDY" ? [a, b] : [b, a];
      const issues: Issue[] =
        opts.order
          ? []
          : [
              {
                level: "warning",
                field,
                raw: text,
                message: `Ambiguous date — could be ${a}/${b} or ${b}/${a}. Assumed month first; set the sheet's date order to be sure.`,
              },
            ];
      return ok({ date: utc(year, m - 1, d), precision: "DAY" as DatePrecision }, issues);
    }

    // Only one reading is possible, so use it regardless of the stated order.
    const [m, d] = asMDY ? [a, b] : [b, a];
    return ok({ date: utc(year, m - 1, d), precision: "DAY" as DatePrecision });
  }

  return bad([
    { level: "error", field, raw: text, message: `Could not read "${text}" as a date.` },
  ]);
}

// ---------------------------------------------------------------------------
// Identifiers and free text
// ---------------------------------------------------------------------------

/**
 * Ear tags arrive as "2051", " 2051 ", "#2051", "ET-2051", or 2051 as a number
 * that lost its leading zero somewhere in Excel. Normalizing to a bare token
 * is what makes re-uploading the same sheet idempotent.
 */
export function parseIdentifier(raw: unknown, field = "tag"): Field<string> {
  if (blank(raw)) return bad([{ level: "error", field, message: "Missing identifier." }]);

  const text = String(raw).trim().replace(/^#/, "").replace(/^(?:et|tag)[-\s]?/i, "");
  const cleaned = text.trim();

  if (!cleaned) {
    return bad([{ level: "error", field, raw: String(raw), message: "Missing identifier." }]);
  }
  if (cleaned.length > 64) {
    return bad([
      { level: "error", field, raw: String(raw), message: "Identifier is implausibly long." },
    ]);
  }
  return ok(cleaned);
}

/**
 * Cage codes are upper-cased before comparison; sheets mix "cg-2002" and
 * "CG-2002" freely and they are the same cage.
 *
 * A blank cage is not an error — plenty of sheets list animals with no housing
 * column at all — so this never produces an issue and takes no field name.
 */
export function parseCageCode(raw: unknown): Field<string> {
  if (blank(raw)) return ok<string>(null as unknown as string);
  const cleaned = String(raw).trim().replace(/\s+/g, "");
  return ok(cleaned.toUpperCase());
}

const GENOTYPE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:hom(?:ozygous)?|\+\/\+)\b/i, "HOM"],
  [/\b(?:het(?:erozygous)?|\+\/-|-\/\+)\b/i, "HET"],
  [/\b(?:wt|wild[-\s]?type|-\/-)\b/i, "WT"],
  [/\bhemi(?:zygous)?\b/i, "HEMI"],
];

/**
 * Genotype hiding in a free-text notes column is extremely common. Pulling it
 * out is offered as a *suggestion* with the matched text quoted, never applied
 * silently — a note reading "not het" would otherwise become "het".
 */
export function sniffGenotype(raw: unknown): { result: string; matched: string } | null {
  if (blank(raw)) return null;
  const text = String(raw);
  for (const [pattern, result] of GENOTYPE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return { result, matched: match[0] };
  }
  return null;
}
