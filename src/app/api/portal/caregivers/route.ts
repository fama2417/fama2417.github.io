import { NextRequest, NextResponse } from "next/server";
import { requirePhrApi } from "@/lib/server-auth";

export async function GET(request: NextRequest) {
  const auth = await requirePhrApi(request); if (auth instanceof NextResponse) return auth;
  const grants = await auth.db.from("phr_caregiver_grants").select("id, grantee_user_id, relationship, created_at, revoked_at").eq("owner_user_id", auth.user.id).order("created_at", { ascending: false });
  if (grants.error) return NextResponse.json({ error: "No fue posible cargar los accesos." }, { status: 500 });
  const caregivers = await Promise.all((grants.data ?? []).map(async (grant) => {
    const user = await auth.db.auth.admin.getUserById(grant.grantee_user_id);
    return { id: grant.id, email: user.data.user?.email ?? "Cuenta eliminada", relationship: grant.relationship, createdAt: grant.created_at, revokedAt: grant.revoked_at };
  }));
  return NextResponse.json({ caregivers });
}

export async function POST(request: NextRequest) {
  const auth = await requirePhrApi(request); if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => ({})) as { email?: string; relationship?: string };
  const email = (body.email ?? "").trim().toLowerCase(), relationship = body.relationship;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !["family", "caregiver"].includes(relationship ?? "")) return NextResponse.json({ error: "Correo o relación inválidos." }, { status: 400 });
  if (email === auth.user.email?.toLowerCase()) return NextResponse.json({ error: "No puedes darte acceso a ti mismo." }, { status: 400 });
  const listed = await auth.db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  let grantee = listed.data.users.find((user) => user.email?.toLowerCase() === email), invited = false;
  if (!grantee) {
    const invitation = await auth.db.auth.admin.inviteUserByEmail(email, { redirectTo: `${request.nextUrl.origin}/portal` });
    if (invitation.error || !invitation.data.user) return NextResponse.json({ error: "No fue posible invitar esa cuenta." }, { status: 502 });
    grantee = invitation.data.user; invited = true;
  }
  if ((await auth.db.from("profiles").select("id").eq("id", grantee.id).maybeSingle()).data) return NextResponse.json({ error: "Una cuenta clínica no puede ser cuidadora del PHR." }, { status: 409 });
  await auth.db.from("phr_caregiver_grants").update({ revoked_at: new Date().toISOString() }).eq("owner_user_id", auth.user.id).eq("grantee_user_id", grantee.id).is("revoked_at", null);
  const inserted = await auth.db.from("phr_caregiver_grants").insert({ owner_user_id: auth.user.id, grantee_user_id: grantee.id, relationship });
  return inserted.error ? NextResponse.json({ error: "No fue posible conceder el acceso." }, { status: 500 }) : NextResponse.json({ invited }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const auth = await requirePhrApi(request); if (auth instanceof NextResponse) return auth;
  const grantId = request.nextUrl.searchParams.get("grantId");
  if (!grantId) return NextResponse.json({ error: "Acceso inválido." }, { status: 400 });
  const revoked = await auth.db.from("phr_caregiver_grants").update({ revoked_at: new Date().toISOString() }).eq("id", grantId).eq("owner_user_id", auth.user.id).is("revoked_at", null);
  return revoked.error ? NextResponse.json({ error: "No fue posible revocar el acceso." }, { status: 500 }) : NextResponse.json({ ok: true });
}
