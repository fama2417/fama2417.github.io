import assert from "node:assert/strict";
import test from "node:test";
import type { StructuredTextItem } from "unpdf";
import { dedupeLabCandidates, labAnalyteSimilarity, labPatientMatches, labSourceHighlight, labSourcePage, loincSearchQueries, parseLabLayoutPages, remapVisualPages, verifiedLabLoinc, type LabCandidate } from "./lab-ai.ts";
import { ocrImageKey, ocrTargetWidth } from "../../lib/pdf-ocr.ts";

const item = (str: string, x: number, y: number): StructuredTextItem => ({
  str, x, y, width: str.length * 5, height: 10, fontSize: 10, fontFamily: "sans", dir: "ltr", hasEOL: false,
});

test("parseLabLayoutPages extrae columnas, identidad y fecha sin IA", () => {
  const page = [
    item("Nombre", 30, 700), item(":", 82, 700), item("PACIENTE PRUEBA", 90, 700),
    item("RUT", 30, 686), item(":", 82, 686), item("12.345.678-5", 90, 686),
    item("Toma de Muestra", 400, 675), item(":", 472, 675), item("08/07/2025 10:28", 480, 675),
    item("Examen", 30, 633), item("Resultado", 145, 633), item("Unidad", 240, 633), item("Valor de Referencia", 300, 633), item("Método", 400, 633),
    item("GLICEMIA", 30, 578), item("98", 145, 578), item("(mg/dL)", 240, 578), item("74 - 100", 302, 578), item("Hexoquinasa", 400, 578),
    item("TRIGLICÉRIDOS", 30, 555), item("210", 145, 555), item("(mg/dL)", 240, 555), item("[ * ] Hasta 150", 302, 555),
  ];
  const parsed = parseLabLayoutPages([page]);
  assert.equal(parsed.patientName, "PACIENTE PRUEBA");
  assert.equal(parsed.patientIdentifier, "12.345.678-5");
  assert.equal(parsed.observedAt, "2025-07-08");
  assert.equal(parsed.needsAi, false);
  assert.equal(parsed.observations.length, 2);
  assert.deepEqual({ ...parsed.observations[0], observedAt: undefined, sourceSentence: undefined, source: undefined, valueText: undefined, refText: undefined }, {
    analyte: "GLICEMIA", valueNum: 98, unit: "mg/dL", refLow: 74, refHigh: 100, flag: "normal",
    observedAt: undefined, sourceSentence: undefined, source: undefined, valueText: undefined, refText: undefined,
  });
  assert.equal(parsed.observations[1].analyte, "TRIGLICÉRIDOS");
  assert.equal(parsed.observations[1].valueNum, 210);
  assert.equal(parsed.observations[1].refHigh, 150);
  assert.equal(parsed.observations[1].flag, "abnormal");
});

test("parseLabLayoutPages acepta encabezados partidos con unidad antes del resultado", () => {
  const header = (unitX: number, resultX: number, referenceX: number, historyX: number) => [
    item("Unidad de", unitX - 6, 650), item("Intervalo de", referenceX - 2, 650), item("Resultado Anterior", historyX, 650),
    item("Examen", 43, 640), item("Medida", unitX, 640), item("Resultado", resultX, 640), item("Referencia", referenceX, 640), item("Valor", historyX, 640),
  ];
  const parsed = parseLabLayoutPages([
    [
      item("Fecha Toma de Muestra", 43, 700), item(":", 170, 700), item("22/07/22 09:43", 180, 700),
      ...header(129, 194, 276, 357),
      item("Glucosa", 43, 610), item("mg/dL", 129, 610), item("77", 194, 610), item("[", 262, 610), item("70", 273, 610), item("-", 293, 610), item("99", 310, 610), item("]", 328, 610), item("85", 357, 610), item("Enzimático", 468, 610),
      item(".", 43, 600), item("mmol/L", 129, 600), item("4.28", 194, 600), item("3.89 - 5.49", 272, 600),
    ],
    [
      ...header(233, 282, 382, 468),
      item("25-OH-Vitamina D", 43, 610), item("ng/mL", 233, 610), item("14", 282, 610), item("↓", 332, 610), item("[ 20", 367, 610), item("-", 403, 610), item("50 ]", 416, 610),
    ],
  ]);

  assert.equal(parsed.observedAt, "2022-07-22");
  assert.equal(parsed.needsAi, false);
  assert.deepEqual(parsed.observations.map(({ analyte, valueNum, unit, refLow, refHigh, flag }) => ({ analyte, valueNum, unit, refLow, refHigh, flag })), [
    { analyte: "Glucosa", valueNum: 77, unit: "mg/dL", refLow: 70, refHigh: 99, flag: "normal" },
    { analyte: "25-OH-Vitamina D", valueNum: 14, unit: "ng/mL", refLow: 20, refHigh: 50, flag: "low" },
  ]);
});

