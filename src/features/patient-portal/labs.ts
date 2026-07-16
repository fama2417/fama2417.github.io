import { convertLabValue, labFlag, parseLabNumber, parseLabReference, type LabFlag, type LoincMetadata } from "../reports/lab-observations.ts";

export type PhrLabResult = {
  id: string; documentId: string; analyte: string; loincCode: string; valueNum: number | null; valueText: string;
  unit: string; refLow: number | null; refHigh: number | null; refText: string; flag: LabFlag; observedAt: string;
  source: "ocr" | "ai"; sourceSentence?: string; reviewStatus: "suggested" | "confirmed"; loincMetadata?: LoincMetadata;
};

export type PhrLabDraft = { analyte: string; value: string; unit: string; reference: string; observedAt: string };

const plain = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const term = (value: string) => plain(value).replace(/[^a-z0-9]+/g, " ").trim();
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const vettedLoinc = [
  { names: /^(?:porcentaje )?saturacion (?:de )?transferrin(?:a)?$/, code: "2502-3", trendKey: "iron-saturation" },
  { names: /^(?:25 oh vitamina d|25 hidroxivitamina d(?: total)?|vitamina d total)$/, code: "62292-8", trendKey: "vitamin-d-25oh-total" },
  { names: /^(?:hemoglobina glicosilada|hemoglobina glicada|hba1c)$/, code: "4548-4", trendKey: "hba1c" },
  { names: /^(?:glicemia|glucosa) media estimada$/, code: "27353-2", trendKey: "estimated-average-glucose" },
  { names: /^tsh$/, code: "3016-3", trendKey: "tsh" },
  { names: /^t4 libre$/, code: "3024-7", trendKey: "free-t4" },
  { names: /^ferritina$/, code: "2276-4", trendKey: "ferritin" },
  { names: /^(?:ferremia|hierro)$/, code: "2498-4", trendKey: "serum-iron" },
  { names: /^(?:capacidad fijacion (?:de )?(?:fierro|fe|hierro)|capacidad total de fijacion (?:de )?(?:fierro|hierro))$/, code: "2500-7", trendKey: "iron-binding-capacity" },
  { names: /^transferrina$/, code: "3034-6", trendKey: "transferrin" },
  { names: /^(?:vitamina b 12|vitamina b12)$/, code: "2132-9", trendKey: "vitamin-b12" },
] as const;

export function phrSpecimenClass(value = "") {
  const specimen = term(value);
  if (/\b(?:urine|orina|urin)\b/.test(specimen)) return "urine";
  if (/\b(?:ser plas|serum|plasma|suero|bld|blood|sangre)\b/.test(specimen)) return "blood";
  return "";
}

export function vettedPhrLabIdentity(input: { analyte: string; unit?: string; specimen?: string }) {
  if (phrSpecimenClass(input.specimen) === "urine") return null;
  return vettedLoinc.find((rule) => rule.names.test(term(input.analyte))) ?? null;
}

export function validatePhrLabDraft(input: PhrLabDraft) {
  const analyte = input.analyte.trim(), value = input.value.trim(), unit = input.unit.trim(), referenceText = input.reference.trim();
  if (!analyte || analyte.length > 160) return { error: "Indica un analito válido." } as const;
  if (!value || value.length > 80) return { error: "Indica un resultado válido." } as const;
  if (unit.length > 32 || referenceText.length > 120) return { error: "Unidad o referencia demasiado extensa." } as const;
  if (!validDate(input.observedAt)) return { error: "Fecha de resultado inválida." } as const;
  const valueNum = parseLabNumber(value), reference = parseLabReference(referenceText);
  return { value: { analyte, valueNum, valueText: valueNum === null ? value : "", unit, ...reference, flag: labFlag(valueNum, reference.refLow, reference.refHigh), observedAt: input.observedAt } } as const;
}

export const phrLabDraftOf = (result: PhrLabResult): PhrLabDraft => ({
  analyte: result.analyte, value: String(result.valueNum ?? result.valueText), unit: result.unit,
  reference: result.refLow !== null && result.refHigh !== null ? `${result.refLow}–${result.refHigh}`
    : result.refLow !== null ? `> ${result.refLow}` : result.refHigh !== null ? `< ${result.refHigh}` : result.refText,
  observedAt: result.observedAt.slice(0, 10),
});

export const phrLabTrendKey = (result: Pick<PhrLabResult, "loincCode" | "analyte">) => vettedPhrLabIdentity(result)?.trendKey ?? (result.loincCode.trim() || plain(result.analyte));

export function phrSpecimenLabel(metadata?: LoincMetadata, sourceSentence = "") {
  const sourceSpecimen = sourceSentence.match(/(?:^|\|)\s*Muestra:\s*([^|]+)$/i)?.[1] ?? "";
  const specimen = plain(sourceSpecimen || metadata?.specimen || "");
  if (/urine|orina|urin/.test(specimen)) return "Orina";
  if (/ser\/plas|serum|plasma|suero/.test(specimen)) return "Sangre (suero/plasma)";
  if (/\bbld\b|blood|whole blood|sangre/.test(specimen)) return "Sangre";
  return "Muestra no determinada";
}

export function reusedPhrLoinc(rows: (Pick<PhrLabResult, "analyte" | "unit"> & { specimen?: string })[], prior: (Pick<PhrLabResult, "analyte" | "unit" | "loincCode"> & { specimen?: string })[]) {
  const priorByKey = new Map<string, Set<string>>();
  for (const row of prior) {
    const key = `${plain(row.analyte)}|${plain(row.unit)}|${phrSpecimenClass(row.specimen)}`;
    priorByKey.set(key, (priorByKey.get(key) ?? new Set()).add(row.loincCode));
  }
  const reused = new Map<number, string>();
  rows.forEach((row, index) => { const codes = priorByKey.get(`${plain(row.analyte)}|${plain(row.unit)}|${phrSpecimenClass(row.specimen)}`); if (codes?.size === 1) reused.set(index, [...codes][0]); });
  return reused;
}

export function buildPhrLabTrend(results: PhrLabResult[]) {
  const numeric = results.filter((result) => result.reviewStatus === "confirmed" && result.valueNum !== null)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  const latest = numeric[0], key = latest ? phrLabTrendKey(latest) : "";
  if (!latest || !key) return null;
  const byDate = new Map<string, { id: string; date: string; value: number }>();
  for (const result of numeric) {
    if (phrLabTrendKey(result) !== key || byDate.has(result.observedAt)) continue;
    const value = convertLabValue(result.valueNum!, result.unit, latest.unit);
    if (value !== null) byDate.set(result.observedAt, { id: result.id, date: result.observedAt, value });
  }
  const points = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-12);
  return points.length >= 2 ? { analyte: latest.analyte, unit: latest.unit, refLow: latest.refLow, refHigh: latest.refHigh, points } : null;
}
