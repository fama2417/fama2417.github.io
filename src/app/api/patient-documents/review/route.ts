import { NextRequest, NextResponse } from "next/server";
import { requireClinicalApi } from "@/lib/server-auth";

const extensions: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "application/dicom": "dcm" };

export async function POST(request: NextRequest) {
  const auth = await requireClinicalApi(request);
  if (auth instanceof NextResponse) return auth;
  const body = (await request.json().catch(() => ({}))) as { patientId?: string; documentId?: string; status?: "accepted" | "rejected"; note?: string };
  const note = body.note?.trim() ?? "";
  if (!body.patientId || !body.documentId || !["accepted", "rejected"].includes(body.status ?? "") || note.length > 1000) {
    return NextResponse.json({ error: "Revisión inválida." }, { status: 400 });
  }
  const patient = await auth.db.from("patients").select("id").eq("id", body.patientId).eq("tenant_id", auth.tenantId).maybeSingle();
  if (!patient.data) return NextResponse.json({ error: "Paciente inexistente." }, { status: 404 });
  const share = await auth.db.from("patient_document_shares").select("id").eq("document_id", body.documentId).eq("patient_id", body.patientId).is("revoked_at", null).maybeSingle();
  if (!share.data) return NextResponse.json({ error: "El paciente no mantiene acceso vigente para este documento." }, { status: 403 });
  const document = await auth.db.from("patient_documents").select("id, original_filename, storage_path, mime_type, source_institution, document_date").eq("id", body.documentId).maybeSingle();
  if (!document.data) return NextResponse.json({ error: "Documento inexistente." }, { status: 404 });
  if (body.status === "accepted" && (await auth.db.from("patient_document_reviews").select("id").eq("document_id", body.documentId).eq("patient_id", body.patientId).eq("status", "accepted").maybeSingle()).data) {
    return NextResponse.json({ error: "El documento ya fue incorporado a esta ficha." }, { status: 409 });
  }

  let clinicalPath: string | null = null;
  if (body.status === "accepted") {
    const downloaded = await auth.db.storage.from("patient-documents").download(document.data.storage_path);
    if (downloaded.error) return NextResponse.json({ error: "No fue posible leer el archivo original." }, { status: 500 });
    clinicalPath = `${auth.tenantId}/${body.patientId}/${crypto.randomUUID()}.${extensions[document.data.mime_type] ?? "bin"}`;
    const uploaded = await auth.db.storage.from("clinical-documents").upload(clinicalPath, downloaded.data, { contentType: document.data.mime_type, upsert: false });
    if (uploaded.error) return NextResponse.json({ error: "No fue posible conservar la copia clínica." }, { status: 500 });
  }
  const review = await auth.db.from("patient_document_reviews").insert({
    document_id: body.documentId, patient_id: body.patientId, reviewer_id: auth.user.id, status: body.status, note,
    original_filename: document.data.original_filename, mime_type: document.data.mime_type, source_institution: document.data.source_institution,
    document_date: document.data.document_date, clinical_storage_path: clinicalPath,
  });
  if (review.error) {
    if (clinicalPath) await auth.db.storage.from("clinical-documents").remove([clinicalPath]);
    return NextResponse.json({ error: "No fue posible registrar la revisión." }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
