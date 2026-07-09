import { NextRequest, NextResponse } from "next/server";
import { listExtractedFindings } from "@/features/reports/ai-repository.ts";
import { requireAiRouteUser } from "@/features/reports/ai-route-auth.ts";

export async function GET(request: NextRequest, { params }: { params: Promise<{ reportId: string }> }) {
  const auth = await requireAiRouteUser(request);
  if ("error" in auth) return auth.error;
  const { reportId } = await params;
  try {
    const items = await listExtractedFindings(auth.supabase, reportId);
    return NextResponse.json({ success: true, reportId, items });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "No fue posible consultar hallazgos." }, { status: 500 });
  }
}
