export type PhrImagingText = {
  clinicalIndication: string;
  technique: string;
  findings: string;
  impression: string;
  fullText: string;
};

const empty = (): PhrImagingText => ({ clinicalIndication: "", technique: "", findings: "", impression: "", fullText: "" });
const plain = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
const headings: [keyof Omit<PhrImagingText, "fullText">, string[]][] = [
  ["clinicalIndication", ["indicacion clinica", "indicacion", "antecedentes clinicos", "antecedentes", "motivo del examen"]],
  ["technique", ["tecnica", "metodo"]],
  ["findings", ["hallazgos", "resultado", "resultados", "descripcion"]],
  ["impression", ["impresion", "conclusion", "conclusiones", "diagnostico"]],
];

export function structurePhrImagingText(value: string): PhrImagingText {
  const result = empty(), lines = value.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  result.fullText = lines.join("\n");
  let current: keyof Omit<PhrImagingText, "fullText"> | "" = "";
  for (const line of lines) {
    const [label, ...rest] = line.split(":"), normalized = plain(label);
    const heading = headings.find(([, aliases]) => aliases.includes(normalized));
    if (heading) {
      current = heading[0];
      const sameLine = rest.join(":").trim();
      if (sameLine) result[current] = sameLine;
    } else if (current) result[current] = [result[current], line].filter(Boolean).join("\n");
  }
  return result;
}
