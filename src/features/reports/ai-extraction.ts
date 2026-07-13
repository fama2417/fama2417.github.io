import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clinicalProfileForCategory } from "../clinical-workspace/profiles.ts";
import { aiConfig, canRunAiExtraction, estimateAiCost, type AiSupabase } from "./ai-budget.ts";
import { AiClinicalDocumentSummaryResultSchema, AiFindingExtractionResultSchema, detectReportingProfile, finalizeClinicalSummary, type AiClinicalSummary } from "./ai-extraction-schema.ts";
import { buildClinicalDocumentSummaryPrompt, buildRadiologyFindingExtractionPrompt, SYSTEM_PROMPT_FOR_CLINICAL_DOCUMENT_SUMMARY, SYSTEM_PROMPT_FOR_RADIOLOGY_FINDING_EXTRACTION } from "./ai-prompts.ts";
import { sanitizeReportForAi } from "./ai-sanitizer.ts";
import { getReportAiSummary, getReportForAiExtraction, insertAiUsageLog, listExtractedFindings, persistAiExtractionResult, saveReportAiSummary } from "./ai-repository.ts";

type Usage = { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };

export class AiStructuredResponseError extends Error {
  constructor() {
    super("No fue posible interpretar la respuesta estructurada de IA.");
  }
}

const usageOf = (response: unknown): Usage => {
  const usage = (response as any)?.usage ?? {};
  return {
    inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? null,
    outputTokens: usage.output_tokens ?? usage.completion_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
  };
};

export const publicAiError = (cause: unknown) => {
  const message = cause instanceof Error ? cause.message : "";
  if (cause instanceof SyntaxError || cause instanceof AiStructuredResponseError || /json|parse|schema|validation|invalid input|invalid_type/i.test(message)) return "No fue posible interpretar la respuesta estructurada de IA.";
  return message || "AI extraction failed";
};

const structuredPayload = (response: unknown) => {
  const parsed = (response as any)?.output_parsed ?? (response as any)?.output?.flatMap((item: any) => item.content ?? []).find((content: any) => content?.parsed)?.parsed;
  if (parsed) return parsed;
  const text = (response as any)?.output_text?.trim();
  if (text) return JSON.parse(text);
  throw new AiStructuredResponseError();
};

export const parseAiExtractionResponse = (response: unknown) => AiFindingExtractionResultSchema.parse(structuredPayload(response));
export const parseAiClinicalDocumentResponse = (response: unknown) => AiClinicalDocumentSummaryResultSchema.parse(structuredPayload(response));

