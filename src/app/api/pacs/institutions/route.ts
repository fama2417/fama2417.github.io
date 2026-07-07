import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { mapOrthancStudy, type OrthancStudy } from "@/lib/orthanc";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const orthancUrl = (process.env.ORTHANC_URL ?? "").replace(/\/$/, "");
const orthancCreds = process.env.ORTHANC_CREDS ?? "";

/** Valores DICOM InstitutionName presentes en Orthanc, para elegir la "Institución PACS" sin adivinar. */
export async function GET(request: NextRequest) {
  if (!supabaseUrl || !serviceKey || !orthancUrl || !orthancCreds) return NextResponse.json({ institutions: [] });
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: caller } = await admin.auth.getUser(token);
  if (!caller.user) return NextResponse.json({ error: "Sesión inválida." }, { status: 401 });
  const { data: profile } = await admin.from("profiles").select("role").eq("id", caller.user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Solo administradores." }, { status: 403 });

  const upstream = await fetch(`${orthancUrl}/studies?expand`, { headers: { Authorization: `Basic ${Buffer.from(orthancCreds).toString("base64")}` } });
  if (!upstream.ok) return NextResponse.json({ error: `PACS no disponible (${upstream.status}).` }, { status: 502 });
  const institutions = [...new Set(((await upstream.json()) as OrthancStudy[]).map((study) => mapOrthancStudy(study).institution.trim()).filter(Boolean))].sort();
  return NextResponse.json({ institutions });
}
