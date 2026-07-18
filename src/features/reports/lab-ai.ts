import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { extractTextItems, type StructuredTextItem } from "unpdf";
import { extractScannedPdf, imageBearingPages } from "../../lib/pdf-ocr.ts";
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
export const labSourcePage = (sourceId: string) => Number(sourceId.match(/^(?:p|page-)(\d+)-r\d+$/)?.[1] ?? 0);

/** Reasigna el índice de página del sub-PDF enviado a IA (page-1, page-2…) al número de página real del documento. */
export function remapVisualPages(rows: LabCandidate[], pages: number[]) {
  for (const row of rows) {
    row.sourceSentence = row.sourceSentence.replace(/^(page-)(\d+)(-r\d+)/, (whole, prefix, index, rest) => {
      const original = pages[Number(index) - 1];
      return original ? `${prefix}${original}${rest}` : whole;
    });
  }
  return rows;
}

export type PreparedLabPdf = {
  patientName: string;
  patientIdentifier: string;
  observedAt: string;
  observations: LabCandidate[];
  aiText: string;
  scanned: boolean;
  needsAi: boolean;
  pageCount: number;
  imageOnlyPages: number[];
};

export const LAB_EXTRACTION_SYSTEM_PROMPT = `Extrae resultados discretos de laboratorio en español.
No diagnostiques, no resumas y no inventes datos. Devuelve una fila por analito medido.
"value", "unit" y "reference" deben conservar el texto del documento. "specimen" debe indicar la muestra explícita (por ejemplo Sangre, Suero u Orina); si no aparece usa "". "reportedFlag" solo refleja una marca explícita del laboratorio; si no existe usa "".
No generes LOINC. "observedAt" es la fecha de toma de muestra en YYYY-MM-DD si aparece.
"sourceId" debe copiar el identificador de línea recibido. Omite encabezados, datos administrativos, métodos y comentarios sin resultado.`;

type LayoutRow = { id: string; y: number; items: StructuredTextItem[] };
type Header = { y: number; exam: number; result: number; unit: number; reference: number; skip: number; method: number };

const plain = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function labAnalyteSimilarity(left: string, right: string) {
  const grams = (value: string) => {
    const normalized = plain(value).replace(/[^a-z0-9]+/g, "");
    if (normalized.length < 2) return normalized ? [normalized] : [];
    return Array.from({ length: normalized.length - 1 }, (_, index) => normalized.slice(index, index + 2));
  };
  const a = grams(left), b = grams(right);
  if (!a.length || !b.length) return 0;
  const remaining = [...b];
  let matches = 0;
  for (const gram of a) {
    const index = remaining.indexOf(gram);
    if (index >= 0) { matches += 1; remaining.splice(index, 1); }
  }
  return 2 * matches / (a.length + b.length);
}
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
      let row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= 5);
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
    const labels = rows
      .filter((candidate) => Math.abs(candidate.y - row.y) <= 15)
      .flatMap((candidate) => candidate.items)
      .map((item) => ({ item, text: plain(item.str) }));
    const exam = labels.find(({ text }) => text === "examen");
    const result = labels.find(({ text }) => text === "resultado");
    const unit = labels.find(({ text }) => /^(?:unidad(?:es)?(?: de)?|medida)$/.test(text));
    const reference = labels.find(({ text }) => /^(?:valor(?:es)? de referencia|intervalo de|referencia)$/.test(text));
    if (!result || !unit || !reference) continue;
    const method = labels.find(({ text }) => text === "metodo");
    const skip = labels.find(({ text }) => /resultado(?:s)? (?:anterior(?:es)?|historico(?:s)?)/.test(text))
      ?? labels.find(({ text }) => /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(text));
    return { y: Math.min(...labels.map(({ item }) => item.y)), exam: exam?.item.x ?? 0, result: result.item.x, unit: unit.item.x, reference: reference.item.x, skip: skip?.item.x ?? Number.POSITIVE_INFINITY, method: method?.item.x ?? Number.POSITIVE_INFINITY };
  }
  return null;
}

