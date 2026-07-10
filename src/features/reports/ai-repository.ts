import { aiConfig, type AiSupabase } from "./ai-budget.ts";
import { AiClinicalSummarySchema, guardClinicalSummaryWithoutImpression, type AiFinding, type AiFindingExtractionResult } from "./ai-extraction-schema.ts";
import { normalizeCandidateKey, normalizeLocalCodeName } from "./ai-normalization.ts";

export type AiReportContext = {
  id: string;
  tenantId: string;
  serviceTypeId: string | null;
  serviceTypeCode: string;
  serviceTypeName: string;
  modality: string;
  reportingGroupId: string | null;
  reportingGroupCode: string | null;
  clinicalIndication: string;
  technique: string;
  findings: string;
  impression: string;
};

export async function getReportForAiExtraction(reportId: string, supabase: AiSupabase): Promise<AiReportContext> {
  const report = await supabase
    .from("radiology_reports")
    .select("id, tenant_id, appointment_id, clinical_indication, technique, findings, impression, appointment:appointments(service_type_id, modality, reason, procedure_code)")
    .eq("id", reportId)
    .maybeSingle();
  if (report.error) throw report.error;
  if (!report.data) throw new Error("Informe inexistente.");
  const row = report.data as any;
  const appointment = row.appointment ?? {};
  const serviceTypeId = appointment.service_type_id ?? null;
  const serviceType = serviceTypeId
    ? await supabase.from("service_types").select("id, code, name, modality").eq("id", serviceTypeId).eq("tenant_id", row.tenant_id).maybeSingle()
    : { data: null, error: null };
  if (serviceType.error) throw serviceType.error;
  const st = (serviceType.data ?? {}) as any;
  const group = serviceTypeId
    ? await supabase.from("service_type_reporting_groups").select("reporting_group_id, reporting_group:reporting_groups(code)").eq("tenant_id", row.tenant_id).eq("service_type_id", serviceTypeId).eq("active", true).order("confidence", { ascending: false }).limit(1).maybeSingle()
    : { data: null, error: null };
  if (group.error) throw group.error;
  const groupRow = group.data as any;

  return {
    id: row.id,
    tenantId: row.tenant_id,
    serviceTypeId,
    serviceTypeCode: st.code ?? appointment.procedure_code ?? "",
    serviceTypeName: st.name ?? appointment.reason ?? "",
    modality: st.modality ?? appointment.modality ?? "",
    reportingGroupId: groupRow?.reporting_group_id ?? null,
    reportingGroupCode: groupRow?.reporting_group?.code ?? null,
    clinicalIndication: row.clinical_indication ?? "",
    technique: row.technique ?? "",
    findings: row.findings ?? "",
    impression: row.impression ?? "",
  };
}

export async function insertAiUsageLog(supabase: AiSupabase, data: Record<string, unknown>) {
  if (!aiConfig().logUsage) return;
  const { error } = await supabase.from("ai_usage_log").insert(data);
  if (error) throw error;
}

export async function findDictionaryFindingByCanonicalName(supabase: AiSupabase, tenantId: string, normalizedCanonicalName: string) {
  const { data, error } = await supabase.from("finding_dictionary").select("id").eq("tenant_id", tenantId).eq("normalized_canonical_name", normalizedCanonicalName).eq("active", true).maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

export function nextCandidateOccurrence(row: { occurrence_count?: number | null }) {
  return Number(row.occurrence_count ?? 0) + 1;
}

export async function findOrCreateFindingCandidate(supabase: AiSupabase, input: {
  tenantId: string; rawText: string; normalizedText: string; suggestedCanonicalName: string; serviceTypeId: string | null;
  serviceTypeCode: string; serviceTypeName: string; reportingGroupId: string | null; modality: string; bodySite: string | null;
  laterality: string | null; severity: string | null; reportId: string; sourceSentence: string; sourceSection: string; confidence: number;
}) {
  let query = supabase.from("finding_candidates").select("id, occurrence_count").eq("tenant_id", input.tenantId).eq("normalized_text", input.normalizedText);
  query = input.reportingGroupId ? query.eq("reporting_group_id", input.reportingGroupId) : query.is("reporting_group_id", null);
  const existing = await query.limit(1).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    const count = nextCandidateOccurrence(existing.data as { occurrence_count?: number | null });
    const updated = await supabase.from("finding_candidates").update({ occurrence_count: count, last_seen_at: new Date().toISOString(), ai_confidence: input.confidence }).eq("id", (existing.data as any).id).select("id").single();
    if (updated.error) throw updated.error;
    return updated.data as { id: string };
  }
  const inserted = await supabase.from("finding_candidates").insert({
    tenant_id: input.tenantId,
    raw_text: input.rawText,
    normalized_text: input.normalizedText,
    suggested_canonical_name: input.suggestedCanonicalName,
    service_type_id: input.serviceTypeId,
    service_type_code: input.serviceTypeCode,
    service_type_name: input.serviceTypeName,
    reporting_group_id: input.reportingGroupId,
    modality: input.modality,
    body_site: input.bodySite,
    laterality_detected: input.laterality,
    severity_detected: input.severity,
    source_report_id: input.reportId,
    source_sentence: input.sourceSentence,
    source_section: input.sourceSection,
    ai_confidence: input.confidence,
  }).select("id").single();
  if (inserted.error) throw inserted.error;
  return inserted.data as { id: string };
}

