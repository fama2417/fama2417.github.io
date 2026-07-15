import { NextRequest, NextResponse } from "next/server";
import { validatePhrProfile } from "@/features/patient-portal/profile";
import { requireNonStaffApi, requirePhrApi } from "@/lib/server-auth";

type Body = { fullName?: string; birthDate?: string; identifier?: string; acceptedPrivacy?: boolean; confirmation?: string };

export async function POST(request: NextRequest) {
  const auth = await requireNonStaffApi(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => ({})) as Body;
  const validated = validatePhrProfile({ fullName: body.fullName ?? "", birthDate: body.birthDate ?? "", identifier: body.identifier ?? "" });
  if ("error" in validated) return NextResponse.json({ error: validated.error }, { status: 400 });
  if (body.acceptedPrivacy !== true) return NextResponse.json({ error: "Debes aceptar la política de privacidad." }, { status: 400 });
  const exists = await auth.db.from("phr_profiles").select("user_id").eq("user_id", auth.user.id).maybeSingle();
  if (exists.data) return NextResponse.json({ error: "Tu registro personal ya existe." }, { status: 409 });
  const now = new Date().toISOString();
  const inserted = await auth.db.from("phr_profiles").insert({
    user_id: auth.user.id, full_name: validated.value.fullName, birth_date: validated.value.birthDate,
    identifier: validated.value.identifier, terms_accepted_at: now, privacy_accepted_at: now,
  });
  return inserted.error ? NextResponse.json({ error: "No fue posible crear tu registro personal." }, { status: 500 }) : NextResponse.json({ ok: true }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePhrApi(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => ({})) as Body;
  const validated = validatePhrProfile({ fullName: body.fullName ?? "", birthDate: body.birthDate ?? "", identifier: body.identifier ?? "" });
  if ("error" in validated) return NextResponse.json({ error: validated.error }, { status: 400 });
  const updated = await auth.db.from("phr_profiles").update({
    full_name: validated.value.fullName, birth_date: validated.value.birthDate, identifier: validated.value.identifier,
  }).eq("user_id", auth.user.id);
  return updated.error ? NextResponse.json({ error: "No fue posible actualizar tu perfil." }, { status: 500 }) : NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const auth = await requirePhrApi(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => ({})) as Body;
  if (body.confirmation !== "ELIMINAR") return NextResponse.json({ error: "Escribe ELIMINAR para confirmar." }, { status: 400 });
  const documents = await auth.db.from("patient_documents").select("storage_path").eq("owner_user_id", auth.user.id);
  if (documents.error) return NextResponse.json({ error: "No fue posible preparar la eliminación." }, { status: 500 });
  const deleted = await auth.db.auth.admin.deleteUser(auth.user.id);
  if (deleted.error) return NextResponse.json({ error: "No fue posible eliminar la cuenta." }, { status: 500 });
  const paths = (documents.data ?? []).map((row) => row.storage_path);
  if (paths.length) {
    const removed = await auth.db.storage.from("patient-documents").remove(paths);
    if (removed.error) console.error("Orphaned deleted PHR files", auth.user.id, removed.error.message);
  }
  return NextResponse.json({ ok: true });
}
