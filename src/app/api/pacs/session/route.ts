import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PACS_COOKIE, signPacsCookie } from "../auth";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const hours = 8;

/** Valida la sesión de Supabase y deja una cookie firmada para que el iframe de OHIF pase por el proxy PACS sin pedir credenciales. */
export async function POST(request: NextRequest) {
  if (!process.env.ORTHANC_URL || !process.env.ORTHANC_CREDS || !process.env.CRON_SECRET) return NextResponse.json({ error: "Proxy PACS sin configurar (ORTHANC_URL, ORTHANC_CREDS, CRON_SECRET)." }, { status: 501 });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const { data, error } = await createClient(supabaseUrl, publishableKey).auth.getUser(token);
  if (error || !data.user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const response = NextResponse.json({ ok: true });
  response.cookies.set(PACS_COOKIE, signPacsCookie(Date.now() + hours * 3600_000), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: hours * 3600,
  });
  return response;
}
