import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { extractText } from "unpdf";
import { z } from "zod";
import { structurePhrImagingText, type PhrImagingText } from "@/features/patient-portal/imaging.ts";
import { aiConfig } from "@/features/reports/ai-budget.ts";
import { sanitizeTextForAi } from "@/features/reports/ai-sanitizer.ts";
import { extractScannedPdf } from "@/lib/pdf-ocr.ts";
import { recordPhrEvent } from "@/lib/phr-events";
import { requirePhrApi } from "@/lib/server-auth";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const imageTypes = new Set(["image/jpeg", "image/png"]);
const ImagingTextSchema = z.object({ clinicalIndication: z.string(), technique: z.string(), findings: z.string(), impression: z.string(), plainLanguage: z.string(), fullText: z.string() });

const parsedText = (response: any) => ImagingTextSchema.parse(response.output_parsed ?? response.output?.flatMap((item: any) => item.content ?? []).find((content: any) => content?.parsed)?.parsed ?? JSON.parse(response.output_text));

async function organizeImagingText(fullText: string, patientName: string) {
  const config = aiConfig(), client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const name = patientName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const safeText = sanitizeTextForAi(fullText).replace(name ? new RegExp(name, "gi") : /$a/, "[PACIENTE]");
  const response = await client.responses.parse({
    model: config.model,
    input: [
      { role: "system", content: "Organiza un informe radiológico ya transcrito. Conserva indicación, técnica, hallazgos e impresión sin agregar datos y excluye nombres, identificadores, firmas, páginas y textos administrativos. En plainLanguage explica en español simple, con 2 a 5 puntos breves, únicamente lo que el informe dice; aclara términos técnicos entre paréntesis, sin diagnosticar, inferir causas, recomendar tratamientos ni reemplazar al profesional. fullText debe quedar vacío." },
      { role: "user", content: safeText },
    ],
    text: { format: zodTextFormat(ImagingTextSchema, "phr_imaging_text") }, max_output_tokens: Math.min(config.maxOutputTokens, 4000), store: false,
  } as any, { timeout: config.timeoutMs });
  const usage = (response as any).usage ?? {};
  return { text: { ...parsedText(response), fullText }, inputTokens: usage.input_tokens ?? null, outputTokens: usage.output_tokens ?? null };
}

async function extractImagingPhoto(bytes: Uint8Array, mimeType: string) {
  const config = aiConfig(), client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.parse({
    model: config.model,
    input: [
      { role: "system", content: "Transcribe un informe radiológico fotografiado. No agregues datos. Conserva el texto original en fullText, separa las secciones clínicas y excluye firmas o datos administrativos. En plainLanguage explica con 2 a 5 puntos breves únicamente lo que dice el informe, aclarando términos técnicos sin diagnosticar ni recomendar tratamientos." },
      { role: "user", content: [{ type: "input_image", image_url: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`, detail: "high" }, { type: "input_text", text: "Extrae indicación clínica, técnica, hallazgos, conclusión o impresión, explicación simple y transcripción completa." }] },
    ],
    text: { format: zodTextFormat(ImagingTextSchema, "phr_imaging_text") }, max_output_tokens: Math.min(config.maxOutputTokens, 4000), store: false,
  } as any, { timeout: config.timeoutMs });
  const text = parsedText(response);
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
  const startedAt = Date.now(), bytes = new Uint8Array(await downloaded.data.arrayBuffer()), config = aiConfig();
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  const attempts = config.enabled && process.env.OPENAI_API_KEY ? await auth.db.from("phr_product_events").select("id", { count: "exact", head: true }).eq("owner_user_id", auth.user.id).eq("event_name", "imaging_ai_attempted").gte("created_at", start.toISOString()) : { count: 0 };
  const aiAvailable = config.enabled && !!process.env.OPENAI_API_KEY && (attempts.count ?? 0) < Math.max(1, Number(process.env.PHR_AI_MAX_PER_DAY ?? 5));
  if (document.data.mime_type === "application/pdf") try {
    const extracted = await extractText(bytes, { mergePages: true });
    const ocr = extracted.text.trim().length >= 20 ? null : await extractScannedPdf(bytes), fullText = (ocr ? ocr.text.join("\n\n") : extracted.text).trim();
    if (fullText.length < 20) throw new Error("no_text");
    const fallback = structurePhrImagingText(fullText), method = ocr ? "local_ocr" : "local";
    if (!aiAvailable) return NextResponse.json({ text: fallback, method });
    await recordPhrEvent(auth.db, auth.user.id, "imaging_ai_attempted", documentId, { mime_type: document.data.mime_type, size_bytes: document.data.size_bytes });
    try {
      const result = await organizeImagingText(fullText, auth.profile.full_name);
      await recordPhrEvent(auth.db, auth.user.id, "imaging_extraction_completed", documentId, { method: `${method}_ai`, duration_ms: Date.now() - startedAt, input_tokens: result.inputTokens, output_tokens: result.outputTokens });
      return NextResponse.json({ text: result.text, method: `${method}_ai` });
    } catch { return NextResponse.json({ text: fallback, method }); }
  } catch {
    await recordPhrEvent(auth.db, auth.user.id, "imaging_extraction_failed", documentId, { method: "local_ocr", duration_ms: Date.now() - startedAt, reason: "parse" });
    return NextResponse.json({ error: "No fue posible extraer texto de este PDF escaneado." }, { status: 422 });
  }

  if (!aiAvailable) return NextResponse.json({ error: config.enabled && process.env.OPENAI_API_KEY ? "Alcanzaste el límite diario de análisis automáticos." : "La extracción visual no está habilitada." }, { status: config.enabled && process.env.OPENAI_API_KEY ? 429 : 503 });
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
  const fields: (keyof PhrImagingText)[] = ["clinicalIndication", "technique", "findings", "impression", "plainLanguage", "fullText"];
  if (fields.some((field) => typeof body.text?.[field] !== "string") || fields.reduce((sum, field) => sum + body.text![field].length, 0) > 150000) return NextResponse.json({ error: "El texto extraído es inválido o demasiado extenso." }, { status: 400 });
  const saved = await auth.db.from("patient_documents").update({ extracted_text: body.text, text_extracted_at: new Date().toISOString() }).eq("id", body.documentId).eq("owner_user_id", auth.user.id).eq("document_type", "imaging").select("mime_type").maybeSingle();
  if (saved.error || !saved.data) return NextResponse.json({ error: "No fue posible guardar las correcciones." }, { status: 502 });
  await recordPhrEvent(auth.db, auth.user.id, "imaging_text_confirmed", body.documentId, { method: saved.data.mime_type === "application/pdf" ? "local" : "ai_visual" });
  return NextResponse.json({ ok: true });
}
