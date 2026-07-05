import { NextRequest, NextResponse } from "next/server";
import { PACS_COOKIE, verifyPacsCookie } from "../auth";

const pacsUrl = (process.env.ORTHANC_URL ?? "").replace(/\/$/, "");
const secret = process.env.CRON_SECRET ?? "";

/**
 * Valida la sesión y redirige DIRECTO a la VM del PACS (sin pasar por Render):
 * Caddy recibe el secreto en /pacs-session, deja su propia cookie e inyecta
 * las credenciales de Orthanc en /ohif y /dicom-web.
 */
export async function GET(request: NextRequest) {
  if (!pacsUrl || !secret) return NextResponse.json({ error: "Proxy PACS sin configurar." }, { status: 501 });
  if (!verifyPacsCookie(request.cookies.get(PACS_COOKIE)?.value)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const next = request.nextUrl.searchParams.get("next") ?? "/ohif/";
  if (!next.startsWith("/") || next.startsWith("//")) return NextResponse.json({ error: "Ruta inválida." }, { status: 400 });

  const target = `${pacsUrl}/pacs-session?t=${encodeURIComponent(secret)}&next=${encodeURIComponent(next)}`;
  // Si Caddy aún no tiene el handoff configurado, cae al visor vía proxy en vez de mostrar un 404.
  const probe = await fetch(target, { redirect: "manual" }).catch(() => null);
  if (probe?.status !== 302) return NextResponse.redirect(new URL(next, request.nextUrl.origin));
  return NextResponse.redirect(target);
}
