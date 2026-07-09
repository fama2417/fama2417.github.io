import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiConfig, canRunAiExtraction, estimateAiCost, type AiSupabase } from "./ai-budget.ts";
import { AiFindingExtractionJsonSchema, AiFindingExtractionResultSchema } from "./ai-extraction-schema.ts";
import { buildRadiologyFindingExtractionPrompt, SYSTEM_PROMPT_FOR_RADIOLOGY_FINDING_EXTRACTION } from "./ai-prompts.ts";
import { sanitizeReportForAi } from "./ai-sanitizer.ts";
import { getReportForAiExtraction, insertAiUsageLog, persistAiExtractionResult } from "./ai-repository.ts";

type Usage = { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };

const usageOf = (response: unknown): Usage => {
  const usage = (response as any)?.usage ?? {};
  return {
    inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? null,
    outputTokens: usage.output_tokens ?? usage.completion_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
  };
};

export async function extractRadiologyFindingsWithAi(reportId: string, options: { force?: boolean; supabase?: SupabaseClient<any, "public", any> } = {}) {
  const supabase = options.supabase as AiSupabase | undefined;
  if (!supabase) return { ok: false as const, error: "Missing server-side Supabase client." };
  const config = aiConfig();
  let context;
  try {
    context = await getReportForAiExtraction(reportId, supabase);
    const budget = await canRunAiExtraction({ tenantId: context.tenantId, reportId, supabase });
    if (!budget.allowed) return { ok: false as const, error: budget.reason ?? "AI extraction blocked." };

    const sanitized = sanitizeReportForAi(context, {
      procedureCode: context.serviceTypeCode,
      procedureName: context.serviceTypeName,
      modality: context.modality,
      reportingGroupCode: context.reportingGroupCode,
    });
    if (!sanitized.findings?.trim() && !sanitized.impression?.trim()) return { ok: false as const, error: "Informe sin hallazgos ni impresion para extraer." };

    const prompt = buildRadiologyFindingExtractionPrompt(sanitized);
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: config.model,
      input: [
        { role: "system", content: SYSTEM_PROMPT_FOR_RADIOLOGY_FINDING_EXTRACTION },
        { role: "user", content: prompt },
      ],
      text: { format: { type: "json_schema", name: "radiology_finding_extraction", schema: AiFindingExtractionJsonSchema, strict: true } },
      max_output_tokens: config.maxOutputTokens,
      store: false,
    } as any, { timeout: config.timeoutMs });
    const parsed = AiFindingExtractionResultSchema.parse(JSON.parse(response.output_text || "{}"));
    const saved = await persistAiExtractionResult(supabase, reportId, parsed, context);
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
    return { ok: true as const, findings: saved, usage: { model: config.model, ...usage, estimatedCostUsd: estimatedCost }, warnings: [...sanitized.warnings, budget.warning].filter(Boolean) };
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
    return { ok: false as const, error: cause instanceof Error ? cause.message : "AI extraction failed" };
  }
}
