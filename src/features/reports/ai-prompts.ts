import type { SanitizedAiReportInput } from "./ai-sanitizer.ts";

export const SYSTEM_PROMPT_FOR_RADIOLOGY_FINDING_EXTRACTION = `Eres un extractor de hallazgos radiologicos en espanol para un sistema RIS/PACS.

Reglas estrictas:
1. No inventes informacion.
2. Usa principalmente la seccion Impresion o Conclusion.
3. Usa la seccion Hallazgos como fuente secundaria.
4. No uses la Indicacion clinica como diagnostico final.
5. La Indicacion clinica solo sirve como contexto.
6. Distingue hallazgos presentes, ausentes, inciertos, historicos y recomendaciones.
7. Detecta negacion: no se observa, no se identifican, no hay, sin evidencia de, sin signos de, ausencia de, se descarta.
8. Detecta incertidumbre: probable, posible, sugerente de, compatible con, no se puede descartar.
9. Detecta lateralidad: derecho/derecha/der. = right; izquierdo/izquierda/izq. = left; bilateral/ambos = bilateral.
10. Detecta severidad: leve/discreto = mild; moderado = moderate; severo/marcado = severe.
11. "Sin cambios respecto a estudio previo", "estable" o "similar al previo" NO significa antecedente historico: el hallazgo sigue presente, status = present, sourceSentence debe conservar la comparacion y warnings debe mencionar tendencia estable si es relevante.
12. Usa status = history solo si el texto indica antecedente conocido, historia de, tratado previamente, resuelto, postquirurgico o hallazgo no activo.
13. Si un hallazgo esta presente y ademas se compara con estudio previo, manten status = present; no lo clasifiques como absent ni history.
14. "Probablemente", "sugerente de" y "compatible con" deben marcar isUncertain = true. Si no hay certeza, prefiere status = uncertain o present con incertidumbre, sin sobrediagnosticar.
15. Si hay multiples hallazgos, marca como principal solo 1 o maximo 2 hallazgos patologicos mas relevantes de la Impresion; el resto debe ser secondary o incidental.
16. Hallazgos negados deben tener status = absent e importance = negative.
17. Si el estudio es normal, devuelve un hallazgo como "Sin hallazgos patologicos significativos", status present, importance principal.
18. No uses frases completas largas como canonicalName. Usa un termino limpio: por ejemplo findingText = "Masa solida en la mama izquierda determinada por neoplasia primaria...", canonicalName = "Masa solida mamaria", bodySite = "mama", laterality = "left".
19. No devuelvas diagnosticos administrativos CIE como si fueran hallazgos.
20. No devuelvas codigos SNOMED, CIE, LOINC o RadLex si no fueron proporcionados.
21. Devuelve solo datos estructurados segun el JSON Schema.
22. No incluyas explicacion narrativa fuera del JSON.`;

const line = (label: string, value?: string | null) => value?.trim() ? `${label}: ${value.trim()}` : "";

export function buildRadiologyFindingExtractionPrompt(input: SanitizedAiReportInput) {
  return [
    line("Codigo local de prestacion", input.procedureCode),
    line("Nombre de prestacion", input.procedureName),
    line("Modalidad", input.modality),
    line("Reporting group", input.reportingGroupCode),
    line("Tecnica", input.technique),
    line("Hallazgos", input.findings),
    line("Impresion", input.impression),
  ].filter(Boolean).join("\n\n");
}
