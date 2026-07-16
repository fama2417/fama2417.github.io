import { NextRequest, NextResponse } from "next/server";
import { extractText } from "unpdf";
import { structurePhrImagingText, type PhrImagingText } from "@/features/patient-portal/imaging.ts";
import { requirePhrApi } from "@/lib/server-auth";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const auth = await requirePhrApi(request);
  if (auth instanceof NextResponse) return auth;
  const { documentId } = await request.json().catch(() => ({})) as { documentId?: string };
  if (!documentId || !uuid.test(documentId)) return NextResponse.json({ error: "Documento inválido." }, { status: 400 });
  const document = await auth.db.from("patient_documents").select("storage_path, mime_type, size_bytes").eq("id", documentId).eq("owner_user_id", auth.user.id).eq("document_type", "imaging").maybeSingle();
  if (!document.data) return NextResponse.json({ error: "Informe de radiología inexistente." }, { status: 404 });
  if (document.data.mime_type !== "application/pdf") return NextResponse.json({ error: "La extracción local de texto requiere un PDF." }, { status: 415 });
  if (document.data.size_bytes > 10 * 1024 * 1024) return NextResponse.json({ error: "El PDF supera los 10 MB permitidos para extracción." }, { status: 413 });
  const downloaded = await auth.db.storage.from("patient-documents").download(document.data.storage_path);
  if (downloaded.error) return NextResponse.json({ error: "No fue posible leer el PDF." }, { status: 502 });
  try {
    const extracted = await extractText(new Uint8Array(await downloaded.data.arrayBuffer()), { mergePages: true });
    const text = structurePhrImagingText(extracted.text);
    if (text.fullText.length < 20) return NextResponse.json({ error: "Este PDF no contiene texto seleccionable. No se envió a IA." }, { status: 422 });
    const saved = await auth.db.from("patient_documents").update({ extracted_text: text, text_extracted_at: new Date().toISOString() }).eq("id", documentId).eq("owner_user_id", auth.user.id);
    return saved.error ? NextResponse.json({ error: "No fue posible guardar el texto extraído." }, { status: 502 }) : NextResponse.json({ text });
  } catch { return NextResponse.json({ error: "No fue posible extraer texto de este PDF." }, { status: 422 }); }
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePhrApi(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => ({})) as { documentId?: string; text?: PhrImagingText };
  if (!body.documentId || !uuid.test(body.documentId) || !body.text) return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  const fields: (keyof PhrImagingText)[] = ["clinicalIndication", "technique", "findings", "impression", "fullText"];
  if (fields.some((field) => typeof body.text?.[field] !== "string") || fields.reduce((sum, field) => sum + body.text![field].length, 0) > 150000) return NextResponse.json({ error: "El texto extraído es inválido o demasiado extenso." }, { status: 400 });
  const saved = await auth.db.from("patient_documents").update({ extracted_text: body.text }).eq("id", body.documentId).eq("owner_user_id", auth.user.id).eq("document_type", "imaging");
  return saved.error ? NextResponse.json({ error: "No fue posible guardar las correcciones." }, { status: 502 }) : NextResponse.json({ ok: true });
}
