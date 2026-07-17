import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, rgb } from "pdf-lib";
import { extractTextItems } from "unpdf";
import { aiConfig } from "@/features/reports/ai-budget.ts";
import { dedupeLabCandidates, groupLabLayoutPages, labAnalyteSimilarity, labSourceHighlight, labSourcePage, loincSearchQueries, normalizeIdentity, prepareLabPdf, shouldUseAiForScannedPdf, structureLabDocument, suggestLabLoinc, suggestLabLoincSearchTerms, type LabCandidate } from "@/features/reports/lab-ai.ts";
import { phrLoincDecision, phrSpecimenClass, reusedPhrLoinc, validatePhrLabDraft, vettedPhrLabIdentity } from "@/features/patient-portal/labs.ts";
import { isAnalyzableLabDocument, labImageMime } from "@/features/patient-portal/documents.ts";
import { recordPhrEvent } from "@/lib/phr-events";
import { extractScannedPdfPage } from "@/lib/pdf-ocr";
import { requirePhrApi } from "@/lib/server-auth";

const MAX_BYTES = 10 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const dateOr = (value: string, fallback: string) => validDate(value) ? value : fallback;
type LoincOption = {
  code: string; display: string; score: number; component?: string; property?: string;
  specimen?: string; scaleType?: string; methodType?: string; className?: string; exampleUcumUnits?: string;
};

