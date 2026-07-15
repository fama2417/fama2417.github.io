import { supabase } from "@/lib/supabase-client";
import type { LabFlag, LabObservation, LabReviewStatus } from "./lab-observations";

type LabRow = {
  id: string; report_id: string; patient_id: string; loinc_code: string; analyte: string;
  value_num: number | null; value_text: string; unit: string; ref_low: number | null; ref_high: number | null;
  ref_text: string; flag: LabFlag; observed_at: string; source: LabObservation["source"]; source_sentence: string;
  review_status: LabReviewStatus;
};

const labColumns = "id, report_id, patient_id, loinc_code, analyte, value_num, value_text, unit, ref_low, ref_high, ref_text, flag, observed_at, source, source_sentence, review_status";

export const mapLabObservation = (row: LabRow): LabObservation => ({
  id: row.id, reportId: row.report_id, patientId: row.patient_id, loincCode: row.loinc_code, analyte: row.analyte,
  valueNum: row.value_num, valueText: row.value_text, unit: row.unit, refLow: row.ref_low, refHigh: row.ref_high,
  refText: row.ref_text, flag: row.flag, observedAt: row.observed_at, source: row.source, sourceSentence: row.source_sentence,
  reviewStatus: row.review_status,
});

export async function fetchLabObservations(reportId: string) {
  const { data, error } = await supabase.from("lab_observations").select(labColumns)
    .eq("report_id", reportId).order("observed_at", { ascending: false }).order("analyte");
  if (error) throw error;
  return (data as LabRow[]).map(mapLabObservation);
}

export async function confirmLabObservation(id: string) {
  const { data, error } = await supabase.from("lab_observations").update({ review_status: "confirmed" }).eq("id", id).select(labColumns).single();
  if (error) throw error;
  return mapLabObservation(data as LabRow);
}

export async function deleteLabObservation(id: string) {
  const { error } = await supabase.from("lab_observations").delete().eq("id", id);
  if (error) throw error;
}

/** Sube un PDF de resultados a la ruta de ingesta: extrae texto + estructura con IA como sugeridos. */
export async function ingestLabPdf(reportId: string, file: File): Promise<{ created: number; warnings: string[] }> {
  const { data } = await supabase.auth.getSession();
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(`/api/reports/${encodeURIComponent(reportId)}/lab/ingest`, {
    method: "POST", headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` }, body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "No fue posible procesar el PDF.");
  return { created: payload.created ?? 0, warnings: payload.warnings ?? [] };
}
