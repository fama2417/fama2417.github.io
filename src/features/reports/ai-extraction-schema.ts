import { z } from "zod";

const confidence = z.number().min(0).max(1);

export const AiClinicalSummarySchema = z.object({
  modalityContext: z.enum(["PET-CT", "CT", "MR", "US", "DX", "MG", "NM", "UNKNOWN"]),
  clinicalContext: z.string().trim().nullable(),
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

export const AiFindingExtractionJsonSchema = z.toJSONSchema(AiFindingExtractionResultSchema) as Record<string, unknown>;