export async function insertExtractedFinding(supabase: AiSupabase, input: Record<string, unknown>) {
  const { data, error } = await supabase.from("extracted_findings").insert(input).select("id, finding_candidate_id").single();
  if (error) throw error;
  return data as { id: string; finding_candidate_id: string | null };
}

export const canCreateDictionaryCandidate = (finding: AiFinding) => finding.shouldCreateDictionaryCandidate
  && finding.status !== "absent"
  && !["negative", "not_relevant"].includes(finding.importance);

export async function getReportAiSummary(supabase: AiSupabase, reportId: string) {
  const [{ data, error }, report] = await Promise.all([
    supabase.from("report_ai_summaries").select("summary_json, model, updated_at").eq("report_id", reportId).maybeSingle(),
    supabase.from("radiology_reports").select("impression").eq("id", reportId).maybeSingle(),
  ]);
  if (error) throw error;
  if (report.error) throw report.error;
  if (!data) return null;
  const summary = guardClinicalSummaryWithoutImpression(AiClinicalSummarySchema.parse((data as any).summary_json), !!(report.data as any)?.impression?.trim());
  return { ...summary, model: (data as any).model, updatedAt: (data as any).updated_at };
}

export async function saveReportAiSummary(supabase: AiSupabase, reportId: string, context: AiReportContext, extractionResult: AiFindingExtractionResult) {
  const { error } = await supabase.from("report_ai_summaries").upsert({
    tenant_id: context.tenantId,
    report_id: reportId,
    summary_json: extractionResult.clinicalSummary,
    model: aiConfig().model,
    provider: "openai",
  }, { onConflict: "tenant_id,report_id" });
  if (error) throw error;
}

export async function deletePriorSuggestedAiFindings(supabase: AiSupabase, reportId: string) {
  const { error } = await supabase.from("extracted_findings").delete().eq("report_id", reportId).eq("extraction_method", "openai").eq("coding_status", "suggested");
  if (error) throw error;
}

export async function persistAiExtractionResult(supabase: AiSupabase, reportId: string, extractionResult: AiFindingExtractionResult, context: AiReportContext, replaceSuggested = false) {
  const config = aiConfig();
  const inserted: { id: string; findingCandidateId: string | null }[] = [];
  if (replaceSuggested) await deletePriorSuggestedAiFindings(supabase, reportId);
  for (const finding of extractionResult.findings) {
    if (finding.confidence < config.minConfidenceToAutoSuggest || !finding.findingText.trim() || !finding.canonicalName.trim()) continue;
    const normalizedCanonicalName = normalizeLocalCodeName(finding.canonicalName);
    const normalizedText = normalizeCandidateKey(finding.findingText);
    const findingId = await findDictionaryFindingByCanonicalName(supabase, context.tenantId, normalizedCanonicalName);
    let candidateId: string | null = null;
    if (!findingId && finding.confidence >= config.minConfidenceToAutoCreateCandidate && canCreateDictionaryCandidate(finding)) {
      candidateId = (await findOrCreateFindingCandidate(supabase, {
        tenantId: context.tenantId,
        rawText: finding.findingText,
        normalizedText,
        suggestedCanonicalName: finding.canonicalName,
        serviceTypeId: context.serviceTypeId,
        serviceTypeCode: context.serviceTypeCode,
        serviceTypeName: context.serviceTypeName,
        reportingGroupId: context.reportingGroupId,
        modality: context.modality,
        bodySite: finding.bodySite,
        laterality: finding.laterality,
        severity: finding.severity,
        reportId,
        sourceSentence: finding.sourceSentence,
        sourceSection: finding.sourceSection,
        confidence: finding.confidence,
      })).id;
    }
    const insertedFinding = await insertExtractedFinding(supabase, {
      tenant_id: context.tenantId,
      report_id: reportId,
      finding_id: findingId,
      finding_candidate_id: candidateId,
      finding_text: finding.findingText,
      normalized_text: normalizedText,
      status: finding.status,
      importance: finding.importance,
      source_section: finding.sourceSection,
      source_sentence: finding.sourceSentence,
      body_site: finding.bodySite,
      laterality: finding.laterality,
      severity: finding.severity,
      confidence: finding.confidence,
      extraction_method: "openai",
      coding_status: "suggested",
    });
    inserted.push({ id: insertedFinding.id, findingCandidateId: insertedFinding.finding_candidate_id });
  }
  await saveReportAiSummary(supabase, reportId, context, extractionResult);
  return inserted;
}

