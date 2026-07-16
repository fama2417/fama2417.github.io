import { convertLabValue, labCategory, type LabCategory } from "../reports/lab-observations.ts";
import { phrLabTrendKey, type PhrLabResult } from "./labs.ts";

export type PhrPeriod = { from: string; to: string };

export const isOutsideReportedRange = (result: Pick<PhrLabResult, "flag">) =>
  ["low", "high", "critical_low", "critical_high", "abnormal"].includes(result.flag);

export const reportedRangeLabel = (result: Pick<PhrLabResult, "flag">) =>
  isOutsideReportedRange(result) ? "Fuera del rango informado por el laboratorio" : result.flag === "normal" ? "Dentro del rango informado por el laboratorio" : "Sin rango informado";

const explanationByCategory: Record<LabCategory, string> = {
  hematology: "Mide componentes de la sangre y parámetros de coagulación.",
  metabolic: "Mide glucosa y otros parámetros relacionados con el metabolismo.",
  renal: "Mide sustancias y electrolitos que el laboratorio agrupa con la función renal.",
  hepatic: "Mide enzimas y sustancias que el laboratorio agrupa con la función hepática.",
  lipids: "Mide colesterol, triglicéridos y otras grasas presentes en la sangre.",
  hormones: "Mide hormonas y señales químicas producidas por distintos órganos.",
  nutrition: "Mide vitaminas, minerales y parámetros relacionados con nutrición.",
  immunology: "Mide marcadores del sistema inmune y de inflamación.",
  urine: "Mide componentes informados en una muestra de orina.",
  microbiology: "Informa hallazgos de microorganismos o pruebas relacionadas.",
  toxicology: "Mide fármacos u otras sustancias informadas por el laboratorio.",
  chemistry: "Mide sustancias químicas presentes en la muestra.",
  other: "Describe una medición informada por el laboratorio.",
};

export const measurementExplanation = (result: Pick<PhrLabResult, "analyte" | "loincMetadata">) =>
  explanationByCategory[labCategory({ analyte: result.analyte, loincMetadata: result.loincMetadata })];

const inPeriod = (date: string, period: PhrPeriod) => date >= period.from && date <= period.to;

export function comparePhrPeriods(results: PhrLabResult[], first: PhrPeriod, second: PhrPeriod) {
  const confirmed = results.filter((result) => result.reviewStatus === "confirmed" && result.valueNum !== null);
  const keys = [...new Set(confirmed.map(phrLabTrendKey))];
  return keys.map((key) => {
    const rows = confirmed.filter((result) => phrLabTrendKey(result) === key).sort((a, b) => b.observedAt.localeCompare(a.observedAt));
    const a = rows.find((result) => inPeriod(result.observedAt, first));
    const b = rows.find((result) => inPeriod(result.observedAt, second));
    if (!a && !b) return null;
    const unit = b?.unit ?? a?.unit ?? "";
    const firstValue = a ? convertLabValue(a.valueNum!, a.unit, unit) : null;
    const secondValue = b ? convertLabValue(b.valueNum!, b.unit, unit) : null;
    return {
      key, analyte: b?.analyte ?? a!.analyte, unit,
      first: firstValue, second: secondValue,
      change: firstValue !== null && secondValue !== null ? secondValue - firstValue : null,
    };
  }).filter((row): row is NonNullable<typeof row> => !!row && (row.first !== null || row.second !== null));
}

const csvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

export function phrTrendsCsv(results: PhrLabResult[]) {
  const rows = results.filter((result) => result.reviewStatus === "confirmed").sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  return "\uFEFF" + [
    ["Fecha", "Biomarcador", "Resultado", "Unidad", "Rango informado", "Estado"],
    ...rows.map((result) => [
      result.observedAt, result.analyte, result.valueNum ?? result.valueText, result.unit,
      result.refText || `${result.refLow ?? ""}${result.refLow !== null || result.refHigh !== null ? " - " : ""}${result.refHigh ?? ""}`,
      reportedRangeLabel(result),
    ]),
  ].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
