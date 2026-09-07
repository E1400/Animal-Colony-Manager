/**
 * Generates fixtures/merged-headers.xlsx.
 *
 * Committed as a script rather than only as a binary so the awkward structure
 * it encodes — a merged header cell and a title row above the real header — is
 * readable in review instead of hidden inside a zip.
 *
 * Run with: npx tsx fixtures/make-xlsx-fixture.mts
 */
import ExcelJS from "exceljs";

const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet("Colony");

sheet.addRow(["Okonkwo Lab breeding stock", "", "", "", ""]);
sheet.addRow([]);
sheet.addRow(["Animal", "Sex", "Birth", "Cage", "Genotype"]);
sheet.addRow(["7001", "M", new Date(Date.UTC(2024, 4, 2)), "OK-01", "HET"]);
sheet.addRow(["7002", "F", new Date(Date.UTC(2024, 4, 2)), "OK-01", "WT"]);
sheet.addRow([]);
sheet.addRow(["7003", "F", new Date(Date.UTC(2024, 4, 9)), "OK-02", "HOM"]);

// A merged title across the first row, which is what makes naive parsers treat
// the whole sheet as one column.
sheet.mergeCells("A1:E1");

await workbook.xlsx.writeFile("fixtures/merged-headers.xlsx");
console.log("wrote fixtures/merged-headers.xlsx");