function columns(row: LayoutRow, header: Header) {
  const values = ["", "", "", "", ""];
  const roles = [
    { x: header.exam, index: 0 },
    { x: header.result, index: 1 },
    { x: header.unit, index: 2 },
    { x: header.reference, index: 3 },
    ...(Number.isFinite(header.skip) ? [{ x: header.skip, index: 4 }] : []),
    ...(Number.isFinite(header.method) ? [{ x: header.method, index: 4 }] : []),
  ].sort((left, right) => left.x - right.x);
  for (const item of row.items) {
    const role = roles.find((candidate, index) => index === roles.length - 1 || item.x < (candidate.x + roles[index + 1].x) / 2) ?? roles[roles.length - 1];
    const index = role.index;
    values[index] = `${values[index]} ${item.str}`.trim();
  }
  return values;
}

const textualResult = /^(?:positivo|negativo|reactivo|no reactivo|indeterminado|detectado|no detectado|ausente|presente|susceptible|sensible|resistente|intermedio|compatible|incompatible|heterocigoto|homocigoto|normal(?:es)?\.?)$/i;
const resultValue = (value: string, analyte = "") => {
  const clean = value.trim();
  if (parseLabNumber(clean) !== null || textualResult.test(clean) || /^\d+\s*:\s*\d+$/.test(clean)) return true;
  return /^(?:microorganismo|germen(?: aislado)?|identificaci[oó]n|patr[oó]n(?: ana)?|grupo (?:sangu[ií]neo|abo))$/i.test(analyte.trim())
    && clean.length <= 80
    && !/[|\t]/.test(clean);
};
const cleanExtractedUnit = (value: string) => value
  .trim()
  .replace(/^\((.*)\)$/, "$1")
  .replace(/^[<>]\s*/, "")
  .replace(/mEg\/L/gi, "mEq/L")
  .replace(/^mEqg\/L$/i, "mEq/L")
  .replace(/^nmol\/$/i, "nmol/L");
const ignored = (value: string) => /^(?:[._-]+|tipo de muestra|examen procesado|fecha de recepcion|metodo analitico|el resultado de este examen)/i.test(plain(value));
const specimenFromRows = (rows: LayoutRow[]) => {
  const pageText = plain(rows.map(rowText).join(" "));
  const explicit = pageText.match(/(?:tipo(?: de)? muestra|muestra)\s*:\s*(sangre total|suero|plasma|orina)\b/)?.[1];
  if (explicit) return explicit.replace(/\b\w/g, (letter) => letter.toUpperCase());
  if (/tipo(?: de)? muestra/.test(pageText)) {
    const nearby = pageText.match(/\b(sangre total|suero|plasma|orina)\b/)?.[1];
    if (nearby) return nearby.replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  if (/orina completa|uroanalisis/.test(pageText)) return "Orina";
  if (/hemograma/.test(pageText)) return "Sangre total";
  if (/coagulacion|tromboplastina|protrombina/.test(pageText)) return "Plasma";
  return "";
};

const panelFromRows = (rows: LayoutRow[]) => {
  const text = plain(rows.map(rowText).join(" "));
  if (/electroforesis (?:de )?proteinas|proteinograma/.test(text)) return "Electroforesis de proteínas";
  if (/analisis microscopico|sedimento urinario/.test(text)) return "Sedimento urinario";
  return "";
};
const dateOnly = (value: string) => {
  const iso = value.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const local = value.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2}|20\d{2})\b/);
  if (!local) return "";
  const year = local[3].length === 2 ? `20${local[3]}` : local[3];
  return `${year}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`;
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
  const documentDateLine = firstPageText.find((text) => /fecha (?:del documento|de (?:informe|emisi[oó]n|resultado))|fec\.?\s*(?:informe|emisi[oó]n|resultado)/i.test(text)) ?? "";
  return {
    patientName: labelledValue("nombre", 85, 400)
      || patientLine.match(/\bpaciente\s*:\s*(.+?)(?=\s+edad\s*:|\s+id\.?\s*atenci[oó]n\b|\s+r\.?\s*u\.?\s*t\.?\s*:|$)/i)?.[1]?.trim()
      || "",
    patientIdentifier: identifierLine.match(/r\.?\s*u\.?\s*t\.?\s*:\s*([0-9.\-k]+)/i)?.[1]
      || labelledValue("rut", 85, 400)
      || "",
    observedAt: dateOnly(sampleText) || dateOnly(requestLine) || dateOnly(documentDateLine),
  };
}

