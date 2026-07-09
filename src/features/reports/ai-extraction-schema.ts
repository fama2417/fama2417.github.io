import { z } from "zod";

const confidence = z.number().min(0).max(1);

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
  findings: z.array(AiFindingSchema),
  overallConfidence: confidence,
  warnings: z.array(z.string()),
}).strict();

export type AiFinding = z.infer<typeof AiFindingSchema>;
export type AiFindingExtractionResult = z.infer<typeof AiFindingExtractionResultSchema>;

export const AiFindingExtractionJsonSchema = z.toJSONSchema(AiFindingExtractionResultSchema) as Record<string, unknown>;
