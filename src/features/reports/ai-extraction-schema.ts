import { z } from "zod";

const confidence = z.number().min(0).max(1);
const ReportingProfileSchema = z.enum(["PET_CT_ONCOLOGY", "CT_ABDOMEN_PELVIS", "CT_CHEST", "MR_BRAIN", "MR_SPINE", "BREAST_IMAGING", "US_GENERAL", "DX_GENERAL", "UNKNOWN"]);
const QualityWarningTypeSchema = z.enum(["procedure_content_mismatch", "missing_impression", "relevant_finding_not_in_impression", "impression_findings_discordance", "missing_expected_score", "possible_wrong_template", "possible_wrong_study", "insufficient_text", "low_confidence_summary"]);
const ClinicalTagSchema = z.enum(["oncology", "progression", "stable", "resolved_lesions", "deauville_5", "incidental_findings", "follow_up_relevant", "report_quality_warning", "procedure_content_mismatch", "missing_impression"]);

const QualityWarningSchema = z.object({ type: QualityWarningTypeSchema, message: z.string().trim().min(1) }).strict();
const LesionTrackingSchema = z.object({
  label: z.string().trim().min(1),
  site: z.string().trim().min(1),
  currentSize: z.string().trim().nullable(),
  priorSize: z.string().trim().nullable(),
  currentSuv: z.string().trim().nullable(),
  priorSuv: z.string().trim().nullable(),
  sizeTrend: z.enum(["increased", "decreased", "stable", "unknown"]),
  metabolicTrend: z.enum(["increased", "decreased", "stable", "unknown"]),
  sourceSentence: z.string().trim().min(1),
}).strict();

export const AiClinicalSummarySchema = z.object({
  reportingProfile: ReportingProfileSchema,
  modalityContext: z.enum(["PET-CT", "CT", "MR", "US", "DX", "MG", "NM", "UNKNOWN"]),
  clinicalContext: z.string().trim().nullable(),
  oncologyContext: z.object({
    disease: z.string().trim().nullable(),
    priorStudyDate: z.string().trim().nullable(),
    treatmentContext: z.string().trim().nullable(),
  }).strict().nullable(),
  globalResponse: z.object({
    status: z.enum(["progression", "stable", "partial_response", "complete_response", "mixed_response", "indeterminate"]),
    explanation: z.string().trim().min(1),
    confidence,
  }).strict().nullable(),
  globalAssessment: z.object({
    status: z.enum(["progression", "stable", "partial_response", "complete_response", "mixed_response", "indeterminate", "not_applicable"]),
    text: z.string().trim().min(1),
    confidence,
  }).strict(),
  scores: z.array(z.object({
    name: z.enum(["Deauville", "BI-RADS", "PI-RADS", "LI-RADS", "RECIST", "other"]),
    value: z.string().trim().min(1),
    sourceSentence: z.string().trim().min(1),
    confidence,
  }).strict()),
  primarySummaryItems: z.array(z.object({
    title: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    category: z.enum(["active_disease", "progression", "stable_disease", "resolved", "incidental", "negative_relevant", "recommendation", "quality_warning"]),
    sites: z.array(z.string().trim().min(1)),
    trend: z.enum(["new", "progression", "stable", "decreased", "resolved", "unknown", "not_applicable"]),
    sourceSection: z.enum(["impression", "findings", "both"]),
    sourceSentences: z.array(z.string().trim().min(1)).min(1),
    confidence,
  }).strict()).max(8),
  activeDiseaseSites: z.array(z.string().trim().min(1)),
  resolvedSites: z.array(z.string().trim().min(1)),
  stableSites: z.array(z.string().trim().min(1)),
  incidentalFindings: z.array(z.string().trim().min(1)),
  qualityWarnings: z.array(QualityWarningSchema),
  clinicalTags: z.array(ClinicalTagSchema),
  lesionTracking: z.array(LesionTrackingSchema),
  warnings: z.array(z.string()),
}).strict();

