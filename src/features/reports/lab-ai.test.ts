import assert from "node:assert/strict";
import test from "node:test";
import type { StructuredTextItem } from "unpdf";
import { labPatientMatches, parseLabLayoutPages } from "./lab-ai.ts";

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
