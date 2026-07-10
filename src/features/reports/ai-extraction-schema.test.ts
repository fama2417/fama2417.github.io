import assert from "node:assert/strict";
import test from "node:test";
import { parseAiExtractionResponse, publicAiError } from "./ai-extraction.ts";
import { AiFindingExtractionResultSchema, detectReportingProfile, finalizeClinicalSummary, guardClinicalSummaryWithoutImpression, parseStoredAiClinicalSummary } from "./ai-extraction-schema.ts";

const valid = {
  reportLanguage: "es",
  procedureContext: { modality: "CT", bodyRegion: "abdomen", suggestedReportingGroup: "CT_ABDOMEN_PELVIS", confidence: 0.8 },
  clinicalSummary: {
    reportingProfile: "CT_ABDOMEN_PELVIS",
    modalityContext: "CT",
    clinicalContext: null,
    oncologyContext: null,
    globalResponse: null,
    globalAssessment: { status: "not_applicable", text: "Colelitiasis.", confidence: 0.9 },
    scores: [],
    primarySummaryItems: [{
      title: "Colelitiasis", summary: "Colelitiasis sin complicaciones.", category: "active_disease", sites: ["vesicula"],
      trend: "not_applicable", sourceSection: "impression", sourceSentences: ["Colelitiasis."], confidence: 0.9,
    }],
    activeDiseaseSites: ["vesicula"],
    resolvedSites: [],
    stableSites: [],
    incidentalFindings: [],
    qualityWarnings: [],
    clinicalTags: [],
    lesionTracking: [],
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

test("detecta perfil y discordancia entre prestacion y contenido", () => {
  assert.equal(detectReportingProfile({ reportingGroupCode: "CT_CHEST", procedureName: "TC torax", findings: "Nodulo pulmonar." }).profile, "CT_CHEST");
  assert.equal(detectReportingProfile({ reportingGroupCode: "NM_PET_CT", modality: "NM" }).profile, "PET_CT_ONCOLOGY");
  assert.equal(detectReportingProfile({ modality: "MG" }).profile, "BREAST_IMAGING");
  const mismatch = detectReportingProfile({ procedureName: "RM cerebro", modality: "MR", findings: "TC de abdomen y pelvis con colelitiasis." });
  assert.equal(mismatch.profile, "MR_BRAIN");
  assert.equal(mismatch.contentProfile, "CT_ABDOMEN_PELVIS");
  assert.equal(mismatch.mismatch?.type, "procedure_content_mismatch");
});

test("deriva QA y tags clinicas sin romper resumen antiguo", () => {
  const oldSummary = parseStoredAiClinicalSummary({
    modalityContext: "PET-CT", clinicalContext: null,
    globalAssessment: { status: "progression", text: "Progresion metabolica.", confidence: 0.55 },
    scores: [{ name: "Deauville", value: "5", sourceSentence: "Deauville 5.", confidence: 0.9 }],
    primarySummaryItems: [], warnings: [],
  });
  const finalized = finalizeClinicalSummary(oldSummary, { hasImpression: false, profile: "PET_CT_ONCOLOGY" });
  assert.equal(finalized.globalResponse?.status, "indeterminate");
  assert.equal(finalized.qualityWarnings.some((warning) => warning.type === "missing_impression"), true);
  assert.deepEqual(finalized.clinicalTags.sort(), ["deauville_5", "missing_impression", "oncology", "report_quality_warning"].sort());
});

test("parsea respuesta IA desde output_text y oculta errores crudos", () => {
  assert.deepEqual(parseAiExtractionResponse({ output_parsed: null, output_text: JSON.stringify(valid) }), valid);
  assert.equal(publicAiError(new Error('[{"code":"invalid_type"}]')), "No fue posible interpretar la respuesta estructurada de IA.");
});

test("sin impresion ni comparacion evita declarar progresion", () => {
  const summary = AiFindingExtractionResultSchema.parse(valid).clinicalSummary;
  const guarded = guardClinicalSummaryWithoutImpression({ ...summary, globalAssessment: { status: "progression", text: "Progresion tumoral.", confidence: 0.9 } }, false);
  assert.equal(guarded.globalAssessment.status, "indeterminate");
  assert.equal(guarded.globalAssessment.confidence, 0.59);
  assert.match(guarded.warnings[0], /Resumen generado desde Hallazgos/);

  const compared = guardClinicalSummaryWithoutImpression({ ...summary, primarySummaryItems: [{ ...summary.primarySummaryItems[0], sourceSentences: ["Aumento respecto al estudio previo."] }] }, false);
  assert.equal(compared.globalAssessment.status, "not_applicable");
});
