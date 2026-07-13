import type { SanitizedAiReportInput } from "./ai-sanitizer.ts";
import type { ReportingProfile } from "./ai-extraction-schema.ts";
import { clinicalProfileForCategory } from "../clinical-workspace/profiles.ts";
import type { Appointment } from "../appointments/mock-data.ts";

export const SYSTEM_PROMPT_FOR_RADIOLOGY_FINDING_EXTRACTION = `Eres un extractor de hallazgos radiologicos en espanol para un sistema RIS/PACS.

Reglas estrictas:
1. No inventes informacion.
2. Devuelve dos niveles: clinicalSummary conciso para revision clinica y findings granular para diccionario, busqueda y auditoria.
3. clinicalSummary debe responder que resume clinicamente el informe, priorizar Impresion o Conclusion y contener maximo 8 primarySummaryItems, de los cuales maximo 3 pueden describir enfermedad principal.
4. No transformes cada oracion de Hallazgos en una tarjeta visible. Agrupa conceptos clinicamente relacionados.
5. En PET-CT oncologico agrupa sitios del mismo patron de enfermedad en un solo summary item multisistemico.
6. Si existe Deauville u otra escala, extraela en scores con su fuente textual.
7. Aumento de tamano, numero o captacion implica trend = progression; desaparicion implica trend = resolved; sin cambios implica trend = stable, nunca history.
8. No incluyas estructuras normales ni negativos rutinarios en primarySummaryItems. Los negativos clinicamente relevantes pueden usar category = negative_relevant.
9. No generes candidatos de diccionario para negativos rutinarios, estructuras normales ni frases administrativas.
10. La seccion Impresion o Conclusion es la fuente principal para definir hallazgos principales.
11. La seccion Hallazgos es fuente secundaria para evidencia, detalles anatomicos, lateralidad, severidad, medidas, SUV y hallazgos incidentales.
12. La Indicacion clinica solo sirve como clinicalContext; nunca debe crear un hallazgo activo por si sola.
13. Distingue hallazgos presentes, ausentes, inciertos, historicos y recomendaciones.
14. Detecta negacion: no se observa, no se identifican, no hay, sin evidencia de, sin signos de, ausencia de, se descarta.
15. Detecta incertidumbre: probable, posible, sugerente de, compatible con, no se puede descartar.
16. Detecta lateralidad: derecho/derecha/der. = right; izquierdo/izquierda/izq. = left; bilateral/ambos = bilateral.
17. Detecta severidad: leve/discreto = mild; moderado = moderate; severo/marcado = severe.
18. Si un hallazgo aparece en Hallazgos pero no en Impresion, clasificalo como secondary o incidental; si parece relevante, agrega warning "hallazgo relevante no mencionado en impresion".
19. Si Impresion dice normal pero Hallazgos contiene patologia, agrega warning de discordancia.
20. "Sin cambios respecto a estudio previo", "estable" o "similar al previo" NO significa antecedente historico: el hallazgo sigue presente, status = present, sourceSentence debe conservar la comparacion y warnings debe mencionar temporalTrend=stable y comparisonWithPrior=true.
21. Usa status = history solo si el texto indica antecedente conocido, historia de, tratado previamente, resuelto, postquirurgico o hallazgo no activo.
22. Si un hallazgo esta presente y ademas se compara con estudio previo, manten status = present; no lo clasifiques como absent ni history.
23. "Probablemente", "sugerente de" y "compatible con" deben marcar isUncertain = true. Si no hay certeza, prefiere status = uncertain o present con incertidumbre, sin sobrediagnosticar.
24. Si hay multiples hallazgos, marca como principal solo 1 o maximo 2 hallazgos patologicos mas relevantes de la Impresion; el resto debe ser secondary o incidental.
25. Hallazgos negados deben tener status = absent e importance = negative.
26. Si el estudio es normal, devuelve un hallazgo como "Sin hallazgos patologicos significativos", status present, importance principal.
27. No uses frases completas largas como canonicalName. Usa un termino limpio: por ejemplo findingText = "Masa solida en la mama izquierda determinada por neoplasia primaria...", canonicalName = "Masa solida mamaria", bodySite = "mama", laterality = "left".
28. No devuelvas diagnosticos administrativos CIE como si fueran hallazgos.
29. No devuelvas codigos SNOMED, CIE, LOINC o RadLex si no fueron proporcionados.
30. Devuelve solo datos estructurados segun el JSON Schema.
31. Si no existe Impresion o Conclusion y tampoco hay comparacion clara, globalAssessment.status debe ser indeterminate y text debe ser "Hallazgos compatibles con enfermedad activa/secundaria, sin poder determinar progresion por falta de impresion o comparacion.". Agrega warning "Resumen generado desde Hallazgos. No se detecto seccion Impresion/Conclusion.".
32. No declares progression sin comparacion clara: por ejemplo aumento, disminucion, lesion nueva, sin cambios o referencia explicita a un estudio previo.
33. En clinicalContext identifica el nombre recibido como "Prestacion registrada: [nombre]". No uses la frase "segun nombre de prestacion".
34. Si nombre/modalidad/region de la prestacion discrepa del contenido, agrega "Contenido sugerido por informe: [region detectada]" a clinicalContext y un warning que comience con "Discordancia prestacion/contenido:".
35. Usa reportingProfile para adaptar el resumen al estudio. Si es PET_CT_ONCOLOGY completa oncologyContext, globalResponse, sitios activos/resueltos/estables e incidentales.
36. En PET-CT: aumento de tamano, numero o captacion = progression; desaparicion o ya no visible = resolved; sin cambios = stable. Agrupa sitios relacionados y extrae Deauville o RECIST si aparecen.
37. Completa qualityWarnings con type y message solo cuando corresponda: procedure_content_mismatch, missing_impression, relevant_finding_not_in_impression, impression_findings_discordance, missing_expected_score, possible_wrong_template, possible_wrong_study, insufficient_text o low_confidence_summary.
38. Genera clinicalTags solo desde evidencia del informe. No inventes tags ni codigos terminologicos.
39. En lesionTracking incluye solo lesiones explicitamente rotuladas LT1, LT2 o LT3. Conserva medidas y SUV como texto, compara actual versus previo y cita sourceSentence.
40. No incluyas estructuras normales como enfermedad activa ni como candidatos de diccionario.
41. No incluyas explicacion narrativa fuera del JSON.`;

