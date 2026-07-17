import assert from "node:assert/strict";
import test from "node:test";
import { comparableLabTrend, convertLabValue, labCategory, labFlag, labTrendKey, type LabObservation } from "./lab-observations.ts";

test("labFlag deriva low/high/normal dentro del rango", () => {
  assert.equal(labFlag(3, 4, 10), "low");
  assert.equal(labFlag(12, 4, 10), "high");
  assert.equal(labFlag(7, 4, 10), "normal");
  assert.equal(labFlag(4, 4, 10), "normal"); // límite inferior inclusivo
  assert.equal(labFlag(10, 4, 10), "normal"); // límite superior inclusivo
});

test("labFlag no evalúa sin valor numérico ni sin ningún límite", () => {
  assert.equal(labFlag(null, 4, 10), "");
  assert.equal(labFlag(NaN, 4, 10), "");
  assert.equal(labFlag(7, null, null), "");
});

test("labFlag funciona con un solo límite", () => {
  assert.equal(labFlag(2, 4, null), "low");
  assert.equal(labFlag(7, 4, null), "normal");
  assert.equal(labFlag(20, null, 10), "high");
});

test("labTrendKey prefiere LOINC y cae al analito normalizado", () => {
  assert.equal(labTrendKey({ loincCode: "718-7", analyte: "Hemoglobina" }), "718-7");
  assert.equal(labTrendKey({ loincCode: "", analyte: "  Hemoglobina " }), "hemoglobina");
});

test("categoriza con metadatos LOINC antes que con la etiqueta local", () => {
  assert.equal(labCategory({ analyte: "GLICEMIA", loincMetadata: { component: "Glucose^fasting", property: "MCnc", timeAspect: "Pt", specimen: "Ser/Plas", scaleType: "Qn", methodType: "", className: "CHEM", status: "ACTIVE", exampleUcumUnits: "mg/dL" } }), "metabolic");
  assert.equal(labCategory({ analyte: "GLUCOSA EN ORINA", loincMetadata: { component: "Glucose", property: "MCnc", timeAspect: "Pt", specimen: "Urine", scaleType: "Qn", methodType: "", className: "UA", status: "ACTIVE", exampleUcumUnits: "mg/dL" } }), "urine");
});

test("clasifica nombres habituales aunque LOINC todavía esté pendiente", () => {
  assert.equal(labCategory({ analyte: "PROMIELOCITOS" }), "hematology");
  assert.equal(labCategory({ analyte: "Tiempo Protrombina" }), "hematology");
  assert.equal(labCategory({ analyte: "VFG CKD-EPI" }), "renal");
  assert.equal(labCategory({ analyte: "Transaminasa(GPT)" }), "hepatic");
  assert.equal(labCategory({ analyte: "Capacidad fijación fierro" }), "nutrition");
  assert.equal(labCategory({ analyte: "CAPACIDAD FIJACION DE Fe" }), "nutrition");
  assert.equal(labCategory({ analyte: "TROPONINA I" }), "chemistry");
  assert.equal(labCategory({ analyte: "Aspecto", sourceSentence: "p33-r27 | Aspecto | Muy Turb | Muestra: Orina" }), "urine");
});

test("convierte unidades UCUM compatibles sin mezclar masa y cantidad molar", () => {
  assert.equal(convertLabValue(100, "mg/dL", "g/L"), 1);
  assert.equal(convertLabValue(1, "10^3/uL", "10^9/L"), 1);
  assert.equal(convertLabValue(5, "mg/dL", "mmol/L"), null);
});

test("la tendencia exige mismo LOINC y normaliza a la unidad más reciente", () => {
  const observation = (id: string, valueNum: number, unit: string, loincCode = "1558-6"): LabObservation => ({
    id, reportId: null, importId: null, appointmentId: "a", patientId: "p", loincCode, analyte: "Glucosa",
    valueNum, valueText: "", unit, refLow: 70, refHigh: 100, refText: "", flag: "normal",
    observedAt: `2026-07-${id.padStart(2, "0")}`, source: "manual", sourceSentence: "", reviewStatus: "confirmed",
  });
  const trend = comparableLabTrend([observation("2", 100, "mg/dL"), observation("1", 0.9, "g/L"), observation("3", 5, "mmol/L")]);
  assert.deepEqual(trend?.points.map((point) => point.value), [90, 100]);
  assert.equal(comparableLabTrend([observation("2", 100, "mg/dL"), { ...observation("4", 100, "mg/dL"), observedAt: "2026-07-02" }]), null);
});
