import assert from "node:assert/strict";
import test from "node:test";
import { buildPhrLabTrend, phrLabDisplayName, phrLabDraftOf, phrLabTrendKey, phrLoincDecision, phrSpecimenLabel, reusedPhrLoinc, reviewPhrLabIdentity, validatePhrLabDraft, vettedPhrLabIdentity, type PhrLabResult } from "./labs.ts";

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
  assert.equal(vettedPhrLabIdentity({ analyte: "% Saturación de Transferrin", unit: "%" })?.code, "2502-3");
  assert.equal(vettedPhrLabIdentity({ analyte: "SATURACION TRANSFERRINA", unit: "%" })?.trendKey, "iron-saturation");
  assert.equal(vettedPhrLabIdentity({ analyte: "Glicemia Media Estimada", unit: "mg/dL" })?.code, "27353-2");
  assert.equal(vettedPhrLabIdentity({ analyte: "Glucosa" }), null);
  assert.equal(vettedPhrLabIdentity({ analyte: "GLICEMIA", unit: "mg/dL", specimen: "Suero" })?.code, "2345-7");
  assert.equal(vettedPhrLabIdentity({ analyte: "GLICEMIA", unit: "mg/dL", specimen: "Orina" }), null);
  assert.equal(vettedPhrLabIdentity({ analyte: "Vitamina D Total", unit: "ng/mL", specimen: "Orina" }), null);
  assert.equal(phrLabTrendKey({ analyte: "TSH", loincCode: "3016-3", unit: "mIU/L" }), "tsh");
  assert.equal(phrLabTrendKey({ analyte: "T4 LIBRE", loincCode: "3024-7", unit: "ng/dL" }), "free-t4");
});

test("corrige alias OCR y evita códigos de otra propiedad o muestra", () => {
  const cases = [
    ["ERIMROCITOS", "x 10^6/uL", "789-8"], ["C.H.C.M.", "gr/dL", "786-4"],
    ["CREATININEMIA", "mg/dL", "2160-0"], ["URENIA", "mg/dL", "3091-6"],
    ["N UREICO", "mg/dL", "3094-0"], ["TSH Ultrasensible", "miIU/L", "3016-3"],
    ["INSULINA", "uU/mL", "20448-7"], ["PROTEINAS TOTALES", "gr/dL", "2885-2"],
    ["Colesterol LDL", "mg/dL", "2089-1"], ["Ind.Col.total/Col.HDL", "", "9830-1"],
    ["R.D.W.", "%", "30385-9"], ["BACILIFORMES NEUT", "%", "26508-2"],
    ["VHS", "mm/hr", "30341-2"], ["TROPONINA I", "ug/L", "10839-9"],
    ["TESTOSTERONA TOTAL", "nmol/L", "14913-8"], ["CORTISOL", "nmol/L", "14675-3"],
  ] as const;
  cases.forEach(([analyte, unit, code]) => assert.equal(vettedPhrLabIdentity({ analyte, unit })?.code, code, analyte));
  assert.equal(vettedPhrLabIdentity({ analyte: "LDH", unit: "U/L" }), null);
  assert.equal(vettedPhrLabIdentity({ analyte: "Glucosa", unit: "mg/dL", specimen: "Orina" }), null);
  assert.equal(vettedPhrLabIdentity({ analyte: "Glucosa", unit: "", specimen: "Orina", valueText: "Negativo" })?.code, "2349-9");
  assert.equal(vettedPhrLabIdentity({ analyte: "Cetonas", unit: "", specimen: "Orina", valueText: "Indicio" })?.code, "33903-6");
  assert.equal(vettedPhrLabIdentity({ analyte: "pH", specimen: "Orina" })?.code, "2756-5");
  assert.equal(vettedPhrLabIdentity({ analyte: "Aspecto", specimen: "Orina", valueText: "Muy turbio" })?.code, "5767-9");
  assert.equal(vettedPhrLabIdentity({ analyte: "Leucocitos", unit: "", specimen: "Orina", valueText: "0 - 2." }), null);
  assert.equal(vettedPhrLabIdentity({ analyte: "GLOBULOS ROJOS", specimen: "Sangre total", valueText: "Normales." })?.code, "6742-1");
  assert.equal(vettedPhrLabIdentity({ analyte: "PLAQUETAS", specimen: "Sangre total", valueText: "Normales." })?.code, "11125-2");
});

