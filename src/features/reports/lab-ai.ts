import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { extractText, getDocumentProxy } from "unpdf";
import { aiConfig } from "./ai-budget.ts";

// Structured output: sin opcionales (OpenAI exige todos los campos). "" o null = ausente.
const LabObservationSchema = z.object({
  analyte: z.string(),
  loincCode: z.string(),
  valueNum: z.number().nullable(),
  valueText: z.string(),
  unit: z.string(),
  refLow: z.number().nullable(),
  refHigh: z.number().nullable(),
  refText: z.string(),
  observedAt: z.string(),
  sourceSentence: z.string(),
});
export const LabExtractionSchema = z.object({
  observations: z.array(LabObservationSchema),
  warnings: z.array(z.string()),
});
export type LabExtraction = z.infer<typeof LabExtractionSchema>;

export const LAB_EXTRACTION_SYSTEM_PROMPT = `Eres un extractor de resultados de laboratorio en espanol desde el texto de un informe/PDF.

Reglas estrictas:
1. No inventes datos. Extrae solo lo que aparece textualmente.
2. Devuelve una observacion por analito (una fila por parametro medido).
3. Conserva valores, unidades, lateralidad, negaciones e incertidumbre EXACTAMENTE como estan escritos. No conviertas unidades ni recalcules.
4. valueNum solo si el resultado es numerico; si es cualitativo (Positivo, Negativo, No reactivo, Reactivo, Indeterminado) usa valueText y deja valueNum en null.
5. unit: la unidad tal cual (g/dL, mg/dL, U/L, %, 10^3/uL...). Si no hay, "".
6. Rango de referencia: si es numerico usa refLow y refHigh; si es textual (ej. "Negativo", "< 5") usa refText y deja refLow/refHigh en null cuando no sean claramente numericos.
7. loincCode: solo si el propio documento trae el codigo LOINC. Si no, "". No inventes codigos.
8. observedAt: fecha del resultado o de la toma de muestra en formato ISO (YYYY-MM-DD) si aparece; si no, "".
9. sourceSentence: la linea o fragmento textual de donde sale la observacion.
10. No incluyas encabezados, datos del paciente, ni texto administrativo como observaciones.
11. Si el texto no contiene resultados de laboratorio interpretables, devuelve observations vacio y un warning.
12. Devuelve solo datos estructurados segun el JSON Schema.`;

/** Extrae el texto embebido del PDF (gratis, sin OCR). Vacio => probablemente escaneado. */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return (Array.isArray(text) ? text.join("\n") : text).trim();
}

const structuredPayload = (response: unknown) => {
  const parsed = (response as any)?.output_parsed
    ?? (response as any)?.output?.flatMap((item: any) => item.content ?? []).find((content: any) => content?.parsed)?.parsed;
  if (parsed) return parsed;
  const text = (response as any)?.output_text?.trim();
  if (text) return JSON.parse(text);
  throw new Error("No fue posible interpretar la respuesta estructurada de IA.");
};

/** Estructura el texto del laboratorio en observaciones discretas con GPT nano. */
export async function structureLabText(text: string, context: { procedureName: string }) {
  const config = aiConfig();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const prompt = [context.procedureName ? `Prestacion registrada: ${context.procedureName}` : "", "Texto del informe de laboratorio:", text].filter(Boolean).join("\n\n");
  const response = await client.responses.parse({
    model: config.model,
    input: [
      { role: "system", content: LAB_EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    text: { format: zodTextFormat(LabExtractionSchema, "lab_extraction") },
    max_output_tokens: config.maxOutputTokens,
    store: false,
  } as any, { timeout: config.timeoutMs });
  const parsed = LabExtractionSchema.parse(structuredPayload(response));
  const usage = (response as any)?.usage ?? {};
  return {
    extraction: parsed,
    usage: {
      inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? null,
      outputTokens: usage.output_tokens ?? usage.completion_tokens ?? null,
      totalTokens: usage.total_tokens ?? null,
    },
  };
}
