import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { extractTextItems, type StructuredTextItem } from "unpdf";
import { aiConfig } from "./ai-budget.ts";
import { labFlag, parseLabNumber, parseLabReference, type LabFlag } from "./lab-observations.ts";

const CompactLabRowSchema = z.object({
  sourceId: z.string(),
  analyte: z.string(),
  value: z.string(),
  unit: z.string(),
  reference: z.string(),
  specimen: z.string(),
  reportedFlag: z.enum(["", "normal", "low", "high", "critical_low", "critical_high", "abnormal"]),
});

export const LabExtractionSchema = z.object({
  patientName: z.string(),
  patientIdentifier: z.string(),
  observedAt: z.string(),
  rows: z.array(CompactLabRowSchema),
  warnings: z.array(z.string()),
});
export type LabExtraction = z.infer<typeof LabExtractionSchema>;

const LabLoincSuggestionSchema = z.object({
  sourceId: z.string(),
  loincCode: z.string(),
  confidence: z.number().min(0).max(1),
});
const LabLoincExtractionSchema = z.object({ rows: z.array(LabLoincSuggestionSchema) });
export type LabLoincSuggestion = z.infer<typeof LabLoincSuggestionSchema>;

const LabLoincSearchSchema = z.object({ rows: z.array(z.object({ sourceId: z.string(), searchTerm: z.string() })) });

export type LabCandidate = {
  analyte: string;
  valueNum: number | null;
  valueText: string;
  unit: string;
  refLow: number | null;
  refHigh: number | null;
  refText: string;
  flag: LabFlag;
  observedAt: string;
  sourceSentence: string;
  source: "ocr" | "ai";
  specimen?: string;
};

export type LabSourceBox = { x: number; y: number; width: number; height: number };

export type PreparedLabPdf = {
  patientName: string;
  patientIdentifier: string;
  observedAt: string;
  observations: LabCandidate[];
  aiText: string;
  scanned: boolean;
  needsAi: boolean;
  pageCount: number;
};

export const LAB_EXTRACTION_SYSTEM_PROMPT = `Extrae resultados discretos de laboratorio en español.
No diagnostiques, no resumas y no inventes datos. Devuelve una fila por analito medido.
"value", "unit" y "reference" deben conservar el texto del documento. "specimen" debe indicar la muestra explícita (por ejemplo Sangre, Suero u Orina); si no aparece usa "". "reportedFlag" solo refleja una marca explícita del laboratorio; si no existe usa "".
No generes LOINC. "observedAt" es la fecha de toma de muestra en YYYY-MM-DD si aparece.
"sourceId" debe copiar el identificador de línea recibido. Omite encabezados, datos administrativos, métodos y comentarios sin resultado.`;

type LayoutRow = { id: string; y: number; items: StructuredTextItem[] };
type Header = { y: number; exam: number; result: number; unit: number; reference: number; method: number };

