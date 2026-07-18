import { NextRequest, NextResponse } from "next/server";
import { clinicalAreaForDocumentType, hasValidPatientDocumentSignature, isPhrClinicalArea, patientDocumentFilename, validatePatientDocument } from "@/features/patient-portal/documents";
import { recordPhrEvent } from "@/lib/phr-events";
import { requirePatientApi, requirePhrApi } from "@/lib/server-auth";

const documentTypes = ["imaging", "laboratory", "prescription", "other"] as const;

export async function POST(request: NextRequest) {
  const auth = await requirePhrApi(request);
  if (auth instanceof NextResponse) return auth;
  const { db, user } = auth;

  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ error: "Solicitud de archivo inválida." }, { status: 400 }); }
  const file = form.get("file");
  const displayName = String(form.get("displayName") ?? "");
  const documentDate = String(form.get("documentDate") ?? "");
  const documentType = String(form.get("documentType") ?? "other");
  const requestedArea = String(form.get("clinicalArea") ?? "");
  const clinicalArea = requestedArea || clinicalAreaForDocumentType(documentType);
  const sourceInstitution = String(form.get("sourceInstitution") ?? "").trim();
  if (!(file instanceof File) || !file.name || file.name.length > 255) return NextResponse.json({ error: "Archivo inválido." }, { status: 400 });
  const filename = patientDocumentFilename(file.name, displayName);
  if (!filename || filename.length > 255) return NextResponse.json({ error: "Nombre de documento inválido." }, { status: 400 });
  const validation = validatePatientDocument(file);
  if (validation) return NextResponse.json({ error: validation }, { status: 400 });
  if (!documentTypes.includes(documentType as (typeof documentTypes)[number])) return NextResponse.json({ error: "Tipo de documento inválido." }, { status: 400 });
  if (!isPhrClinicalArea(clinicalArea)) return NextResponse.json({ error: "Área clínica inválida." }, { status: 400 });
  if (!sourceInstitution || sourceInstitution.length > 160) return NextResponse.json({ error: "Indica la institución de origen." }, { status: 400 });
  const documentTime = Date.parse(`${documentDate}T00:00:00Z`);
  if (documentDate && (!/^\d{4}-\d{2}-\d{2}$/.test(documentDate) || !Number.isFinite(documentTime) || new Date(documentTime).toISOString().slice(0, 10) !== documentDate)) {
    return NextResponse.json({ error: "Fecha inválida." }, { status: 400 });
  }

  // ponytail: 20 MB en memoria cubre el MVP; migrar a TUS si las cargas reales lo exigen.
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasValidPatientDocumentSignature(bytes, file.type)) return NextResponse.json({ error: "El contenido no corresponde a un PDF, JPG, PNG o DICOM válido." }, { status: 400 });
  const extension = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "application/dicom": "dcm" }[file.type];
  const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
  const prior = await db.from("patient_documents").select("id", { count: "exact", head: true }).eq("owner_user_id", user.id);
  const uploaded = await db.storage.from("patient-documents").upload(path, bytes, { contentType: file.type, upsert: false });
  if (uploaded.error) {
    await recordPhrEvent(db, user.id, "document_upload_failed", undefined, { mime_type: file.type, size_bytes: file.size, stage: "storage" });
    return NextResponse.json({ error: "No fue posible guardar el archivo." }, { status: 500 });
  }
  const inserted = await db.from("patient_documents").insert({
    owner_user_id: user.id, original_filename: filename, storage_path: path, mime_type: file.type,
    size_bytes: file.size, document_date: documentDate || null, document_type: documentType, clinical_area: clinicalArea, source_institution: sourceInstitution,
  }).select("id").single();
  if (inserted.error) {
    await db.storage.from("patient-documents").remove([path]);
    await recordPhrEvent(db, user.id, "document_upload_failed", undefined, { mime_type: file.type, size_bytes: file.size, stage: "database" });
    return NextResponse.json({ error: "No fue posible registrar el documento." }, { status: 500 });
  }
  await recordPhrEvent(db, user.id, "document_uploaded", inserted.data.id, { mime_type: file.type, size_bytes: file.size, document_type: documentType, clinical_area: clinicalArea, repeat_upload: (prior.count ?? 0) > 0 });
  return NextResponse.json({ ok: true, documentId: inserted.data.id }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePatientApi(request);
  if (auth instanceof NextResponse) return auth;
  const { db } = auth;
  const body = (await request.json().catch(() => ({}))) as { documentId?: string; patientId?: string; shared?: boolean };
  if (!body.documentId || !body.patientId || typeof body.shared !== "boolean") return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  const [document, patient] = await Promise.all([
    db.from("patient_documents").select("id").eq("id", body.documentId).eq("owner_user_id", auth.user.id).maybeSingle(),
    db.from("patients").select("id").eq("id", body.patientId).eq("user_id", auth.user.id).maybeSingle(),
  ]);
  if (!document.data || !patient.data) return NextResponse.json({ error: "Documento o ficha inexistente." }, { status: 404 });

  if (body.shared) {
    const active = await db.from("patient_document_shares").select("id").eq("document_id", body.documentId).eq("patient_id", body.patientId).is("revoked_at", null).maybeSingle();
    if (!active.data) {
      const inserted = await db.from("patient_document_shares").insert({ document_id: body.documentId, patient_id: body.patientId, granted_by: auth.user.id });
      if (inserted.error) return NextResponse.json({ error: "No fue posible compartir el documento." }, { status: 500 });
    }
  } else {
    const revoked = await db.from("patient_document_shares").update({ revoked_at: new Date().toISOString() })
      .eq("document_id", body.documentId).eq("patient_id", body.patientId).is("revoked_at", null);
    if (revoked.error) return NextResponse.json({ error: "No fue posible revocar el acceso." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const auth = await requirePhrApi(request);
  if (auth instanceof NextResponse) return auth;
  const { db } = auth;
  const documentId = request.nextUrl.searchParams.get("documentId");
  if (!documentId) return NextResponse.json({ error: "Documento inválido." }, { status: 400 });
  const document = await db.from("patient_documents").select("id, storage_path").eq("id", documentId).eq("owner_user_id", auth.user.id).maybeSingle();
  if (!document.data) return NextResponse.json({ error: "Documento inexistente." }, { status: 404 });
  const deleted = await db.from("patient_documents").delete().eq("id", documentId).eq("owner_user_id", auth.user.id);
  if (deleted.error) return NextResponse.json({ error: "No fue posible eliminar el documento." }, { status: 500 });
  const removed = await db.storage.from("patient-documents").remove([document.data.storage_path]);
  if (removed.error) console.error("Orphaned patient document", document.data.storage_path, removed.error.message);
  return NextResponse.json({ ok: true });
}
