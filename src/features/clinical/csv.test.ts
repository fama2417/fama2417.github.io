import assert from "node:assert/strict";
import test from "node:test";
import { codeColumns, detectDelimiter, loincDesignationImportRow, loincImportRow, parseDelimited } from "./csv.ts";

test("parsea CSV con comillas, comas internas y CRLF", () => {
  const rows = parseDelimited('code,name\r\n"R10.4","Dolor abdominal, otro"\r\nA00,"Cólera"');
  assert.deepEqual(rows, [["code", "name"], ["R10.4", "Dolor abdominal, otro"], ["A00", "Cólera"]]);
});

test("comilla escapada dentro de campo", () => {
  assert.deepEqual(parseDelimited('a,b\n"x ""y""",z'), [["a", "b"], ['x "y"', "z"]]);
});

test("detecta TSV y punto y coma", () => {
  assert.equal(detectDelimiter("a\tb"), "\t");
  assert.equal(detectDelimiter("a;b"), ";");
  assert.deepEqual(parseDelimited("code\tterm\n123\tHemoglobina"), [["code", "term"], ["123", "Hemoglobina"]]);
});

test("codeColumns reconoce encabezados LOINC, SNOMED y genéricos", () => {
  assert.deepEqual(codeColumns(["LOINC_NUM", "COMPONENT", "LONG_COMMON_NAME"]), { code: 0, display: 2 });
  assert.deepEqual(codeColumns(["id", "effectiveTime", "conceptId", "term"]), { code: 2, display: 3 }); // conceptId gana sobre id (RF2)
  assert.deepEqual(codeColumns(["Código", "Descripción"]), { code: 0, display: 1 });
  assert.deepEqual(codeColumns(["foo", "bar"]), { code: 0, display: 1 });
});

test("loincImportRow conserva metadatos oficiales para agrupar y normalizar", () => {
  const header = ["LOINC_NUM", "COMPONENT", "PROPERTY", "TIME_ASPCT", "SYSTEM", "SCALE_TYP", "METHOD_TYP", "CLASS", "STATUS", "LONG_COMMON_NAME", "EXAMPLE_UCUM_UNITS"];
  assert.deepEqual(loincImportRow(header, ["1558-6", "Glucose^fasting", "MCnc", "Pt", "Ser/Plas", "Qn", "", "CHEM", "ACTIVE", "Glucose fasting [Mass/volume] in Serum or Plasma", "mg/dL"]), {
    code: "1558-6", display: "Glucose fasting [Mass/volume] in Serum or Plasma", component: "Glucose^fasting",
    property: "MCnc", timeAspect: "Pt", specimen: "Ser/Plas", scaleType: "Qn", methodType: "",
    className: "CHEM", status: "ACTIVE", exampleUcumUnits: "mg/dL",
  });
});

test("loincDesignationImportRow conserva la variante española como alias", () => {
  const header = ["LOINC_NUM", "COMPONENT", "SYSTEM", "LONG_COMMON_NAME", "LinguisticVariantDisplayName"];
  assert.deepEqual(loincDesignationImportRow(header, ["24355-0", "Panel macroscópico de análisis de orina", "Orina", "Panel macroscópico de análisis de orina: Orina", ""], "esMX28LinguisticVariant.csv"), {
    code: "24355-0", languageVariant: "esMX", display: "Panel macroscópico de análisis de orina: Orina",
    searchText: "Panel macroscopico de analisis de orina: Orina Panel macroscopico de analisis de orina Orina",
  });
});
