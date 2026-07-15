import { NextRequest, NextResponse } from "next/server";
import { aiConfig } from "@/features/reports/ai-budget.ts";
import { sanitizeTextForAi } from "@/features/reports/ai-sanitizer.ts";
import { dedupeLabCandidates, normalizeIdentity, prepareLabPdf, structureLabDocument, suggestLabLoinc, verifiedLabLoinc, type LabCandidate } from "@/features/reports/lab-ai.ts";
import { reusedPhrLoinc, validatePhrLabDraft } from "@/features/patient-portal/labs.ts";
import { requirePhrApi } from "@/lib/server-auth";

const MAX_BYTES = 10 * 1024 * 1024;
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const dateOr = (value: string, fallback: string) => validDate(value) ? value : fallback;
const redact = (text: string, values: string[]) => values.filter((value) => value.trim()).reduce((result, value) => result.replace(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[PATIENT]"), sanitizeTextForAi(text));

async function matchPhrLoinc(db: any, ownerUserId: string, rows: LabCandidate[]) {
  const warnings: string[] = [], loincByIndex = new Map<number, string>();
  const catalog = await db.from("terminology_codes").select("code", { count: "exact", head: true }).eq("system", "LOINC");
  if (catalog.error || !catalog.count) return { loincByIndex, warnings: [catalog.error ? "No fue posible consultar el catálogo LOINC." : "El catálogo LOINC está vacío; debe cargarse para homologar resultados."] };

  const prior = await db.from("phr_lab_results").select("analyte, unit, loinc_code")
    .eq("owner_user_id", ownerUserId).eq("review_status", "confirmed").neq("loinc_code", "");
  for (const [index, code] of reusedPhrLoinc(rows, (prior.data ?? []).map((row: { analyte: string; unit: string; loinc_code: string }) => ({ analyte: row.analyte, unit: row.unit, loincCode: row.loinc_code })))) loincByIndex.set(index, code);

  const unresolved = rows.map((row, index) => ({ row, index })).filter(({ index }) => !loincByIndex.has(index));
  const config = aiConfig();
  if (!unresolved.length) return { loincByIndex, warnings };
  if (!config.enabled || !process.env.OPENAI_API_KEY) return { loincByIndex, warnings: ["La IA no está habilitada para homologar analitos nuevos con LOINC."] };

  try {
    const suggested = await suggestLabLoinc(unresolved.map(({ row }) => row));
    const proposed = [...new Set(suggested.suggestions.map((row) => row.loincCode.trim()).filter(Boolean))];
    const known = proposed.length ? await db.from("terminology_codes").select("code").eq("system", "LOINC").in("code", proposed) : { data: [], error: null };
    if (known.error) throw known.error;
    for (const [sourceId, code] of verifiedLabLoinc(suggested.suggestions, (known.data ?? []).map((row: { code: string }) => row.code), config.minConfidenceToAutoSuggest)) {
      const original = unresolved[Number(sourceId)];
      if (original) loincByIndex.set(original.index, code);
    }
    warnings.push(`${loincByIndex.size} de ${rows.length} analitos fueron homologados automáticamente con LOINC y verificados contra el catálogo.`);
  } catch { warnings.push("No fue posible completar la homologación LOINC; los resultados siguen disponibles para revisión."); }
  return { loincByIndex, warnings };
}

export async function POST(request: NextRequest) {
  const auth = await requirePhrApi(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => ({})) as { documentId?: string; rematch?: boolean };
  if (!body.documentId) return NextResponse.json({ error: "Documento inválido." }, { status: 400 });

  const document = await auth.db.from("patient_documents")
    .select("id, storage_path, mime_type, size_bytes, document_date, created_at")
    .eq("id", body.documentId).eq("owner_user_id", auth.user.id).eq("document_type", "laboratory").maybeSingle();
  if (!document.data) return NextResponse.json({ error: "Laboratorio inexistente." }, { status: 404 });
  if (document.data.mime_type !== "application/pdf") return NextResponse.json({ error: "La extracción de laboratorio requiere un PDF." }, { status: 415 });
  if (document.data.size_bytes > MAX_BYTES) return NextResponse.json({ error: "El PDF supera los 10 MB permitidos para análisis." }, { status: 413 });

  const previous = await auth.db.from("phr_lab_imports").select("id, warnings").eq("document_id", body.documentId).eq("owner_user_id", auth.user.id).maybeSingle();
  if (previous.data) {
    const existing = await auth.db.from("phr_lab_results").select("id, analyte, value_num, value_text, unit, ref_low, ref_high, ref_text, flag, observed_at, source, source_sentence, loinc_code").eq("import_id", previous.data.id).order("analyte");
    if (existing.data?.length && body.rematch) {
      const pending = existing.data.map((row, originalIndex) => ({ row, originalIndex })).filter(({ row }) => !row.loinc_code);
      if (!pending.length) return NextResponse.json({ duplicate: true, created: existing.data.length, loincMapped: existing.data.length, warnings: ["Todos los resultados ya tienen agrupación LOINC."] });
      const rows = pending.map(({ row }) => ({ analyte: row.analyte, valueNum: row.value_num, valueText: row.value_text, unit: row.unit, refLow: row.ref_low, refHigh: row.ref_high, refText: row.ref_text, flag: row.flag, observedAt: row.observed_at, source: row.source, sourceSentence: row.source_sentence })) as LabCandidate[];
      const matched = await matchPhrLoinc(auth.db, auth.user.id, rows);
      const updates = await Promise.all([...matched.loincByIndex].map(([index, code]) => auth.db.from("phr_lab_results").update({ loinc_code: code }).eq("id", existing.data[pending[index].originalIndex].id).eq("owner_user_id", auth.user.id)));
      const applied = updates.filter((result) => !result.error).length;
      if (applied < updates.length) matched.warnings.push("Algunas homologaciones no pudieron guardarse y permanecen pendientes.");
      return NextResponse.json({ duplicate: true, created: existing.data.length, loincMapped: existing.data.length - pending.length + applied, warnings: matched.warnings });
    }
    if (existing.data?.length) return NextResponse.json({ duplicate: true, created: existing.data.length, loincMapped: existing.data.filter((row) => row.loinc_code).length, warnings: previous.data.warnings ?? [] });
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
  const matched = await matchPhrLoinc(auth.db, auth.user.id, candidates);
  warnings.push(...matched.warnings);
  const fallbackDate = document.data.document_date ?? document.data.created_at.slice(0, 10);
  if (candidates.some((row) => !row.observedAt)) warnings.push("No se encontró fecha de muestra en todas las filas; se usó la fecha del documento.");
  const extractionMethod = !prepared.needsAi ? "local" : prepared.scanned ? "ai_visual" : "ai_text";
  const imported = await auth.db.from("phr_lab_imports").insert({
    owner_user_id: auth.user.id, document_id: body.documentId, extraction_method: extractionMethod,
    patient_name: extractedName, patient_identifier: extractedIdentifier, warnings,
  }).select("id").single();
  if (imported.error) return NextResponse.json({ error: "No fue posible registrar el análisis." }, { status: 502 });

  const inserted = await auth.db.from("phr_lab_results").insert(candidates.map((row, index) => ({
    owner_user_id: auth.user.id, document_id: body.documentId, import_id: imported.data.id, loinc_code: matched.loincByIndex.get(index) ?? "",
    analyte: row.analyte, value_num: row.valueNum, value_text: row.valueText, unit: row.unit,
    ref_low: row.refLow, ref_high: row.refHigh, ref_text: row.refText, flag: row.flag,
    observed_at: dateOr(row.observedAt || prepared.observedAt || aiResult?.extraction.observedAt || "", fallbackDate),
    source: row.source, source_sentence: row.sourceSentence, review_status: "suggested",
  }))).select("id");
  if (inserted.error) {
    await auth.db.from("phr_lab_imports").delete().eq("id", imported.data.id);
    return NextResponse.json({ error: "No fue posible guardar las sugerencias." }, { status: 502 });
  }
  return NextResponse.json({ created: inserted.data?.length ?? 0, loincMapped: matched.loincByIndex.size, duplicate: false, warnings });
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePhrApi(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => ({})) as { resultId?: string; confirm?: boolean; analyte?: string; value?: string; unit?: string; reference?: string; observedAt?: string };
  if (!body.resultId) return NextResponse.json({ error: "Resultado inválido." }, { status: 400 });
  const validated = validatePhrLabDraft({ analyte: body.analyte ?? "", value: body.value ?? "", unit: body.unit ?? "", reference: body.reference ?? "", observedAt: body.observedAt ?? "" });
  if ("error" in validated) return NextResponse.json({ error: validated.error }, { status: 400 });
  const current = await auth.db.from("phr_lab_results").select("flag, analyte, unit, loinc_code").eq("id", body.resultId).eq("owner_user_id", auth.user.id).eq("review_status", "suggested").maybeSingle();
  if (!current.data) return NextResponse.json({ error: "La sugerencia ya no está disponible para edición." }, { status: 404 });
  const keepExplicitFlag = ["abnormal", "critical_low", "critical_high"].includes(current.data.flag);
  const value = validated.value;
  const updated = await auth.db.from("phr_lab_results").update({
    analyte: value.analyte, value_num: value.valueNum, value_text: value.valueText, unit: value.unit,
    ref_low: value.refLow, ref_high: value.refHigh, ref_text: value.refText,
    flag: keepExplicitFlag ? current.data.flag : value.flag, observed_at: value.observedAt,
    loinc_code: normalizeIdentity(value.analyte) === normalizeIdentity(current.data.analyte) && normalizeIdentity(value.unit) === normalizeIdentity(current.data.unit) ? current.data.loinc_code : "",
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
