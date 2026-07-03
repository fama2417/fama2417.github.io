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
  updatedAt?: string;
};

const columns = "appointment_id, clinical_indication, technique, comparison, findings, impression, status, critical_finding, updated_at";

type ReportRow = { appointment_id: string; clinical_indication: string; technique: string; comparison: string; findings: string; impression: string; status: RadiologyReport["status"]; critical_finding: boolean; updated_at: string };

const mapReport = (row: ReportRow): RadiologyReport => ({
  appointmentId: row.appointment_id,
  clinicalIndication: row.clinical_indication,
  technique: row.technique,
  comparison: row.comparison,
  findings: row.findings,
  impression: row.impression,
  status: row.status,
  criticalFinding: row.critical_finding,
  updatedAt: row.updated_at,
});

export async function fetchReport(appointmentId: string) {
  const { data, error } = await supabase.from("radiology_reports").select(columns).eq("appointment_id", appointmentId).maybeSingle();
  if (error) throw error;
  return data ? mapReport(data as ReportRow) : null;
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
    updated_at: new Date().toISOString(),
  }, { onConflict: "appointment_id" });
  if (error) throw error;
}
