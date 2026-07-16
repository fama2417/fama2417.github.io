import { NextRequest, NextResponse } from "next/server";
import { validatePhrHealthItem, type PhrHealthItemDraft } from "@/features/patient-portal/health-summary.ts";
import { requirePhrApi } from "@/lib/server-auth";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Body = Partial<PhrHealthItemDraft> & { id?: string };

async function validBody(request: NextRequest, ownerUserId: string, db: any) {
  const body = await request.json().catch(() => ({})) as Body;
  const validated = validatePhrHealthItem(body);
  if ("error" in validated) return NextResponse.json({ error: validated.error }, { status: 400 });
  if (validated.value.sourceDocumentId) {
    const document = await db.from("patient_documents").select("id").eq("id", validated.value.sourceDocumentId).eq("owner_user_id", ownerUserId).maybeSingle();
    if (!document.data) return NextResponse.json({ error: "El documento de origen no pertenece a tu registro." }, { status: 400 });
  }
  return { body, value: validated.value };
}

const dbValue = (value: PhrHealthItemDraft) => ({
  kind: value.kind, label: value.label, status: value.status, event_date: value.eventDate || null,
  source: value.source, source_document_id: value.sourceDocumentId || null, notes: value.notes,
});

export async function POST(request: NextRequest) {
  const auth = await requirePhrApi(request); if (auth instanceof NextResponse) return auth;
  const parsed = await validBody(request, auth.user.id, auth.db); if (parsed instanceof NextResponse) return parsed;
  const saved = await auth.db.from("phr_health_items").insert({ owner_user_id: auth.user.id, ...dbValue(parsed.value) }).select("id").single();
  return saved.error ? NextResponse.json({ error: "No fue posible guardar el antecedente." }, { status: 500 }) : NextResponse.json({ id: saved.data.id }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePhrApi(request); if (auth instanceof NextResponse) return auth;
  const parsed = await validBody(request, auth.user.id, auth.db); if (parsed instanceof NextResponse) return parsed;
  if (!parsed.body.id || !uuid.test(parsed.body.id)) return NextResponse.json({ error: "Antecedente inválido." }, { status: 400 });
  const saved = await auth.db.from("phr_health_items").update(dbValue(parsed.value)).eq("id", parsed.body.id).eq("owner_user_id", auth.user.id).select("id").maybeSingle();
  return saved.error || !saved.data ? NextResponse.json({ error: "No fue posible actualizar el antecedente." }, { status: saved.error ? 500 : 404 }) : NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const auth = await requirePhrApi(request); if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!uuid.test(id)) return NextResponse.json({ error: "Antecedente inválido." }, { status: 400 });
  const deleted = await auth.db.from("phr_health_items").delete().eq("id", id).eq("owner_user_id", auth.user.id).select("id").maybeSingle();
  return deleted.error || !deleted.data ? NextResponse.json({ error: "No fue posible eliminar el antecedente." }, { status: deleted.error ? 500 : 404 }) : NextResponse.json({ ok: true });
}
