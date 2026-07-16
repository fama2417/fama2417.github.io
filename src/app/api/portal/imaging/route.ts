import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { extractText } from "unpdf";
import { z } from "zod";
import { structurePhrImagingText, type PhrImagingText } from "@/features/patient-portal/imaging.ts";
import { aiConfig } from "@/features/reports/ai-budget.ts";
import { recordPhrEvent } from "@/lib/phr-events";
import { requirePhrApi } from "@/lib/server-auth";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const imageTypes = new Set(["image/jpeg", "image/png"]);
const ImagingTextSchema = z.object({ clinicalIndication: z.string(), technique: z.string(), findings: z.string(), impression: z.string(), fullText: z.string() });

async function extractImagingPhoto(bytes: Uint8Array, mimeType: string) {
  const config = aiConfig(), client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.parse({
    model: config.model,
    input: [
      { role: "system", content: "Transcribe un informe radiológico fotografiado. No diagnostiques, interpretes, corrijas ni agregues datos. Conserva el texto original en fullText y separa sólo las secciones explícitas; usa cadena vacía cuando no existan." },
      { role: "user", content: [{ type: "input_image", image_url: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`, detail: "high" }, { type: "input_text", text: "Extrae indicación clínica, técnica, hallazgos, conclusión o impresión y transcripción completa." }] },
    ],
    text: { format: zodTextFormat(ImagingTextSchema, "phr_imaging_text") }, max_output_tokens: Math.min(config.maxOutputTokens, 4000), store: false,
  } as any, { timeout: config.timeoutMs });
  const parsed = (response as any).output_parsed ?? (response as any).output?.flatMap((item: any) => item.content ?? []).find((content: any) => content?.parsed)?.parsed;
  const text = ImagingTextSchema.parse(parsed ?? JSON.parse((response as any).output_text));
  const usage = (response as any).usage ?? {};
  return { text, inputTokens: usage.input_tokens ?? null, outputTokens: usage.output_tokens ?? null };
}

export async function POST(request: NextRequest) {
  const auth = await requirePhrApi(request);
  if (auth instanceof NextResponse) return auth;
  const { documentId } = await request.json().catch(() => ({})) as { documentId?: string };
  if (!documentId || !uuid.test(documentId)) return NextResponse.json({ error: "Documento inválido." }, { status: 400 });
  const document = await auth.db.from("patient_documents").select("storage_path, mime_type, size_bytes").eq("id", documentId).eq("owner_user_id", auth.user.id).eq("document_type", "imaging").maybeSingle();
  if (!document.data) return NextResponse.json({ error: "Informe de radiología inexistente." }, { status: 404 });
  if (document.data.mime_type !== "application/pdf" && !imageTypes.has(document.data.mime_type)) return NextResponse.json({ error: "La extracción acepta PDF, JPG o PNG." }, { status: 415 });
  if (document.data.size_bytes > 10 * 1024 * 1024) return NextResponse.json({ error: "El archivo supera los 10 MB permitidos para extracción." }, { status: 413 });
  const downloaded = await auth.db.storage.from("patient-documents").download(document.data.storage_path);
  if (downloaded.error) return NextResponse.json({ error: "No fue posible leer el PDF." }, { status: 502 });
  const startedAt = Date.now(), bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  if (document.data.mime_type === "application/pdf") try {
    const extracted = await extractText(bytes, { mergePages: true }), text = structurePhrImagingText(extracted.text);
    if (text.fullText.length < 20) {
      await recordPhrEvent(auth.db, auth.user.id, "imaging_extraction_failed", documentId, { method: "local", duration_ms: Date.now() - startedAt, reason: "no_text" });
      return NextResponse.json({ error: "Este PDF no contiene texto seleccionable. No se envió a IA; puedes subir una fotografía legible." }, { status: 422 });
    }
    await recordPhrEvent(auth.db, auth.user.id, "imaging_extraction_completed", documentId, { method: "local", duration_ms: Date.now() - startedAt });
    return NextResponse.json({ text, method: "local" });
  } catch {
    await recordPhrEvent(auth.db, auth.user.id, "imaging_extraction_failed", documentId, { method: "local", duration_ms: Date.now() - startedAt, reason: "parse" });
    return NextResponse.json({ error: "No fue posible extraer texto de este PDF." }, { status: 422 });
  }

  const config = aiConfig();
  if (!config.enabled || !process.env.OPENAI_API_KEY) return NextResponse.json({ error: "La extracción visual no está habilitada." }, { status: 503 });
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  const attempts = await auth.db.from("phr_product_events").select("id", { count: "exact", head: true }).eq("owner_user_id", auth.user.id).eq("event_name", "imaging_ai_attempted").gte("created_at", start.toISOString());
  if ((attempts.count ?? 0) >= Math.max(1, Number(process.env.PHR_AI_MAX_PER_DAY ?? 5))) return NextResponse.json({ error: "Alcanzaste el límite diario de análisis automáticos." }, { status: 429 });
  await recordPhrEvent(auth.db, auth.user.id, "imaging_ai_attempted", documentId, { mime_type: document.data.mime_type, size_bytes: document.data.size_bytes });
  try {
    const result = await extractImagingPhoto(bytes, document.data.mime_type);
    if (result.text.fullText.trim().length < 20) throw new Error("empty");
    await recordPhrEvent(auth.db, auth.user.id, "imaging_extraction_completed", documentId, { method: "ai_visual", duration_ms: Date.now() - startedAt, input_tokens: result.inputTokens, output_tokens: result.outputTokens });
    return NextResponse.json({ text: result.text, method: "ai_visual" });
  } catch {
    await recordPhrEvent(auth.db, auth.user.id, "imaging_extraction_failed", documentId, { method: "ai_visual", duration_ms: Date.now() - startedAt, reason: "recognition" });
    return NextResponse.json({ error: "No fue posible reconocer el texto de esta fotografía." }, { status: 502 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePhrApi(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => ({})) as { documentId?: string; text?: PhrImagingText };
  if (!body.documentId || !uuid.test(body.documentId) || !body.text) return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  const fields: (keyof PhrImagingText)[] = ["clinicalIndication", "technique", "findings", "impression", "fullText"];
  if (fields.some((field) => typeof body.text?.[field] !== "string") || fields.reduce((sum, field) => sum + body.text![field].length, 0) > 150000) return NextResponse.json({ error: "El texto extraído es inválido o demasiado extenso." }, { status: 400 });
  const saved = await auth.db.from("patient_documents").update({ extracted_text: body.text, text_extracted_at: new Date().toISOString() }).eq("id", body.documentId).eq("owner_user_id", auth.user.id).eq("document_type", "imaging").select("mime_type").maybeSingle();
  if (saved.error || !saved.data) return NextResponse.json({ error: "No fue posible guardar las correcciones." }, { status: 502 });
  await recordPhrEvent(auth.db, auth.user.id, "imaging_text_confirmed", body.documentId, { method: saved.data.mime_type === "application/pdf" ? "local" : "ai_visual" });
  return NextResponse.json({ ok: true });
}
