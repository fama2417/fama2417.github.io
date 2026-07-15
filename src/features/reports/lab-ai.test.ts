import assert from "node:assert/strict";
import test from "node:test";
import type { StructuredTextItem } from "unpdf";
import { labPatientMatches, loincSearchQueries, parseLabLayoutPages, verifiedLabLoinc } from "./lab-ai.ts";

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
