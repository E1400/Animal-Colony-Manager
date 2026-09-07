import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { commitImport } from "@/lib/import/commit";
import { guessMapping } from "@/lib/import/mapping";
import { parseDate, parseIdentifier, parseSex, sniffGenotype } from "@/lib/import/normalize";
import { parseSpreadsheet } from "@/lib/import/parse";
import { hashContent, planImport } from "@/lib/import/plan";

import { makeFixture, resetDb } from "./helpers";

beforeEach(resetDb);

const fixture = (name: string) => readFileSync(`fixtures/${name}`);

describe("normalizing what people actually type", () => {
  it("reads the sex codings that turn up in real sheets", () => {
    for (const raw of ["M", "male", "♂", "buck"]) {
      expect(parseSex(raw).value).toBe("MALE");
    }
    for (const raw of ["F", "female", "♀", "doe"]) {
      expect(parseSex(raw).value).toBe("FEMALE");
    }
    expect(parseSex("").value).toBe("UNKNOWN");
  });

  it("refuses numeric sex coding rather than guessing", () => {
    // 1 means male in some labs and female in others. Picking one silently
    // mislabels half a colony.
    const result = parseSex("1");
    expect(result.value).toBeNull();
    expect(result.issues[0].message).toMatch(/ambiguous between labs/i);
  });

  it("reads ISO, month-name, and month-only dates with the right precision", () => {
    expect(parseDate("2024-03-15").value).toMatchObject({ precision: "DAY" });
    expect(parseDate("Mar 17 2024").value?.date.toISOString().slice(0, 10)).toBe("2024-03-17");
    // "June 2024" is a month, not the 1st — recording it as DAY would invent
    // precision the sheet never had.
    expect(parseDate("June 2024").value).toMatchObject({ precision: "MONTH" });
    expect(parseDate("2024").value).toMatchObject({ precision: "YEAR" });
  });

  it("recognises an Excel serial date instead of reading it as a year", () => {
    const result = parseDate("45367");
    expect(result.value?.date.toISOString().slice(0, 10)).toBe("2024-03-16");
    expect(result.issues[0].message).toMatch(/Excel serial/i);
  });

  it("warns on a genuinely ambiguous slash date but commits to one reading", () => {
    const result = parseDate("04/03/2024");
    expect(result.value?.date.toISOString().slice(0, 10)).toBe("2024-04-03");
    expect(result.issues.some((i) => /ambiguous/i.test(i.message))).toBe(true);

    // Told the convention, it stops warning.
    expect(parseDate("04/03/2024", { order: "DMY" }).issues).toHaveLength(0);
    expect(
      parseDate("04/03/2024", { order: "DMY" }).value?.date.toISOString().slice(0, 10),
    ).toBe("2024-03-04");
  });

  it("uses the only valid reading when a date is unambiguous", () => {
    // 17 cannot be a month, so this is day-first regardless of convention.
    expect(parseDate("17/03/2024").value?.date.toISOString().slice(0, 10)).toBe("2024-03-17");
  });

  it("strips the decoration people put around ear tags", () => {
    expect(parseIdentifier(" 2105 ").value).toBe("2105");
    expect(parseIdentifier("#2106").value).toBe("2106");
    expect(parseIdentifier("ET-2107").value).toBe("2107");
  });

  it("spots a genotype hiding in a notes column", () => {
    expect(sniffGenotype("het for Ai9 - confirmed")).toMatchObject({ result: "HET" });
    expect(sniffGenotype("looks healthy")).toBeNull();
  });
});

