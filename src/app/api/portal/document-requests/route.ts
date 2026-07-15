import { NextRequest, NextResponse } from "next/server";
import { requireClinicalApi, requirePatientApi } from "@/lib/server-auth";

export async function POST(request: NextRequest) {
  const auth = await requireClinicalApi(request);
  if (auth instanceof NextResponse) return auth;
  const body = (await request.json().catch(() => ({}))) as { patientId?: string; message?: string };
  const message = body.message?.trim() || "Solicitamos antecedentes externos relevantes para complementar tu atención.";
  if (!body.patientId || message.length > 500) return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  const patient = await auth.db.from("patients").select("id, user_id").eq("id", body.patientId).eq("tenant_id", auth.tenantId).maybeSingle();
  if (!patient.data?.user_id) return NextResponse.json({ error: "El paciente aún no tiene una cuenta vinculada." }, { status: 409 });
  const pending = await auth.db.from("patient_document_requests").select("id").eq("patient_id", body.patientId).eq("status", "pending").maybeSingle();
  if (pending.data) return NextResponse.json({ error: "Ya existe una solicitud pendiente." }, { status: 409 });
  const inserted = await auth.db.from("patient_document_requests").insert({ patient_id: body.patientId, requested_by: auth.user.id, message });
  return inserted.error ? NextResponse.json({ error: "No fue posible enviar la solicitud." }, { status: 500 }) : NextResponse.json({ ok: true }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePatientApi(request);
  if (auth instanceof NextResponse) return auth;
  const body = (await request.json().catch(() => ({}))) as { requestId?: string; status?: "approved" | "rejected"; documentIds?: string[] };
  if (!body.requestId || !["approved", "rejected"].includes(body.status ?? "")) return NextResponse.json({ error: "Respuesta inválida." }, { status: 400 });
  const row = await auth.db.from("patient_document_requests").select("id, patient_id, status, patient:patients!inner(user_id)").eq("id", body.requestId).maybeSingle();
  const requestPatient = row.data?.patient as unknown as { user_id: string } | null;
  if (!row.data || row.data.status !== "pending" || requestPatient?.user_id !== auth.user.id) return NextResponse.json({ error: "Solicitud inexistente." }, { status: 404 });

  if (body.status === "approved") {
    const ids = [...new Set(body.documentIds ?? [])].slice(0, 20);
    if (!ids.length) return NextResponse.json({ error: "Selecciona al menos un documento." }, { status: 400 });
    const documents = await auth.db.from("patient_documents").select("id").eq("owner_user_id", auth.user.id).in("id", ids);
    if (documents.error || documents.data?.length !== ids.length) return NextResponse.json({ error: "Hay documentos inválidos." }, { status: 400 });
    for (const documentId of ids) {
      const active = await auth.db.from("patient_document_shares").select("id").eq("document_id", documentId).eq("patient_id", row.data.patient_id).is("revoked_at", null).maybeSingle();
      if (!active.data) {
        const share = await auth.db.from("patient_document_shares").insert({ document_id: documentId, patient_id: row.data.patient_id, granted_by: auth.user.id });
        if (share.error) return NextResponse.json({ error: "No fue posible compartir todos los documentos." }, { status: 500 });
      }
    }
  }
  const updated = await auth.db.from("patient_document_requests").update({ status: body.status, responded_at: new Date().toISOString() }).eq("id", body.requestId).eq("status", "pending");
  return updated.error ? NextResponse.json({ error: "No fue posible responder la solicitud." }, { status: 500 }) : NextResponse.json({ ok: true });
}
