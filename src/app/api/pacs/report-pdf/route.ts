import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const orthancUrl = (process.env.ORTHANC_URL ?? "").replace(/\/$/, "");
const orthancCreds = process.env.ORTHANC_CREDS ?? "";

/**
 * Archiva en Orthanc el PDF del informe definitivo (serie DICOM PDF encapsulado).
 * El PDF llega ya renderizado desde el cliente (rasterizado del mismo informe que se imprime),
 * así el archivado en el PACS es idéntico a lo que ve el radiólogo al imprimir.
 */
export async function POST(request: NextRequest) {
  if (!orthancUrl || !orthancCreds) return NextResponse.json({ error: "PACS sin configurar en el servidor." }, { status: 501 });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const db = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth } = await db.auth.getUser(token);
  if (!auth.user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });

  const { appointmentId, pdfBase64 } = (await request.json().catch(() => ({}))) ?? {};
  if (!appointmentId || typeof pdfBase64 !== "string" || !pdfBase64) return NextResponse.json({ error: "Falta el informe a archivar." }, { status: 400 });

  const [report, appointment] = await Promise.all([
    db.from("radiology_reports").select("status").eq("appointment_id", appointmentId).maybeSingle(),
    db.from("appointments").select("study:imaging_studies(orthanc_study_id)").eq("id", appointmentId).maybeSingle(),
  ]);
  if (report.data?.status !== "final") return NextResponse.json({ error: "No hay informe definitivo para archivar." }, { status: 409 });
  const orthancStudyId = (appointment.data as unknown as { study: { orthanc_study_id: string | null } | null } | null)?.study?.orthanc_study_id;
  if (!orthancStudyId) return NextResponse.json({ error: "El estudio no tiene imágenes vinculadas en el PACS; el PDF no se archivó." }, { status: 409 });

  const upstream = await fetch(`${orthancUrl}/tools/create-dicom`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(orthancCreds).toString("base64")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      Parent: orthancStudyId,
      Tags: { Modality: "DOC", SeriesDescription: "Informe radiológico (PDF)" },
      Content: `data:application/pdf;base64,${pdfBase64}`,
    }),
  });
  if (!upstream.ok) return NextResponse.json({ error: `El PACS rechazó el PDF (${upstream.status}).` }, { status: 502 });
  return NextResponse.json({ ok: true });
}