test("labPatientMatches prioriza identificador y no acepta documentos sin identidad", () => {
  const expected = { patientName: "María Pérez", patientIdentifier: "12.345.678-5" };
  assert.equal(labPatientMatches({ patientName: "OTRA PERSONA", patientIdentifier: "12345678-5" }, expected), true);
  assert.equal(labPatientMatches({ patientName: "María Pérez", patientIdentifier: "99.999.999-9" }, expected), false);
  assert.equal(labPatientMatches({ patientName: "", patientIdentifier: "" }, expected), false);
});

test("parseLabLayoutPages reconoce el formato monoespaciado de INDISA", () => {
  const page = [
    item("Paciente : MANQUELIPE ALDAY FABIAN Id. Atención 5173440 : R.u.t. : 18332410-1", 30, 700),
    item("Fono : 123456789 Fec. Solicitud 07/05/2026 09:57 :", 30, 686),
    item("EXAMEN RESULTADO UNIDAD VALOR DE REFERENCIA", 30, 640),
    item("ERITROCITOS 4.29 * M/uL 4.5 - 5.9", 30, 620),
    item("HEMOGLOBINA 13.7 gr/dL 13.0 - 17.0", 30, 604),
    item("INR 0.99", 30, 588),
    item("GLOBULOS ROJOS Normales.", 30, 572),
    item("Deseable <200 Factor de Riesgo < 40", 30, 556),
    item("cambio de metodología 01 junio 2020", 30, 548),
    item("EXAMEN VALIDADO POR PROFESIONAL", 30, 540),
  ];

  const parsed = parseLabLayoutPages([page]);
  assert.equal(parsed.patientName, "MANQUELIPE ALDAY FABIAN");
  assert.equal(parsed.patientIdentifier, "18332410-1");
  assert.equal(parsed.observedAt, "2026-05-07");
  assert.equal(parsed.needsAi, false);
  assert.equal(parsed.observations.length, 4);
  assert.deepEqual(parsed.observations.map(({ analyte, valueNum, valueText, unit, flag }) => ({ analyte, valueNum, valueText, unit, flag })), [
    { analyte: "ERITROCITOS", valueNum: 4.29, valueText: "", unit: "M/uL", flag: "abnormal" },
    { analyte: "HEMOGLOBINA", valueNum: 13.7, valueText: "", unit: "gr/dL", flag: "normal" },
    { analyte: "INR", valueNum: 0.99, valueText: "", unit: "", flag: "" },
    { analyte: "GLOBULOS ROJOS", valueNum: null, valueText: "Normales.", unit: "", flag: "" },
  ]);
});

test("verifiedLabLoinc acepta sólo sugerencias confiables presentes en el catálogo", () => {
  const mapped = verifiedLabLoinc([
    { sourceId: "0", loincCode: "4544-3", confidence: 0.7 },
    { sourceId: "0", loincCode: "718-7", confidence: 0.95 },
    { sourceId: "1", loincCode: "4544-3", confidence: 0.4 },
    { sourceId: "2", loincCode: "inventado", confidence: 0.99 },
  ], ["718-7", "4544-3"], 0.65);
  assert.deepEqual([...mapped], [["0", "718-7"]]);
});

