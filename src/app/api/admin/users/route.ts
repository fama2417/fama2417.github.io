import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { effectiveTenantId } from "@/lib/tenant";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ROLES = ["admin", "operator", "radiologist"] as const;
const UI_ROLES = [...ROLES, "superadmin"] as const;

/** Valida el token del solicitante y exige rol admin. Devuelve el cliente con privilegios y su tenant. */
async function requireAdmin(request: NextRequest) {
  if (!supabaseUrl || !serviceKey) return { error: NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY en el servidor." }, { status: 501 }) };
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return { error: NextResponse.json({ error: "No autenticado." }, { status: 401 }) };
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: caller } = await admin.auth.getUser(token);
  if (!caller.user) return { error: NextResponse.json({ error: "Sesión inválida." }, { status: 401 }) };
  const { data: profile } = await admin.from("profiles").select("role, platform, tenant_id, active_tenant_id").eq("id", caller.user.id).single();
  if (profile?.role !== "admin") return { error: NextResponse.json({ error: "Solo administradores." }, { status: 403 }) };
  return { admin, callerId: caller.user.id, tenantId: effectiveTenantId(profile), platform: !!profile.platform };
}

export async function GET(request: NextRequest) {
  const context = await requireAdmin(request);
  if ("error" in context) return context.error;
  const { admin, tenantId } = context;
  const { data: profiles, error } = await admin.from("profiles").select("id, full_name, role, platform, tenant_id, professional_registration, signature_url").eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { data: authUsers } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emails = new Map(authUsers.users.map((user) => [user.id, user.email]));
  const tenants = context.platform ? (await admin.from("tenants").select("id, name").eq("active", true).order("name")).data ?? [] : [];
  return NextResponse.json({ platform: context.platform, tenantId, tenants, users: profiles.map((profile) => ({ ...profile, role: profile.platform ? "superadmin" : profile.role, email: emails.get(profile.id) ?? "" })) });
}

export async function POST(request: NextRequest) {
  const context = await requireAdmin(request);
  if ("error" in context) return context.error;
  const { admin } = context;
  const body = await request.json();
  const { email, password, fullName, role, professionalRegistration, tenantId: requestedTenantId } = body ?? {};
  if (!email || !password || !fullName || !UI_ROLES.includes(role)) return NextResponse.json({ error: "Datos incompletos." }, { status: 400 });
  if (role === "superadmin" && !context.platform) return NextResponse.json({ error: "Solo un SuperAdmin puede crear otro SuperAdmin." }, { status: 403 });
  if (String(password).length < 12) return NextResponse.json({ error: "La contraseña debe tener al menos 12 caracteres." }, { status: 400 });
  const tenantId = context.platform && typeof requestedTenantId === "string" ? requestedTenantId : context.tenantId;
  if (!(await admin.from("tenants").select("id").eq("id", tenantId).eq("active", true).maybeSingle()).data) return NextResponse.json({ error: "Institución inexistente o inactiva." }, { status: 400 });
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const { error: profileError } = await admin.from("profiles").insert({ id: created.user.id, full_name: String(fullName).trim(), role: role === "superadmin" ? "admin" : role, platform: role === "superadmin", professional_registration: String(professionalRegistration ?? "").trim(), tenant_id: tenantId });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: NextRequest) {
  const context = await requireAdmin(request);
  if ("error" in context) return context.error;
  const { admin } = context;
  const { userId, role, professionalRegistration, fullName, signaturePath, password, email, tenantId: requestedTenantId } = (await request.json()) ?? {};
  if (!userId || !UI_ROLES.includes(role)) return NextResponse.json({ error: "Datos incompletos." }, { status: 400 });
  const { data: target } = await admin.from("profiles").select("tenant_id, platform").eq("id", userId).maybeSingle();
  if (!target) return NextResponse.json({ error: "Usuario inexistente." }, { status: 404 });
  if ((!context.platform && target.tenant_id !== context.tenantId) || (target.platform && !context.platform)) return NextResponse.json({ error: "Usuario fuera de tu institución." }, { status: 403 });
  if (role === "superadmin" && !context.platform) return NextResponse.json({ error: "Solo un SuperAdmin puede asignar ese perfil." }, { status: 403 });
  if (userId === context.callerId && target.platform && role !== "superadmin") return NextResponse.json({ error: "No puedes quitar tu propio acceso SuperAdmin." }, { status: 400 });
  const tenantId = context.platform && typeof requestedTenantId === "string" ? requestedTenantId : target.tenant_id;
  if (!(await admin.from("tenants").select("id").eq("id", tenantId).eq("active", true).maybeSingle()).data) return NextResponse.json({ error: "Institución inexistente o inactiva." }, { status: 400 });
  if ((tenantId !== target.tenant_id || role !== "radiologist") && (await admin.from("appointments").select("id").eq("assigned_to", userId).limit(1).maybeSingle()).data) return NextResponse.json({ error: "Desasigna los estudios pendientes antes de cambiar el rol o institución de este radiólogo." }, { status: 400 });
  if (password !== undefined && String(password).length < 12) return NextResponse.json({ error: "La contraseña debe tener al menos 12 caracteres." }, { status: 400 });
  if (email !== undefined && (typeof email !== "string" || !email.includes("@"))) return NextResponse.json({ error: "Correo inválido." }, { status: 400 });

  const authUpdate: { email?: string; password?: string } = {};
  if (typeof email === "string" && email.includes("@")) authUpdate.email = email.trim();
  if (password !== undefined) authUpdate.password = String(password);
  if (Object.keys(authUpdate).length) {
    const { error: authError } = await admin.auth.admin.updateUserById(userId, authUpdate);
    if (authError) return NextResponse.json({ error: authError.message }, { status: 400 });
  }

  const update: Record<string, string | boolean> = { role: role === "superadmin" ? "admin" : role, platform: role === "superadmin", tenant_id: tenantId, professional_registration: String(professionalRegistration ?? "").trim() };
  if (typeof fullName === "string" && fullName.trim()) update.full_name = fullName.trim();
  if (typeof signaturePath === "string") update.signature_url = signaturePath;
  const { error } = await admin.from("profiles").update(update).eq("id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