const mapExtractedFinding = (row: any) => ({
  id: row.id,
  findingText: row.finding_text,
  normalizedText: row.normalized_text,
  status: row.status,
  importance: row.importance,
  sourceSection: row.source_section,
  sourceSentence: row.source_sentence,
  bodySite: row.body_site,
  laterality: row.laterality,
  severity: row.severity,
  confidence: row.confidence,
  extractionMethod: row.extraction_method,
  codingStatus: row.coding_status,
  dictionary: row.finding ? { id: row.finding.id, localCode: row.finding.local_code, canonicalName: row.finding.canonical_name } : null,
  candidate: row.candidate ? { id: row.candidate.id, rawText: row.candidate.raw_text, suggestedCanonicalName: row.candidate.suggested_canonical_name, status: row.candidate.status } : null,
});

const extractedColumns = "id, report_id, finding_text, normalized_text, status, importance, source_section, source_sentence, body_site, laterality, severity, confidence, extraction_method, coding_status, finding:finding_dictionary(id, local_code, canonical_name), candidate:finding_candidates(id, raw_text, suggested_canonical_name, status)";

export async function listExtractedFindings(supabase: AiSupabase, reportId: string) {
  const { data, error } = await supabase.from("extracted_findings").select(extractedColumns).eq("report_id", reportId).order("confidence", { ascending: false }).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapExtractedFinding).sort((a, b) => Number(b.importance === "principal") - Number(a.importance === "principal"));
}

export async function getExtractedFindingById(supabase: AiSupabase, findingId: string) {
  const { data, error } = await supabase.from("extracted_findings").select("id, tenant_id, report_id, finding_text, finding_id, coding_status").eq("id", findingId).maybeSingle();
  if (error) throw error;
  return data as { id: string; tenant_id: string; report_id: string; finding_text: string; finding_id: string | null; coding_status: string } | null;
}

export async function createExtractionFeedback(supabase: AiSupabase, data: {
  reportId: string; extractedFindingId: string; originalText: string; originalSuggestion: string; correctedText?: string | null;
  correctedFindingId?: string | null; action: "accepted" | "corrected" | "rejected"; userId: string;
}) {
  const { error } = await supabase.from("extraction_feedback").insert({
    report_id: data.reportId,
    extracted_finding_id: data.extractedFindingId,
    original_text: data.originalText,
    original_suggestion: data.originalSuggestion,
    corrected_text: data.correctedText ?? null,
    corrected_finding_id: data.correctedFindingId ?? null,
    action: data.action,
    user_id: data.userId,
  });
  if (error) throw error;
}

export async function confirmExtractedFinding(supabase: AiSupabase, findingId: string, userId: string) {
  const finding = await getExtractedFindingById(supabase, findingId);
  if (!finding) return null;
  const { data, error } = await supabase.from("extracted_findings").update({ coding_status: "confirmed" }).eq("id", findingId).select(extractedColumns).single();
  if (error) throw error;
  await createExtractionFeedback(supabase, { reportId: finding.report_id, extractedFindingId: finding.id, originalText: finding.finding_text, originalSuggestion: finding.finding_text, action: "accepted", userId });
  return mapExtractedFinding(data);
}

export async function rejectExtractedFinding(supabase: AiSupabase, findingId: string, userId: string, reason?: string) {
  const finding = await getExtractedFindingById(supabase, findingId);
  if (!finding) return null;
  const { data, error } = await supabase.from("extracted_findings").update({ coding_status: "rejected" }).eq("id", findingId).select(extractedColumns).single();
  if (error) throw error;
  await createExtractionFeedback(supabase, { reportId: finding.report_id, extractedFindingId: finding.id, originalText: finding.finding_text, originalSuggestion: finding.finding_text, correctedText: reason ?? null, action: "rejected", userId });
  return mapExtractedFinding(data);
}

export async function correctExtractedFinding(supabase: AiSupabase, findingId: string, userId: string, correctedText: string, correctedFindingId?: string) {
  const finding = await getExtractedFindingById(supabase, findingId);
  if (!finding) return null;
  const { data, error } = await supabase.from("extracted_findings").update({
    coding_status: "corrected",
    finding_text: correctedText,
    normalized_text: normalizeCandidateKey(correctedText),
    finding_id: correctedFindingId ?? finding.finding_id,
  }).eq("id", findingId).select(extractedColumns).single();
  if (error) throw error;
  await createExtractionFeedback(supabase, { reportId: finding.report_id, extractedFindingId: finding.id, originalText: finding.finding_text, originalSuggestion: finding.finding_text, correctedText, correctedFindingId: correctedFindingId ?? null, action: "corrected", userId });
  return mapExtractedFinding(data);
}
