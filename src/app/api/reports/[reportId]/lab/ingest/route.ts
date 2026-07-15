import { NextRequest, NextResponse } from "next/server";
import { aiConfig, canRunAiExtraction, estimateAiCost } from "@/features/reports/ai-budget.ts";
import { insertAiUsageLog } from "@/features/reports/ai-repository.ts";
import { requireAiRouteUser } from "@/features/reports/ai-route-auth.ts";
import { extractPdfText, structureLabText } from "@/features/reports/lab-ai.ts";
import { labFlag } from "@/features/reports/lab-observations.ts";

const MAX_BYTES = 10 * 1024 * 1024;
const isoOrNow = (value: string) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : new Date().toISOString();
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ reportId: string }> }) {
  if (!aiConfig().enabled) return NextResponse.json({ error: "La IA está deshabilitada." }, { status: 403 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "OpenAI no está configurado." }, { status: 503 });

  const auth = await requireAiRouteUser(request, ["admin", "clinician", "radiologist"]);
  if ("error" in auth) return auth.error;
  const { reportId } = await params;

  const { data: report, error } = await auth.supabase.from("radiology_reports")
    .select("id, tenant_id, appointment_id, report_category, status, appointment:appointments(patient_id, status, reason)")
    .eq("id", reportId).maybeSingle();
  if (error) return NextResponse.json({ error: "No fue posible cargar el informe." }, { status: 502 });
  if (!report) return NextResponse.json({ error: "Informe inexistente." }, { status: 404 });
  const appointment = (report as any).appointment ?? {};
  if ((report as any).report_category !== "laboratory") return NextResponse.json({ error: "Este informe no es de laboratorio." }, { status: 400 });
  if ((report as any).status !== "draft") return NextResponse.json({ error: "El informe debe estar en borrador." }, { status: 400 });
  if (appointment.status !== "completed") return NextResponse.json({ error: "La cita debe estar en estado «Atendida» para cargar resultados." }, { status: 400 });

  if (auth.role !== "admin") {
    const permission = await auth.supabase.rpc("can_sign_report", { p_appointment_id: (report as any).appointment_id });
    if (permission.error || permission.data !== true) return NextResponse.json({ error: "No autorizado para este documento." }, { status: 403 });
  }

  const budget = await canRunAiExtraction({ tenantId: auth.tenantId, reportId, supabase: auth.supabase });
  if (!budget.allowed) return NextResponse.json({ error: budget.reason ?? "IA no disponible." }, { status: 429 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Adjunta un PDF con los resultados." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "El PDF supera los 10 MB." }, { status: 413 });

  let text: string;
  try {
    text = await extractPdfText(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return NextResponse.json({ error: "No fue posible leer el PDF." }, { status: 422 });
  }
  if (!text) return NextResponse.json({ error: "El PDF no tiene texto (probablemente escaneado). El OCR de imagen aún no está disponible." }, { status: 422 });

  const model = aiConfig().model;
  let result;
  try {
    result = await structureLabText(text, { procedureName: appointment.reason ?? "" });
  } catch (cause) {
    await insertAiUsageLog(auth.supabase, { tenant_id: auth.tenantId, report_id: reportId, provider: "openai", model, request_type: "lab_ingest", success: false, error_message: cause instanceof Error ? cause.message : "lab ingest failed" }).catch(() => undefined);
    return NextResponse.json({ error: "No fue posible interpretar el laboratorio." }, { status: 502 });
  }

  const rows = result.extraction.observations
    .filter((o) => o.analyte.trim() && (o.valueNum !== null || o.valueText.trim()))
    .map((o) => ({
      tenant_id: auth.tenantId, report_id: reportId, appointment_id: (report as any).appointment_id, patient_id: appointment.patient_id,
      loinc_code: o.loincCode.trim(), analyte: o.analyte.trim(),
      value_num: o.valueNum, value_text: o.valueNum === null ? o.valueText.trim() : "",
      unit: o.unit.trim(), ref_low: o.refLow, ref_high: o.refHigh, ref_text: o.refText.trim(),
      flag: labFlag(o.valueNum, o.refLow, o.refHigh), observed_at: isoOrNow(o.observedAt),
      source: "ai", source_sentence: o.sourceSentence.trim(), review_status: "suggested",
    }));

  let created = 0;
  if (rows.length) {
    const inserted = await auth.supabase.from("lab_observations").insert(rows).select("id");
    if (inserted.error) return NextResponse.json({ error: "No fue posible guardar los resultados (verifica que la cita esté Atendida y tu ámbito profesional)." }, { status: 502 });
    created = inserted.data?.length ?? 0;
  }

  const estimatedCost = await estimateAiCost({ model, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, supabase: auth.supabase });
  const warnings = [...result.extraction.warnings, budget.warning].filter(Boolean) as string[];
  await insertAiUsageLog(auth.supabase, {
    tenant_id: auth.tenantId, report_id: reportId, provider: "openai", model, request_type: "lab_ingest",
    input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens, total_tokens: result.usage.totalTokens,
    estimated_cost_usd: estimatedCost, success: true, error_message: warnings.join("; ") || null,
  }).catch(() => undefined);

  return NextResponse.json({ success: true, created, warnings });
}
