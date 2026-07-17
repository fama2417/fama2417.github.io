import assert from "node:assert/strict";
import test from "node:test";
import type { StructuredTextItem } from "unpdf";
import { labPatientMatches, labSourceHighlight, loincSearchQueries, parseLabLayoutPages, shouldUseAiForScannedPdf, verifiedLabLoinc } from "./lab-ai.ts";
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
});

test("OCR reutiliza páginas rasterizadas repetidas y limita el reescalado", () => {
  const page = new Uint8Array([1, 2, 3]);
  assert.equal(ocrImageKey(page, 831, 998, 3), ocrImageKey(page, 831, 998, 3));
  assert.notEqual(ocrImageKey(page, 831, 998, 3), ocrImageKey(page, 832, 998, 3));
  assert.equal(ocrTargetWidth(831), 2493);
  assert.equal(ocrTargetWidth(2400), 2500);
});

test("sólo deriva a reconocimiento visual los PDF escaneados extensos", () => {
  assert.equal(shouldUseAiForScannedPdf(false, 13), false);
  assert.equal(shouldUseAiForScannedPdf(true, 3), false);
  assert.equal(shouldUseAiForScannedPdf(true, 4), true);
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
  assert.match(parsed.observations[0].sourceSentence, /Muestra: Orina$/);
});

test("ubica el valor en columnas y en una fila monoespaciada", () => {
  assert.deepEqual(labSourceHighlight([item("8.4", 145, 578)], "8.4"), { x: 145, y: 578, width: 15, height: 10 });
  const box = labSourceHighlight([item("Colesterol VLDL 8.4 mg/dL", 30, 500)], "8.4", "Colesterol VLDL");
  assert.ok(box && box.x > 30 && box.width >= 12);
  const b12 = labSourceHighlight([item("Vitamina B12 12 pg/mL", 30, 480)], "12", "Vitamina B12");
  assert.ok(b12 && b12.x > 30 + "Vitamina B12".length * 5);
});
