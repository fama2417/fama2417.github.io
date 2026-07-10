import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiConfig, canRunAiExtraction, estimateAiCost, type AiSupabase } from "./ai-budget.ts";
import { AiFindingExtractionResultSchema, detectReportingProfile, finalizeClinicalSummary } from "./ai-extraction-schema.ts";
import { buildRadiologyFindingExtractionPrompt, SYSTEM_PROMPT_FOR_RADIOLOGY_FINDING_EXTRACTION } from "./ai-prompts.ts";
import { sanitizeReportForAi } from "./ai-sanitizer.ts";
import { getReportAiSummary, getReportForAiExtraction, insertAiUsageLog, listExtractedFindings, persistAiExtractionResult } from "./ai-repository.ts";

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

export const parseAiExtractionResponse = (response: unknown) => {
  const parsed = (response as any)?.output_parsed ?? (response as any)?.output?.flatMap((item: any) => item.content ?? []).find((content: any) => content?.parsed)?.parsed;
  if (parsed) return AiFindingExtractionResultSchema.parse(parsed);
  const text = (response as any)?.output_text?.trim();
  if (text) return AiFindingExtractionResultSchema.parse(JSON.parse(text));
  throw new AiStructuredResponseError();
};

export async function extractRadiologyFindingsWithAi(reportId: string, options: { force?: boolean; supabase?: SupabaseClient<any, "public", any> } = {}) {
  const supabase = options.supabase as AiSupabase | undefined;
  if (!supabase) return { ok: false as const, error: "Missing server-side Supabase client." };
  const config = aiConfig();
  let context;
  try {
    context = await getReportForAiExtraction(reportId, supabase);
    const [existingSummary, existingFindings] = await Promise.all([getReportAiSummary(supabase, reportId), listExtractedFindings(supabase, reportId)]);
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
    if (!sanitized.findings?.trim() && !sanitized.impression?.trim()) return { ok: false as const, error: "Informe sin hallazgos ni impresion para extraer." };

    const profile = detectReportingProfile(sanitized);
    const prompt = buildRadiologyFindingExtractionPrompt(sanitized, profile.profile);
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.parse({
      model: config.model,
      input: [
        { role: "system", content: SYSTEM_PROMPT_FOR_RADIOLOGY_FINDING_EXTRACTION },
        { role: "user", content: prompt },
      ],
      text: { format: zodTextFormat(AiFindingExtractionResultSchema, "radiology_finding_extraction") },
      max_output_tokens: config.maxOutputTokens,
      store: false,
    } as any, { timeout: config.timeoutMs });
    const parsedResponse = parseAiExtractionResponse(response);
    const parsed = { ...parsedResponse, clinicalSummary: finalizeClinicalSummary(parsedResponse.clinicalSummary, { hasImpression: !!sanitized.impression?.trim(), profile: profile.profile, mismatch: profile.mismatch }) };
    const saved = await persistAiExtractionResult(supabase, reportId, parsed, context, options.force === true);
    const usage = usageOf(response);
    const estimatedCost = await estimateAiCost({ model: config.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, supabase });
    await insertAiUsageLog(supabase, {
      tenant_id: context.tenantId,
      report_id: reportId,
      service_type_id: context.serviceTypeId,
      provider: "openai",
      model: config.model,
      request_type: "extract_findings",
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      total_tokens: usage.totalTokens,
      estimated_cost_usd: estimatedCost,
      success: true,
      error_message: budget.warning ?? (sanitized.warnings.join("; ") || null),
    });
    return { ok: true as const, findings: saved, clinicalSummary: parsed.clinicalSummary, usage: { model: config.model, ...usage, estimatedCostUsd: estimatedCost }, warnings: [...sanitized.warnings, budget.warning].filter(Boolean), reused: false };
  } catch (cause) {
    if (context) {
      await insertAiUsageLog(supabase, {
        tenant_id: context.tenantId,
        report_id: reportId,
        service_type_id: context.serviceTypeId,
        provider: "openai",
        model: config.model,
        request_type: "extract_findings",
        success: false,
        error_message: cause instanceof Error ? cause.message : "AI extraction failed",
      }).catch(() => undefined);
    }
    return { ok: false as const, error: publicAiError(cause) };
  }
}