const plain = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const rowText = (row: LayoutRow) => row.items.map((item) => item.str.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
const uniqueItems = (items: StructuredTextItem[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${Math.round(item.x * 10)}|${Math.round(item.y * 10)}|${item.str.trim()}`;
    if (!item.str.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export function groupLabLayoutPages(pages: StructuredTextItem[][]): LayoutRow[][] {
  return pages.map((page, pageIndex) => {
    const rows: LayoutRow[] = [];
    for (const item of uniqueItems(page).sort((a, b) => b.y - a.y || a.x - b.x)) {
      let row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= 2);
      if (!row) {
        row = { id: `p${pageIndex + 1}-r${rows.length + 1}`, y: item.y, items: [] };
        rows.push(row);
      }
      row.items.push(item);
    }
    return rows.sort((a, b) => b.y - a.y).map((row, index) => ({ ...row, id: `p${pageIndex + 1}-r${index + 1}`, items: row.items.sort((a, b) => a.x - b.x) }));
  });
}

/** Ubica el valor dentro de su fila PDF; soporta tanto columnas separadas como líneas monoespaciadas. */
export function labSourceHighlight(items: StructuredTextItem[], value: string, analyte = ""): LabSourceBox | null {
  const clean = value.trim();
  if (!clean) return null;
  const exact = items.find((item) => item.str.trim() === clean);
  if (exact) return { x: exact.x, y: exact.y, width: exact.width, height: exact.height };
  for (const item of items) {
    const analyteIndex = analyte ? item.str.indexOf(analyte) : -1;
    const index = item.str.indexOf(clean, analyteIndex < 0 ? 0 : analyteIndex + analyte.length);
    if (index < 0 || !item.str.length) continue;
    return { x: item.x + item.width * index / item.str.length, y: item.y, width: Math.max(12, item.width * clean.length / item.str.length), height: item.height };
  }
  return null;
}

function findHeader(rows: LayoutRow[]): Header | null {
  for (const row of rows) {
    const labels = row.items.map((item) => ({ item, text: plain(item.str) }));
    const exam = labels.find(({ text }) => text === "examen");
    const result = labels.find(({ text }) => text === "resultado");
    const unit = labels.find(({ text }) => text === "unidad");
    const reference = labels.find(({ text }) => text.includes("valor de referencia"));
    if (!exam || !result || !unit || !reference) continue;
    const method = labels.find(({ text }) => text === "metodo");
    return { y: row.y, exam: exam.item.x, result: result.item.x, unit: unit.item.x, reference: reference.item.x, method: method?.item.x ?? Number.POSITIVE_INFINITY };
  }
  return null;
}

function columns(row: LayoutRow, header: Header) {
  const cuts = [(header.exam + header.result) / 2, (header.result + header.unit) / 2, (header.unit + header.reference) / 2, Number.isFinite(header.method) ? (header.reference + header.method) / 2 : Number.POSITIVE_INFINITY];
  const values = ["", "", "", "", ""];
  for (const item of row.items) {
    const index = item.x < cuts[0] ? 0 : item.x < cuts[1] ? 1 : item.x < cuts[2] ? 2 : item.x < cuts[3] ? 3 : 4;
    values[index] = `${values[index]} ${item.str}`.trim();
  }
  return values;
}

const resultValue = (value: string) => parseLabNumber(value) !== null || /^(?:positivo|negativo|reactivo|no reactivo|indeterminado|detectado|no detectado|ausente|presente)$/i.test(value.trim());
const ignored = (value: string) => /^(?:_{4,}|tipo de muestra|examen procesado|fecha de recepcion|metodo analitico|el resultado de este examen)/i.test(plain(value));
const dateOnly = (value: string) => {
  const iso = value.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const local = value.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  return local ? `${local[3]}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}` : "";
};

function metadata(rows: LayoutRow[][]) {
  const first = rows[0] ?? [];
  const firstPageText = first.map(rowText);
  const labelledValue = (label: string, fromX: number, toX: number) => {
    const row = first.find((candidate) => plain(rowText(candidate)).startsWith(label));
    return row?.items.filter((item) => item.x >= fromX && item.x < toX && item.str.trim() !== ":").map((item) => item.str.trim()).join(" ").trim() ?? "";
  };
  const sampleText = firstPageText.find((text) => /(?:toma de muestra|fec\.?\s*t\.?\s*muestra)/i.test(text)) ?? "";
  const patientLine = firstPageText.find((text) => /\bpaciente\s*:/i.test(text)) ?? "";
  const identifierLine = firstPageText.find((text) => /r\.?\s*u\.?\s*t\.?\s*:/i.test(text)) ?? "";
  const requestLine = firstPageText.find((text) => /fec\.?\s*solicitud/i.test(text)) ?? "";
  return {
    patientName: labelledValue("nombre", 85, 400)
      || patientLine.match(/\bpaciente\s*:\s*(.+?)(?=\s+edad\s*:|\s+id\.?\s*atenci[oó]n\b|\s+r\.?\s*u\.?\s*t\.?\s*:|$)/i)?.[1]?.trim()
      || "",
    patientIdentifier: labelledValue("rut", 85, 400)
      || identifierLine.match(/r\.?\s*u\.?\s*t\.?\s*:\s*([0-9.\-k]+)/i)?.[1]
      || "",
    observedAt: dateOnly(sampleText) || dateOnly(requestLine),
  };
}

function normalizedCandidate(row: z.infer<typeof CompactLabRowSchema>, observedAt: string, source: "ocr" | "ai", specimen = ""): LabCandidate | null {
  const analyte = row.analyte.trim();
  const rawValue = row.value.trim();
  if (!analyte || !rawValue) return null;
  const valueNum = parseLabNumber(rawValue);
  const reference = parseLabReference(row.reference);
  const derived = labFlag(valueNum, reference.refLow, reference.refHigh);
  const explicit = row.reportedFlag || (/\[\s*\*\s*\]/.test(row.reference) ? "abnormal" : "");
  return {
    analyte,
    valueNum,
    valueText: valueNum === null ? rawValue : "",
    unit: row.unit.trim().replace(/^\((.*)\)$/, "$1"),
    ...reference,
    flag: (explicit || derived) as LabFlag,
    observedAt: dateOnly(observedAt),
    sourceSentence: [row.sourceId, analyte, rawValue, row.unit, row.reference, specimen ? `Muestra: ${specimen}` : ""].filter(Boolean).join(" | "),
    source,
    ...(specimen ? { specimen } : {}),
  };
}

function parseTwoColumnLabRows(rows: LayoutRow[], observedAt: string) {
  const observations: LabCandidate[] = [];
  const header = rows.find((row) => /^examen\s+resultado$/.test(plain(rowText(row))));
  if (!header) return { foundHeader: false, observations, aiLines: [] as string[] };
  const exam = header.items.find((item) => plain(item.str) === "examen");
  const result = header.items.find((item) => plain(item.str) === "resultado");
  if (!exam || !result) return { foundHeader: false, observations, aiLines: [] as string[] };

  const cut = result.x - 15;
  const aiLines: string[] = [];
  let specimen = "";
  for (const row of rows.filter((candidate) => candidate.y < header.y - 2)) {
    const text = rowText(row), normalized = plain(text);
    if (/^(?:examen validado|la interpretacion|unidad de medida|valor de referencia|nota\s*:)/.test(normalized)) break;
    const sample = text.match(/^Muestra\s*:\s*(.+)$/i);
    if (sample) { specimen = sample[1].trim(); continue; }
    if (!text || /^(?:[-_=]{4,}|analisis\b|metodo\b|nota\b|observacion\b)/.test(normalized)) continue;
    const analyte = row.items.filter((item) => item.x < cut).map((item) => item.str.trim()).filter(Boolean).join(" ");
    const resultItems = row.items.filter((item) => item.x >= cut).map((item) => item.str.trim()).filter((value) => value && value !== "*");
    const rawValue = resultItems.join(" ").trim();
    if (!analyte || !rawValue) continue;
    const range = rawValue.match(/^(-?\d+(?:[.,]\d+)?)\s*(\*)?\s+(\S+)\s+(-?\d+(?:[.,]\d+)?)\s*-\s*(-?\d+(?:[.,]\d+)?)$/);
    const compact = {
      sourceId: row.id, analyte,
      value: range?.[1] ?? rawValue.replace(/\s+\*$/, ""),
      unit: range?.[3] ?? "",
      reference: range ? `${range[4]} - ${range[5]}` : "",
      reportedFlag: range?.[2] || row.items.some((item) => item.str.trim() === "*") ? "abnormal" as const : "" as const,
    };
    const parsed = normalizedCandidate({ ...compact, specimen }, observedAt, "ocr", specimen);
    if (!parsed) continue;
    observations.push(parsed);
    aiLines.push([row.id, analyte, compact.value, compact.unit, compact.reference, specimen].join("\t"));
  }
  return { foundHeader: true, observations, aiLines };
}

function parseMonospacedLabRows(rows: LayoutRow[], observedAt: string) {
  const observations: LabCandidate[] = [];
  const aiLines: string[] = [];
  let foundHeader = false;
  let insideTable = false;
  const specimens = rows.map(rowText).map((text) => text.match(/^(?:tipo(?: de)?\s+)?muestra\s*:\s*(.+)$/i)?.[1]?.trim()).filter((value): value is string => !!value);
  const rawSpecimen = specimens.at(-1) ?? "";
  const specimen = /orina|urin/i.test(rawSpecimen) ? "Orina" : /sangre total/i.test(rawSpecimen) ? "Sangre total" : /suero/i.test(rawSpecimen) ? "Suero" : rawSpecimen;

  for (const row of rows) {
    const text = rowText(row);
    const normalized = plain(text);
    if (/^examen(?:\s+resultado(?:\s+unidad)?(?:\s+.*)?)?$/.test(normalized)) {
      foundHeader = true;
      insideTable = true;
      continue;
    }
    if (/^(?:examen validado|examen ejecutado|la interpretacion)/.test(normalized)) {
      insideTable = false;
      continue;
    }
    if (!insideTable || !text || /^(?:[-_=]{4,}|["']|\d+\s*(?:-|mes\b|anos?\b)|metodo|nota|observacion|comentario|muestra|tipo de muestra|fecha|rango|valores? de referencia|normal\b|prediabetes|diabetes|suficiencia|insuficiencia|deficiencia|adultos|ninos|hombres|mujeres|mayor|menor|hasta|guia|segun|fuente|este resultado|un criterio|reemplaza|por cambio)/.test(normalized)) continue;

    let match = text.match(/^(.+?)\s+(-?\d+(?:[.,]\d+)?)(?:\s*(\*))?\s+(\S+)\s+(-?\d+(?:[.,]\d+)?)\s*-\s*(-?\d+(?:[.,]\d+)?)$/);
    let compact: z.infer<typeof CompactLabRowSchema> | null = match ? {
      sourceId: row.id,
      analyte: match[1],
      value: match[2],
      unit: match[4],
      reference: `${match[5]} - ${match[6]}`,
      specimen: "",
      reportedFlag: match[3] ? "abnormal" : "",
    } : null;

    if (!compact) {
      match = text.match(/^(.+?)\s+(-?\d+(?:[.,]\d+)?)(?:\s*(\*))?\s+(\S+)$/);
      if (match) compact = {
        sourceId: row.id,
        analyte: match[1],
        value: match[2],
        unit: match[4],
        reference: "",
        specimen: "",
        reportedFlag: match[3] ? "abnormal" : "",
      };
    }
    if (!compact) {
      match = text.match(/^(.+?)\s+(-?\d+(?:[.,]\d+)?)(?:\s*(\*))?$/);
      if (match && !/\d/.test(match[1])) compact = {
        sourceId: row.id,
        analyte: match[1],
        value: match[2],
        unit: "",
        reference: "",
        specimen: "",
        reportedFlag: match[3] ? "abnormal" : "",
      };
    }
    if (!compact) {
      match = text.match(/^(.+?)\s+(no reactivo|no detectado|indeterminado|positivo|negativo|reactivo|detectado|normales?\.?|ausente|presente)$/i);
      if (match) compact = { sourceId: row.id, analyte: match[1], value: match[2], unit: "", reference: "", specimen: "", reportedFlag: "" };
    }

    if (!compact) continue;
    const parsed = normalizedCandidate({ ...compact, specimen }, observedAt, "ocr", specimen);
    if (!parsed) continue;
    observations.push(parsed);
    aiLines.push([row.id, compact.analyte, compact.value, compact.unit, compact.reference].join("\t"));
  }

  return { foundHeader, observations, aiLines };
}

export function parseLabLayoutPages(pages: StructuredTextItem[][]): Omit<PreparedLabPdf, "scanned" | "pageCount"> {
  const layout = groupLabLayoutPages(pages);
  const documentMetadata = metadata(layout);
  const observations: LabCandidate[] = [];
  const aiLines: string[] = [];
  let candidateRows = 0;

  for (const rows of layout) {
    const header = findHeader(rows);
    if (!header) {
      const twoColumn = parseTwoColumnLabRows(rows, documentMetadata.observedAt);
      if (twoColumn.foundHeader) {
        observations.push(...twoColumn.observations);
        candidateRows += twoColumn.observations.length;
        aiLines.push(...twoColumn.aiLines);
        continue;
      }
      const monospaced = parseMonospacedLabRows(rows, documentMetadata.observedAt);
      if (monospaced.foundHeader) {
        observations.push(...monospaced.observations);
        candidateRows += monospaced.observations.length;
        aiLines.push(...monospaced.aiLines);
        continue;
      }
      for (const row of rows.filter((candidate) => !ignored(rowText(candidate)))) aiLines.push(`${row.id}\t${rowText(row)}`);
      continue;
    }
    let last: LabCandidate | null = null;
    for (const row of rows.filter((candidate) => candidate.y < header.y - 2)) {
      const values = columns(row, header).map((value) => value.replace(/\s+/g, " ").trim());
      const text = rowText(row);
      if (ignored(text)) continue;
      if (values[0] && resultValue(values[1])) {
        candidateRows += 1;
        const compact = { sourceId: row.id, analyte: values[0], value: values[1], unit: values[2], reference: values[3], specimen: "", reportedFlag: /\[\s*\*\s*\]/.test(values[3]) ? "abnormal" as const : "" as const };
        const parsed = normalizedCandidate(compact, documentMetadata.observedAt, "ocr");
        if (parsed) {
          observations.push(parsed);
          last = parsed;
          aiLines.push([row.id, ...values].join("\t"));
        }
        continue;
      }
      if (last && !values[0] && !values[1] && !values[2] && values[3]) {
        last.refText = [last.refText, values[3]].filter(Boolean).join("; ");
        aiLines.push(`${row.id}\t\t\t\t${values[3]}`);
      } else if (values[0] && !ignored(values[0])) aiLines.push(`${row.id}\t${values[0]}`);
    }
  }

  return {
    ...documentMetadata,
    observations: dedupeLabCandidates(observations),
    aiText: aiLines.join("\n").slice(0, Number(process.env.AI_MAX_INPUT_CHARS ?? 12000)),
    needsAi: observations.length === 0 || candidateRows > observations.length,
  };
}

export async function prepareLabPdf(bytes: Uint8Array): Promise<PreparedLabPdf> {
  const extracted = await extractTextItems(bytes.slice());
  const parsed = parseLabLayoutPages(extracted.items);
  const scanned = extracted.items.every((page) => page.every((item) => !item.str.trim()));
  return { ...parsed, scanned, needsAi: scanned || parsed.needsAi, pageCount: extracted.totalPages };
}

export function normalizeIdentity(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

export function labPatientMatches(extracted: { patientName: string; patientIdentifier: string }, expected: { patientName: string; patientIdentifier: string }) {
  if (extracted.patientIdentifier.trim()) return normalizeIdentity(extracted.patientIdentifier) === normalizeIdentity(expected.patientIdentifier);
  if (extracted.patientName.trim()) return normalizeIdentity(extracted.patientName) === normalizeIdentity(expected.patientName);
  return false;
}

export function dedupeLabCandidates(rows: LabCandidate[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const value = row.valueNum === null ? normalizeIdentity(row.valueText) : String(row.valueNum);
    const key = [normalizeIdentity(row.analyte), value, normalizeIdentity(row.unit), row.observedAt].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function verifiedLabLoinc(suggestions: LabLoincSuggestion[], knownCodes: Iterable<string>, minConfidence: number) {
  const known = new Set(knownCodes);
  return new Map(suggestions
    .map((row) => ({ ...row, loincCode: row.loincCode.trim() }))
    .filter((row) => row.confidence >= minConfidence && known.has(row.loincCode))
    .map((row) => [row.sourceId, row.loincCode] as const));
}

export const loincSearchQueries = (term: string) => {
  const words = term.trim().split(/\s+/).filter(Boolean);
  return words.map((_, index) => words.slice(0, words.length - index).join(" "));
};

const structuredPayload = (response: unknown) => {
  const parsed = (response as any)?.output_parsed
    ?? (response as any)?.output?.flatMap((item: any) => item.content ?? []).find((content: any) => content?.parsed)?.parsed;
  if (parsed) return parsed;
  const text = (response as any)?.output_text?.trim();
  if (text) return JSON.parse(text);
  throw new Error("No fue posible interpretar la respuesta estructurada de IA.");
};

export async function structureLabDocument(input: { text?: string; pdfBytes?: Uint8Array; imageBytes?: Uint8Array; imageMime?: "image/jpeg" | "image/png"; procedureName: string }) {
  const config = aiConfig();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const instruction = `Prestación: ${input.procedureName || "Laboratorio"}\nExtrae solamente las filas de resultados.`;
  const content = input.imageBytes && input.imageMime
    ? [
        { type: "input_image", image_url: `data:${input.imageMime};base64,${Buffer.from(input.imageBytes).toString("base64")}`, detail: "high" },
        { type: "input_text", text: `${instruction}\nEs una fotografía. Asigna sourceId correlativos image-r1, image-r2, etc. e identifica la muestra de cada sección.` },
      ]
    : input.pdfBytes
    ? [
        { type: "input_file", filename: "resultados.pdf", file_data: `data:application/pdf;base64,${Buffer.from(input.pdfBytes).toString("base64")}` },
        { type: "input_text", text: instruction },
      ]
    : `${instruction}\n\nFilas compactas (sourceId, analito, resultado, unidad, referencia, método):\n${input.text ?? ""}`;
  const response = await client.responses.parse({
    model: config.model,
    input: [{ role: "system", content: LAB_EXTRACTION_SYSTEM_PROMPT }, { role: "user", content }],
    text: { format: zodTextFormat(LabExtractionSchema, "lab_extraction") },
    max_output_tokens: Math.min(config.maxOutputTokens, 3000),
    store: false,
  } as any, { timeout: config.timeoutMs });
  const extraction = LabExtractionSchema.parse(structuredPayload(response));
  const usage = (response as any)?.usage ?? {};
  return {
    extraction,
    observations: extraction.rows.map((row) => normalizedCandidate(row, extraction.observedAt, "ai", row.specimen)).filter((row): row is LabCandidate => !!row),
    usage: {
      inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? null,
      outputTokens: usage.output_tokens ?? usage.completion_tokens ?? null,
      totalTokens: usage.total_tokens ?? null,
    },
  };
}

export async function suggestLabLoinc(rows: Pick<LabCandidate, "analyte" | "unit" | "valueNum" | "valueText" | "specimen">[], englishTerms: string[] = [], candidates: { code: string; display: string }[][] = []) {
  const config = aiConfig();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const candidateRule = candidates.length ? "Solo puedes devolver un código incluido en candidates para esa fila." : "No inventes códigos.";
  const response = await client.responses.parse({
    model: config.model,
    input: [
      { role: "system", content: `Homologa analitos de laboratorio a LOINC. El nombre original puede estar en español o abreviado; usa englishSearchTerm como equivalencia inglesa, sin reemplazar el significado del original. ${candidateRule} Elige uno únicamente cuando analito, unidad y muestra permitan una equivalencia suficientemente específica; si muestra, método o significado son ambiguos, usa loincCode vacío y confidence baja. sourceId debe copiarse exactamente.` },
      { role: "user", content: JSON.stringify(rows.map((row, index) => ({ sourceId: String(index), analyte: row.analyte, englishSearchTerm: englishTerms[index] ?? "", specimen: row.specimen ?? "", unit: row.unit, valueType: row.valueNum === null ? "text" : "number", candidates: candidates[index] ?? [] }))) },
    ],
    text: { format: zodTextFormat(LabLoincExtractionSchema, "lab_loinc") },
    max_output_tokens: Math.min(config.maxOutputTokens, 4000),
    store: false,
  } as any, { timeout: config.timeoutMs });
  const extraction = LabLoincExtractionSchema.parse(structuredPayload(response));
  const usage = (response as any)?.usage ?? {};
  return {
    suggestions: extraction.rows,
    usage: {
      inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? null,
      outputTokens: usage.output_tokens ?? usage.completion_tokens ?? null,
      totalTokens: usage.total_tokens ?? null,
    },
  };
}

export async function suggestLabLoincSearchTerms(rows: Pick<LabCandidate, "analyte" | "unit" | "valueNum" | "valueText" | "specimen">[]) {
  const config = aiConfig();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.parse({
    model: config.model,
    input: [
      { role: "system", content: `Convierte cada analito a un término breve de búsqueda en inglés para el catálogo LOINC. Devuelve exactamente una fila por sourceId y no devuelvas códigos. searchTerm debe comenzar con el componente medido y usar de 1 a 5 palabras que aparecerían en LONG_COMMON_NAME; agrega total/libre, tiempo, muestra o método sólo cuando estén explícitos. Ordena primero las palabras más distintivas.` },
      { role: "user", content: JSON.stringify(rows.map((row, index) => ({ sourceId: String(index), analyte: row.analyte, specimen: row.specimen ?? "", unit: row.unit, valueType: row.valueNum === null ? "text" : "number" }))) },
    ],
    text: { format: zodTextFormat(LabLoincSearchSchema, "lab_loinc_search") },
    max_output_tokens: Math.min(config.maxOutputTokens, 4000),
    store: false,
  } as any, { timeout: config.timeoutMs });
  const extraction = LabLoincSearchSchema.parse(structuredPayload(response));
  const usage = (response as any)?.usage ?? {};
  return {
    terms: extraction.rows,
    usage: {
      inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? null,
      outputTokens: usage.output_tokens ?? usage.completion_tokens ?? null,
      totalTokens: usage.total_tokens ?? null,
    },
  };
}
