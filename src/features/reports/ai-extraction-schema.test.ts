import assert from "node:assert/strict";
import test from "node:test";
import { parseAiExtractionResponse, publicAiError } from "./ai-extraction.ts";
import { AiFindingExtractionResultSchema } from "./ai-extraction-schema.ts";

const valid = {
  reportLanguage: "es",
  procedureContext: { modality: "CT", bodyRegion: "abdomen", suggestedReportingGroup: "CT_ABDOMEN_PELVIS", confidence: 0.8 },
  clinicalSummary: {
    modalityContext: "CT",
    clinicalContext: null,
    globalAssessment: { status: "not_applicable", text: "Colelitiasis.", confidence: 0.9 },
    scores: [],
    primarySummaryItems: [{
      title: "Colelitiasis", summary: "Colelitiasis sin complicaciones.", category: "active_disease", sites: ["vesicula"],
      trend: "not_applicable", sourceSection: "impression", sourceSentences: ["Colelitiasis."], confidence: 0.9,
    }],
    warnings: [],
  },
  findings: [{
    findingText: "Colelitiasis.",
    canonicalName: "Colelitiasis",
    status: "present",
    importance: "principal",
    bodySite: "vesicula",
    laterality: null,
    severity: null,
    sourceSection: "impression",
    sourceSentence: "Colelitiasis.",
    isNegated: false,
    isUncertain: false,
    isHistorical: false,
    shouldCreateDictionaryCandidate: false,
    confidence: 0.9,
  }],
  overallConfidence: 0.9,
  warnings: [],
};

test("valida salida estructurada de IA", () => {
  assert.equal(AiFindingExtractionResultSchema.safeParse(valid).success, true);
  assert.equal(AiFindingExtractionResultSchema.safeParse({ ...valid, findings: [{ ...valid.findings[0], findingText: "" }] }).success, false);
  assert.equal(AiFindingExtractionResultSchema.safeParse({ ...valid, clinicalSummary: { ...valid.clinicalSummary, primarySummaryItems: Array(9).fill(valid.clinicalSummary.primarySummaryItems[0]) } }).success, false);
});

test("parsea respuesta IA desde output_text y oculta errores crudos", () => {
  assert.deepEqual(parseAiExtractionResponse({ output_parsed: null, output_text: JSON.stringify(valid) }), valid);
  assert.equal(publicAiError(new Error('[{"code":"invalid_type"}]')), "No fue posible interpretar la respuesta estructurada de IA.");
});
