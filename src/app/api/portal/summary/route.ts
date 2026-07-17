import { NextRequest, NextResponse } from "next/server";
import { healthItemKindLabels, healthItemStatusLabels, type PhrHealthItemKind, type PhrHealthItemStatus } from "@/features/patient-portal/health-summary";
import { phrLabTrendKey } from "@/features/patient-portal/labs";
import { isOutsideReportedRange } from "@/features/patient-portal/longitudinal";
import { simplePhrPdf } from "@/features/patient-portal/pdf";
import { requirePhrApi } from "@/lib/server-auth";

export async function GET(request: NextRequest) {
  const auth = await requirePhrApi(request); if (auth instanceof NextResponse) return auth;
  const [documents, labResults, healthItems] = await Promise.all([
    auth.db.from("patient_documents").select("original_filename, source_institution, document_date, created_at").eq("owner_user_id", auth.user.id).order("document_date", { ascending: false, nullsFirst: false }).limit(10),
    auth.db.from("phr_lab_results").select("id, loinc_code, analyte, canonical_analyte, value_num, value_text, unit, flag, observed_at").eq("owner_user_id", auth.user.id).eq("review_status", "confirmed").order("observed_at", { ascending: false }),
    auth.db.from("phr_health_items").select("kind, label, status, event_date, source, notes").eq("owner_user_id", auth.user.id).order("kind").order("status"),
  ]);
  if (documents.error || labResults.error || healthItems.error) return NextResponse.json({ error: "No fue posible preparar el resumen." }, { status: 500 });
  type LabResultRow = NonNullable<typeof labResults.data>[number];
  const latest = new Map<string, LabResultRow>();
  for (const result of labResults.data ?? []) {
    const key = phrLabTrendKey({ loincCode: result.loinc_code, analyte: result.analyte });
    if (!latest.has(key)) latest.set(key, result);
  }
  const outside = [...latest.values()].filter(isOutsideReportedRange);
  const p = auth.profile;
  const lines = [
    `Persona: ${p.full_name}`, `Fecha de nacimiento: ${p.birth_date}`, "Datos declarados por la persona. No reemplazan una evaluación clínica.", "",
    "PERFIL DE EMERGENCIA",
    `Grupo sanguíneo: ${p.blood_type || "No informado"}`, `Alergias: ${p.allergies || "No informadas"}`,
    `Condiciones declaradas: ${p.conditions || "No informadas"}`, `Medicamentos declarados: ${p.medications || "No informados"}`,
    `Contacto: ${[p.emergency_contact_name, p.emergency_contact_phone].filter(Boolean).join(" - ") || "No informado"}`,
    p.emergency_notes ? `Notas: ${p.emergency_notes}` : "", "", "ANTECEDENTES ESTRUCTURADOS",
    ...((healthItems.data ?? []).length ? (healthItems.data ?? []).map((item) => `${healthItemKindLabels[item.kind as PhrHealthItemKind]} | ${item.label} | ${healthItemStatusLabels[item.status as PhrHealthItemStatus]}${item.event_date ? ` | ${item.event_date}` : ""} | ${item.source === "patient" ? "Declarado por la persona" : "Vinculado a documento"}${item.notes ? ` | ${item.notes}` : ""}`) : ["No hay antecedentes estructurados declarados."]),
    "", "ÚLTIMOS RESULTADOS FUERA DEL RANGO INFORMADO POR EL LABORATORIO",
    ...(outside.length ? outside.map((result) => `${result.observed_at} | ${result.canonical_analyte || result.analyte}: ${result.value_num ?? result.value_text} ${result.unit}`) : ["No hay resultados confirmados fuera del rango informado."]),
    "", "DOCUMENTOS RECIENTES",
    ...((documents.data ?? []).map((document) => `${document.document_date ?? document.created_at.slice(0, 10)} | ${document.original_filename} | ${document.source_institution}`)),
  ].filter((line) => line !== "");
  const pdf = await simplePhrPdf("Resumen personal para consulta", lines);
  return new NextResponse(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=resumen-para-consulta.pdf", "Cache-Control": "no-store" } });
}