export const AiFindingSchema = z.object({
  findingText: z.string().trim().min(1),
  canonicalName: z.string().trim().min(1),
  status: z.enum(["present", "absent", "uncertain", "history", "recommendation"]),
  importance: z.enum(["principal", "secondary", "incidental", "negative", "not_relevant"]),
  bodySite: z.string().trim().nullable(),
  laterality: z.enum(["left", "right", "bilateral", "midline", "unknown"]).nullable(),
  severity: z.enum(["mild", "moderate", "severe", "unknown"]).nullable(),
  sourceSection: z.enum(["findings", "impression", "clinical_indication"]),
  sourceSentence: z.string().trim().min(1),
  isNegated: z.boolean(),
  isUncertain: z.boolean(),
  isHistorical: z.boolean(),
  shouldCreateDictionaryCandidate: z.boolean(),
  confidence,
}).strict();

export const AiFindingExtractionResultSchema = z.object({
  reportLanguage: z.enum(["es", "en", "mixed", "unknown"]),
  procedureContext: z.object({
    modality: z.string(),
    bodyRegion: z.string().nullable(),
    suggestedReportingGroup: z.string().nullable(),
    confidence,
  }).strict(),
  clinicalSummary: AiClinicalSummarySchema,
  findings: z.array(AiFindingSchema),
  overallConfidence: confidence,
  warnings: z.array(z.string()),
}).strict();

export type AiFinding = z.infer<typeof AiFindingSchema>;
export type AiClinicalSummary = z.infer<typeof AiClinicalSummarySchema>;
export type AiFindingExtractionResult = z.infer<typeof AiFindingExtractionResultSchema>;
export type ReportingProfile = z.infer<typeof ReportingProfileSchema>;

const NO_IMPRESSION_WARNING = "Resumen generado desde Hallazgos. No se detectó sección Impresión/Conclusión.";
const INDETERMINATE_WITHOUT_IMPRESSION = "Hallazgos compatibles con enfermedad activa/secundaria, sin poder determinar progresión por falta de impresión o comparación.";

export function guardClinicalSummaryWithoutImpression(summary: AiClinicalSummary, hasImpression: boolean) {
  if (hasImpression) return summary;
  const sourceText = summary.primarySummaryItems.flatMap((item) => item.sourceSentences).join(" ");
  const hasComparison = /compar|respecto|previo|aument|increment|disminu|reducci|nuevo|progres|regres|sin cambios|estable/i.test(sourceText);
  return {
    ...summary,
    globalAssessment: hasComparison ? summary.globalAssessment : {
      status: "indeterminate" as const,
      text: INDETERMINATE_WITHOUT_IMPRESSION,
      confidence: Math.min(summary.globalAssessment.confidence, 0.59),
    },
    warnings: summary.warnings.includes(NO_IMPRESSION_WARNING)
      ? summary.warnings
      : [NO_IMPRESSION_WARNING, ...summary.warnings],
  };
}

const profileFromText = (value: string): ReportingProfile => {
  const text = value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  if (/pet[- _/]?ct|deauville|suv|max.*captacion|hipermetabol/.test(text)) return "PET_CT_ONCOLOGY";
  if (/ct_abdomen_pelvis|t[co].*abdomen.*pelvis|abdomen.*pelvis/.test(text)) return "CT_ABDOMEN_PELVIS";
  if (/ct_chest|t[co].*torax|pulmonar|mediastin/.test(text)) return "CT_CHEST";
  if (/mr_brain|r[mm].*(cerebro|encefalo|craneo)|parenquima cerebral/.test(text)) return "MR_BRAIN";
  if (/mr_spine|r[mm].*columna|medula espinal|vertebral/.test(text)) return "MR_SPINE";
  if (/mama|mamograf|bi-?rads/.test(text)) return "BREAST_IMAGING";
  if (/ecograf|ultrason|doppler|\bus\b/.test(text)) return "US_GENERAL";
  if (/radiograf|rayos x|\bdx\b/.test(text)) return "DX_GENERAL";
  return "UNKNOWN";
};

