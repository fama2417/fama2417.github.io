import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { effectiveTenantId } from "@/lib/tenant";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export async function requireAiRouteUser(request: NextRequest, roles?: string[]) {
  if (!supabaseUrl || !publishableKey) return { error: NextResponse.json({ error: "Falta configuracion de Supabase en el servidor." }, { status: 501 }) };
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token) return { error: NextResponse.json({ error: "No autenticado." }, { status: 401 }) };
  const supabase = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth } = await supabase.auth.getUser(token);
  if (!auth.user) return { error: NextResponse.json({ error: "Sesion invalida." }, { status: 401 }) };
  const { data: profile, error } = await supabase.from("profiles").select("role, tenant_id, active_tenant_id, platform").eq("id", auth.user.id).single();
  if (error || !profile) return { error: NextResponse.json({ error: "Perfil inexistente." }, { status: 403 }) };
  if (roles && !roles.includes(profile.role)) return { error: NextResponse.json({ error: "No autorizado." }, { status: 403 }) };
  return { supabase, userId: auth.user.id, role: profile.role, tenantId: effectiveTenantId(profile) };
}
