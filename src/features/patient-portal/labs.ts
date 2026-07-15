import { convertLabValue, labFlag, parseLabNumber, parseLabReference, type LabFlag } from "../reports/lab-observations.ts";

export type PhrLabResult = {
  id: string; documentId: string; analyte: string; loincCode: string; valueNum: number | null; valueText: string;
  unit: string; refLow: number | null; refHigh: number | null; refText: string; flag: LabFlag; observedAt: string;
  source: "ocr" | "ai"; reviewStatus: "suggested" | "confirmed";
};

export type PhrLabDraft = { analyte: string; value: string; unit: string; reference: string; observedAt: string };

const plain = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

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

export const phrLabTrendKey = (result: Pick<PhrLabResult, "loincCode" | "analyte">) => result.loincCode.trim() || plain(result.analyte);

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