export function detectReportingProfile(input: { reportingGroupCode?: string | null; modality?: string | null; procedureName?: string | null; findings?: string | null; impression?: string | null }) {
  const modalityFallback: Partial<Record<string, ReportingProfile>> = { MG: "BREAST_IMAGING", US: "US_GENERAL", DX: "DX_GENERAL" };
  const registered = profileFromText(`${input.reportingGroupCode ?? ""} ${input.procedureName ?? ""}`) || "UNKNOWN";
  const registeredProfile = registered === "UNKNOWN" ? modalityFallback[(input.modality ?? "").toUpperCase()] ?? "UNKNOWN" : registered;
  const content = profileFromText(`${input.findings ?? ""} ${input.impression ?? ""}`);
  const profile = registeredProfile === "UNKNOWN" ? content : registeredProfile;
  const profileNames: Record<ReportingProfile, string> = { PET_CT_ONCOLOGY: "PET-CT oncológico", CT_ABDOMEN_PELVIS: "TC abdomen/pelvis", CT_CHEST: "TC tórax", MR_BRAIN: "RM cerebro", MR_SPINE: "RM columna", BREAST_IMAGING: "imagen mamaria", US_GENERAL: "ecografía", DX_GENERAL: "radiografía", UNKNOWN: "estudio no determinado" };
  const mismatch = registeredProfile !== "UNKNOWN" && content !== "UNKNOWN" && registeredProfile !== content
    ? { type: "procedure_content_mismatch" as const, message: `Posible discordancia: prestación registrada ${input.procedureName || profileNames[registeredProfile]}, pero contenido compatible con ${profileNames[content]}.` }
    : null;
  return { profile, contentProfile: content, mismatch };
}

const storedSummaryDefaults = {
  reportingProfile: "UNKNOWN" as const,
  oncologyContext: null,
  globalResponse: null,
  activeDiseaseSites: [],
  resolvedSites: [],
  stableSites: [],
  incidentalFindings: [],
  qualityWarnings: [],
  clinicalTags: [],
  lesionTracking: [],
};

export const parseStoredAiClinicalSummary = (value: unknown) => AiClinicalSummarySchema.parse({ ...storedSummaryDefaults, ...(value as Record<string, unknown>) });

export function finalizeClinicalSummary(summary: AiClinicalSummary, options: { hasImpression: boolean; profile: ReportingProfile; mismatch?: { type: "procedure_content_mismatch"; message: string } | null }) {
  const guarded = guardClinicalSummaryWithoutImpression(summary, options.hasImpression);
  const qualityWarnings = [...guarded.qualityWarnings];
  const addWarning = (warning: z.infer<typeof QualityWarningSchema>) => {
    if (!qualityWarnings.some((item) => item.type === warning.type && item.message === warning.message)) qualityWarnings.push(warning);
  };
  if (!options.hasImpression) addWarning({ type: "missing_impression", message: "No se detectó sección Impresión/Conclusión. Resumen generado desde Hallazgos, menor confianza." });
  if (guarded.globalAssessment.confidence < 0.6) addWarning({ type: "low_confidence_summary", message: "Resumen clínico de baja confianza; requiere revisión." });
  if (options.mismatch) addWarning(options.mismatch);

  const globalResponse = guarded.globalResponse ?? (options.profile === "PET_CT_ONCOLOGY" ? {
    status: guarded.globalAssessment.status === "not_applicable" ? "indeterminate" as const : guarded.globalAssessment.status,
    explanation: guarded.globalAssessment.text,
    confidence: guarded.globalAssessment.confidence,
  } : null);
  const tags = new Set(guarded.clinicalTags);
  if (options.profile === "PET_CT_ONCOLOGY" || guarded.oncologyContext?.disease) tags.add("oncology");
  const response = globalResponse?.status ?? guarded.globalAssessment.status;
  if (response === "progression") tags.add("progression");
  if (response === "stable") tags.add("stable");
  if (guarded.resolvedSites.length) tags.add("resolved_lesions");
  if (guarded.incidentalFindings.length) tags.add("incidental_findings");
  if (guarded.lesionTracking.length || guarded.oncologyContext?.priorStudyDate || ["progression", "stable", "partial_response", "mixed_response"].includes(response)) tags.add("follow_up_relevant");
  if (guarded.scores.some((score) => score.name === "Deauville" && /(^|\D)5(\D|$)/.test(score.value))) tags.add("deauville_5");
  if (qualityWarnings.length) tags.add("report_quality_warning");
  if (qualityWarnings.some((warning) => warning.type === "procedure_content_mismatch")) tags.add("procedure_content_mismatch");
  if (!options.hasImpression) tags.add("missing_impression");

  return { ...guarded, reportingProfile: options.profile, globalResponse, qualityWarnings, clinicalTags: [...tags] };
}

export const AiFindingExtractionJsonSchema = z.toJSONSchema(AiFindingExtractionResultSchema) as Record<string, unknown>;
