export const CODE_SYSTEMS = [
  ["LOCAL", "Código local"],
  ["LOINC", "LOINC"],
  ["SNOMEDCT", "SNOMED CT"],
  ["ICD-10", "CIE-10"],
  ["ICD-11", "CIE-11"],
] as const;

export type CodeSystem = (typeof CODE_SYSTEMS)[number][0];
