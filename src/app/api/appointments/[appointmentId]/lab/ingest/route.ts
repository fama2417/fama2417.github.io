import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { aiConfig, canRunAiExtraction, estimateAiCost } from "@/features/reports/ai-budget.ts";
import { insertAiUsageLog } from "@/features/reports/ai-repository.ts";
import { requireAiRouteUser } from "@/features/reports/ai-route-auth.ts";
import { dedupeLabCandidates, labPatientMatches, normalizeIdentity, prepareLabPdf, structureLabDocument, suggestLabLoinc, verifiedLabLoinc, type LabCandidate } from "@/features/reports/lab-ai.ts";
import { sanitizeTextForAi } from "@/features/reports/ai-sanitizer.ts";

const MAX_BYTES = 10 * 1024 * 1024;
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const removePatientName = (text: string, name: string) => name.trim() ? text.replace(new RegExp(escapeRegExp(name.trim()), "gi"), "[PATIENT]") : text;
const observedAt = (value: string, fallback: string) => `${/^20\d{2}-\d{2}-\d{2}$/.test(value) ? value : fallback}T00:00:00.000Z`;
const loincKey = (row: Pick<LabCandidate, "analyte" | "unit">) => `${normalizeIdentity(row.analyte)}|${normalizeIdentity(row.unit)}`;
type AiUsage = { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
const combinedUsage = (rows: AiUsage[]) => Object.fromEntries((["inputTokens", "outputTokens", "totalTokens"] as const).map((key) => [key,
  rows.every((row) => row[key] === null) ? null : rows.reduce((sum, row) => sum + (row[key] ?? 0), 0),
])) as AiUsage;

export async function POST(request: NextRequest, { params }: { params: Promise<{ appointmentId: string }> }) {
  const auth = await requireAiRouteUser(request, ["admin", "clinician", "radiologist"]);
  if ("error" in auth) return auth.error;
  const { appointmentId } = await params;

  const appointmentResult = await auth.supabase.from("appointments")
    .select("id, tenant_id, patient_id, status, service_category, appointment_date, reason, patient:patients(full_name, identifier)")
    .eq("id", appointmentId).maybeSingle();
  if (appointmentResult.error) return NextResponse.json({ error: "No fue posible cargar la atención." }, { status: 502 });
  if (!appointmentResult.data) return NextResponse.json({ error: "Atención inexistente." }, { status: 404 });
  const appointment = appointmentResult.data as any;
  const patient = Array.isArray(appointment.patient) ? appointment.patient[0] : appointment.patient;
  if (appointment.service_category !== "laboratory") return NextResponse.json({ error: "Esta atención no es de laboratorio." }, { status: 400 });
  if (appointment.status !== "completed") return NextResponse.json({ error: "La cita debe estar en estado «Atendida» para cargar resultados." }, { status: 400 });
  if (auth.role !== "admin") {
    const permission = await auth.supabase.rpc("can_sign_report", { p_appointment_id: appointmentId });
    if (permission.error || permission.data !== true) return NextResponse.json({ error: "No autorizado para esta atención." }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Adjunta un PDF con los resultados." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "El PDF supera los 10 MB." }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return NextResponse.json({ error: "El archivo adjunto no es un PDF válido." }, { status: 415 });
  const fileHash = createHash("sha256").update(bytes).digest("hex");

  const existing = await auth.supabase.from("lab_result_imports").select("id").eq("appointment_id", appointmentId).eq("file_sha256", fileHash).maybeSingle();
  if (existing.error) return NextResponse.json({ error: "No fue posible verificar importaciones previas." }, { status: 502 });
  if (existing.data) {
    const count = await auth.supabase.from("lab_observations").select("id", { count: "exact", head: true }).eq("import_id", existing.data.id);
    return NextResponse.json({ success: true, duplicate: true, created: count.count ?? 0, warnings: ["Este PDF ya había sido importado; no se duplicaron resultados."] });
  }

  let prepared;
  try {
    prepared = await prepareLabPdf(bytes);
  } catch {
    return NextResponse.json({ error: "No fue posible leer el PDF." }, { status: 422 });
  }

  let candidates: LabCandidate[] = prepared.observations;
  let aiResult: Awaited<ReturnType<typeof structureLabDocument>> | null = null;
  let aiWarning: string | undefined;
  let budgetResult: Awaited<ReturnType<typeof canRunAiExtraction>> | null = null;
  const aiBudget = async () => budgetResult ??= await canRunAiExtraction({ tenantId: auth.tenantId, reportId: appointmentId, supabase: auth.supabase });
  if (prepared.needsAi) {
    const budget = await aiBudget();
    if (!budget.allowed) return NextResponse.json({ error: budget.reason ?? "IA no disponible para este PDF." }, { status: 429 });
    aiWarning = budget.warning;
    const model = aiConfig().model;
    try {
      const text = sanitizeTextForAi(removePatientName(prepared.aiText, patient?.full_name ?? ""));
      aiResult = await structureLabDocument({
        procedureName: appointment.reason ?? "",
        ...(prepared.scanned ? { pdfBytes: bytes } : { text }),
      });
      candidates = aiResult.observations;
    } catch (cause) {
      await insertAiUsageLog(auth.supabase, {
        tenant_id: auth.tenantId, appointment_id: appointmentId, provider: "openai", model, request_type: "lab_ingest",
        success: false, error_message: cause instanceof Error ? cause.message : "lab ingest failed",
      }).catch(() => undefined);
      return NextResponse.json({ error: "No fue posible interpretar el laboratorio." }, { status: 502 });
    }
  }

  const extractedPatient = {
    patientName: prepared.patientName || aiResult?.extraction.patientName || "",
    patientIdentifier: prepared.patientIdentifier || aiResult?.extraction.patientIdentifier || "",
  };
  if (!labPatientMatches(extractedPatient, { patientName: patient?.full_name ?? "", patientIdentifier: patient?.identifier ?? "" })) {
    return NextResponse.json({ error: "La identidad del PDF no coincide con el paciente de la atención. No se guardó ningún resultado." }, { status: 422 });
  }

  const rows = dedupeLabCandidates(candidates).filter((row) => row.analyte && (row.valueNum !== null || row.valueText));
  if (!rows.length) return NextResponse.json({ error: "No se detectaron filas de resultados para revisar." }, { status: 422 });
  let loincResult: Awaited<ReturnType<typeof suggestLabLoinc>> | null = null;
  let loincWarning: string | undefined;
  let loincBySource = new Map<string, string>();
  let reusedLoinc = 0;
  const loincCatalog = await auth.supabase.from("terminology_codes").select("code", { count: "exact", head: true }).eq("system", "LOINC");
  if (loincCatalog.error) loincWarning = "No fue posible consultar el catálogo LOINC; los resultados quedaron sin homologar.";
  else if (!loincCatalog.count) loincWarning = "El catálogo LOINC está vacío; cárgalo para habilitar la homologación automática.";
  else {
    const prior = await auth.supabase.from("lab_observations").select("analyte, unit, loinc_code")
      .eq("review_status", "confirmed").neq("loinc_code", "").in("analyte", [...new Set(rows.map((row) => row.analyte))]);
    const priorByKey = new Map<string, Set<string>>();
    for (const row of prior.data ?? []) {
      const key = loincKey(row);
      priorByKey.set(key, (priorByKey.get(key) ?? new Set()).add(row.loinc_code));
    }
    rows.forEach((row, index) => {
      const codes = priorByKey.get(loincKey(row));
      if (codes?.size === 1) loincBySource.set(String(index), [...codes][0]);
    });
    reusedLoinc = loincBySource.size;
    const unresolved = rows.map((row, index) => ({ row, index })).filter(({ index }) => !loincBySource.has(String(index)));
    if (unresolved.length) {
      const budget = await aiBudget();
      if (!budget.allowed) loincWarning = "Nano no estaba disponible para homologar los analitos nuevos; los resultados igualmente quedaron listos para revisión.";
      else try {
        loincResult = await suggestLabLoinc(unresolved.map(({ row }) => row));
        const proposedCodes = [...new Set(loincResult.suggestions.map((row) => row.loincCode.trim()).filter(Boolean))];
        const known = proposedCodes.length
          ? await auth.supabase.from("terminology_codes").select("code").eq("system", "LOINC").in("code", proposedCodes)
          : { data: [], error: null };
        if (known.error) throw known.error;
        for (const [sourceId, code] of verifiedLabLoinc(loincResult.suggestions, (known.data ?? []).map((row) => row.code), aiConfig().minConfidenceToAutoSuggest)) {
          const original = unresolved[Number(sourceId)];
          if (original) loincBySource.set(String(original.index), code);
        }
      } catch {
        loincWarning = "No fue posible homologar LOINC automáticamente; los resultados igualmente quedaron listos para revisión.";
      }
    }
  }
  const extractionMethod = !prepared.needsAi ? "local" : prepared.scanned ? "ai_visual" : "ai_text";
  const imported = await auth.supabase.from("lab_result_imports").insert({
    tenant_id: auth.tenantId,
    appointment_id: appointmentId,
    patient_id: appointment.patient_id,
    file_sha256: fileHash,
    source_filename: file.name.slice(0, 255),
    extraction_method: extractionMethod,
    identity_verified: true,
  }).select("id").single();
  if (imported.error) {
    if (imported.error.code === "23505") return NextResponse.json({ success: true, duplicate: true, created: 0, warnings: ["Este PDF ya había sido importado."] });
    return NextResponse.json({ error: "No fue posible registrar la importación." }, { status: 502 });
  }

  const fallbackDate = appointment.appointment_date;
  const inserts = rows.map((row, index) => ({
    tenant_id: auth.tenantId,
    report_id: null,
    import_id: imported.data.id,
    appointment_id: appointmentId,
    patient_id: appointment.patient_id,
    loinc_code: loincBySource.get(String(index)) ?? "",
    analyte: row.analyte,
    value_num: row.valueNum,
    value_text: row.valueText,
    unit: row.unit,
    ref_low: row.refLow,
    ref_high: row.refHigh,
    ref_text: row.refText,
    flag: row.flag,
    observed_at: observedAt(row.observedAt || prepared.observedAt || aiResult?.extraction.observedAt || "", fallbackDate),
    source: row.source,
    source_sentence: row.sourceSentence,
    review_status: "suggested",
  }));
  const inserted = await auth.supabase.from("lab_observations").insert(inserts).select("id");
  if (inserted.error) {
    await auth.supabase.from("lab_result_imports").delete().eq("id", imported.data.id);
    return NextResponse.json({ error: "No fue posible guardar los resultados sugeridos." }, { status: 502 });
  }

  const warnings = [
    ...(aiResult?.extraction.warnings ?? []),
    aiWarning,
    loincWarning,
    rows.some((row) => !row.observedAt) ? "No se encontró fecha de muestra; se usó la fecha de la atención." : undefined,
    loincResult ? `Nano recibió sólo los analitos nuevos y sugirió ${loincBySource.size - reusedLoinc} homologación(es) LOINC verificadas contra el catálogo; ${reusedLoinc} se reutilizaron.` : undefined,
    extractionMethod === "local" && !loincResult ? "Extracción local: no se consumieron tokens de IA." : undefined,
  ].filter(Boolean) as string[];

  const usageRows = [aiResult?.usage, loincResult?.usage].filter((usage): usage is AiUsage => !!usage);
  if (usageRows.length) {
    const usage = combinedUsage(usageRows);
    const model = aiConfig().model;
    const estimatedCost = await estimateAiCost({ model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, supabase: auth.supabase });
    await insertAiUsageLog(auth.supabase, {
      tenant_id: auth.tenantId, appointment_id: appointmentId, provider: "openai", model, request_type: "lab_ingest",
      input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, total_tokens: usage.totalTokens,
      estimated_cost_usd: estimatedCost, success: true, error_message: warnings.join("; ") || null,
    }).catch(() => undefined);
  }

  return NextResponse.json({ success: true, created: inserted.data?.length ?? 0, loincMapped: loincBySource.size, duplicate: false, warnings });
}