test("loincSearchQueries relaja calificadores sin cambiar el analito", () => {
  assert.deepEqual(loincSearchQueries("Chloride serum plasma"), ["Chloride serum plasma", "Chloride serum", "Chloride"]);
  assert.equal(loincSearchQueries("JUVENILES NEUT")[0], "Metamyelocytes Leukocytes Blood");
  assert.equal(loincSearchQueries("LDH")[0], "Lactate dehydrogenase Serum Plasma");
});

test("OCR reutiliza páginas rasterizadas repetidas y limita el reescalado", () => {
  const page = new Uint8Array([1, 2, 3]);
  assert.equal(ocrImageKey(page, 831, 998, 3), ocrImageKey(page, 831, 998, 3));
  assert.notEqual(ocrImageKey(page, 831, 998, 3), ocrImageKey(page, 832, 998, 3));
  assert.equal(ocrTargetWidth(831), 2500);
  assert.equal(ocrTargetWidth(2400), 2500);
});

test("reconoce páginas fuente tanto del OCR local como de la extracción visual", () => {
  assert.equal(labSourcePage("p12-r18"), 12);
  assert.equal(labSourcePage("page-12-r18"), 12);
  assert.equal(labSourcePage("image-r1"), 0);
});

test("remapVisualPages reasigna el índice del sub-PDF a la página real del documento", () => {
  const row = (sourceSentence: string) => ({ sourceSentence } as LabCandidate);
  // El sub-PDF llevaba las páginas 3 y 5 del original como page-1 y page-2.
  const rows = [row("page-1-r2 | Glucosa | 90"), row("page-2-r7 | Sodio | 140"), row("image-r1 | Potasio | 4.1")];
  remapVisualPages(rows, [3, 5]);
  assert.equal(labSourcePage(rows[0].sourceSentence.split(" | ")[0]), 3);
  assert.equal(labSourcePage(rows[1].sourceSentence.split(" | ")[0]), 5);
  assert.equal(rows[2].sourceSentence, "image-r1 | Potasio | 4.1"); // sin índice de página: intacto
});

test("tolera errores OCR al buscar la fila que debe resaltarse", () => {
  assert.ok(labAnalyteSimilarity("ERITROCPTO", "ERITROCITOS") > .6);
  assert.ok(labAnalyteSimilarity("ERITROCPTO", "ERITROCITOS") > labAnalyteSimilarity("ERITROCPTO", "HEMOGLOBINA"));
});

test("parseLabLayoutPages interpreta columnas OCR y omite el resultado histórico", () => {
  const parsed = parseLabLayoutPages([[
    item("RUT: 18332410-1", 27, 888), item("Centro de Atención:", 183, 888),
    item("Toma de Muestra :", 546, 906), item("16/08/2024 08:44", 668, 906),
    item("Resultado", 235, 730), item("Unidad", 365, 730), item("06/07/2023", 476, 730), item("Valores de Referencia", 589, 730),
    item("GLICEMIA", 35, 679), item("83", 233, 679), item("mg/dL", 365, 679), item("84", 493, 679), item("74 - 99", 667, 679),
  ]]);
  assert.equal(parsed.patientIdentifier, "18332410-1");
  assert.equal(parsed.observations[0].valueNum, 83);
  assert.deepEqual([parsed.observations[0].refLow, parsed.observations[0].refHigh], [74, 99]);
});