function normalizedCandidate(row: z.infer<typeof CompactLabRowSchema>, observedAt: string, source: "ocr" | "ai", specimen = "", panel = ""): LabCandidate | null {
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
    unit: cleanExtractedUnit(row.unit),
    ...reference,
    flag: (explicit || derived) as LabFlag,
    observedAt: dateOnly(observedAt),
    sourceSentence: [row.sourceId, analyte, rawValue, row.unit, row.reference, specimen ? `Muestra: ${specimen}` : "", panel ? `Panel: ${panel}` : ""].filter(Boolean).join(" | "),
    source,
    ...(specimen ? { specimen } : {}),
  };
}

function parseTwoColumnLabRows(rows: LayoutRow[], observedAt: string, defaultSpecimen = "", panel = "") {
  const observations: LabCandidate[] = [];
  const header = rows.find((row) => /^examen\s+resultado$/.test(plain(rowText(row))));
  if (!header) return { foundHeader: false, observations, aiLines: [] as string[] };
  const exam = header.items.find((item) => plain(item.str) === "examen");
  const result = header.items.find((item) => plain(item.str) === "resultado");
  if (!exam || !result) return { foundHeader: false, observations, aiLines: [] as string[] };

  const cut = result.x - 15;
  const aiLines: string[] = [];
  let specimen = defaultSpecimen;
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
    const parsed = normalizedCandidate({ ...compact, specimen }, observedAt, "ocr", specimen, panel);
    if (!parsed) continue;
    observations.push(parsed);
    aiLines.push([row.id, analyte, compact.value, compact.unit, compact.reference, specimen].join("\t"));
  }
  return { foundHeader: true, observations, aiLines };
}

function parseMonospacedLabRows(rows: LayoutRow[], observedAt: string, defaultSpecimen = "", panel = "") {
  const observations: LabCandidate[] = [];
  const aiLines: string[] = [];
  let foundHeader = false;
  let insideTable = false;
  const specimen = defaultSpecimen;

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
      match = text.match(/^(.+?)\s+(no reactivo|no detectado|indeterminado|positivo|negativo|reactivo|detectado|normales?\.?|ausente|presente|susceptible|sensible|resistente|intermedio|compatible|incompatible|heterocigoto|homocigoto|\d+\s*:\s*\d+)$/i);
      if (match) compact = { sourceId: row.id, analyte: match[1], value: match[2], unit: "", reference: "", specimen: "", reportedFlag: "" };
    }

    if (!compact) continue;
    const parsed = normalizedCandidate({ ...compact, specimen }, observedAt, "ocr", specimen, panel);
    if (!parsed) continue;
    observations.push(parsed);
    aiLines.push([row.id, compact.analyte, compact.value, compact.unit, compact.reference].join("\t"));
  }

  return { foundHeader, observations, aiLines };
}

function parseLooseColumnRows(rows: LayoutRow[], observedAt: string, defaultSpecimen = "", panel = "") {
  const observations: LabCandidate[] = [];
  const specimen = defaultSpecimen;
  const historyHeader = rows.flatMap((row) => row.items).find((item) => /resultados? historicos?/i.test(plain(item.str)));
  for (const row of rows) {
    const cells = row.items.filter((item) => item.str.trim()).sort((a, b) => a.x - b.x), analyteCell = cells[0];
    if (!analyteCell || analyteCell.x > 150 || /:|resultado|unidad|valor|referencia|intervalo|adulto|niñ|embaraz|procesado|autorizado|tecnolog|metod|nota|tipo de muestra|fecha|rut|edad|profesional|servicio|informe|laboratorio/i.test(analyteCell.str)) continue;
    const valueCell = cells.find((item) => item.x > analyteCell.x && /^(?:\s*[<>]?\s*-?\d+(?:[.,]\d+)?\s*[<>]?\s*|\s*mayor\s+(?:de|a)\s+\d+(?:[.,]\d+)?\s*)$/i.test(item.str));
    if (!valueCell) continue;
    const unitCell = cells.find((item) => item.x > valueCell.x && /[%a-zµμ]/i.test(item.str) && item.str.length <= 30);
    if (!unitCell) continue;
    const reference = cells.filter((item) => item.x > unitCell.x && (!historyHeader || item.x < historyHeader.x)).map((item) => item.str).join(" ");
    const value = valueCell.str.replace(/^mayor\s+(?:de|a)\s+/i, "> ").trim();
    const compact = { sourceId: row.id, analyte: analyteCell.str, value, unit: unitCell.str, reference, specimen, reportedFlag: /[<>]/.test(valueCell.str) ? "abnormal" as const : "" as const };
    const parsed = normalizedCandidate(compact, observedAt, "ocr", specimen, panel);
    if (parsed) observations.push(parsed);
  }
  return observations;
}

