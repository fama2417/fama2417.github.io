export const CODE_SYSTEMS = [
  ["LOCAL", "Código local", ""],
  ["LOINC", "LOINC", "http://loinc.org"],
  ["SNOMEDCT", "SNOMED CT", "http://snomed.info/sct"],
  ["ICD-10", "CIE-10", "http://hl7.org/fhir/sid/icd-10"],
  ["ICD-11", "CIE-11", "http://id.who.int/icd/release/11/mms"],
] as const;

export type CodeSystem = (typeof CODE_SYSTEMS)[number][0];

export const codeSystemLabels = Object.fromEntries(CODE_SYSTEMS.map(([value, label]) => [value, label])) as Record<CodeSystem, string>;
export const codeSystemUrls = Object.fromEntries(CODE_SYSTEMS.map(([value, , url]) => [value, url])) as Record<CodeSystem, string>;
export const isCodeSystem = (value: string): value is CodeSystem => value in codeSystemLabels;
const codePattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

export function codingError(system: string, code: string, display: string, label: string, required = false) {
  const sys = system || "LOCAL";
  if (!isCodeSystem(sys)) return `${label}: sistema de código inválido.`;
  const hasCode = !!code.trim();
  const hasDisplay = !!display.trim();
  if (required || sys !== "LOCAL" || hasCode || hasDisplay) {
    if (!hasCode || !hasDisplay) return `${label}: completa código y nombre estándar.`;
    if (!codePattern.test(code.trim())) return `${label}: el código tiene caracteres inválidos.`;
  }
  return "";
}

export function codeHref(system: string, code: string) {
  const clean = code.trim();
  if (!clean || !isCodeSystem(system) || system === "LOCAL") return "";
  if (system === "LOINC") return `https://loinc.org/${encodeURIComponent(clean)}/`;
  if (system === "SNOMEDCT") return `https://browser.ihtsdotools.org/?perspective=full&conceptId1=${encodeURIComponent(clean)}`;
  if (system === "ICD-10") return `https://icd.who.int/browse10/2019/en#/${encodeURIComponent(clean)}`;
  if (system === "ICD-11") return `https://icd.who.int/browse/2025-01/mms/en#/${encodeURIComponent(clean)}`;
  return codeSystemUrls[system];
}
