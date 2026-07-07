import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { csvCell, pdfSafeText } from "./safe-text.ts";

test("neutraliza fórmulas CSV y caracteres no compatibles con el PDF", async () => {
  assert.equal(csvCell("=HYPERLINK(\"x\")"), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell("Paciente normal"), `"Paciente normal"`);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  assert.equal(pdfSafeText(font, "Hallazgo ⚠ crítico"), "Hallazgo ? crítico");
});
