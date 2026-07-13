export type SanitizedAiReportInput = {
  procedureCode?: string;
  procedureName?: string;
  modality?: string;
  reportingGroupCode?: string | null;
  clinicalIndication?: string;
  comparison?: string;
  technique?: string;
  findings?: string;
  impression?: string;
  warnings: string[];
};

type ReportLike = {
  clinicalIndication?: string | null;
  comparison?: string | null;
  technique?: string | null;
  findings?: string | null;
  impression?: string | null;
};

type RelatedLike = {
  procedureCode?: string | null;
  procedureName?: string | null;
  modality?: string | null;
  reportingGroupCode?: string | null;
  patientName?: string | null;
};

export function sanitizeTextForAi(text: string) {
  return text
    .replace(/\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]\b/g, "[RUT]")
    .replace(/\b\d{8,9}\b/g, "[ID]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]")
    .replace(/(?:\+?56\s?)?(?:9\s?)?\d{4}\s?\d{4}\b/g, "[PHONE]")
    .replace(/\b(?:fecha de nacimiento|f\.? nac\.?|fnac|dob)\s*:?\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi, "$1: [DATE]")
    .replace(/\b(?:rut|dni|id|documento)\s*:?\s*[\w.-]+\b/gi, "$1: [ID]")
    .replace(/\b(?:accession(?: number)?|numero de acceso)\s*:?\s*[\w.-]+\b/gi, "$1: [ACCESSION]")
    .replace(/https?:\/\/\S+/gi, "[URL]")
    .trim();
}

const removeName = (text: string, name?: string | null) => name?.trim()
  ? text.replace(new RegExp(name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[PATIENT]")
  : text;

function fit(input: SanitizedAiReportInput, maxChars: number) {
  const fields: ("impression" | "findings" | "comparison" | "technique" | "clinicalIndication")[] = ["impression", "findings", "comparison", "technique", "clinicalIndication"];
  let remaining = maxChars;
  for (const key of fields) {
    const value = String(input[key] ?? "");
    if (!value) continue;
    if (value.length > remaining) {
      input[key] = value.slice(0, Math.max(0, remaining)).trim();
      input.warnings.push("AI input truncated");
      remaining = 0;
    } else remaining -= value.length;
  }
}

export function sanitizeReportForAi(report: ReportLike, relatedData: RelatedLike = {}): SanitizedAiReportInput {
  const clean = (value?: string | null) => sanitizeTextForAi(removeName(value ?? "", relatedData.patientName));
  const input: SanitizedAiReportInput = {
    procedureCode: clean(relatedData.procedureCode),
    procedureName: clean(relatedData.procedureName),
    modality: clean(relatedData.modality),
    reportingGroupCode: clean(relatedData.reportingGroupCode),
    clinicalIndication: clean(report.clinicalIndication),
    comparison: clean(report.comparison),
    technique: clean(report.technique),
    findings: clean(report.findings),
    impression: clean(report.impression),
    warnings: [],
  };
  const maxChars = Number(process.env.AI_MAX_INPUT_CHARS ?? 12000);
  if (JSON.stringify(input).length > maxChars) fit(input, maxChars);
  return input;
}