export async function extractReportWithAi(reportId: string, options: { actorRole?: string; force?: boolean; supabase?: SupabaseClient<any, "public", any> } = {}) {
  const supabase = options.supabase as AiSupabase | undefined;
  if (!supabase) return { ok: false as const, error: "Missing server-side Supabase client." };
  const config = aiConfig();
  let requestType = "extract_findings";
  let context;
  try {
    context = await getReportForAiExtraction(reportId, supabase);
    if (options.actorRole !== "admin") {
      const permission = await supabase.rpc("can_sign_report", { p_appointment_id: context.appointmentId });
      if (permission.error || permission.data !== true) return { ok: false as const, error: "No autorizado para analizar este documento." };
    }
    const analysisProfile = clinicalProfileForCategory(context.reportCategory).aiAnalysisProfile;
    if (analysisProfile === "none") return { ok: false as const, error: "El análisis con IA no está disponible para este tipo de documento." };
    const isRadiology = analysisProfile === "radiology";
    requestType = isRadiology ? "extract_findings" : "summarize_clinical_document";
    const [existingSummary, existingFindings] = await Promise.all([
      getReportAiSummary(supabase, reportId),
      isRadiology ? listExtractedFindings(supabase, reportId) : Promise.resolve([]),
    ]);
    if (!options.force && (existingSummary || existingFindings.length)) {
      return { ok: true as const, findings: existingFindings, clinicalSummary: existingSummary, usage: null, warnings: [], reused: true };
    }
    const budget = await canRunAiExtraction({ tenantId: context.tenantId, reportId, supabase });
    if (!budget.allowed) return { ok: false as const, error: budget.reason ?? "AI extraction blocked." };

    const sanitized = sanitizeReportForAi(context, {
      procedureCode: context.serviceTypeCode,
      procedureName: context.serviceTypeName,
      modality: context.modality,
      reportingGroupCode: context.reportingGroupCode,
    });
    if (isRadiology && !sanitized.findings?.trim() && !sanitized.impression?.trim()) return { ok: false as const, error: "Informe sin hallazgos ni impresión para extraer." };
    if (!isRadiology && ![sanitized.clinicalIndication, sanitized.comparison, sanitized.technique, sanitized.findings, sanitized.impression].some((value) => value?.trim())) {
      return { ok: false as const, error: "Documento sin contenido clínico para analizar." };
    }

    const radiologyProfile = isRadiology ? detectReportingProfile(sanitized) : null;
    const prompt = isRadiology
      ? buildRadiologyFindingExtractionPrompt(sanitized, radiologyProfile!.profile)
      : buildClinicalDocumentSummaryPrompt(sanitized, analysisProfile);
    const systemPrompt = isRadiology ? SYSTEM_PROMPT_FOR_RADIOLOGY_FINDING_EXTRACTION : SYSTEM_PROMPT_FOR_CLINICAL_DOCUMENT_SUMMARY;
    const textFormat = isRadiology
      ? zodTextFormat(AiFindingExtractionResultSchema, "radiology_finding_extraction")
      : zodTextFormat(AiClinicalDocumentSummaryResultSchema, "clinical_document_summary");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.parse({
      model: config.model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      text: { format: textFormat },
      max_output_tokens: config.maxOutputTokens,
      store: false,
    } as any, { timeout: config.timeoutMs });
    let clinicalSummary: AiClinicalSummary;
    let saved: { id: string; findingCandidateId: string | null }[] = [];
    let responseWarnings: string[] = [];
    if (isRadiology) {
      const parsed = parseAiExtractionResponse(response);
      clinicalSummary = finalizeClinicalSummary(parsed.clinicalSummary, { hasImpression: !!sanitized.impression?.trim(), profile: radiologyProfile!.profile, mismatch: radiologyProfile!.mismatch });
      saved = await persistAiExtractionResult(supabase, reportId, { ...parsed, clinicalSummary }, context, options.force === true);
      responseWarnings = parsed.warnings;
    } else {
      const parsed = parseAiClinicalDocumentResponse(response);
      clinicalSummary = {
        reportingProfile: "UNKNOWN",
        modalityContext: "UNKNOWN",
        clinicalContext: parsed.clinicalSummary.documentContext,
        oncologyContext: null,
        globalResponse: null,
        globalAssessment: { status: "not_applicable", ...parsed.clinicalSummary.assessment },
        scores: [],
        primarySummaryItems: parsed.clinicalSummary.summaryItems.map((item) => ({ ...item, sites: [], trend: "not_applicable" as const })),
        activeDiseaseSites: [], resolvedSites: [], stableSites: [], incidentalFindings: [], qualityWarnings: [], clinicalTags: [], lesionTracking: [],
        warnings: parsed.clinicalSummary.warnings,
      };
      responseWarnings = [...parsed.warnings, ...parsed.clinicalSummary.warnings];
      await saveReportAiSummary(supabase, reportId, context, clinicalSummary, analysisProfile);
    }
    const usage = usageOf(response);
    const estimatedCost = await estimateAiCost({ model: config.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, supabase });
    await insertAiUsageLog(supabase, {
      tenant_id: context.tenantId,
      report_id: reportId,
      service_type_id: context.serviceTypeId,
      provider: "openai",
      model: config.model,
      request_type: requestType,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      total_tokens: usage.totalTokens,
      estimated_cost_usd: estimatedCost,
      success: true,
      error_message: budget.warning ?? (sanitized.warnings.join("; ") || null),
    });
    return { ok: true as const, findings: saved, clinicalSummary, usage: { model: config.model, ...usage, estimatedCostUsd: estimatedCost }, warnings: [...responseWarnings, ...sanitized.warnings, budget.warning].filter(Boolean), reused: false };
  } catch (cause) {
    if (context) {
      await insertAiUsageLog(supabase, {
        tenant_id: context.tenantId,
        report_id: reportId,
        service_type_id: context.serviceTypeId,
        provider: "openai",
        model: config.model,
        request_type: requestType,
        success: false,
        error_message: cause instanceof Error ? cause.message : "AI extraction failed",
      }).catch(() => undefined);
    }
    return { ok: false as const, error: publicAiError(cause) };
  }
}
