// Helpers puros para resultados de laboratorio discretos (sin imports de supabase/JSX: testeables en node).
// Modelo forma-Observation de FHIR; ver migración 202607140001_lab_observations.sql.

export type LabFlag = "" | "normal" | "low" | "high" | "critical_low" | "critical_high" | "abnormal";

export type LabReviewStatus = "suggested" | "confirmed";

export type LoincMetadata = {
  component: string;
  property: string;
  timeAspect: string;
  specimen: string;
  scaleType: string;
  methodType: string;
  className: string;
  status: string;
  exampleUcumUnits: string;
};

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
  loincMetadata?: LoincMetadata;
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

export const labCategoryLabels = {
  hematology: "Hematología y coagulación",
  metabolic: "Glucosa y metabolismo",
  renal: "Función renal y electrolitos",
  hepatic: "Función hepática",
  lipids: "Perfil lipídico",
  hormones: "Tiroides y hormonas",
  nutrition: "Hierro, vitaminas y nutrición",
  immunology: "Inmunología e inflamación",
  urine: "Orina",
  microbiology: "Microbiología",
  toxicology: "Fármacos y toxicología",
  chemistry: "Química clínica",
  other: "Otros resultados",
} as const;
export type LabCategory = keyof typeof labCategoryLabels;
export const labCategoryOrder = Object.keys(labCategoryLabels) as LabCategory[];

const plain = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Categoría amigable derivada de metadatos LOINC; el nombre sólo completa catálogos antiguos. */
export function labCategory(observation: Pick<LabObservation, "analyte" | "loincMetadata">): LabCategory {
  const meta = observation.loincMetadata;
  const className = (meta?.className ?? "").toUpperCase();
  const text = plain(`${meta?.component ?? ""} ${observation.analyte}`);
  const specimen = plain(meta?.specimen ?? "");
  if (className === "UA" || className === "PANEL.UA" || /urine|orina/.test(specimen)) return "urine";
  if (/^(PANEL\.)?(HEM\/BC|COAG|BLDBK)/.test(className)) return "hematology";
  if (/^(PANEL\.)?(MICRO|ABXBACT)/.test(className)) return "microbiology";
  if (/DRUG|TOX/.test(className)) return "toxicology";
  if (/eritroc|hemoglobin|hematocrit|\bv\.?c\.?m\b|\bh\.?c\.?m\b|c\.?h\.?c\.?m|r\.?d\.?w|\br\.?a\.?n\b|leucocit|plaquet|basofil|eosinofil|mielocit|juvenil|baciliform|segmentad|linfocit|monocit|blasto|promielocit|neutrofil|globulos? (?:rojos?|blancos?)|\bvhs\b|protrombin|\binr\b/.test(text)) return "hematology";
  if (/glucos|glyc|hemoglobin a1c|hba1c|insulin|c-peptide|peptido c|lactat/.test(text)) return "metabolic";
  if (/cholesterol|colesterol|triglycer|triglicer|apolipoprotein|lipoprotein|hdl|ldl|vldl/.test(text)) return "lipids";
  if (/creatinin|cystatin|urea|uremia|nitrogeno ureico|uric acid|acido urico|glomerular|\bvfg\b|beta 2 microglobulin|sodium|sodio|potassium|potasio|chloride|cloro|electrolyte/.test(text)) return "renal";
  if (/bilirubin|bilirrubin|albumin|alanine aminotransferase|aspartate aminotransferase|transaminasa|\b(gpt|got|alat|asat|sgpt|sgot|alt|ast|ggt)\b|gamma (?:gt|glutam)|alkaline phosphatase|fosfatasa alcalina/.test(text)) return "hepatic";
  if (/thyro|tiroid|tsh|triiodothyronine|\bt3\b|\bt4\b|cortisol|testosterone|estradiol|progesterone|prolactin|gonadotropin|luteinizing|follicle.stimulating|parathyroid|hormona/.test(text) || /FERT/.test(className)) return "hormones";
  if (/ferritin|transferrin|ferremia|fijacion fierro|saturacion de transferrin|\biron\b|hierro|folate|folato|vitamin|vitamina|cobalamin|calcium|calcio|magnesium|magnesio|phosphorus|fosforo/.test(text)) return "nutrition";
  if (/c.reactive|reactive protein|proteina c|immunoglobulin|anticuer|antibody|complement|rheumatoid|reumato|sedimentation|eritrosediment/.test(text) || /SERO|ALLERGY|CELLMARK|HLA/.test(className)) return "immunology";
  return /CHEM|CHAL/.test(className) || /proteinas? totales|desh.*lactica|\bldh\b|troponina/.test(text) ? "chemistry" : "other";
}

