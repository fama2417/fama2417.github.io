import { NextRequest, NextResponse } from "next/server";
import { requirePhrApi } from "@/lib/server-auth";

type Body = { trendKey?: string; label?: string };
const valid = (body: Body) => ({ trendKey: (body.trendKey ?? "").trim(), label: (body.label ?? "").trim() });

export async function POST(request: NextRequest) {
  const auth = await requirePhrApi(request); if (auth instanceof NextResponse) return auth;
  const value = valid(await request.json().catch(() => ({})) as Body);
  if (!value.trendKey || value.trendKey.length > 180 || !value.label || value.label.length > 160) return NextResponse.json({ error: "Biomarcador inválido." }, { status: 400 });
  const saved = await auth.db.from("phr_biomarker_favorites").upsert({ owner_user_id: auth.user.id, trend_key: value.trendKey, label: value.label });
  return saved.error ? NextResponse.json({ error: "No fue posible guardar el favorito." }, { status: 500 }) : NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const auth = await requirePhrApi(request); if (auth instanceof NextResponse) return auth;
  const value = valid(await request.json().catch(() => ({})) as Body);
  if (!value.trendKey) return NextResponse.json({ error: "Biomarcador inválido." }, { status: 400 });
  const deleted = await auth.db.from("phr_biomarker_favorites").delete().eq("owner_user_id", auth.user.id).eq("trend_key", value.trendKey);
  return deleted.error ? NextResponse.json({ error: "No fue posible quitar el favorito." }, { status: 500 }) : NextResponse.json({ ok: true });
}