export function parseLabLayoutPages(pages: StructuredTextItem[][]): Omit<PreparedLabPdf, "scanned" | "pageCount" | "imageOnlyPages"> {
  const layout = groupLabLayoutPages(pages);
  const documentMetadata = metadata(layout);
  const observations: LabCandidate[] = [];
  const aiLines: string[] = [];
  let candidateRows = 0;

  for (const rows of layout) {
    const pageSpecimen = specimenFromRows(rows);
    const pagePanel = panelFromRows(rows);
    const header = findHeader(rows);
    if (!header) {
      const twoColumn = parseTwoColumnLabRows(rows, documentMetadata.observedAt, pageSpecimen, pagePanel);
      if (twoColumn.foundHeader) {
        observations.push(...twoColumn.observations);
        candidateRows += twoColumn.observations.length;
        aiLines.push(...twoColumn.aiLines);
        continue;
      }
      const monospaced = parseMonospacedLabRows(rows, documentMetadata.observedAt, pageSpecimen, pagePanel);
      if (monospaced.foundHeader) {
        observations.push(...monospaced.observations);
        candidateRows += monospaced.observations.length;
        aiLines.push(...monospaced.aiLines);
        continue;
      }
      const loose = parseLooseColumnRows(rows, documentMetadata.observedAt, pageSpecimen, pagePanel);
      if (loose.length) { observations.push(...loose); candidateRows += loose.length; continue; }
      for (const row of rows.filter((candidate) => !ignored(rowText(candidate)))) aiLines.push(`${row.id}\t${rowText(row)}`);
      continue;
    }
    const before = observations.length;
    let last: LabCandidate | null = null;
    for (const row of rows.filter((candidate) => candidate.y < header.y - 2)) {
      const values = columns(row, header).map((value) => value.replace(/\s+/g, " ").trim());
      const text = rowText(row);
      const normalizedText = plain(text);
      if (/^(?:a partir|procesado por|autorizado por|tecnologia|el resultado de este examen|laboratorio adscrito|survey del college|informe emitido)/.test(normalizedText)) break;
      if (/^metodo\b/.test(normalizedText)) continue;
      if (ignored(text)) continue;
      const result = values[1].replace(/\s+(?:<|>|\*|↑|↓)$/, "").trim();
      if (values[0] && !ignored(values[0]) && resultValue(result, values[0])) {
        candidateRows += 1;
        const reportedFlag = /(?:\s<|↓)$/.test(values[1]) ? "low" as const : /(?:\s>|↑)$/.test(values[1]) ? "high" as const : /\*$|\[\s*\*\s*\]/.test(`${values[1]} ${values[3]}`) ? "abnormal" as const : "" as const;
        const compact = { sourceId: row.id, analyte: values[0], value: result, unit: values[2], reference: values[3], specimen: pageSpecimen, reportedFlag };
        const parsed = normalizedCandidate(compact, documentMetadata.observedAt, "ocr", pageSpecimen, pagePanel);
        if (parsed) {
          observations.push(parsed);
          last = parsed;
          aiLines.push([row.id, values[0], result, values[2], values[3], pageSpecimen].join("\t"));
        }
        continue;
      }
      if (last && !values[0] && !values[1] && values[2] && !last.unit) {
        last.unit = cleanExtractedUnit(values[2]);
        const parts = last.sourceSentence.split(" | ");
        parts[3] = last.unit;
        last.sourceSentence = parts.join(" | ");
      } else if (last && !values[0] && !values[1] && !values[2] && values[3]) {
        last.refText = [last.refText, values[3]].filter(Boolean).join("; ");
        aiLines.push(`${row.id}\t\t\t\t${values[3]}`);
      } else if (values[0] && !ignored(values[0])) aiLines.push(`${row.id}\t${values[0]}`);
    }
    if (observations.length === before) {
      const loose = parseLooseColumnRows(rows, documentMetadata.observedAt, pageSpecimen, pagePanel);
      observations.push(...loose); candidateRows += loose.length;
    }
  }

  return {
    ...documentMetadata,
    observations: dedupeLabCandidates(observations),
    aiText: aiLines.join("\n").slice(0, Number(process.env.AI_MAX_INPUT_CHARS ?? 12000)),
    needsAi: observations.length === 0 || candidateRows > observations.length,
  };
}

