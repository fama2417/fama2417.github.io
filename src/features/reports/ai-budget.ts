import type { SupabaseClient } from "@supabase/supabase-js";

export type AiSupabase = SupabaseClient<any, "public", any>;

const boolEnv = (name: string, fallback: boolean) => process.env[name] == null ? fallback : process.env[name] === "true";
const numberEnv = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

export function aiConfig() {
  return {
    model: process.env.OPENAI_MODEL || "gpt-5.4-nano",
    fallbackModel: process.env.OPENAI_FALLBACK_MODEL || "gpt-5.4-mini",
    enabled: boolEnv("AI_EXTRACTION_ENABLED", false),
    maxOutputTokens: numberEnv("AI_MAX_OUTPUT_TOKENS", 4000),
    timeoutMs: numberEnv("AI_TIMEOUT_MS", 45000),
    maxReportsPerDay: numberEnv("AI_MAX_REPORTS_PER_DAY", 100),
    monthlyBudgetUsd: numberEnv("AI_MONTHLY_BUDGET_USD", 10),
    logUsage: boolEnv("AI_LOG_USAGE", true),
    minConfidenceToAutoSuggest: numberEnv("AI_MIN_CONFIDENCE_TO_AUTO_SUGGEST", 0.65),
    minConfidenceToAutoCreateCandidate: numberEnv("AI_MIN_CONFIDENCE_TO_AUTO_CREATE_CANDIDATE", 0.5),
  };
}

export async function estimateAiCost({ model, inputTokens, outputTokens, supabase }: { model: string; inputTokens?: number | null; outputTokens?: number | null; supabase: AiSupabase }) {
  if (inputTokens == null || outputTokens == null) return null;
  const { data, error } = await supabase.from("ai_model_pricing").select("input_usd_per_1m, output_usd_per_1m").eq("provider", "openai").eq("model", model).eq("active", true).maybeSingle();
  if (error || !data) return null;
  const input = Number(data.input_usd_per_1m ?? 0);
  const output = Number(data.output_usd_per_1m ?? 0);
  if (input <= 0 && output <= 0) return null;
  return (inputTokens / 1_000_000) * input + (outputTokens / 1_000_000) * output;
}

export async function canRunAiExtraction({ tenantId, supabase }: { tenantId: string; reportId: string; supabase: AiSupabase }) {
  const config = aiConfig();
  if (!config.enabled) return { allowed: false, reason: "AI extraction disabled" };
  if (!process.env.OPENAI_API_KEY) return { allowed: false, reason: "Missing OPENAI_API_KEY" };

  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const daily = await supabase.from("ai_usage_log").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("success", true).gte("created_at", dayStart.toISOString());
  if (daily.error) return { allowed: false, reason: daily.error.message };
  if ((daily.count ?? 0) >= config.maxReportsPerDay) return { allowed: false, reason: "Daily AI extraction limit reached" };

  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const usage = await supabase.from("ai_usage_log").select("estimated_cost_usd").eq("tenant_id", tenantId).eq("success", true).gte("created_at", monthStart.toISOString());
  if (usage.error) return { allowed: false, reason: usage.error.message };
  const spent = (usage.data ?? []).reduce((sum, row) => sum + Number(row.estimated_cost_usd ?? 0), 0);
  if (spent >= config.monthlyBudgetUsd) return { allowed: false, reason: "Monthly AI budget reached" };

  const pricing = await supabase.from("ai_model_pricing").select("input_usd_per_1m, output_usd_per_1m").eq("provider", "openai").eq("model", config.model).eq("active", true).maybeSingle();
  const prices = pricing.data ? [Number(pricing.data.input_usd_per_1m), Number(pricing.data.output_usd_per_1m)] : [0, 0];
  return { allowed: true, warning: prices.every((n) => n <= 0) ? "AI pricing not configured" : undefined };
}