const specimenOf = (row: { specimen?: string; source_sentence?: string; sourceSentence?: string }) => row.specimen ?? (row.source_sentence ?? row.sourceSentence ?? "").match(/(?:^|\|)\s*Muestra:\s*([^|]+)$/i)?.[1]?.trim() ?? "";
const mappingKey = (row: { analyte: string; unit: string; specimen?: string; source_sentence?: string; sourceSentence?: string }) => `${normalizeIdentity(row.analyte)}|${normalizeIdentity(row.unit)}|${phrSpecimenClass(specimenOf(row))}`;
const individualOption = (row: LabCandidate, option: LoincOption) => {
  if (/\bpanel\b/i.test(option.display) || option.className?.startsWith("PANEL.")) return false;
  if (row.valueNum !== null && !!row.unit && (/\[(?:presence|arbitrary)/i.test(option.display) || /^(?:Ord|Nom)$/.test(option.scaleType ?? ""))) return false;
  const wanted = phrSpecimenClass(specimenOf(row)), actual = phrSpecimenClass(option.specimen);
  return !wanted || !actual || wanted === actual;
};

async function preferredLoincDisplays(db: any, codes: string[]) {
  if (!codes.length) return new Map<string, string>();
  const [terms, designations] = await Promise.all([
    db.from("terminology_codes").select("code, display").eq("system", "LOINC").in("code", codes),
    db.from("terminology_designations").select("code, display, language_variant").eq("system", "LOINC").in("code", codes),
  ]);
  const displays = new Map<string, string>((terms.data ?? []).map((row: { code: string; display: string }) => [row.code, row.display]));
  const preferred = new Set<string>();
  const languageRank = (value: string) => { const rank = ["esCL", "esES", "esMX", "esAR"].indexOf(value); return rank < 0 ? 99 : rank; };
  for (const row of [...(designations.data ?? [])].sort((a, b) => languageRank(a.language_variant) - languageRank(b.language_variant))) {
    if (!preferred.has(row.code)) { displays.set(row.code, row.display); preferred.add(row.code); }
  }
  return displays;
}

async function matchPhrLoinc(db: any, ownerUserId: string, rows: LabCandidate[], useAi: boolean, sourceInstitution = "") {
  const warnings: string[] = [], loincByIndex = new Map<number, string>(), suggestedByIndex = new Map<number, string>();
  const confidenceByIndex = new Map<number, number>(), canonicalByIndex = new Map<number, string>(), optionsByIndex = new Map<number, LoincOption[]>();
  const finish = async () => {
    const displays = await preferredLoincDisplays(db, [...new Set([...loincByIndex.values(), ...suggestedByIndex.values()])]);
    for (const [index, code] of [...loincByIndex, ...suggestedByIndex]) canonicalByIndex.set(index, displays.get(code) ?? rows[index].analyte);
    return { loincByIndex, suggestedByIndex, confidenceByIndex, canonicalByIndex, optionsByIndex, warnings };
  };
  const catalog = await db.from("terminology_codes").select("code", { count: "exact", head: true }).eq("system", "LOINC");
  if (catalog.error || !catalog.count) { warnings.push(catalog.error ? "No fue posible consultar el catálogo LOINC." : "El catálogo LOINC está vacío; debe cargarse para homologar resultados."); return finish(); }

  const vetted = rows.map((row, index) => ({ index, identity: vettedPhrLabIdentity({ analyte: row.analyte, unit: row.unit, specimen: specimenOf(row) }) })).filter((row) => row.identity);
  if (vetted.length) {
    const codes = [...new Set(vetted.map((row) => row.identity!.code))];
    const known = await db.from("terminology_codes").select("code").eq("system", "LOINC").in("code", codes);
    const existing = new Set((known.data ?? []).map((row: { code: string }) => row.code));
    vetted.forEach((row) => { if (existing.has(row.identity!.code)) { loincByIndex.set(row.index, row.identity!.code); confidenceByIndex.set(row.index, 1); } });
  }

  const learned = await db.from("phr_lab_term_mappings").select("analyte_key, unit_key, specimen_class, loinc_code").eq("source_institution", normalizeIdentity(sourceInstitution));
  const learnedByKey = new Map<string, string>((learned.data ?? []).map((row: { analyte_key: string; unit_key: string; specimen_class: string; loinc_code: string }) => [`${row.analyte_key}|${row.unit_key}|${row.specimen_class}`, row.loinc_code]));
  rows.forEach((row, index) => { const code = learnedByKey.get(mappingKey(row)); if (!loincByIndex.has(index) && code) { loincByIndex.set(index, code); confidenceByIndex.set(index, 1); } });

  const prior = await db.from("phr_lab_results").select("analyte, unit, loinc_code, source_sentence")
    .eq("owner_user_id", ownerUserId).eq("review_status", "confirmed").neq("loinc_code", "");
  for (const [index, code] of reusedPhrLoinc(rows.map((row) => ({ ...row, specimen: specimenOf(row) })), (prior.data ?? []).map((row: { analyte: string; unit: string; loinc_code: string; source_sentence: string }) => ({ analyte: row.analyte, unit: row.unit, loincCode: row.loinc_code, specimen: specimenOf(row) })))) if (!loincByIndex.has(index)) { loincByIndex.set(index, code); confidenceByIndex.set(index, 1); }

  const unresolved = rows.map((row, index) => ({ row, index })).filter(({ index }) => !loincByIndex.has(index));
  const config = aiConfig();
  if (!unresolved.length || !useAi) return finish();
  try {
    const search = async (row: LabCandidate, queries: string[]) => {
      const found = new Map<string, LoincOption>();
      for (const term of [...new Set(queries.filter(Boolean))]) {
        let result = await db.rpc("search_loinc_candidates", { p_term: term, p_specimen: specimenOf(row), p_unit: row.unit, p_limit: 40 });
        if (result.error) result = await db.rpc("search_terminology", { p_system: "LOINC", p_term: term });
        if (result.error) continue;
        for (const candidate of result.data ?? []) {
          const option = {
            code: candidate.code, display: candidate.display, score: Number(candidate.similarity_score ?? .5),
            component: candidate.component, property: candidate.property, specimen: candidate.specimen,
            scaleType: candidate.scale_type, methodType: candidate.method_type, className: candidate.class_name,
            exampleUcumUnits: candidate.example_ucum_units,
          };
          if (!found.has(option.code) || found.get(option.code)!.score < option.score) found.set(option.code, option);
        }
        if (found.size >= 40) break;
      }
      return [...found.values()].sort((a, b) => b.score - a.score).slice(0, 40);
    };
    const candidateSets = await Promise.all(unresolved.map(({ row }) => search(row, loincSearchQueries(row.analyte))));
    const missing = candidateSets.map((options, index) => ({ options, index })).filter(({ options }) => !options.length || options[0].score < .45);
    const englishTerms = new Map<number, string>();
    if (missing.length && config.enabled && process.env.OPENAI_API_KEY) {
      const translated = await suggestLabLoincSearchTerms(missing.map(({ index }) => unresolved[index].row));
      translated.terms.forEach((row) => { const target = missing[Number(row.sourceId)]; if (target) englishTerms.set(target.index, row.searchTerm); });
      await Promise.all(missing.map(async ({ index }) => {
        const translated = await search(unresolved[index].row, loincSearchQueries(englishTerms.get(index) ?? ""));
        const merged = new Map<string, LoincOption>();
        for (const option of [...candidateSets[index], ...translated]) if (!merged.has(option.code) || merged.get(option.code)!.score < option.score) merged.set(option.code, option);
        candidateSets[index] = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, 40);
      }));
    }
    candidateSets.forEach((options, index) => { candidateSets[index] = options.filter((option) => individualOption(unresolved[index].row, option)).slice(0, 5); });
    if (!config.enabled || !process.env.OPENAI_API_KEY) {
      candidateSets.forEach((options, index) => {
        const target = unresolved[index].index, ranked = options.slice(0, 3);
        if (ranked.length) optionsByIndex.set(target, ranked);
        const selected = ranked[0];
        if (!selected) return;
        const decision = phrLoincDecision(.5, selected.score);
        confidenceByIndex.set(target, decision.confidence);
        if (decision.status === "review") suggestedByIndex.set(target, selected.code);
      });
      warnings.push("La búsqueda local encontró candidatos LOINC, pero requieren revisión porque la validación semántica por IA no está disponible.");
      return finish();
    }
    const suggested = await suggestLabLoinc(unresolved.map(({ row }) => row), unresolved.map((_, index) => englishTerms.get(index) ?? ""), candidateSets);
    const preferred = new Map(suggested.suggestions.map((row) => [row.sourceId, row]));
    candidateSets.forEach((options, index) => {
      const proposal = preferred.get(String(index)), code = proposal?.loincCode.trim();
      const ranked = code ? [...options].sort((a, b) => Number(b.code === code) - Number(a.code === code)) : options;
      if (ranked.length) optionsByIndex.set(unresolved[index].index, ranked.slice(0, 3));
      const selected = code ? options.find((option) => option.code === code) : undefined;
      if (!selected || !proposal) return;
      const decision = phrLoincDecision(proposal.confidence, selected.score), confidence = decision.confidence;
      confidenceByIndex.set(unresolved[index].index, confidence);
      if (decision.status === "matched") loincByIndex.set(unresolved[index].index, selected.code);
      else if (decision.status === "review") suggestedByIndex.set(unresolved[index].index, selected.code);
    });
    warnings.push(`${loincByIndex.size} de ${rows.length} analitos quedaron homologados automáticamente; ${suggestedByIndex.size} requieren revisión por confianza intermedia.`);
  } catch { warnings.push("No fue posible completar la homologación LOINC; los resultados siguen disponibles para revisión."); }
  return finish();
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
  const locatedPage = labSourcePage(sourceId ?? "");
  if (locatedPage) sourcePage = locatedPage;
  if (locatedPage && sourceValue) {
    try {
      const pageNumber = locatedPage, extracted = await extractTextItems(original.slice());
      const findBox = (rows: ReturnType<typeof groupLabLayoutPages>[number]) => {
        const exact = rows.find((item) => item.id === sourceId), exactBox = exact && labSourceHighlight(exact.items, sourceValue, sourceAnalyte);
        if (exactBox) return exactBox;
        return rows.map((row) => ({ box: labSourceHighlight(row.items, sourceValue, sourceAnalyte), similarity: labAnalyteSimilarity(row.items[0]?.str ?? row.items.map((item) => item.str).join(" "), sourceAnalyte) }))
          .filter((candidate) => candidate.box)
          .sort((a, b) => b.similarity - a.similarity)[0]?.box ?? null;
      };
      let box = findBox(groupLabLayoutPages(extracted.items)[pageNumber - 1] ?? []);
      if (!box) box = findBox(groupLabLayoutPages([await extractScannedPdfPage(original, pageNumber)])[0]);
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
    const existing = await auth.db.from("phr_lab_results").select("id, analyte, canonical_analyte, suggested_loinc_code, coding_confidence, value_num, value_text, unit, ref_low, ref_high, ref_text, flag, observed_at, source, source_sentence, loinc_code, review_status").eq("import_id", previous.data.id).order("analyte");
    existingRows = existing.data ?? [];
    if (body.suggestLoinc) {
      const pending = existingRows.filter((row) => !row.loinc_code || (vettedPhrLabIdentity({ analyte: row.analyte, unit: row.unit, specimen: specimenOf(row) })?.code ?? row.loinc_code) !== row.loinc_code);
      if (!pending.length) return NextResponse.json({ suggestions: [], warnings: ["No se detectaron homologaciones pendientes o incompatibles."] });
      const rows = pending.map((row) => ({ analyte: row.analyte, valueNum: row.value_num, valueText: row.value_text, unit: row.unit, refLow: row.ref_low, refHigh: row.ref_high, refText: row.ref_text, flag: row.flag, observedAt: row.observed_at, source: row.source, sourceSentence: row.source_sentence, specimen: row.source_sentence.match(/(?:^|\|)\s*Muestra:\s*([^|]+)$/i)?.[1]?.trim() })) as LabCandidate[];
      const matched = await matchPhrLoinc(auth.db, auth.user.id, rows, true, document.data.source_institution);
      const suggestions = pending.map((row, index) => {
        const recommendedCode = matched.loincByIndex.get(index) ?? matched.suggestedByIndex.get(index) ?? row.suggested_loinc_code ?? "";
        const ranked = matched.optionsByIndex.get(index) ?? [];
        const options = recommendedCode && !ranked.some((option) => option.code === recommendedCode)
          ? [{ code: recommendedCode, display: matched.canonicalByIndex.get(index) ?? row.canonical_analyte ?? recommendedCode }, ...ranked]
          : ranked;
        return { resultId: row.id, analyte: row.analyte, currentCode: row.loinc_code, recommendedCode, confidence: matched.confidenceByIndex.get(index) ?? row.coding_confidence ?? null, options: options.map(({ code, display }) => ({ code, display })) };
      });
      return NextResponse.json({ suggestions, warnings: matched.warnings });
    }
    if (body.rescan && existingRows.length) previousImportId = previous.data.id;
    if (existing.data?.length && body.rematch && !body.rescan) {
      const pending = existing.data.map((row, originalIndex) => ({ row, originalIndex })).filter(({ row }) => !row.loinc_code || (vettedPhrLabIdentity({ analyte: row.analyte, unit: row.unit, specimen: specimenOf(row) })?.code ?? row.loinc_code) !== row.loinc_code);
      if (!pending.length) return NextResponse.json({ duplicate: true, created: existing.data.length, loincMapped: existing.data.length, warnings: ["Todos los resultados ya tienen agrupación LOINC."] });
      const rows = pending.map(({ row }) => ({ analyte: row.analyte, valueNum: row.value_num, valueText: row.value_text, unit: row.unit, refLow: row.ref_low, refHigh: row.ref_high, refText: row.ref_text, flag: row.flag, observedAt: row.observed_at, source: row.source, sourceSentence: row.source_sentence, specimen: row.source_sentence.match(/(?:^|\|)\s*Muestra:\s*([^|]+)$/i)?.[1]?.trim() })) as LabCandidate[];
      const matched = await matchPhrLoinc(auth.db, auth.user.id, rows, true, document.data.source_institution);
      const updates = await Promise.all(pending.map(({ row }, index) => auth.db.from("phr_lab_results").update({
        loinc_code: matched.loincByIndex.get(index) ?? "",
        suggested_loinc_code: matched.suggestedByIndex.get(index) ?? "",
        canonical_analyte: matched.canonicalByIndex.get(index) ?? "",
        coding_confidence: matched.confidenceByIndex.get(index) ?? null,
      }).eq("id", row.id).eq("owner_user_id", auth.user.id)));
      const applied = updates.filter((result) => !result.error).length;
      const mappedApplied = updates.filter((result, index) => !result.error && matched.loincByIndex.has(index)).length;
      if (applied < updates.length) matched.warnings.push("Algunas homologaciones no pudieron guardarse y permanecen pendientes.");
      return NextResponse.json({ duplicate: true, created: existing.data.length, loincMapped: existing.data.length - pending.length + mappedApplied, warnings: matched.warnings });
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
    try { prepared = await prepareLabPdf(bytes, true); }
    catch { await recordPhrEvent(auth.db, auth.user.id, "lab_analysis_failed", body.documentId, { method: "local", stage: "parse", duration_ms: Date.now() - startedAt }); return NextResponse.json({ error: "No fue posible interpretar el PDF." }, { status: 422 }); }
  }

  let aiResult: Awaited<ReturnType<typeof structureLabDocument>> | null = null;
  let usedVisualAi = false;
  let localFallbackReason = "";
  const scannedPdfWithManyPages = !imageMime && shouldUseAiForScannedPdf(prepared.scanned, prepared.pageCount);
  const needsVisualRecognition = !!imageMime || scannedPdfWithManyPages;
  if (needsVisualRecognition) {
    const config = aiConfig();
    let canUseAi = config.enabled && !!process.env.OPENAI_API_KEY;
    let aiLimitReached = false;
    if (canUseAi) {
      const start = new Date(); start.setUTCHours(0, 0, 0, 0);
      const usage = await auth.db.from("phr_lab_imports").select("id", { count: "exact", head: true })
        .eq("owner_user_id", auth.user.id).in("extraction_method", ["ai_text", "ai_visual"]).gte("created_at", start.toISOString());
      const limit = Math.max(1, Number(process.env.PHR_AI_MAX_PER_DAY ?? 5));
      canUseAi = (usage.count ?? 0) < limit;
      aiLimitReached = !canUseAi;
      if (!canUseAi) localFallbackReason = "Se alcanzó el límite diario de reconocimiento visual; se usó OCR local como respaldo.";
    } else localFallbackReason = "El reconocimiento visual no estaba disponible; se usó OCR local como respaldo.";
    if (canUseAi) {
      try {
        aiResult = await structureLabDocument({ procedureName: "Laboratorio personal", ...(imageMime ? { imageBytes: bytes, imageMime } : { pdfBytes: bytes }) });
        usedVisualAi = true;
      } catch {
        await recordPhrEvent(auth.db, auth.user.id, "lab_analysis_failed", body.documentId, { method: "ai_visual", stage: "recognition", duration_ms: Date.now() - startedAt });
        if (imageMime) return NextResponse.json({ error: "No fue posible extraer resultados de este archivo." }, { status: 502 });
        localFallbackReason = "El reconocimiento visual no pudo completar el análisis; se usó OCR local como respaldo.";
      }
    } else if (imageMime) return NextResponse.json({ error: localFallbackReason || "Este archivo necesita reconocimiento visual y la extracción automática no está habilitada." }, { status: aiLimitReached ? 429 : 503 });
  }
  if (prepared.scanned && !usedVisualAi) {
    try { prepared = await prepareLabPdf(bytes); }
    catch { return NextResponse.json({ error: "No fue posible leer las páginas escaneadas del PDF." }, { status: 422 }); }
  }
  const rows: LabCandidate[] = aiResult?.observations ?? prepared.observations;

  const extractedName = prepared.patientName || aiResult?.extraction.patientName || "";
  const extractedIdentifier = prepared.patientIdentifier || aiResult?.extraction.patientIdentifier || "";
  const profileIdentifier = auth.profile.identifier.trim();
  const warnings = [...(aiResult?.extraction.warnings ?? [])];
  if (usedVisualAi && scannedPdfWithManyPages) warnings.push("El PDF contenía varias páginas escaneadas y se procesó con reconocimiento visual; revisa cada cifra antes de confirmarla.");
  else if (prepared.scanned && !imageMime) warnings.push("El PDF era un escaneo sin texto y se leyó con OCR local; revisa cada cifra antes de confirmarla.");
  if (localFallbackReason && !imageMime) warnings.push(localFallbackReason);
  if (!usedVisualAi && !imageMime && prepared.needsAi) warnings.push("El PDF se leyó sólo localmente y puede contener filas que requieren corrección manual; no se envió contenido a IA.");
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
  if (!candidates.length) { await recordPhrEvent(auth.db, auth.user.id, "lab_analysis_failed", body.documentId, { method: usedVisualAi ? "ai_visual" : "local", stage: "no_results", duration_ms: Date.now() - startedAt }); return NextResponse.json({ error: "No se detectaron resultados para revisar." }, { status: 422 }); }
  const matched = await matchPhrLoinc(auth.db, auth.user.id, candidates, true, document.data.source_institution);
  warnings.push(...matched.warnings);
  const fallbackDate = document.data.document_date ?? document.data.created_at.slice(0, 10);
  if (candidates.some((row) => !row.observedAt)) warnings.push("No se encontró fecha de muestra en todas las filas; se usó la fecha del documento.");
  const extractionMethod = usedVisualAi ? "ai_visual" : "local";
  const imported = previousImportId
    ? await auth.db.from("phr_lab_imports").update({ extraction_method: extractionMethod, patient_name: extractedName, patient_identifier: extractedIdentifier, warnings }).eq("id", previousImportId).eq("owner_user_id", auth.user.id).select("id").single()
    : await auth.db.from("phr_lab_imports").insert({ owner_user_id: auth.user.id, document_id: body.documentId, extraction_method: extractionMethod, patient_name: extractedName, patient_identifier: extractedIdentifier, warnings }).select("id").single();
  if (imported.error) { await recordPhrEvent(auth.db, auth.user.id, "lab_analysis_failed", body.documentId, { method: extractionMethod, stage: "import", duration_ms: Date.now() - startedAt }); return NextResponse.json({ error: "No fue posible registrar el análisis." }, { status: 502 }); }

  const inserted = await auth.db.from("phr_lab_results").insert(candidates.map((row, index) => ({
    owner_user_id: auth.user.id, document_id: body.documentId, import_id: imported.data.id, loinc_code: matched.loincByIndex.get(index) ?? "",
    suggested_loinc_code: matched.suggestedByIndex.get(index) ?? "", canonical_analyte: matched.canonicalByIndex.get(index) ?? "", coding_confidence: matched.confidenceByIndex.get(index) ?? null,
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
    const displays = await preferredLoincDisplays(auth.db, codes);
    const updates = await Promise.all(selections.map((item) => auth.db.from("phr_lab_results").update({ loinc_code: item.loincCode, canonical_analyte: displays.get(item.loincCode) ?? knownByCode.get(item.loincCode) ?? "", suggested_loinc_code: "", coding_confidence: 1 }).eq("id", item.resultId).eq("owner_user_id", auth.user.id).select("id")));
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
  const current = await auth.db.from("phr_lab_results").select("flag, analyte, unit, loinc_code, canonical_analyte, suggested_loinc_code, coding_confidence, document_id, created_at").eq("id", body.resultId).eq("owner_user_id", auth.user.id).eq("review_status", "suggested").maybeSingle();
  if (!current.data) return NextResponse.json({ error: "La sugerencia ya no está disponible para edición." }, { status: 404 });
  const keepExplicitFlag = ["abnormal", "critical_low", "critical_high"].includes(current.data.flag);
  const value = validated.value;
  const sameIdentity = normalizeIdentity(value.analyte) === normalizeIdentity(current.data.analyte) && normalizeIdentity(value.unit) === normalizeIdentity(current.data.unit);
  const updated = await auth.db.from("phr_lab_results").update({
    analyte: value.analyte, value_num: value.valueNum, value_text: value.valueText, unit: value.unit,
    ref_low: value.refLow, ref_high: value.refHigh, ref_text: value.refText,
    flag: keepExplicitFlag ? current.data.flag : value.flag, observed_at: value.observedAt,
    loinc_code: sameIdentity ? current.data.loinc_code : "", canonical_analyte: sameIdentity ? current.data.canonical_analyte : "",
    suggested_loinc_code: sameIdentity ? current.data.suggested_loinc_code : "", coding_confidence: sameIdentity ? current.data.coding_confidence : null,
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
