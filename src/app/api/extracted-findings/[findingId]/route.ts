import { NextRequest, NextResponse } from "next/server";
import { PatchExtractedFindingActionSchema } from "@/features/reports/ai-actions.ts";
import { confirmExtractedFinding, correctExtractedFinding, rejectExtractedFinding } from "@/features/reports/ai-repository.ts";
import { requireAiRouteUser } from "@/features/reports/ai-route-auth.ts";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ findingId: string }> }) {
  const auth = await requireAiRouteUser(request, ["admin", "radiologist"]);
  if ("error" in auth) return auth.error;
  const parsed = PatchExtractedFindingActionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Accion invalida." }, { status: 400 });

  const { findingId } = await params;
  const body = parsed.data;
  try {
    const item = body.action === "confirm"
      ? await confirmExtractedFinding(auth.supabase, findingId, auth.userId)
      : body.action === "reject"
        ? await rejectExtractedFinding(auth.supabase, findingId, auth.userId, body.reason)
        : await correctExtractedFinding(auth.supabase, findingId, auth.userId, body.correctedText, body.correctedFindingId);
    if (!item) return NextResponse.json({ error: "Hallazgo inexistente." }, { status: 404 });
    return NextResponse.json({ success: true, item });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "No fue posible actualizar el hallazgo.";
    return NextResponse.json({ error: message }, { status: /permission|row-level|policy/i.test(message) ? 403 : 400 });
  }
}