const line = (label: string, value?: string | null) => value?.trim() ? `${label}: ${value.trim()}` : "";

export const SYSTEM_PROMPT_FOR_CLINICAL_DOCUMENT_SUMMARY = `Eres un asistente de revision documental clinica en espanol.

Reglas estrictas:
1. El resultado es una sugerencia para revision profesional; no inventes informacion ni completes datos ausentes.
2. No reescribas ni modifiques el documento original.
3. Resume solo afirmaciones presentes en las secciones recibidas y cita cada punto con sourceSentences textuales.
4. Conserva cifras, unidades, lateralidad, negaciones e incertidumbre exactamente como fueron documentadas.
5. En laboratorio no calcules, no cambies unidades y no declares normalidad o anormalidad salvo que el texto lo indique.
6. En patologia no infieras etapa, grado, margenes, biomarcadores ni diagnosticos que no esten escritos.
7. En procedimientos no declares ausencia de incidentes o complicaciones salvo que este documentada.
8. En consulta no propongas diagnosticos, tratamientos o conductas nuevas.
9. assessment.text debe ser una sintesis breve del documento, con confianza calibrada.
10. Genera como maximo 8 summaryItems y usa sourceSection segun el campo de origen.
11. Clasifica cada punto solo como clinical_fact, result, diagnosis, recommendation, limitation o warning.
12. Usa recommendation solo para planes o seguimientos escritos y warning solo para vacios o contradicciones observables; no inventes alertas.
13. No devuelvas codigos SNOMED, CIE, LOINC o RadLex si no fueron proporcionados.
14. Devuelve solo datos estructurados segun el JSON Schema.`;

type NonRadiologyCategory = Exclude<Appointment["serviceCategory"], "imaging">;
const clinicalGuidance: Record<NonRadiologyCategory, string> = {
  consultation: "Prioriza evaluacion, diagnosticos y plan documentados; separa antecedentes de problemas activos.",
  laboratory: "Prioriza resultados e interpretacion escritos; conserva valores y unidades sin inferir rangos.",
  pathology: "Prioriza diagnostico, muestra, microscopia y marcadores, grado o margenes solo cuando esten explicitamente documentados.",
  procedure: "Prioriza indicacion, tecnica, hallazgos, incidentes o limitaciones y plan posterior documentado.",
};

export function buildRadiologyFindingExtractionPrompt(input: SanitizedAiReportInput, reportingProfile: ReportingProfile = "UNKNOWN") {
  return [
    line("Codigo local de prestacion", input.procedureCode),
    line("Nombre de prestacion", input.procedureName),
    line("Modalidad", input.modality),
    line("Reporting group", input.reportingGroupCode),
    line("Reporting profile asignado", reportingProfile),
    line("Indicacion clinica (solo contexto)", input.clinicalIndication),
    line("Comparacion", input.comparison),
    line("Tecnica", input.technique),
    line("Hallazgos", input.findings),
    line("Impresion", input.impression),
  ].filter(Boolean).join("\n\n");
}

export function buildClinicalDocumentSummaryPrompt(input: SanitizedAiReportInput, category: NonRadiologyCategory) {
  const profile = clinicalProfileForCategory(category);
  const values = { clinicalIndication: input.clinicalIndication, comparison: input.comparison, technique: input.technique, findings: input.findings, impression: input.impression };
  return [
    line("Perfil documental", category),
    line("Prestacion registrada", input.procedureName),
    line("Codigo local de prestacion", input.procedureCode),
    line("Instruccion especifica", clinicalGuidance[category]),
    ...profile.sections.map((section) => line(`${section.label} [${section.name}]`, values[section.name])),
  ].filter(Boolean).join("\n\n");
}