export async function prepareLabPdf(bytes: Uint8Array, deferScannedOcr = false): Promise<PreparedLabPdf> {
  const extracted = await extractTextItems(bytes.slice());
  const emptyPages = extracted.items.map((page, index) => ({ page: index + 1, empty: page.every((item) => !item.str.trim()) })).filter((row) => row.empty).map((row) => row.page);
  const scanned = extracted.totalPages > 0 && emptyPages.length === extracted.totalPages;
  const imageOnlyPages = emptyPages.length ? await imageBearingPages(bytes, emptyPages) : [];
  if (scanned && deferScannedOcr) return { patientName: "", patientIdentifier: "", observedAt: "", observations: [], aiText: "", scanned, needsAi: true, pageCount: extracted.totalPages, imageOnlyPages };
  const pages = scanned ? await extractScannedPdf(bytes) : extracted;
  const parsed = parseLabLayoutPages(pages.items);
  return { ...parsed, scanned, needsAi: parsed.needsAi, pageCount: pages.totalPages, imageOnlyPages };
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
    const analyte = plain(row.analyte).replace(/\s+/g, " ").trim();
    if (/^(?:paciente|fono|rut|r u t|conclusion\b)/.test(analyte) || /^\d+(?:[.,]\d+)?\s*(?:mg|g|ug|ng|pg|u)\//.test(analyte)) return false;
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
  const aliases: Record<string, string[]> = {
    juvenilesneut: ["Metamyelocytes Leukocytes Blood"],
    deshlacticatotalldh: ["Lactate dehydrogenase Serum Plasma"],
    ldh: ["Lactate dehydrogenase Serum Plasma"],
  };
  return [...(aliases[normalizeIdentity(term)] ?? []), ...words.map((_, index) => words.slice(0, words.length - index).join(" "))];
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
        { type: "input_file", filename: "resultados.pdf", file_data: `data:application/pdf;base64,${Buffer.from(input.pdfBytes).toString("base64")}`, detail: "high" },
        { type: "input_text", text: `${instruction}\nEl PDF contiene páginas escaneadas. Asigna sourceId correlativos page-N-rM e identifica la muestra de cada sección.` },
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

export async function suggestLabLoinc(rows: Pick<LabCandidate, "analyte" | "unit" | "valueNum" | "valueText" | "specimen">[], englishTerms: string[] = [], candidates: { code: string; display: string; score?: number }[][] = []) {
  const config = aiConfig();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const candidateRule = candidates.length ? "Solo puedes devolver un código incluido en candidates para esa fila." : "No inventes códigos.";
  const response = await client.responses.parse({
    model: config.model,
    input: [
      { role: "system", content: `Homologa analitos de laboratorio a LOINC. El nombre original puede estar en español, abreviado o contener errores OCR; usa englishSearchTerm sólo como ayuda. ${candidateRule} Evalúa componente, propiedad compatible con la unidad, tiempo, muestra, escala y método. Si el documento no declara un método, prefiere un candidato general sin método antes que inferir uno especializado. El score sólo ordena candidatos y no prueba equivalencia clínica. Si muestra o significado son ambiguos, usa loincCode vacío y confidence baja. sourceId debe copiarse exactamente.` },
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
