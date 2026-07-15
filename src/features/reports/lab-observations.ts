// Helpers puros para resultados de laboratorio discretos (sin imports de supabase/JSX: testeables en node).
// Modelo forma-Observation de FHIR; ver migración 202607140001_lab_observations.sql.

export type LabFlag = "" | "normal" | "low" | "high" | "critical_low" | "critical_high" | "abnormal";

export type LabReviewStatus = "suggested" | "confirmed";

export type LabObservation = {
  id: string;
  reportId: string | null;
  importId: string | null;
  appointmentId: string;
  patientId: string;
  loincCode: string;
  analyte: string;
  valueNum: number | null;
  valueText: string;
  unit: string;
  refLow: number | null;
  refHigh: number | null;
  refText: string;
  flag: LabFlag;
  observedAt: string;
  source: "manual" | "ocr" | "ai";
  sourceSentence: string;
  reviewStatus: LabReviewStatus;
};

export const labFlagLabels: Record<LabFlag, string> = {
  "": "Sin evaluar",
  normal: "Normal",
  low: "Bajo",
  high: "Alto",
  critical_low: "Crítico bajo",
  critical_high: "Crítico alto",
  abnormal: "Anormal",
};

/**
 * Flag automático a partir del valor numérico y el rango de referencia.
 * Solo deriva normal/low/high; los umbrales críticos NO se deducen de un rango de referencia
 * y deben marcarse explícitamente (critical_low/critical_high). Sin valor numérico o sin ningún
 * límite, devuelve "" (no evaluable): un resultado textual o sin rango no recibe flag inventado.
 */
export function labFlag(valueNum: number | null, refLow: number | null, refHigh: number | null): LabFlag {
  if (valueNum === null || Number.isNaN(valueNum)) return "";
  if (refLow === null && refHigh === null) return "";
  if (refLow !== null && valueNum < refLow) return "low";
  if (refHigh !== null && valueNum > refHigh) return "high";
  return "normal";
}

export function parseLabNumber(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  return /^-?\d+(?:\.\d+)?$/.test(normalized) ? Number(normalized) : null;
}

export function parseLabReference(value: string): { refLow: number | null; refHigh: number | null; refText: string } {
  const clean = value.replace(/\[\s*\*\s*\]/g, "").replace(/\s+/g, " ").trim();
  const range = clean.match(/^(-?\d+(?:[.,]\d+)?)\s*[-–]\s*(-?\d+(?:[.,]\d+)?)(?:\s*-\s*\.)?$/);
  if (range) return { refLow: parseLabNumber(range[1]), refHigh: parseLabNumber(range[2]), refText: "" };
  const high = clean.match(/^(?:hasta|menor\s+a|<)\s*:?[ ]*(-?\d+(?:[.,]\d+)?)(?:\s*-\s*\.)?$/i);
  if (high) return { refLow: null, refHigh: parseLabNumber(high[1]), refText: "" };
  const low = clean.match(/^(?:mayor\s+a|>)\s*:?[ ]*(-?\d+(?:[.,]\d+)?)$/i);
  if (low) return { refLow: parseLabNumber(low[1]), refHigh: null, refText: "" };
  return { refLow: null, refHigh: null, refText: clean };
}

/** Clave de agrupación para tendencia: LOINC si existe, si no el nombre del analito normalizado. */
export const labTrendKey = (obs: Pick<LabObservation, "loincCode" | "analyte">) =>
  obs.loincCode.trim() || obs.analyte.trim().toLowerCase();
