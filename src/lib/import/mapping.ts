/**
 * Guessing which spreadsheet column means what.
 *
 * The guess is always a starting point, never the decision — the import UI
 * shows every mapping and lets a human override it before anything is written.
 * A heuristic that silently mismaps "Dam" onto "ear tag" is worse than one
 * that admits it does not know.
 */

export const IMPORT_FIELDS = [
  "tag",
  "sex",
  "birthDate",
  "cageCode",
  "strain",
  "genotype",
  "damTag",
  "sireTag",
  "notes",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

export const FIELD_LABELS: Record<ImportField, string> = {
  tag: "Ear tag / identifier",
  sex: "Sex",
  birthDate: "Date of birth",
  cageCode: "Cage",
  strain: "Strain / line",
  genotype: "Genotype",
  damTag: "Dam (mother) tag",
  sireTag: "Sire (father) tag",
  notes: "Notes",
};

/** Only a tag is structurally required; everything else can be absent. */
export const REQUIRED_FIELDS: ImportField[] = ["tag"];

type Rule = { field: ImportField; patterns: RegExp[]; weight: number };

// Order matters only for readability; scoring decides. Parent columns are
// listed before the generic tag rule because "dam id" contains "id".
const RULES: Rule[] = [
  { field: "damTag", patterns: [/\b(dam|mother|mom|female parent)\b/i], weight: 10 },
  { field: "sireTag", patterns: [/\b(sire|father|dad|male parent)\b/i], weight: 10 },
  {
    field: "tag",
    patterns: [/ear[\s_-]?tag/i, /\btag\b/i, /\bear[\s_-]?punch\b/i, /\banimal[\s_-]?(id|no|number)\b/i, /\bmouse[\s_-]?(id|no|number)\b/i, /^id$/i, /^animal$/i, /^mouse$/i],
    weight: 9,
  },
  { field: "sex", patterns: [/^sex$/i, /\bgender\b/i, /^m\/f$/i], weight: 10 },
  {
    field: "birthDate",
    patterns: [/\bdob\b/i, /date of birth/i, /\bbirth\b/i, /\bborn\b/i, /\bbirthdate\b/i],
    weight: 10,
  },
  { field: "cageCode", patterns: [/\bcage\b/i, /\bcage[\s_-]?(id|no|number|code)\b/i], weight: 10 },
  { field: "strain", patterns: [/\bstrain\b/i, /\bline\b/i, /\bbackground\b/i], weight: 9 },
  { field: "genotype", patterns: [/\bgenotype\b/i, /\bgeno\b/i, /\ballele\b/i], weight: 10 },
  { field: "notes", patterns: [/\bnotes?\b/i, /\bcomments?\b/i, /\bremarks?\b/i], weight: 8 },
];

export type Mapping = Partial<Record<ImportField, string>>;

export type MappingGuess = {
  mapping: Mapping;
  /** Headers we could not place, surfaced so nothing is silently ignored. */
  unmapped: string[];
  confidence: Record<string, number>;
};

export function guessMapping(headers: string[]): MappingGuess {
  const scores = new Map<ImportField, { header: string; score: number }>();
  const confidence: Record<string, number> = {};

  for (const header of headers) {
    let bestField: ImportField | null = null;
    let bestScore = 0;

    for (const rule of RULES) {
      for (const pattern of rule.patterns) {
        if (!pattern.test(header)) continue;
        // An exact-ish match on a short header beats an incidental substring
        // hit inside a long one.
        const specificity = rule.weight + Math.max(0, 12 - header.length) / 4;
        if (specificity > bestScore) {
          bestScore = specificity;
          bestField = rule.field;
        }
      }
    }

    if (bestField) {
      confidence[header] = Number(bestScore.toFixed(1));
      const held = scores.get(bestField);
      // Two columns competing for one field: keep the stronger match and leave
      // the other unmapped rather than picking arbitrarily.
      if (!held || bestScore > held.score) {
        scores.set(bestField, { header, score: bestScore });
      }
    }
  }

  const mapping: Mapping = {};
  for (const [field, { header }] of scores) mapping[field] = header;

  const used = new Set(Object.values(mapping));
  const unmapped = headers.filter((h) => !used.has(h));

  return { mapping, unmapped, confidence };
}

export function missingRequired(mapping: Mapping): ImportField[] {
  return REQUIRED_FIELDS.filter((f) => !mapping[f]);
}
