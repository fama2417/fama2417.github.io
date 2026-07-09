import { NextRequest, NextResponse } from "next/server";
import { extractRadiologyFindingsWithAi } from "@/features/reports/ai-extraction.ts";
import { requireAiRouteUser } from "@/features/reports/ai-route-auth.ts";

const errorStatus = (message: string) => {
  if (/limit|budget/i.test(message)) return 429;
  if (/sin hallazgos|sin impresion/i.test(message)) return 400;
  if (/inexistente/i.test(message)) return 404;
  return 502;
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ reportId: string }> }) {
  if (process.env.AI_EXTRACTION_ENABLED !== "true") return NextResponse.json({ error: "AI extraction is disabled" }, { status: 403 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "OpenAI API key is not configured" }, { status: 503 });

  const auth = await requireAiRouteUser(request, ["admin", "radiologist"]);
  if ("error" in auth) return auth.error;
  const { reportId } = await params;
  const body = await request.json().catch(() => ({}));
  const result = await extractRadiologyFindingsWithAi(reportId, { supabase: auth.supabase, force: body?.force === true });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: errorStatus(result.error) });

  return NextResponse.json({
    success: true,
    reportId,
    extractedFindings: result.findings,
    candidatesCreated: result.findings.filter((item) => item.findingCandidateId).length,
    usage: result.usage,
    warnings: result.warnings,
  });
}
