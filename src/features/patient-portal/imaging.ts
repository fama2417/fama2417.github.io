export type PhrImagingText = {
  clinicalIndication: string;
  technique: string;
  findings: string;
  impression: string;
  plainLanguage: string;
  fullText: string;
};

type ImagingSection = "clinicalIndication" | "technique" | "findings" | "impression";
const empty = (): PhrImagingText => ({ clinicalIndication: "", technique: "", findings: "", impression: "", plainLanguage: "", fullText: "" });
const plain = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
const headings: [ImagingSection, string[]][] = [
  ["clinicalIndication", ["indicacion clinica", "indicacion", "antecedentes clinicos", "antecedentes", "motivo del examen", "motivo de consulta"]],
  ["technique", ["tecnica", "metodo", "procedimiento", "examen realizado"]],
  ["findings", ["hallazgos", "resultado", "resultados", "descripcion", "observaciones"]],
  ["impression", ["impresion", "conclusion", "conclusiones", "diagnostico", "diagnostico final", "interpretacion"]],
];

export const cleanPhrImagingSection = (value: string) => value.split(/\s+(?=(?:atentamente\b|p[aá]g(?:ina)?\s+\d+\s+de\s+\d+|paciente\s*:|informe validado por\s*:|firmado por\s*:))/i)[0].trim();

export function phrImagingPlainLanguagePoints(value: string) {
  const explicit = value.replace(/\r/g, "").split(/\n+|(?:^|\s)[•▪◦-]\s+|(?:^|\s)\d+[.)]\s+/).map((part) => part.trim().replace(/^[•▪◦-]\s*/, "")).filter(Boolean);
  return explicit.length > 1 ? explicit : value.trim().split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ])/).map((part) => part.trim()).filter(Boolean);
}

export function structurePhrImagingText(value: string): PhrImagingText {
  const withInlineHeadings = value.replace(/\s+((?:indicaci[oó]n cl[ií]nica|indicaci[oó]n|antecedentes cl[ií]nicos|antecedentes|motivo del examen|motivo de consulta|t[eé]cnica|m[eé]todo|procedimiento|examen realizado|hallazgos|resultado|resultados|descripci[oó]n|observaciones|impresi[oó]n|conclusi[oó]n|conclusiones|diagn[oó]stico final|diagn[oó]stico(?!\s+final\b)|interpretaci[oó]n))\s+(\S)/gi, (match, heading: string, next: string) => heading[0] === heading[0].toUpperCase() && next === next.toLocaleUpperCase("es-CL") ? `\n${heading}: ${next}` : match);
  const separated = withInlineHeadings.replace(/\s+(?=(?:indicaci[oó]n cl[ií]nica|indicaci[oó]n|antecedentes cl[ií]nicos|antecedentes|motivo del examen|motivo de consulta|t[eé]cnica|m[eé]todo|procedimiento|examen realizado|hallazgos|resultado|resultados|descripci[oó]n|observaciones|impresi[oó]n|conclusi[oó]n|conclusiones|diagn[oó]stico|diagn[oó]stico final|interpretaci[oó]n)\s*:)/gi, "\n");
  const result = empty(), lines = separated.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  result.fullText = lines.join("\n");
  let current: ImagingSection | "" = "";
  for (const line of lines) {
    const [label, ...rest] = line.split(":"), normalized = plain(label);
    const heading = headings.find(([, aliases]) => aliases.includes(normalized));
    if (heading) {
      current = heading[0];
      const sameLine = rest.join(":").trim();
      if (sameLine) result[current] = sameLine;
    } else if (current) result[current] = [result[current], line].filter(Boolean).join("\n");
  }
  headings.forEach(([field]) => { result[field] = cleanPhrImagingSection(result[field]); });
  return result;
}