describe("parsing an untidy sheet", () => {
  it("finds the header below a title block and drops separator rows", async () => {
    const sheet = await parseSpreadsheet(fixture("messy-colony.csv"), "messy-colony.csv");

    // The header is on row 4, under two title lines and a blank.
    expect(sheet.headerRow).toBe(4);
    expect(sheet.preambleRows).toBe(3);
    expect(sheet.headers).toContain("Ear Tag");
    expect(sheet.headers).toContain("DOB");

    // Blank separator rows are structure, not data.
    expect(sheet.rows.every((r) => Object.values(r).some((v) => v !== ""))).toBe(true);
    // Row numbers stay tied to the spreadsheet, so errors can cite them.
    expect(sheet.rowNumbers[0]).toBe(5);
  });

  it("reads an xlsx with a merged title row", async () => {
    const sheet = await parseSpreadsheet(fixture("merged-headers.xlsx"), "merged-headers.xlsx");
    expect(sheet.headers).toEqual(
      expect.arrayContaining(["Animal", "Sex", "Birth", "Cage", "Genotype"]),
    );
    expect(sheet.rows).toHaveLength(3);
  });
});

describe("guessing the column mapping", () => {
  it("maps obvious headers and reports what it could not place", async () => {
    const sheet = await parseSpreadsheet(fixture("messy-colony.csv"), "messy-colony.csv");
    const { mapping, unmapped } = guessMapping(sheet.headers);

    expect(mapping.tag).toBe("Ear Tag");
    expect(mapping.sex).toBe("Sex");
    expect(mapping.birthDate).toBe("DOB");
    expect(mapping.cageCode).toBe("Cage");
    expect(mapping.strain).toBe("Strain");
    expect(mapping.notes).toBe("Notes");
    expect(unmapped).toHaveLength(0);
  });

  it("handles a sheet that uses entirely different names", async () => {
    const sheet = await parseSpreadsheet(fixture("legacy-export.csv"), "legacy-export.csv");
    const { mapping } = guessMapping(sheet.headers);

    expect(mapping.tag).toBe("mouse id");
    expect(mapping.sex).toBe("gender");
    expect(mapping.birthDate).toBe("date of birth");
    expect(mapping.cageCode).toBe("cage no");
    expect(mapping.genotype).toBe("genotype");
  });

  it("does not mistake a parent column for the animal's own tag", () => {
    const { mapping } = guessMapping(["animal id", "dam id", "sire id"]);
    expect(mapping.tag).toBe("animal id");
    expect(mapping.damTag).toBe("dam id");
    expect(mapping.sireTag).toBe("sire id");
  });
});

describe("the dry run", () => {
  async function planFixture(file: string, labId: string) {
    const data = fixture(file);
    const sheet = await parseSpreadsheet(data, file);
    const { mapping } = guessMapping(sheet.headers);
    return planImport({
      sheet,
      mapping,
      labId,
      namespace: "testlab",
      contentHash: hashContent(data),
    });
  }

  it("classifies every row and rejects only the bad ones", async () => {
    const { lab } = await makeFixture({ cages: 0, animals: 0 });
    const plan = await planFixture("messy-colony.csv", lab.id);

    const byRow = new Map(plan.rows.map((r) => [r.rowNumber, r]));

    expect(byRow.get(5)?.status).toBe("CREATED");
    // Flagged rather than created: the genotype was inferred from free text.
    expect(byRow.get(6)?.status).toBe("FLAGGED");
    // Unrecognised sex and an impossible date are errors, not silent defaults.
    expect(byRow.get(12)?.status).toBe("ERROR");
    expect(byRow.get(13)?.status).toBe("ERROR");
    // The repeated tag is rejected with a pointer to the earlier row.
    expect(byRow.get(14)?.status).toBe("ERROR");
    expect(byRow.get(14)?.issues.some((i) => /also appears on row 5/.test(i.message))).toBe(true);

    expect(plan.counts.ERROR).toBe(3);
    expect(plan.counts.CREATED + plan.counts.FLAGGED).toBe(6);
  });

  it("writes nothing at all", async () => {
    const { lab } = await makeFixture({ cages: 0, animals: 0 });
    await planFixture("messy-colony.csv", lab.id);

    expect(await prisma.animal.count()).toBe(0);
    expect(await prisma.cage.count()).toBe(0);
    expect(await prisma.importBatch.count()).toBe(0);
  });

  it("names the cages it would have to create", async () => {
    const { lab } = await makeFixture({ cages: 0, animals: 0 });
    const plan = await planFixture("messy-colony.csv", lab.id);
    expect(plan.newCageCodes).toEqual(
      expect.arrayContaining(["CG-2001", "CG-2002", "CG-2003"]),
    );
  });
});

