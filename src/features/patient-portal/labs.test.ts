import assert from "node:assert/strict";
import test from "node:test";
import { buildPhrLabTrend, phrLabDisplayName, phrLabDraftOf, phrLabTrendKey, phrLoincDecision, phrSpecimenLabel, reusedPhrLoinc, validatePhrLabDraft, vettedPhrLabIdentity, type PhrLabResult } from "./labs.ts";

const row = (id: string, date: string, value: number, unit = "mg/dL", status: PhrLabResult["reviewStatus"] = "confirmed"): PhrLabResult => ({
  id, documentId: id, analyte: "Glucosa", loincCode: "", valueNum: value, valueText: "", unit,
  refLow: 70, refHigh: 99, refText: "", flag: "normal", observedAt: date, source: "ocr", reviewStatus: status,
});

test("valida una corrección de laboratorio y deriva su bandera", () => {
  const parsed = validatePhrLabDraft({ analyte: " Glucosa ", value: "110", unit: "mg/dL", reference: "70 - 99", observedAt: "2026-07-01" });
  assert.ok("value" in parsed);
  assert.deepEqual(parsed.value, { analyte: "Glucosa", valueNum: 110, valueText: "", unit: "mg/dL", refLow: 70, refHigh: 99, refText: "", flag: "high", observedAt: "2026-07-01" });
});

test("la tendencia personal exige confirmación y unidades compatibles", () => {
  const trend = buildPhrLabTrend([row("a", "2026-05-01", 90), row("b", "2026-06-01", 1, "g/L"), row("c", "2026-07-01", 999, "mmol/L", "suggested")]);
  assert.deepEqual(trend?.points.map(({ date, value }) => ({ date, value })), [{ date: "2026-05-01", value: 0.9 }, { date: "2026-06-01", value: 1 }]);
});

test("conserva referencias de un solo límite al editar", () => {
  const result: PhrLabResult = { id: "a", documentId: "d", analyte: "Colesterol", loincCode: "", valueNum: 180, valueText: "", unit: "mg/dL", refLow: null, refHigh: 200, refText: "", flag: "normal", observedAt: "2026-07-01", source: "ocr", reviewStatus: "suggested" };
  const draft = phrLabDraftOf(result);
  assert.equal(draft.reference, "< 200");
  const parsed = validatePhrLabDraft(draft);
  if ("error" in parsed) assert.fail(parsed.error);
  assert.equal(parsed.value.refHigh, 200);
  assert.equal(parsed.value.flag, "normal");
});

test("reutiliza LOINC confirmado sólo cuando analito y unidad son inequívocos", () => {
  const rows = [row("nuevo", "2026-07-01", 90), { ...row("otro", "2026-07-01", 5), analyte: "TSH", unit: "mUI/L" }];
  const prior = [{ ...row("previo", "2026-01-01", 92), analyte: "GLÚCOSA", unit: "MG/DL", loincCode: "2345-7" }];
  assert.deepEqual([...reusedPhrLoinc(rows, prior)], [[0, "2345-7"]]);
});

test("presenta la muestra LOINC sin inventarla cuando falta", () => {
  const metadata = { component: "Glucose", property: "MCnc", timeAspect: "Pt", specimen: "Urine", scaleType: "Qn", methodType: "", className: "UA", status: "ACTIVE", exampleUcumUnits: "mg/dL" };
  assert.equal(phrSpecimenLabel(metadata), "Orina");
  assert.equal(phrSpecimenLabel({ ...metadata, specimen: "Ser/Plas" }), "Sangre (suero/plasma)");
  assert.equal(phrSpecimenLabel(undefined, "p33-r31 | Nitritos | Negativo | Muestra: Orina"), "Orina");
  assert.equal(phrSpecimenLabel(undefined, "p20-r19 | Ferremia | 114 | ug/dL | 65 - 175 | Muestra: Suero"), "Sangre (suero/plasma)");
  assert.equal(phrSpecimenLabel(), "Muestra no determinada");
});

test("homologa alias frecuentes sin mezclar mediciones relacionadas", () => {
  assert.equal(vettedPhrLabIdentity({ analyte: "% Saturación de Transferrin" })?.code, "2502-3");
  assert.equal(vettedPhrLabIdentity({ analyte: "SATURACION TRANSFERRINA" })?.trendKey, "iron-saturation");
  assert.equal(vettedPhrLabIdentity({ analyte: "Glicemia Media Estimada" })?.code, "27353-2");
  assert.equal(vettedPhrLabIdentity({ analyte: "Glucosa" }), null);
  assert.equal(vettedPhrLabIdentity({ analyte: "GLICEMIA", unit: "mg/dL", specimen: "Suero" })?.code, "2345-7");
  assert.equal(vettedPhrLabIdentity({ analyte: "GLICEMIA", unit: "mg/dL", specimen: "Orina" }), null);
  assert.equal(vettedPhrLabIdentity({ analyte: "Vitamina D Total", specimen: "Orina" }), null);
  assert.equal(phrLabTrendKey({ analyte: "TSH", loincCode: "24348-5" }), "tsh");
  assert.equal(phrLabTrendKey({ analyte: "T4 LIBRE", loincCode: "24348-5" }), "free-t4");
});

test("separa nombre original, nombre canónico y confianza de homologación", () => {
  assert.equal(phrLabDisplayName({ analyte: "ERITROCPTO", canonicalAnalyte: "Eritrocitos en sangre" }), "Eritrocitos en sangre");
  assert.deepEqual(phrLoincDecision(.96, .72), { confidence: .9, status: "matched" });
  assert.deepEqual(phrLoincDecision(.72, .5), { confidence: .67, status: "review" });
});
