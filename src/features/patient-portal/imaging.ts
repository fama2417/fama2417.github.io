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
  ["clinicalIndication", ["indicacion clinica", "indicacion", "antecedentes clinicos", "antecedentes", "motivo del examen"]],
  ["technique", ["tecnica", "metodo"]],
  ["findings", ["hallazgos", "resultado", "resultados", "descripcion"]],
  ["impression", ["impresion", "conclusion", "conclusiones", "diagnostico"]],
];

export const cleanPhrImagingSection = (value: string) => value.split(/\s+(?=(?:atentamente\b|p[aá]g(?:ina)?\s+\d+\s+de\s+\d+|paciente\s*:|informe validado por\s*:|firmado por\s*:))/i)[0].trim();

export function structurePhrImagingText(value: string): PhrImagingText {
  const separated = value.replace(/\s+(?=(?:indicaci[oó]n cl[ií]nica|indicaci[oó]n|antecedentes cl[ií]nicos|antecedentes|motivo del examen|t[eé]cnica|m[eé]todo|hallazgos|resultado|resultados|descripci[oó]n|impresi[oó]n|conclusi[oó]n|conclusiones|diagn[oó]stico)\s*:)/gi, "\n");
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