test("usa el contexto del panel para no confundir fracciones de electroforesis", () => {
  const context = "p16-r21 | Alfa-1 | 0.30 | g/dL | Muestra: Suero | Panel: Electroforesis de proteínas";
  assert.equal(vettedPhrLabIdentity({ analyte: "Alfa-1", unit: "g/dL", specimen: "Suero", sourceSentence: context })?.code, "2865-4");
  assert.equal(vettedPhrLabIdentity({ analyte: "Gamma", unit: "g/dL", specimen: "Suero", sourceSentence: context })?.code, "2874-6");
  assert.equal(vettedPhrLabIdentity({ analyte: "Alfa-1", unit: "g/dL", specimen: "Suero" }), null);
  assert.equal(vettedPhrLabIdentity({ analyte: "VFG CKD-EPI RAZA BLANCA", specimen: "Suero" })?.code, "88294-4");
  assert.equal(vettedPhrLabIdentity({ analyte: "VFG MDRD-IDMS RAZA NEGRA", specimen: "Suero" })?.code, "48643-1");
});

test("deja amarillas las equivalencias con unidad o alias implícito", () => {
  const context = "p33-r21 | Leucocitos | 0 - 2. | Muestra: Orina | Panel: Sedimento urinario";
  assert.equal(reviewPhrLabIdentity({ analyte: "Leucocitos", specimen: "Orina", valueText: "0 - 2.", sourceSentence: context })?.code, "105104-4");
  assert.equal(reviewPhrLabIdentity({ analyte: "Glob.rojos", specimen: "Orina", valueText: "0 - 2.", sourceSentence: context })?.code, "105107-7");
  assert.equal(reviewPhrLabIdentity({ analyte: "JUVENILES NEUT", unit: "%", specimen: "Sangre total" })?.code, "28541-1");
  assert.equal(reviewPhrLabIdentity({ analyte: "Desh.Láctica Total(LDH)", unit: "U/L" })?.code, "32324-6");
  assert.equal(reviewPhrLabIdentity({ analyte: "LDH", unit: "U/L", specimen: "Suero" })?.code, "32324-6");
  assert.equal(reviewPhrLabIdentity({ analyte: "Desh.Láctica Total(LDH)", unit: "U/L", specimen: "Orina" }), null);
});

test("separa nombre original, nombre canónico y confianza de homologación", () => {
  assert.equal(phrLabDisplayName({ analyte: "ERITROCPTO", canonicalAnalyte: "Eritrocitos en sangre" }), "Eritrocitos en sangre");
  assert.deepEqual(phrLoincDecision(.96, .72), { confidence: .9, status: "matched" });
  assert.deepEqual(phrLoincDecision(.72, .5), { confidence: .67, status: "review" });
});

test("phrLabDisplayName muestra el componente LOINC, no los cinco ejes técnicos", () => {
  // El nombre completo LOINC trae componente + ejes tras el primer ":"; se muestra solo el componente.
  assert.equal(phrLabDisplayName({ analyte: "C.H.C.M.", loincCode: "788-4", canonicalAnalyte: "Concentración media de hemoglobina corpuscular en eritrocitos: Eritrocitos. Punto temporal. Concentración de masa. Cuantitativo" }), "Concentración media de hemoglobina corpuscular en eritrocitos");
  // Sin homologar cae al nombre del informe.
  assert.equal(phrLabDisplayName({ analyte: "TSH", canonicalAnalyte: "" }), "TSH");
  // Override curado por código LOINC gana sobre el componente para los índices del hemograma.
  assert.equal(phrLabDisplayName({ analyte: "C.H.C.M.", loincCode: "786-4", canonicalAnalyte: "Concentración media de hemoglobina corpuscular en eritrocitos: Eritrocitos. Cuantitativo" }), "Concentración de hemoglobina corpuscular media (CHCM)");
});
