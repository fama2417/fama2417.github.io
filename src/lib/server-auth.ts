import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { effectiveTenantId } from "./tenant";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export function serviceDatabase() {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function caller(request: NextRequest) {
  if (!url || !key) return NextResponse.json({ error: "El servidor no está configurado." }, { status: 501 });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  const db = serviceDatabase();
  const user = (await db.auth.getUser(token)).data.user;
  return user ? { db, user } : NextResponse.json({ error: "Sesión inválida." }, { status: 401 });
}

export async function requireNonStaffApi(request: NextRequest) {
  const auth = await caller(request);
  if (auth instanceof NextResponse) return auth;
  if ((await auth.db.from("profiles").select("id").eq("id", auth.user.id).maybeSingle()).data) {
    return NextResponse.json({ error: "Esta operación es exclusiva para cuentas de paciente." }, { status: 403 });
  }
  return auth;
}

export async function requirePhrApi(request: NextRequest) {
  const auth = await requireNonStaffApi(request);
  if (auth instanceof NextResponse) return auth;
  const profile = await auth.db.from("phr_profiles").select("user_id, full_name, birth_date, identifier, blood_type, allergies, conditions, medications, emergency_contact_name, emergency_contact_phone, emergency_notes").eq("user_id", auth.user.id).maybeSingle();
  return profile.data ? { ...auth, profile: profile.data } : NextResponse.json({ error: "Completa primero tu registro personal." }, { status: 403 });
}

export async function requirePatientApi(request: NextRequest) {
  const auth = await requireNonStaffApi(request);
  if (auth instanceof NextResponse) return auth;
  const patients = await auth.db.from("patients").select("id, tenant_id").eq("user_id", auth.user.id);
  return patients.data?.length ? { ...auth, patients: patients.data } : NextResponse.json({ error: "La cuenta no está vinculada a una ficha de paciente." }, { status: 403 });
}

export async function requireClinicalApi(request: NextRequest) {
  const auth = await caller(request);
  if (auth instanceof NextResponse) return auth;
  const profile = await auth.db.from("profiles").select("role, platform, tenant_id, active_tenant_id").eq("id", auth.user.id).maybeSingle();
  const tenantId = profile.data ? effectiveTenantId(profile.data) : "";
  if (!tenantId || !["admin", "radiologist", "clinician"].includes(profile.data?.role ?? "")) {
    return NextResponse.json({ error: "Se requiere un perfil clínico." }, { status: 403 });
  }
  return { ...auth, tenantId, role: profile.data!.role };
}