const unitKey = (unit: string) => plain(unit).replace(/μ|µ/g, "u").replace(/\s+/g, "").replace(/litro|litre/g, "l");

function parsedUnit(unit: string): { dimension: string; factor: number } | null {
  const key = unitKey(unit).replace(/ui\/l|iu\/l|\[iu\]\/l/g, "u/l");
  if (key === "%") return { dimension: "ratio", factor: 0.01 };
  if (key === "u/l") return { dimension: "activity/l", factor: 1 };
  const concentration = key.match(/^(kg|g|mg|ug|ng|pg|mol|mmol|umol|nmol|pmol)\/(l|dl|ml|ul)$/);
  if (concentration) {
    const numerator: Record<string, [string, number]> = {
      kg: ["mass", 1e3], g: ["mass", 1], mg: ["mass", 1e-3], ug: ["mass", 1e-6], ng: ["mass", 1e-9], pg: ["mass", 1e-12],
      mol: ["amount", 1], mmol: ["amount", 1e-3], umol: ["amount", 1e-6], nmol: ["amount", 1e-9], pmol: ["amount", 1e-12],
    };
    const denominator: Record<string, number> = { l: 1, dl: 1e-1, ml: 1e-3, ul: 1e-6 };
    const [dimension, factor] = numerator[concentration[1]];
    return { dimension: `${dimension}/volume`, factor: factor / denominator[concentration[2]] };
  }
  const count = key.match(/^(?:x)?10(?:\^|\*)?(-?\d+)\/(l|dl|ml|ul)$/);
  if (count) {
    const denominator: Record<string, number> = { l: 1, dl: 1e-1, ml: 1e-3, ul: 1e-6 };
    return { dimension: "count/volume", factor: 10 ** Number(count[1]) / denominator[count[2]] };
  }
  return null;
}

/** Convierte sólo unidades UCUM dimensionalmente equivalentes; nunca cruza masa con cantidad molar. */
export function convertLabValue(value: number, fromUnit: string, toUnit: string): number | null {
  if (unitKey(fromUnit) === unitKey(toUnit)) return value;
  const from = parsedUnit(fromUnit), to = parsedUnit(toUnit);
  return from && to && from.dimension === to.dimension ? value * from.factor / to.factor : null;
}

export type ComparableLabPoint = { id: string; observedAt: string; value: number };

/** Serie numérica segura: mismo LOINC y unidades convertibles a la unidad más reciente. */
export function comparableLabTrend(points: LabObservation[]): { unit: string; points: ComparableLabPoint[]; refLow: number | null; refHigh: number | null } | null {
  const latest = points[0];
  if (!latest?.loincCode || latest.valueNum === null) return null;
  const comparableByDate = new Map<string, ComparableLabPoint>();
  for (const point of points) {
    if (point.loincCode !== latest.loincCode || point.valueNum === null) continue;
    const value = convertLabValue(point.valueNum, point.unit, latest.unit);
    if (value !== null && Number.isFinite(new Date(point.observedAt).getTime()) && !comparableByDate.has(point.observedAt)) {
      comparableByDate.set(point.observedAt, { id: point.id, observedAt: point.observedAt, value });
    }
  }
  const comparable = [...comparableByDate.values()].sort((a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime()).slice(-12);
  return comparable.length >= 2 ? { unit: latest.unit, points: comparable, refLow: latest.refLow, refHigh: latest.refHigh } : null;
}