test("parseLabLayoutPages acepta informes concatenados con encabezados variables", () => {
  const identity = [
    item("R.u.t. : 18332410-1 Sexo : Masculino", 24, 700),
    item("Paciente : PACIENTE PRUEBA Edad : 30 Año(s)", 24, 686),
    item("Dirección : ejemplo Fec. T. Muestra : 28/06/2024 10:39", 24, 672),
  ];
  const parsed = parseLabLayoutPages([
    [...identity, item("Tipo Muestra : SUERO", 24, 615), item("Examen Resultado Margen Histórico", 30, 576), item("FERRITINA 569.0 * ng/mL 30 - 400", 30, 537)],
    [...identity, item("Tipo Muestra : SUERO-HORMONAS", 24, 615), item("Examen", 30, 576), item("VITAMINA D Total 17.8 ng/mL", 30, 537), item("Rango de Referencia", 30, 488)],
  ]);

  assert.equal(parsed.patientName, "PACIENTE PRUEBA");
  assert.equal(parsed.patientIdentifier, "18332410-1");
  assert.equal(parsed.observedAt, "2024-06-28");
  assert.equal(parsed.needsAi, false);
  assert.deepEqual(parsed.observations.map(({ analyte, valueNum, unit, flag, specimen }) => ({ analyte, valueNum, unit, flag, specimen })), [
    { analyte: "FERRITINA", valueNum: 569, unit: "ng/mL", flag: "abnormal", specimen: "Suero" },
    { analyte: "VITAMINA D Total", valueNum: 17.8, unit: "ng/mL", flag: "", specimen: "Suero" },
  ]);
});

test("parseLabLayoutPages conserva resultados textuales de orina en formato de dos columnas", () => {
  const page = [
    item("EXAMEN", 28, 524), item("RESULTADO", 185, 524),
    item("Muestra: Orina", 28, 490),
    item("ANALISIS MICROSCOPICO:", 28, 456),
    item("Leucocitos", 28, 434), item("0 - 2.", 179, 434),
    item("Cristales", 28, 411), item("Uratos amorfos muy abundante.", 179, 411),
    item("Densidad", 28, 321), item("1.035", 179, 321), item("*", 538, 321),
    item("Nitritos", 28, 298), item("Negativo", 179, 298),
    item("EXAMEN VALIDADO POR PROFESIONAL", 42, 78),
  ];

  const parsed = parseLabLayoutPages([page]);
  assert.equal(parsed.needsAi, false);
  assert.deepEqual(parsed.observations.map(({ analyte, valueNum, valueText, flag, specimen }) => ({ analyte, valueNum, valueText, flag, specimen })), [
    { analyte: "Leucocitos", valueNum: null, valueText: "0 - 2.", flag: "", specimen: "Orina" },
    { analyte: "Cristales", valueNum: null, valueText: "Uratos amorfos muy abundante.", flag: "", specimen: "Orina" },
    { analyte: "Densidad", valueNum: 1.035, valueText: "", flag: "abnormal", specimen: "Orina" },
    { analyte: "Nitritos", valueNum: null, valueText: "Negativo", flag: "", specimen: "Orina" },
  ]);
  assert.match(parsed.observations[0].sourceSentence, /Muestra: Orina \| Panel: Sedimento urinario$/);
});

test("ubica el valor en columnas y en una fila monoespaciada", () => {
  assert.deepEqual(labSourceHighlight([item("8.4", 145, 578)], "8.4"), { x: 145, y: 578, width: 15, height: 10 });
  const box = labSourceHighlight([item("Colesterol VLDL 8.4 mg/dL", 30, 500)], "8.4", "Colesterol VLDL");
  assert.ok(box && box.x > 30 && box.width >= 12);
  const b12 = labSourceHighlight([item("Vitamina B12 12 pg/mL", 30, 480)], "12", "Vitamina B12");
  assert.ok(b12 && b12.x > 30 + "Vitamina B12".length * 5);
});

test("conserva la bandera, excluye el histórico y reconoce la muestra del hemograma", () => {
  const parsed = parseLabLayoutPages([[
    item("HEMOGRAMA", 30, 700),
    item("Resultado", 145, 640), item("Unidad", 240, 640), item("Valores de Referencia", 300, 640), item("Resultados Históricos", 450, 640),
    item("ERITROCITOS", 30, 610), item("4.42 <", 145, 610), item("x 10^6/uL", 240, 610), item("4.9 - 5.7", 300, 610), item("4.91", 450, 610),
  ]]);
  assert.deepEqual(parsed.observations.map(({ analyte, valueNum, unit, refLow, refHigh, flag, specimen }) => ({ analyte, valueNum, unit, refLow, refHigh, flag, specimen })), [
    { analyte: "ERITROCITOS", valueNum: 4.42, unit: "x 10^6/uL", refLow: 4.9, refHigh: 5.7, flag: "low", specimen: "Sangre total" },
  ]);
});

