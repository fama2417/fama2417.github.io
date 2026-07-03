import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** Solo usuarios con profiles.platform = true administran instituciones. */
async function requirePlatform(request: NextRequest) {
  if (!supabaseUrl || !serviceKey) return { error: NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY en el servidor." }, { status: 501 }) };
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return { error: NextResponse.json({ error: "No autenticado." }, { status: 401 }) };
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: caller } = await admin.auth.getUser(token);
  if (!caller.user) return { error: NextResponse.json({ error: "Sesión inválida." }, { status: 401 }) };
  const { data: profile } = await admin.from("profiles").select("platform").eq("id", caller.user.id).single();
  if (!profile?.platform) return { error: NextResponse.json({ error: "Solo usuarios de plataforma." }, { status: 403 }) };
  return { admin };
}

export async function GET(request: NextRequest) {
  const context = await requirePlatform(request);
  if ("error" in context) return context.error;
  const { data, error } = await context.admin.from("tenants").select("id, name, active, created_at").order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tenants: data });
}

export async function POST(request: NextRequest) {
  const context = await requirePlatform(request);
  if ("error" in context) return context.error;
  const { admin } = context;
  const { name, adminEmail, adminPassword, adminName } = (await request.json()) ?? {};
  if (!name || !adminEmail || !adminPassword || !adminName) return NextResponse.json({ error: "Datos incompletos." }, { status: 400 });
  if (String(adminPassword).length < 12) return NextResponse.json({ error: "La contraseña debe tener al menos 12 caracteres." }, { status: 400 });

  const { data: tenant, error: tenantError } = await admin.from("tenants").insert({ name }).select("id").single();
  if (tenantError) return NextResponse.json({ error: tenantError.message }, { status: 400 });

  const { data: created, error: userError } = await admin.auth.admin.createUser({ email: adminEmail, password: adminPassword, email_confirm: true });
  if (userError) {
    await admin.from("tenants").delete().eq("id", tenant.id);
    return NextResponse.json({ error: userError.message }, { status: 400 });
  }
  const { error: profileError } = await admin.from("profiles").insert({ id: created.user.id, full_name: adminName, role: "admin", tenant_id: tenant.id });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    await admin.from("tenants").delete().eq("id", tenant.id);
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
