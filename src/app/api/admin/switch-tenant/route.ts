import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** El superadmin de plataforma cambia la institución activa (afecta el tenant efectivo de RLS). */
export async function POST(request: NextRequest) {
  if (!supabaseUrl || !serviceKey) return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY en el servidor." }, { status: 501 });
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: caller } = await admin.auth.getUser(token);
  if (!caller.user) return NextResponse.json({ error: "Sesión inválida." }, { status: 401 });
  const { data: profile } = await admin.from("profiles").select("platform").eq("id", caller.user.id).single();
  if (!profile?.platform) return NextResponse.json({ error: "Solo superadministradores de plataforma." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const tenantId = body?.tenantId;
  if (typeof tenantId !== "string" || !tenantId) return NextResponse.json({ error: "Falta tenantId." }, { status: 400 });
  const { data: tenant } = await admin.from("tenants").select("id").eq("id", tenantId).eq("active", true).single();
  if (!tenant) return NextResponse.json({ error: "Institución inexistente." }, { status: 404 });

  const { error } = await admin.from("profiles").update({ active_tenant_id: tenantId }).eq("id", caller.user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
