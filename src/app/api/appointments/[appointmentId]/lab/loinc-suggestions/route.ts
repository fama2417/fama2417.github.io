import { NextRequest, NextResponse } from "next/server";
import { aiConfig, canRunAiExtraction, estimateAiCost } from "@/features/reports/ai-budget.ts";
import { suggestLabLoinc, verifiedLabLoincCandidates } from "@/features/reports/lab-ai.ts";
import { insertAiUsageLog } from "@/features/reports/ai-repository.ts";
import { requireAiRouteUser } from "@/features/reports/ai-route-auth.ts";

export async function POST(request: NextRequest, { params }: { params: Promise<{ appointmentId: string }> }) {
  const auth = await requireAiRouteUser(request, ["admin", "clinician", "radiologist"]);
  if ("error" in auth) return auth.error;
  const { appointmentId } = await params;

  const appointment = await auth.supabase.from("appointments").select("id, status, service_category").eq("id", appointmentId).maybeSingle();
  if (appointment.error) return NextResponse.json({ error: "No fue posible cargar la atención." }, { status: 502 });
  if (!appointment.data) return NextResponse.json({ error: "Atención inexistente." }, { status: 404 });
  if (appointment.data.service_category !== "laboratory" || appointment.data.status !== "completed") {
    return NextResponse.json({ error: "La atención debe corresponder a un laboratorio atendido." }, { status: 400 });
  }
  if (auth.role !== "admin") {
    const permission = await auth.supabase.rpc("can_sign_report", { p_appointment_id: appointmentId });
    if (permission.error || permission.data !== true) return NextResponse.json({ error: "No autorizado para esta atención." }, { status: 403 });
  }

  const pending = await auth.supabase.from("lab_observations").select("id, analyte, unit, value_num, value_text")
    .eq("appointment_id", appointmentId).eq("review_status", "suggested").eq("loinc_code", "").order("analyte").limit(80);
  if (pending.error) return NextResponse.json({ error: "No fue posible cargar los analitos sin homologar." }, { status: 502 });
  if (!pending.data?.length) return NextResponse.json({ suggestions: [], warning: "No hay analitos pendientes sin LOINC." });

  const budget = await canRunAiExtraction({ tenantId: auth.tenantId, reportId: appointmentId, supabase: auth.supabase });
  if (!budget.allowed) return NextResponse.json({ error: budget.reason ?? "Nano no está disponible." }, { status: 429 });

  const model = aiConfig().model;
  try {
    const result = await suggestLabLoinc(pending.data.map((row) => ({
      analyte: row.analyte, unit: row.unit, valueNum: row.value_num, valueText: row.value_text,
    })), 3);
    const proposedCodes = [...new Set(result.suggestions.map((row) => row.loincCode.trim()).filter(Boolean))];
    const known = proposedCodes.length
      ? await auth.supabase.from("terminology_codes").select("code, display").eq("system", "LOINC").in("code", proposedCodes)
      : { data: [], error: null };
    if (known.error) throw known.error;

    const displays = new Map((known.data ?? []).map((row) => [row.code, row.display]));
    const candidates = verifiedLabLoincCandidates(result.suggestions, displays.keys());
    const suggestions = pending.data.flatMap((row, index) => {
      const options = (candidates.get(String(index)) ?? []).map((candidate) => ({
        code: candidate.loincCode, display: displays.get(candidate.loincCode) ?? "", confidence: candidate.confidence,
      }));
      return options.length ? [{ observationId: row.id, options }] : [];
    });

    const estimatedCost = await estimateAiCost({ model, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, supabase: auth.supabase });
    await insertAiUsageLog(auth.supabase, {
      tenant_id: auth.tenantId, appointment_id: appointmentId, provider: "openai", model, request_type: "lab_ingest",
      input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens, total_tokens: result.usage.totalTokens,
      estimated_cost_usd: estimatedCost, success: true, error_message: "Sugerencias LOINC pendientes para revisión humana",
    }).catch(() => undefined);
    return NextResponse.json({ suggestions, warning: budget.warning });
  } catch (cause) {
    await insertAiUsageLog(auth.supabase, {
      tenant_id: auth.tenantId, appointment_id: appointmentId, provider: "openai", model, request_type: "lab_ingest",
      success: false, error_message: cause instanceof Error ? cause.message : "LOINC suggestions failed",
    }).catch(() => undefined);
    return NextResponse.json({ error: "No fue posible obtener sugerencias LOINC." }, { status: 502 });
  }
}
