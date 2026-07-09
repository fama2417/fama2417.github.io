import { NextRequest, NextResponse } from "next/server";
import { getReportAiSummary, listExtractedFindings } from "@/features/reports/ai-repository.ts";
import { requireAiRouteUser } from "@/features/reports/ai-route-auth.ts";

export async function GET(request: NextRequest, { params }: { params: Promise<{ reportId: string }> }) {
  const auth = await requireAiRouteUser(request);
  if ("error" in auth) return auth.error;
  const { reportId } = await params;
  try {
    const [items, clinicalSummary] = await Promise.all([listExtractedFindings(auth.supabase, reportId), getReportAiSummary(auth.supabase, reportId)]);
    return NextResponse.json({ success: true, reportId, items, clinicalSummary });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "No fue posible consultar hallazgos." }, { status: 500 });
  }
}