test("recupera unidades en la línea siguiente y analitos con números", () => {
  const sodium = parseLabLayoutPages([[
    item("Tipo de muestra: Suero", 30, 700),
    item("Resultado", 145, 640), item("Unidad", 240, 640), item("Valores de Referencia", 340, 640),
    item("SODIO", 30, 610), item("134 <", 145, 610), item("137 - 145", 340, 610),
    item("mEg/L", 240, 594),
  ]]);
  assert.deepEqual({ unit: sodium.observations[0].unit, value: sodium.observations[0].valueNum, flag: sodium.observations[0].flag, specimen: sodium.observations[0].specimen },
    { unit: "mEq/L", value: 134, flag: "low", specimen: "Suero" });

  const ocrUnits = parseLabLayoutPages([[
    item("Tipo de muestra: Suero", 30, 700),
    item("Resultado", 145, 640), item("Unidad", 240, 640), item("Valores de Referencia", 340, 640),
    item("TESTOSTERONA TOTAL", 30, 610), item("27.8", 145, 610), item("nmol/", 240, 610), item("4.6 - 28.2", 340, 610),
    item("SODIO", 30, 580), item("134", 145, 580), item("mEqg/L", 240, 580), item("137 - 145", 340, 580),
  ]]);
  assert.deepEqual(ocrUnits.observations.map((row) => row.unit), ["nmol/L", "mEq/L"]);

  const loose = parseLabLayoutPages([[
    item("Tipo de muestra: Suero", 30, 700), item("Unidad", 300, 640),
    item("VITAMINA B12", 30, 610), item("394", 200, 610), item("pg/mL", 300, 610),
    item("V.F.G. Estimado", 30, 580), item("Mayor de 60", 200, 580), item("mL/min", 300, 580),
  ]]);
  assert.deepEqual(loose.observations.map(({ analyte, valueNum, valueText, unit }) => ({ analyte, valueNum, valueText, unit })), [
    { analyte: "VITAMINA B12", valueNum: 394, valueText: "", unit: "pg/mL" },
    { analyte: "V.F.G. Estimado", valueNum: null, valueText: "> 60", unit: "mL/min" },
  ]);
});

test("descarta filas administrativas y referencias confundidas con analitos", () => {
  const row = (analyte: string, valueNum: number | null, valueText: string, unit: string) => ({
    analyte, valueNum, valueText, unit, refLow: null, refHigh: null, refText: "", flag: "" as const,
    observedAt: "2026-05-07", sourceSentence: `p1-r1 | ${analyte} | ${valueNum ?? valueText}`, source: "ocr" as const,
  });
  const clean = dedupeLabCandidates([
    row("Paciente", 5173440, "", "R.u.t."), row("Fono", 48624837, "", "Fec. Solicitud"),
    row("1339.0 mg/dL", 650, "", "-1600.0"), row("Conclusión del trazado", null, "normal", ""),
    row("25 OH VITAMINA D", 26.8, "", "ng/mL"),
  ]);
  assert.deepEqual(clean.map((item) => item.analyte), ["25 OH VITAMINA D"]);
});

test("conserva el contexto de electroforesis para homologar sus fracciones", () => {
  const parsed = parseLabLayoutPages([[
    item("ELECTROFORESIS DE PROTEÍNAS", 30, 700), item("Tipo de muestra: Suero", 30, 680),
    item("Resultado", 145, 640), item("Unidad", 240, 640), item("Valores de Referencia", 340, 640),
    item("Alfa-1", 30, 610), item("0.30", 145, 610), item("g/dL", 240, 610), item("0.2 - 0.4", 340, 610),
  ]]);
  assert.match(parsed.observations[0].sourceSentence, /Panel: Electroforesis de proteínas$/);
});
