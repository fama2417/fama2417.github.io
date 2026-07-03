import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ROLES = ["admin", "operator", "radiologist"] as const;

/** Valida el token del solicitante y exige rol admin. Devuelve el cliente con privilegios y su tenant. */
async function requireAdmin(request: NextRequest) {
  if (!supabaseUrl || !serviceKey) return { error: NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY en el servidor." }, { status: 501 }) };
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return { error: NextResponse.json({ error: "No autenticado." }, { status: 401 }) };
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: caller } = await admin.auth.getUser(token);
  if (!caller.user) return { error: NextResponse.json({ error: "Sesión inválida." }, { status: 401 }) };
  const { data: profile } = await admin.from("profiles").select("role, tenant_id").eq("id", caller.user.id).single();
  if (profile?.role !== "admin") return { error: NextResponse.json({ error: "Solo administradores." }, { status: 403 }) };
  return { admin, tenantId: profile.tenant_id as string };
}

export async function GET(request: NextRequest) {
  const context = await requireAdmin(request);
  if ("error" in context) return context.error;
  const { admin, tenantId } = context;
  const { data: profiles, error } = await admin.from("profiles").select("id, full_name, role").eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { data: authUsers } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emails = new Map(authUsers.users.map((user) => [user.id, user.email]));
  return NextResponse.json({ users: profiles.map((profile) => ({ ...profile, email: emails.get(profile.id) ?? "" })) });
}

export async function POST(request: NextRequest) {
  const context = await requireAdmin(request);
  if ("error" in context) return context.error;
  const { admin, tenantId } = context;
  const body = await request.json();
  const { email, password, fullName, role } = body ?? {};
  if (!email || !password || !fullName || !ROLES.includes(role)) return NextResponse.json({ error: "Datos incompletos." }, { status: 400 });
  if (String(password).length < 12) return NextResponse.json({ error: "La contraseña debe tener al menos 12 caracteres." }, { status: 400 });
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const { error: profileError } = await admin.from("profiles").insert({ id: created.user.id, full_name: fullName, role, tenant_id: tenantId });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: NextRequest) {
  const context = await requireAdmin(request);
  if ("error" in context) return context.error;
  const { admin, tenantId } = context;
  const { userId, role } = (await request.json()) ?? {};
  if (!userId || !ROLES.includes(role)) return NextResponse.json({ error: "Datos incompletos." }, { status: 400 });
  const { error } = await admin.from("profiles").update({ role }).eq("id", userId).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
