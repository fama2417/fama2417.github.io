import { supabase } from "@/lib/supabase-client";

export type RadiologyReport = {
  appointmentId: string;
  clinicalIndication: string;
  technique: string;
  comparison: string;
  findings: string;
  impression: string;
  status: "draft" | "final";
  criticalFinding: boolean;
  criticalFindingType: string;
  updatedAt?: string;
};

const columns = "appointment_id, clinical_indication, technique, comparison, findings, impression, status, critical_finding, critical_finding_type, updated_at";

type ReportRow = { appointment_id: string; clinical_indication: string; technique: string; comparison: string; findings: string; impression: string; status: RadiologyReport["status"]; critical_finding: boolean; critical_finding_type: string; updated_at: string };

const mapReport = (row: ReportRow): RadiologyReport => ({
  appointmentId: row.appointment_id,
  clinicalIndication: row.clinical_indication,
  technique: row.technique,
  comparison: row.comparison,
  findings: row.findings,
  impression: row.impression,
  status: row.status,
  criticalFinding: row.critical_finding,
  criticalFindingType: row.critical_finding_type ?? "",
  updatedAt: row.updated_at,
});

export async function fetchReport(appointmentId: string) {
  const result = await supabase.from("radiology_reports").select(columns).eq("appointment_id", appointmentId).maybeSingle();
  if (!result.error) return result.data ? mapReport(result.data as ReportRow) : null;
  // ponytail: fallback mientras la migración critical_finding_type no esté aplicada; quitar cuando esté en producción
  const fallback = await supabase.from("radiology_reports").select(columns.replace(", critical_finding_type", "")).eq("appointment_id", appointmentId).maybeSingle();
  if (fallback.error) throw fallback.error;
  return fallback.data ? mapReport(fallback.data as unknown as ReportRow) : null;
}

export async function saveReport(report: RadiologyReport) {
  const { error } = await supabase.from("radiology_reports").upsert({
    appointment_id: report.appointmentId,
    clinical_indication: report.clinicalIndication,
    technique: report.technique,
    comparison: report.comparison,
    findings: report.findings,
    impression: report.impression,
    status: report.status,
    critical_finding: report.criticalFinding,
    critical_finding_type: report.criticalFinding ? report.criticalFindingType : "",
    updated_at: new Date().toISOString(),
  }, { onConflict: "appointment_id" });
  if (error) throw error;
}
