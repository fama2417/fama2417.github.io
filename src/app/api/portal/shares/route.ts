import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { phrLabTrendKey } from "@/features/patient-portal/labs";
import { requirePhrApi } from "@/lib/server-auth";

export async function GET(request: NextRequest) {
  const auth = await requirePhrApi(request); if (auth instanceof NextResponse) return auth;
  const result = await auth.db.from("phr_share_links").select("id, title, expires_at, revoked_at, created_at, access_count, last_accessed_at").eq("owner_user_id", auth.user.id).order("created_at", { ascending: false });
  if (result.error) return NextResponse.json({ error: "No fue posible cargar los enlaces." }, { status: 500 });
  return NextResponse.json({ shares: (result.data ?? []).map((row) => ({ id: row.id, title: row.title, expiresAt: row.expires_at, revokedAt: row.revoked_at, createdAt: row.created_at, accessCount: row.access_count, lastAccessedAt: row.last_accessed_at })) });
}

export async function POST(request: NextRequest) {
  const auth = await requirePhrApi(request); if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => ({})) as { title?: string; expiresInDays?: number; documentIds?: string[]; trendKeys?: string[]; includeEmergency?: boolean };
  const title = (body.title ?? "Resumen de salud").trim(), days = Number(body.expiresInDays), documentIds = [...new Set(body.documentIds ?? [])], trendKeys = [...new Set(body.trendKeys ?? [])];
  if (!title || title.length > 120 || !Number.isInteger(days) || days < 1 || days > 30 || documentIds.length > 50 || trendKeys.length > 50) return NextResponse.json({ error: "Configuración del enlace inválida." }, { status: 400 });
  if (!documentIds.length && !trendKeys.length && body.includeEmergency !== true) return NextResponse.json({ error: "Selecciona al menos un dato para compartir." }, { status: 400 });

  const [documents, results] = await Promise.all([
    documentIds.length ? auth.db.from("patient_documents").select("id").eq("owner_user_id", auth.user.id).in("id", documentIds) : Promise.resolve({ data: [], error: null }),
    trendKeys.length ? auth.db.from("phr_lab_results").select("id, loinc_code, analyte").eq("owner_user_id", auth.user.id).eq("review_status", "confirmed").limit(500) : Promise.resolve({ data: [], error: null }),
  ]);
  if (documents.error || results.error || (documents.data?.length ?? 0) !== documentIds.length) return NextResponse.json({ error: "La selección contiene datos no disponibles." }, { status: 400 });
  const selectedResults = (results.data ?? []).filter((row) => trendKeys.includes(phrLabTrendKey({ loincCode: row.loinc_code, analyte: row.analyte })));
  if (trendKeys.some((key) => !selectedResults.some((row) => phrLabTrendKey({ loincCode: row.loinc_code, analyte: row.analyte }) === key))) return NextResponse.json({ error: "Uno de los biomarcadores ya no está disponible." }, { status: 400 });

  const token = randomBytes(32).toString("base64url"), tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
  const share = await auth.db.from("phr_share_links").insert({ owner_user_id: auth.user.id, token_hash: tokenHash, title, include_emergency: body.includeEmergency === true, expires_at: expiresAt }).select("id").single();
  if (share.error) return NextResponse.json({ error: "No fue posible crear el enlace." }, { status: 500 });
  const writes = await Promise.all([
    documentIds.length ? auth.db.from("phr_share_documents").insert(documentIds.map((documentId) => ({ share_id: share.data.id, owner_user_id: auth.user.id, document_id: documentId }))) : Promise.resolve({ error: null }),
    selectedResults.length ? auth.db.from("phr_share_results").insert(selectedResults.map((result) => ({ share_id: share.data.id, owner_user_id: auth.user.id, result_id: result.id }))) : Promise.resolve({ error: null }),
  ]);
  if (writes.some((write) => write.error)) { await auth.db.from("phr_share_links").delete().eq("id", share.data.id); return NextResponse.json({ error: "No fue posible guardar la selección." }, { status: 500 }); }
  return NextResponse.json({ url: `${request.nextUrl.origin}/compartir/${token}` }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const auth = await requirePhrApi(request); if (auth instanceof NextResponse) return auth;
  const shareId = request.nextUrl.searchParams.get("shareId");
  if (!shareId) return NextResponse.json({ error: "Enlace inválido." }, { status: 400 });
  const revoked = await auth.db.from("phr_share_links").update({ revoked_at: new Date().toISOString() }).eq("id", shareId).eq("owner_user_id", auth.user.id).is("revoked_at", null);
  return revoked.error ? NextResponse.json({ error: "No fue posible revocar el enlace." }, { status: 500 }) : NextResponse.json({ ok: true });
}