describe("committing", () => {
  async function importFile(file: string, labId: string, actorId: string) {
    const data = fixture(file);
    const sheet = await parseSpreadsheet(data, file);
    const { mapping } = guessMapping(sheet.headers);
    const plan = await planImport({
      sheet,
      mapping,
      labId,
      namespace: "testlab",
      contentHash: hashContent(data),
    });
    return {
      plan,
      result: await commitImport({
        plan,
        labId,
        actorId,
        filename: file,
        sourceFormat: "csv",
        mapping,
      }),
    };
  }

  it("creates the good rows, records the bad ones, and skips nothing silently", async () => {
    const { lab, user } = await makeFixture({ cages: 0, animals: 0 });
    const { result } = await importFile("messy-colony.csv", lab.id, user.id);

    expect(await prisma.animal.count()).toBe(6);
    expect(await prisma.cage.count()).toBe(3);

    // Every row of the file is accounted for, including the rejected ones.
    const rows = await prisma.importRow.count({ where: { batchId: result.batchId } });
    expect(rows).toBe(9);

    const errors = await prisma.importRow.findMany({
      where: { batchId: result.batchId, status: "ERROR" },
    });
    expect(errors).toHaveLength(3);
    // The raw cells are kept so an error can quote the sheet back.
    expect(errors[0].raw).toBeTruthy();
  });

  it("lands as one changeset, so an import can be undone as one action", async () => {
    const { lab, user } = await makeFixture({ cages: 0, animals: 0 });
    const { result } = await importFile("messy-colony.csv", lab.id, user.id);

    const changeset = await prisma.changeset.findUniqueOrThrow({
      where: { id: result.changesetId },
    });
    expect(changeset.kind).toBe("IMPORT");

    const identifiers = await prisma.animalIdentifier.count({
      where: { changesetId: result.changesetId },
    });
    expect(identifiers).toBe(6);
  });

  it("refuses the same file twice", async () => {
    const { lab, user } = await makeFixture({ cages: 0, animals: 0 });
    await importFile("messy-colony.csv", lab.id, user.id);

    await expect(importFile("messy-colony.csv", lab.id, user.id)).rejects.toThrow(
      /already been imported/i,
    );
    expect(await prisma.animal.count()).toBe(6);
  });

  it("updates rather than duplicates when a tag is already known", async () => {
    const { lab, user } = await makeFixture({ cages: 0, animals: 0 });
    await importFile("messy-colony.csv", lab.id, user.id);

    // A second sheet, same animals, one with a sex that was previously unknown.
    const data = Buffer.from(
      "Ear Tag,Sex,DOB,Cage,Strain,Notes\n2107,F,2024-03-20,CG-2003,B6,now with a valid sex\n",
    );
    const sheet = await parseSpreadsheet(data, "correction.csv");
    const { mapping } = guessMapping(sheet.headers);
    const plan = await planImport({
      sheet,
      mapping,
      labId: lab.id,
      namespace: "testlab",
      contentHash: hashContent(data),
    });

    // 2107 was rejected the first time for a bad sex code, so it is new here.
    expect(plan.counts.CREATED + plan.counts.FLAGGED).toBe(1);
    await commitImport({
      plan,
      labId: lab.id,
      actorId: user.id,
      filename: "correction.csv",
      sourceFormat: "csv",
      mapping,
    });

    expect(await prisma.animal.count()).toBe(7);

    // Re-importing that same corrected row updates the existing animal.
    const again = await planImport({
      sheet,
      mapping,
      labId: lab.id,
      namespace: "testlab",
      contentHash: "different-hash-same-content",
    });
    expect(again.counts.UPDATED).toBe(1);
    expect(again.counts.CREATED).toBe(0);
  });
});
