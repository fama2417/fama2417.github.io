import { NextRequest, NextResponse } from "next/server";
import { aiConfig } from "@/features/reports/ai-budget.ts";
import { sanitizeTextForAi } from "@/features/reports/ai-sanitizer.ts";
import { dedupeLabCandidates, normalizeIdentity, prepareLabPdf, structureLabDocument, type LabCandidate } from "@/features/reports/lab-ai.ts";
import { validatePhrLabDraft } from "@/features/patient-portal/labs.ts";
import { requirePhrApi } from "@/lib/server-auth";

const MAX_BYTES = 10 * 1024 * 1024;
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const dateOr = (value: string, fallback: string) => validDate(value) ? value : fallback;
const redact = (text: string, values: string[]) => values.filter((value) => value.trim()).reduce((result, value) => result.replace(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[PATIENT]"), sanitizeTextForAi(text));

export async function POST(request: NextRequest) {
  const auth = await requirePhrApi(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => ({})) as { documentId?: string };
  if (!body.documentId) return NextResponse.json({ error: "Documento inválido." }, { status: 400 });

  const document = await auth.db.from("patient_documents")
    .select("id, storage_path, mime_type, size_bytes, document_date, created_at")
    .eq("id", body.documentId).eq("owner_user_id", auth.user.id).eq("document_type", "laboratory").maybeSingle();
  if (!document.data) return NextResponse.json({ error: "Laboratorio inexistente." }, { status: 404 });
  if (document.data.mime_type !== "application/pdf") return NextResponse.json({ error: "La extracción de laboratorio requiere un PDF." }, { status: 415 });
  if (document.data.size_bytes > MAX_BYTES) return NextResponse.json({ error: "El PDF supera los 10 MB permitidos para análisis." }, { status: 413 });

  const previous = await auth.db.from("phr_lab_imports").select("id, warnings").eq("document_id", body.documentId).eq("owner_user_id", auth.user.id).maybeSingle();
  if (previous.data) {
    const count = await auth.db.from("phr_lab_results").select("id", { count: "exact", head: true }).eq("import_id", previous.data.id);
    if (count.count) return NextResponse.json({ duplicate: true, created: count.count, warnings: previous.data.warnings ?? [] });
    await auth.db.from("phr_lab_imports").delete().eq("id", previous.data.id).eq("owner_user_id", auth.user.id);
  }

  const downloaded = await auth.db.storage.from("patient-documents").download(document.data.storage_path);
  if (downloaded.error || !downloaded.data) return NextResponse.json({ error: "No fue posible leer el PDF original." }, { status: 502 });
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  let prepared: Awaited<ReturnType<typeof prepareLabPdf>>;
  try { prepared = await prepareLabPdf(bytes); }
  catch { return NextResponse.json({ error: "No fue posible interpretar el PDF." }, { status: 422 }); }

  let rows: LabCandidate[] = prepared.observations;
  let aiResult: Awaited<ReturnType<typeof structureLabDocument>> | null = null;
  if (prepared.needsAi) {
    const config = aiConfig();
    if (!config.enabled || !process.env.OPENAI_API_KEY) return NextResponse.json({ error: "Este PDF necesita OCR visual y la extracción automática no está habilitada." }, { status: 503 });
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    const usage = await auth.db.from("phr_lab_imports").select("id", { count: "exact", head: true })
      .eq("owner_user_id", auth.user.id).in("extraction_method", ["ai_text", "ai_visual"]).gte("created_at", start.toISOString());
    const limit = Math.max(1, Number(process.env.PHR_AI_MAX_PER_DAY ?? 5));
    if ((usage.count ?? 0) >= limit) return NextResponse.json({ error: "Alcanzaste el límite diario de análisis automáticos." }, { status: 429 });
    try {
      aiResult = await structureLabDocument({
        procedureName: "Laboratorio personal",
        ...(prepared.scanned ? { pdfBytes: bytes } : { text: redact(prepared.aiText, [auth.profile.full_name, auth.profile.identifier]) }),
      });
      rows = aiResult.observations;
    } catch { return NextResponse.json({ error: "No fue posible extraer resultados de este PDF." }, { status: 502 }); }
  }

  const extractedName = prepared.patientName || aiResult?.extraction.patientName || "";
  const extractedIdentifier = prepared.patientIdentifier || aiResult?.extraction.patientIdentifier || "";
  const profileIdentifier = auth.profile.identifier.trim();
  const warnings = [...(aiResult?.extraction.warnings ?? [])];
  if (extractedIdentifier && profileIdentifier) {
    if (normalizeIdentity(extractedIdentifier) !== normalizeIdentity(profileIdentifier)) return NextResponse.json({ error: "La identidad del PDF no coincide con tu perfil. No se guardó ningún resultado." }, { status: 422 });
  } else if (extractedName) {
    if (normalizeIdentity(extractedName) !== normalizeIdentity(auth.profile.full_name)) return NextResponse.json({ error: "El nombre del PDF no coincide con tu perfil. No se guardó ningún resultado." }, { status: 422 });
  } else warnings.push("No se encontró identidad en el PDF; revisa cuidadosamente cada resultado antes de confirmarlo.");

  const candidates = dedupeLabCandidates(rows).filter((row) => row.analyte && (row.valueNum !== null || row.valueText));
  if (!candidates.length) return NextResponse.json({ error: "No se detectaron resultados para revisar." }, { status: 422 });
  const fallbackDate = document.data.document_date ?? document.data.created_at.slice(0, 10);
  if (candidates.some((row) => !row.observedAt)) warnings.push("No se encontró fecha de muestra en todas las filas; se usó la fecha del documento.");
  const extractionMethod = !prepared.needsAi ? "local" : prepared.scanned ? "ai_visual" : "ai_text";
  const imported = await auth.db.from("phr_lab_imports").insert({
    owner_user_id: auth.user.id, document_id: body.documentId, extraction_method: extractionMethod,
    patient_name: extractedName, patient_identifier: extractedIdentifier, warnings,
  }).select("id").single();
  if (imported.error) return NextResponse.json({ error: "No fue posible registrar el análisis." }, { status: 502 });

  const inserted = await auth.db.from("phr_lab_results").insert(candidates.map((row) => ({
    owner_user_id: auth.user.id, document_id: body.documentId, import_id: imported.data.id, loinc_code: "",
    analyte: row.analyte, value_num: row.valueNum, value_text: row.valueText, unit: row.unit,
    ref_low: row.refLow, ref_high: row.refHigh, ref_text: row.refText, flag: row.flag,
    observed_at: dateOr(row.observedAt || prepared.observedAt || aiResult?.extraction.observedAt || "", fallbackDate),
    source: row.source, source_sentence: row.sourceSentence, review_status: "suggested",
  }))).select("id");
  if (inserted.error) {
    await auth.db.from("phr_lab_imports").delete().eq("id", imported.data.id);
    return NextResponse.json({ error: "No fue posible guardar las sugerencias." }, { status: 502 });
  }
  return NextResponse.json({ created: inserted.data?.length ?? 0, duplicate: false, warnings });
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePhrApi(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => ({})) as { resultId?: string; confirm?: boolean; analyte?: string; value?: string; unit?: string; reference?: string; observedAt?: string };
  if (!body.resultId) return NextResponse.json({ error: "Resultado inválido." }, { status: 400 });
  const validated = validatePhrLabDraft({ analyte: body.analyte ?? "", value: body.value ?? "", unit: body.unit ?? "", reference: body.reference ?? "", observedAt: body.observedAt ?? "" });
  if ("error" in validated) return NextResponse.json({ error: validated.error }, { status: 400 });
  const current = await auth.db.from("phr_lab_results").select("flag").eq("id", body.resultId).eq("owner_user_id", auth.user.id).eq("review_status", "suggested").maybeSingle();
  if (!current.data) return NextResponse.json({ error: "La sugerencia ya no está disponible para edición." }, { status: 404 });
  const keepExplicitFlag = ["abnormal", "critical_low", "critical_high"].includes(current.data.flag);
  const value = validated.value;
  const updated = await auth.db.from("phr_lab_results").update({
    analyte: value.analyte, value_num: value.valueNum, value_text: value.valueText, unit: value.unit,
    ref_low: value.refLow, ref_high: value.refHigh, ref_text: value.refText,
    flag: keepExplicitFlag ? current.data.flag : value.flag, observed_at: value.observedAt,
    review_status: body.confirm === true ? "confirmed" : "suggested",
  }).eq("id", body.resultId).eq("owner_user_id", auth.user.id).eq("review_status", "suggested");
  return updated.error ? NextResponse.json({ error: "No fue posible actualizar el resultado." }, { status: 502 }) : NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const auth = await requirePhrApi(request);
  if (auth instanceof NextResponse) return auth;
  const resultId = request.nextUrl.searchParams.get("resultId");
  if (!resultId) return NextResponse.json({ error: "Resultado inválido." }, { status: 400 });
  const result = await auth.db.from("phr_lab_results").select("import_id").eq("id", resultId).eq("owner_user_id", auth.user.id).eq("review_status", "suggested").maybeSingle();
  if (!result.data) return NextResponse.json({ error: "Sugerencia inexistente." }, { status: 404 });
  const deleted = await auth.db.from("phr_lab_results").delete().eq("id", resultId).eq("owner_user_id", auth.user.id).eq("review_status", "suggested");
  if (deleted.error) return NextResponse.json({ error: "No fue posible descartar la sugerencia." }, { status: 502 });
  const remaining = await auth.db.from("phr_lab_results").select("id", { count: "exact", head: true }).eq("import_id", result.data.import_id);
  if (!remaining.count) await auth.db.from("phr_lab_imports").delete().eq("id", result.data.import_id).eq("owner_user_id", auth.user.id);
  return NextResponse.json({ ok: true });
}
