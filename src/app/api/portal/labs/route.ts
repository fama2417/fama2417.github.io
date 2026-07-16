import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, rgb } from "pdf-lib";
import { extractTextItems } from "unpdf";
import { aiConfig } from "@/features/reports/ai-budget.ts";
import { dedupeLabCandidates, groupLabLayoutPages, labSourceHighlight, loincSearchQueries, normalizeIdentity, prepareLabPdf, structureLabDocument, suggestLabLoinc, suggestLabLoincSearchTerms, type LabCandidate } from "@/features/reports/lab-ai.ts";
import { phrSpecimenClass, reusedPhrLoinc, validatePhrLabDraft, vettedPhrLabIdentity } from "@/features/patient-portal/labs.ts";
import { isAnalyzableLabDocument, labImageMime } from "@/features/patient-portal/documents.ts";
import { recordPhrEvent } from "@/lib/phr-events";
import { requirePhrApi } from "@/lib/server-auth";

const MAX_BYTES = 10 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const dateOr = (value: string, fallback: string) => validDate(value) ? value : fallback;
type LoincOption = { code: string; display: string };

const specimenOf = (row: { specimen?: string; source_sentence?: string; sourceSentence?: string }) => row.specimen ?? (row.source_sentence ?? row.sourceSentence ?? "").match(/(?:^|\|)\s*Muestra:\s*([^|]+)$/i)?.[1]?.trim() ?? "";
const mappingKey = (row: { analyte: string; unit: string; specimen?: string; source_sentence?: string; sourceSentence?: string }) => `${normalizeIdentity(row.analyte)}|${normalizeIdentity(row.unit)}|${phrSpecimenClass(specimenOf(row))}`;
const individualOption = (row: LabCandidate, option: LoincOption) => !/\bpanel\b/i.test(option.display) && !(row.valueNum !== null && !!row.unit && /\[(?:presence|arbitrary)/i.test(option.display));

async function matchPhrLoinc(db: any, ownerUserId: string, rows: LabCandidate[], useAi: boolean, sourceInstitution = "") {
  const warnings: string[] = [], loincByIndex = new Map<number, string>(), optionsByIndex = new Map<number, LoincOption[]>();
  const catalog = await db.from("terminology_codes").select("code", { count: "exact", head: true }).eq("system", "LOINC");
  if (catalog.error || !catalog.count) return { loincByIndex, optionsByIndex, warnings: [catalog.error ? "No fue posible consultar el catálogo LOINC." : "El catálogo LOINC está vacío; debe cargarse para homologar resultados."] };

  const vetted = rows.map((row, index) => ({ index, identity: vettedPhrLabIdentity({ analyte: row.analyte, unit: row.unit, specimen: specimenOf(row) }) })).filter((row) => row.identity);
  if (vetted.length) {
    const codes = [...new Set(vetted.map((row) => row.identity!.code))];
    const known = await db.from("terminology_codes").select("code").eq("system", "LOINC").in("code", codes);
    const existing = new Set((known.data ?? []).map((row: { code: string }) => row.code));
    vetted.forEach((row) => { if (existing.has(row.identity!.code)) loincByIndex.set(row.index, row.identity!.code); });
  }

  const learned = await db.from("phr_lab_term_mappings").select("analyte_key, unit_key, specimen_class, loinc_code").eq("source_institution", normalizeIdentity(sourceInstitution));
  const learnedByKey = new Map<string, string>((learned.data ?? []).map((row: { analyte_key: string; unit_key: string; specimen_class: string; loinc_code: string }) => [`${row.analyte_key}|${row.unit_key}|${row.specimen_class}`, row.loinc_code]));
  rows.forEach((row, index) => { const code = learnedByKey.get(mappingKey(row)); if (!loincByIndex.has(index) && code) loincByIndex.set(index, code); });

  const prior = await db.from("phr_lab_results").select("analyte, unit, loinc_code, source_sentence")
    .eq("owner_user_id", ownerUserId).eq("review_status", "confirmed").neq("loinc_code", "");
  for (const [index, code] of reusedPhrLoinc(rows.map((row) => ({ ...row, specimen: specimenOf(row) })), (prior.data ?? []).map((row: { analyte: string; unit: string; loinc_code: string; source_sentence: string }) => ({ analyte: row.analyte, unit: row.unit, loincCode: row.loinc_code, specimen: specimenOf(row) })))) if (!loincByIndex.has(index)) loincByIndex.set(index, code);

  const unresolved = rows.map((row, index) => ({ row, index })).filter(({ index }) => !loincByIndex.has(index));
  const config = aiConfig();
  if (!unresolved.length || !useAi) return { loincByIndex, optionsByIndex, warnings };
  if (!config.enabled || !process.env.OPENAI_API_KEY) return { loincByIndex, optionsByIndex, warnings: ["La IA no está habilitada para homologar analitos nuevos con LOINC."] };

  try {
    const search = async (queries: string[]) => {
      const found = new Map<string, string>();
      for (const term of [...new Set(queries.filter(Boolean))]) {
        const result = await db.rpc("search_terminology", { p_system: "LOINC", p_term: term });
        if (result.error) continue;
        for (const candidate of result.data ?? []) if (!found.has(candidate.code)) found.set(candidate.code, candidate.display);
        if (found.size >= 8) break;
      }
      return [...found].slice(0, 8).map(([code, display]) => ({ code, display }));
    };
    const candidateSets = await Promise.all(unresolved.map(({ row }) => search(loincSearchQueries(row.analyte))));
    const missing = candidateSets.map((options, index) => ({ options, index })).filter(({ options }) => !options.length);
    const englishTerms = new Map<number, string>();
    if (missing.length) {
      const translated = await suggestLabLoincSearchTerms(missing.map(({ index }) => unresolved[index].row));
      translated.terms.forEach((row) => { const target = missing[Number(row.sourceId)]; if (target) englishTerms.set(target.index, row.searchTerm); });
      await Promise.all(missing.map(async ({ index }) => { candidateSets[index] = await search(loincSearchQueries(englishTerms.get(index) ?? "")); }));
    }
    candidateSets.forEach((options, index) => { candidateSets[index] = options.filter((option) => individualOption(unresolved[index].row, option)); });
    const suggested = await suggestLabLoinc(unresolved.map(({ row }) => row), unresolved.map((_, index) => englishTerms.get(index) ?? ""), candidateSets);
    const preferred = new Map(suggested.suggestions.map((row) => [row.sourceId, row.loincCode.trim()]));
    candidateSets.forEach((options, index) => {
      const code = preferred.get(String(index));
      const ranked = code ? [...options].sort((a, b) => Number(b.code === code) - Number(a.code === code)) : options;
      if (ranked.length) optionsByIndex.set(unresolved[index].index, ranked.slice(0, 3));
    });
    warnings.push(`${loincByIndex.size} de ${rows.length} analitos reutilizaron una equivalencia verificada. La IA sólo ordenó alternativas existentes; no asignó códigos por sí sola.`);
  } catch { warnings.push("No fue posible completar la homologación LOINC; los resultados siguen disponibles para revisión."); }
  return { loincByIndex, optionsByIndex, warnings };
}

export async function GET(request: NextRequest) {
  const auth = await requirePhrApi(request);
  if (auth instanceof NextResponse) return auth;
  const resultId = request.nextUrl.searchParams.get("resultId") ?? "";
  if (!uuid.test(resultId)) return NextResponse.json({ error: "Resultado inválido." }, { status: 400 });
  const result = await auth.db.from("phr_lab_results").select("document_id, source_sentence").eq("id", resultId).eq("owner_user_id", auth.user.id).maybeSingle();
  if (!result.data) return NextResponse.json({ error: "Resultado inexistente." }, { status: 404 });
  const document = await auth.db.from("patient_documents").select("storage_path, mime_type").eq("id", result.data.document_id).eq("owner_user_id", auth.user.id).maybeSingle();
  if (!document.data || !isAnalyzableLabDocument(document.data.mime_type)) return NextResponse.json({ error: "El documento fuente no es compatible." }, { status: 404 });
  const downloaded = await auth.db.storage.from("patient-documents").download(document.data.storage_path);
  if (downloaded.error) return NextResponse.json({ error: "No fue posible abrir el documento fuente." }, { status: 502 });
  const original = new Uint8Array(await downloaded.data.arrayBuffer());
  if (document.data.mime_type !== "application/pdf") {
    return new NextResponse(Buffer.from(original), { headers: { "Content-Type": document.data.mime_type, "Content-Disposition": "inline; filename=fuente-laboratorio", "Cache-Control": "private, no-store", "X-PHR-Highlight": "false", "X-PHR-Page": "1" } });
  }
  let output = Buffer.from(original), highlighted = false, sourcePage = 1;
  const [sourceId, sourceAnalyte, sourceValue] = result.data.source_sentence.split(/\s+\|\s+/);
  const locator = sourceId?.match(/^p(\d+)-r\d+$/);
  if (locator) sourcePage = Number(locator[1]);
  if (locator && sourceValue) {
    try {
      const pageNumber = Number(locator[1]), extracted = await extractTextItems(original.slice());
      const row = groupLabLayoutPages(extracted.items)[pageNumber - 1]?.find((item) => item.id === sourceId);
      const box = row && labSourceHighlight(row.items, sourceValue, sourceAnalyte);
      if (box) {
        const pdf = await PDFDocument.load(original), page = pdf.getPages()[pageNumber - 1];
        page?.drawRectangle({ x: box.x - 3, y: box.y - 2, width: box.width + 6, height: box.height + 4, color: rgb(1, .86, .18), opacity: .38, borderColor: rgb(.92, .62, 0), borderWidth: 1 });
        output = Buffer.from(await pdf.save()); highlighted = !!page;
      }
    } catch { /* El PDF original sigue disponible aunque no tenga coordenadas utilizables. */ }
  }
  return new NextResponse(output, { headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline; filename=fuente-laboratorio.pdf", "Cache-Control": "private, no-store", "X-PHR-Highlight": highlighted ? "true" : "false", "X-PHR-Page": String(sourcePage) } });
}

export async function POST(request: NextRequest) {
  const auth = await requirePhrApi(request);
  if (auth instanceof NextResponse) return auth;
  const startedAt = Date.now();
  const body = await request.json().catch(() => ({})) as { documentId?: string; rematch?: boolean; rescan?: boolean; suggestLoinc?: boolean };
  if (!body.documentId) return NextResponse.json({ error: "Documento inválido." }, { status: 400 });

  const document = await auth.db.from("patient_documents")
    .select("id, storage_path, mime_type, size_bytes, document_date, source_institution, created_at")
    .eq("id", body.documentId).eq("owner_user_id", auth.user.id).eq("document_type", "laboratory").maybeSingle();
  if (!document.data) return NextResponse.json({ error: "Laboratorio inexistente." }, { status: 404 });
  if (!isAnalyzableLabDocument(document.data.mime_type)) return NextResponse.json({ error: "La extracción de laboratorio acepta PDF, JPG o PNG." }, { status: 415 });
  if (document.data.size_bytes > MAX_BYTES) return NextResponse.json({ error: "El archivo supera los 10 MB permitidos para análisis." }, { status: 413 });

  let previousImportId = "";
  let existingRows: any[] = [];
  const previous = await auth.db.from("phr_lab_imports").select("id, warnings").eq("document_id", body.documentId).eq("owner_user_id", auth.user.id).maybeSingle();
  if (previous.data) {
    const existing = await auth.db.from("phr_lab_results").select("id, analyte, value_num, value_text, unit, ref_low, ref_high, ref_text, flag, observed_at, source, source_sentence, loinc_code, review_status").eq("import_id", previous.data.id).order("analyte");
    existingRows = existing.data ?? [];
    if (body.suggestLoinc) {
      const pending = existingRows.filter((row) => !row.loinc_code || (vettedPhrLabIdentity({ analyte: row.analyte, unit: row.unit, specimen: specimenOf(row) })?.code ?? row.loinc_code) !== row.loinc_code);
      if (!pending.length) return NextResponse.json({ suggestions: [], warnings: ["No se detectaron homologaciones pendientes o incompatibles."] });
      const rows = pending.map((row) => ({ analyte: row.analyte, valueNum: row.value_num, valueText: row.value_text, unit: row.unit, refLow: row.ref_low, refHigh: row.ref_high, refText: row.ref_text, flag: row.flag, observedAt: row.observed_at, source: row.source, sourceSentence: row.source_sentence, specimen: row.source_sentence.match(/(?:^|\|)\s*Muestra:\s*([^|]+)$/i)?.[1]?.trim() })) as LabCandidate[];
      const matched = await matchPhrLoinc(auth.db, auth.user.id, rows, true, document.data.source_institution);
      const reusedCodes = [...new Set(matched.loincByIndex.values())];
      const reused = reusedCodes.length ? await auth.db.from("terminology_codes").select("code, display").eq("system", "LOINC").in("code", reusedCodes) : { data: [], error: null };
      const reusedDisplay = new Map((reused.data ?? []).map((row: { code: string; display: string }) => [row.code, row.display]));
      const suggestions = pending.map((row, index) => {
        const reusedCode = matched.loincByIndex.get(index);
        const options = reusedCode ? [{ code: reusedCode, display: reusedDisplay.get(reusedCode) ?? reusedCode }] : matched.optionsByIndex.get(index) ?? [];
        return { resultId: row.id, analyte: row.analyte, currentCode: row.loinc_code, recommendedCode: reusedCode ?? "", options };
      });
      return NextResponse.json({ suggestions, warnings: matched.warnings });
    }
    if (body.rescan && existingRows.length) previousImportId = previous.data.id;
    if (existing.data?.length && body.rematch && !body.rescan) {
      const pending = existing.data.map((row, originalIndex) => ({ row, originalIndex })).filter(({ row }) => !row.loinc_code || (vettedPhrLabIdentity({ analyte: row.analyte, unit: row.unit, specimen: specimenOf(row) })?.code ?? row.loinc_code) !== row.loinc_code);
      if (!pending.length) return NextResponse.json({ duplicate: true, created: existing.data.length, loincMapped: existing.data.length, warnings: ["Todos los resultados ya tienen agrupación LOINC."] });
      const rows = pending.map(({ row }) => ({ analyte: row.analyte, valueNum: row.value_num, valueText: row.value_text, unit: row.unit, refLow: row.ref_low, refHigh: row.ref_high, refText: row.ref_text, flag: row.flag, observedAt: row.observed_at, source: row.source, sourceSentence: row.source_sentence, specimen: row.source_sentence.match(/(?:^|\|)\s*Muestra:\s*([^|]+)$/i)?.[1]?.trim() })) as LabCandidate[];
      const matched = await matchPhrLoinc(auth.db, auth.user.id, rows, true, document.data.source_institution);
      const updates = await Promise.all([...matched.loincByIndex].map(([index, code]) => auth.db.from("phr_lab_results").update({ loinc_code: code }).eq("id", existing.data[pending[index].originalIndex].id).eq("owner_user_id", auth.user.id)));
      const applied = updates.filter((result) => !result.error).length;
      if (applied < updates.length) matched.warnings.push("Algunas homologaciones no pudieron guardarse y permanecen pendientes.");
      return NextResponse.json({ duplicate: true, created: existing.data.length, loincMapped: existing.data.length - pending.length + applied, warnings: matched.warnings });
    }
    if (existing.data?.length && !body.rescan) return NextResponse.json({ duplicate: true, created: existing.data.length, loincMapped: existing.data.filter((row) => row.loinc_code).length, warnings: previous.data.warnings ?? [] });
    if (!existing.data?.length) await auth.db.from("phr_lab_imports").delete().eq("id", previous.data.id).eq("owner_user_id", auth.user.id);
  }

  const downloaded = await auth.db.storage.from("patient-documents").download(document.data.storage_path);
  if (downloaded.error || !downloaded.data) return NextResponse.json({ error: "No fue posible leer el archivo original." }, { status: 502 });
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  const imageMime = labImageMime(document.data.mime_type);
  let prepared: Awaited<ReturnType<typeof prepareLabPdf>>;
  if (imageMime) prepared = { patientName: "", patientIdentifier: "", observedAt: "", observations: [], aiText: "", scanned: true, needsAi: true, pageCount: 1 };
  else {
    try { prepared = await prepareLabPdf(bytes); }
    catch { await recordPhrEvent(auth.db, auth.user.id, "lab_analysis_failed", body.documentId, { method: "local", stage: "parse", duration_ms: Date.now() - startedAt }); return NextResponse.json({ error: "No fue posible interpretar el PDF." }, { status: 422 }); }
  }

  let rows: LabCandidate[] = prepared.observations;
  let aiResult: Awaited<ReturnType<typeof structureLabDocument>> | null = null;
  if (imageMime) {
    const config = aiConfig();
    if (!config.enabled || !process.env.OPENAI_API_KEY) return NextResponse.json({ error: "Este archivo necesita reconocimiento visual y la extracción automática no está habilitada." }, { status: 503 });
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    const usage = await auth.db.from("phr_lab_imports").select("id", { count: "exact", head: true })
      .eq("owner_user_id", auth.user.id).in("extraction_method", ["ai_text", "ai_visual"]).gte("created_at", start.toISOString());
    const limit = Math.max(1, Number(process.env.PHR_AI_MAX_PER_DAY ?? 5));
    if ((usage.count ?? 0) >= limit) return NextResponse.json({ error: "Alcanzaste el límite diario de análisis automáticos." }, { status: 429 });
    try {
      aiResult = await structureLabDocument({
        procedureName: "Laboratorio personal",
        imageBytes: bytes, imageMime,
      });
      rows = aiResult.observations;
    } catch { await recordPhrEvent(auth.db, auth.user.id, "lab_analysis_failed", body.documentId, { method: "ai_visual", stage: "recognition", duration_ms: Date.now() - startedAt }); return NextResponse.json({ error: "No fue posible extraer resultados de este archivo." }, { status: 502 }); }
  }

  const extractedName = prepared.patientName || aiResult?.extraction.patientName || "";
  const extractedIdentifier = prepared.patientIdentifier || aiResult?.extraction.patientIdentifier || "";
  const profileIdentifier = auth.profile.identifier.trim();
  const warnings = [...(aiResult?.extraction.warnings ?? [])];
  if (prepared.scanned) warnings.push("El PDF era un escaneo sin texto y se leyó con OCR local; revisa cada cifra antes de confirmarla.");
  if (!imageMime && prepared.needsAi) warnings.push("El PDF se leyó sólo localmente y puede contener filas que requieren corrección manual; no se envió contenido a IA.");
  if (extractedIdentifier && profileIdentifier) {
    if (normalizeIdentity(extractedIdentifier) !== normalizeIdentity(profileIdentifier)) return NextResponse.json({ error: "La identidad del archivo no coincide con tu perfil. No se guardó ningún resultado." }, { status: 422 });
  } else if (extractedName) {
    if (normalizeIdentity(extractedName) !== normalizeIdentity(auth.profile.full_name)) return NextResponse.json({ error: "El nombre del archivo no coincide con tu perfil. No se guardó ningún resultado." }, { status: 422 });
  } else warnings.push("No se encontró identidad en el archivo; revisa cuidadosamente cada resultado antes de confirmarlo.");

  let candidates = dedupeLabCandidates(rows).filter((row) => row.analyte && (row.valueNum !== null || row.valueText));
  if (previousImportId) {
    const existingSourceIds = new Set(existingRows.map((row) => String(row.source_sentence).split(/\s+\|\s+/)[0]).filter(Boolean));
    candidates = candidates.filter((row) => !existingSourceIds.has(row.sourceSentence.split(/\s+\|\s+/)[0]));
    if (!candidates.length) return NextResponse.json({ duplicate: true, created: 0, loincMapped: existingRows.filter((row) => row.loinc_code).length, warnings: ["La relectura no encontró resultados nuevos."] });
  }
  if (!candidates.length) { await recordPhrEvent(auth.db, auth.user.id, "lab_analysis_failed", body.documentId, { method: imageMime ? "ai_visual" : "local", stage: "no_results", duration_ms: Date.now() - startedAt }); return NextResponse.json({ error: "No se detectaron resultados para revisar." }, { status: 422 }); }
  const matched = await matchPhrLoinc(auth.db, auth.user.id, candidates, !!imageMime, document.data.source_institution);
  warnings.push(...matched.warnings);
  const fallbackDate = document.data.document_date ?? document.data.created_at.slice(0, 10);
  if (candidates.some((row) => !row.observedAt)) warnings.push("No se encontró fecha de muestra en todas las filas; se usó la fecha del documento.");
  const extractionMethod = imageMime ? "ai_visual" : "local";
  const imported = previousImportId
    ? await auth.db.from("phr_lab_imports").update({ extraction_method: extractionMethod, patient_name: extractedName, patient_identifier: extractedIdentifier, warnings }).eq("id", previousImportId).eq("owner_user_id", auth.user.id).select("id").single()
    : await auth.db.from("phr_lab_imports").insert({ owner_user_id: auth.user.id, document_id: body.documentId, extraction_method: extractionMethod, patient_name: extractedName, patient_identifier: extractedIdentifier, warnings }).select("id").single();
  if (imported.error) { await recordPhrEvent(auth.db, auth.user.id, "lab_analysis_failed", body.documentId, { method: extractionMethod, stage: "import", duration_ms: Date.now() - startedAt }); return NextResponse.json({ error: "No fue posible registrar el análisis." }, { status: 502 }); }

  const inserted = await auth.db.from("phr_lab_results").insert(candidates.map((row, index) => ({
    owner_user_id: auth.user.id, document_id: body.documentId, import_id: imported.data.id, loinc_code: matched.loincByIndex.get(index) ?? "",
    analyte: row.analyte, value_num: row.valueNum, value_text: row.valueText, unit: row.unit,
    ref_low: row.refLow, ref_high: row.refHigh, ref_text: row.refText, flag: row.flag,
    observed_at: dateOr(row.observedAt || prepared.observedAt || aiResult?.extraction.observedAt || "", fallbackDate),
    source: row.source, source_sentence: row.sourceSentence, review_status: "suggested",
  }))).select("id");
  if (inserted.error) {
    if (!previousImportId) await auth.db.from("phr_lab_imports").delete().eq("id", imported.data.id);
    await recordPhrEvent(auth.db, auth.user.id, "lab_analysis_failed", body.documentId, { method: extractionMethod, stage: "results", duration_ms: Date.now() - startedAt });
    return NextResponse.json({ error: "No fue posible guardar las sugerencias." }, { status: 502 });
  }
  await recordPhrEvent(auth.db, auth.user.id, "lab_analysis_completed", body.documentId, { method: extractionMethod, duration_ms: Date.now() - startedAt, result_count: inserted.data?.length ?? 0, loinc_mapped: matched.loincByIndex.size, warning_count: warnings.length });
  return NextResponse.json({ created: inserted.data?.length ?? 0, loincMapped: matched.loincByIndex.size, duplicate: !!previousImportId, warnings });
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePhrApi(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => ({})) as { resultId?: string; resultIds?: string[]; confirm?: boolean; analyte?: string; value?: string; unit?: string; reference?: string; observedAt?: string; loincSelections?: { resultId: string; loincCode: string }[] };
  if (Array.isArray(body.loincSelections)) {
    const selections = body.loincSelections.filter((item) => uuid.test(item?.resultId ?? "") && /^\d{1,7}-\d$/.test(item?.loincCode ?? "")).slice(0, 100);
    if (!selections.length || selections.length !== body.loincSelections.length) return NextResponse.json({ error: "Selecciones LOINC inválidas." }, { status: 400 });
    const resultIds = [...new Set(selections.map((item) => item.resultId))];
    if (resultIds.length !== selections.length) return NextResponse.json({ error: "Cada resultado debe tener una sola selección LOINC." }, { status: 400 });
    const targets = await auth.db.from("phr_lab_results").select("id, document_id, analyte, value_num, unit, source_sentence").eq("owner_user_id", auth.user.id).in("id", resultIds);
    if (targets.error || targets.data?.length !== resultIds.length) return NextResponse.json({ error: "Uno o más resultados ya no están disponibles." }, { status: 404 });
    const codes = [...new Set(selections.map((item) => item.loincCode))];
    const known = await auth.db.from("terminology_codes").select("code, display").eq("system", "LOINC").in("code", codes);
    const knownByCode = new Map((known.data ?? []).map((row: { code: string; display: string }) => [row.code, row.display]));
    if (known.error || knownByCode.size !== codes.length) return NextResponse.json({ error: "Uno o más códigos LOINC no existen en el catálogo." }, { status: 400 });
    const targetById = new Map((targets.data ?? []).map((row) => [row.id, row]));
    if (selections.some((item) => { const target = targetById.get(item.resultId), display = knownByCode.get(item.loincCode) ?? ""; return /\bpanel\b/i.test(display) || (target?.value_num !== null && !!target?.unit && /\[(?:presence|arbitrary)/i.test(display)); })) return NextResponse.json({ error: "Una selección corresponde a un panel o a una medición incompatible con el resultado." }, { status: 400 });
    const updates = await Promise.all(selections.map((item) => auth.db.from("phr_lab_results").update({ loinc_code: item.loincCode }).eq("id", item.resultId).eq("owner_user_id", auth.user.id).select("id")));
    if (updates.some((result) => result.error)) return NextResponse.json({ error: "No fue posible guardar todas las selecciones LOINC." }, { status: 502 });
    const documentIds = [...new Set((targets.data ?? []).map((row) => row.document_id))];
    const documents = await auth.db.from("patient_documents").select("id, source_institution").eq("owner_user_id", auth.user.id).in("id", documentIds);
    const institutionByDocument = new Map((documents.data ?? []).map((row) => [row.id, row.source_institution]));
    await auth.db.from("phr_lab_term_mappings").upsert(selections.map((item) => { const target = targetById.get(item.resultId)!; return {
      source_institution: normalizeIdentity(institutionByDocument.get(target.document_id) ?? ""), analyte_key: normalizeIdentity(target.analyte), unit_key: normalizeIdentity(target.unit),
      specimen_class: phrSpecimenClass(specimenOf(target)), loinc_code: item.loincCode, updated_at: new Date().toISOString(),
    }; }), { onConflict: "source_institution,analyte_key,unit_key,specimen_class" });
    return NextResponse.json({ updated: updates.reduce((sum, result) => sum + (result.data?.length ?? 0), 0) });
  }
  if (Array.isArray(body.resultIds)) {
    const ids = [...new Set(body.resultIds)].filter((id) => uuid.test(id)).slice(0, 200);
    if (!ids.length || ids.length !== body.resultIds.length || body.confirm !== true) return NextResponse.json({ error: "Resultados inválidos." }, { status: 400 });
    const pending = await auth.db.from("phr_lab_results").select("created_at").eq("owner_user_id", auth.user.id).eq("review_status", "suggested").in("id", ids);
    const updated = await auth.db.from("phr_lab_results").update({ review_status: "confirmed" }).eq("owner_user_id", auth.user.id).eq("review_status", "suggested").in("id", ids).select("id");
    if (updated.error) return NextResponse.json({ error: "No fue posible confirmar los resultados." }, { status: 502 });
    const first = (pending.data ?? []).map((row) => Date.parse(row.created_at)).filter(Number.isFinite).sort((a, b) => a - b)[0];
    await recordPhrEvent(auth.db, auth.user.id, "lab_results_confirmed", undefined, { result_count: updated.data?.length ?? 0, bulk: true, review_seconds: first ? Math.max(0, Math.round((Date.now() - first) / 1000)) : null });
    return NextResponse.json({ confirmed: updated.data?.length ?? 0 });
  }
  if (!body.resultId) return NextResponse.json({ error: "Resultado inválido." }, { status: 400 });
  const validated = validatePhrLabDraft({ analyte: body.analyte ?? "", value: body.value ?? "", unit: body.unit ?? "", reference: body.reference ?? "", observedAt: body.observedAt ?? "" });
  if ("error" in validated) return NextResponse.json({ error: validated.error }, { status: 400 });
  const current = await auth.db.from("phr_lab_results").select("flag, analyte, unit, loinc_code, document_id, created_at").eq("id", body.resultId).eq("owner_user_id", auth.user.id).eq("review_status", "suggested").maybeSingle();
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
  if (updated.error) return NextResponse.json({ error: "No fue posible actualizar el resultado." }, { status: 502 });
  if (body.confirm === true) await recordPhrEvent(auth.db, auth.user.id, "lab_results_confirmed", current.data.document_id, { result_count: 1, bulk: false, review_seconds: Math.max(0, Math.round((Date.now() - Date.parse(current.data.created_at)) / 1000)) });
  return NextResponse.json({ ok: true });
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
