import type { Appointment } from "@/features/appointments/mock-data";

export type ReportSection = { name: "clinicalIndication" | "technique" | "comparison" | "findings" | "impression"; label: string; hint: string };

export const reportProfiles: Record<Appointment["serviceCategory"], { title: string; editor: string; sections: ReportSection[] }> = {
  imaging: {
    title: "Informe imagenológico",
    editor: "Informe estructurado imagenológico",
    sections: [
      { name: "clinicalIndication", label: "Indicación clínica", hint: "Motivo del examen, antecedentes relevantes." },
      { name: "technique", label: "Técnica", hint: "Protocolo, contraste, limitaciones." },
      { name: "comparison", label: "Comparación", hint: "Estudios previos utilizados." },
      { name: "findings", label: "Hallazgos", hint: "Descripción sistemática por órgano/región." },
      { name: "impression", label: "Impresión", hint: "Conclusión numerada y recomendaciones." },
    ],
  },
  laboratory: {
    title: "Informe de laboratorio",
    editor: "Resultados estructurados de laboratorio",
    sections: [
      { name: "clinicalIndication", label: "Solicitud / indicación", hint: "Motivo clínico o panel solicitado." },
      { name: "technique", label: "Muestra / método", hint: "Tipo de muestra, método, equipo o limitaciones preanalíticas." },
      { name: "comparison", label: "Valores de referencia", hint: "Rangos relevantes o comparación con controles previos." },
      { name: "findings", label: "Resultados", hint: "Resultados principales con unidades cuando corresponda." },
      { name: "impression", label: "Interpretación", hint: "Conclusión clínica, alertas o recomendación de control." },
    ],
  },
  pathology: {
    title: "Informe anatomopatológico",
    editor: "Informe estructurado de anatomía patológica",
    sections: [
      { name: "clinicalIndication", label: "Antecedentes clínicos", hint: "Hipótesis, sitio anatómico y contexto." },
      { name: "technique", label: "Muestra / macroscopía", hint: "Tipo de muestra, cantidad, medidas y descripción macroscópica." },
      { name: "comparison", label: "Procesamiento / técnicas", hint: "Tinciones, inmunohistoquímica o estudios complementarios." },
      { name: "findings", label: "Microscopía", hint: "Descripción microscópica estructurada." },
      { name: "impression", label: "Diagnóstico", hint: "Diagnóstico anatomopatológico, grado, márgenes o recomendaciones." },
    ],
  },
  consultation: {
    title: "Nota clínica",
    editor: "Consulta clínica estructurada",
    sections: [
      { name: "clinicalIndication", label: "Motivo de consulta", hint: "Problema principal declarado por el paciente o derivante." },
      { name: "technique", label: "Anamnesis", hint: "Historia actual y antecedentes relevantes." },
      { name: "comparison", label: "Examen físico / controles", hint: "Examen, signos vitales o comparación con evolución previa." },
      { name: "findings", label: "Evaluación", hint: "Hallazgos clínicos y razonamiento." },
      { name: "impression", label: "Diagnóstico y plan", hint: "Diagnósticos, indicaciones, tratamiento y control." },
    ],
  },
  procedure: {
    title: "Reporte de procedimiento",
    editor: "Procedimiento estructurado",
    sections: [
      { name: "clinicalIndication", label: "Indicación", hint: "Motivo del procedimiento y antecedentes." },
      { name: "technique", label: "Técnica / procedimiento", hint: "Descripción del procedimiento, materiales y sedación si aplica." },
      { name: "comparison", label: "Incidentes / limitaciones", hint: "Complicaciones, tolerancia o limitaciones." },
      { name: "findings", label: "Hallazgos", hint: "Hallazgos observados durante el procedimiento." },
      { name: "impression", label: "Conclusión y plan", hint: "Conclusión, indicaciones post-procedimiento y seguimiento." },
    ],
  },
};

export const profileFor = (category?: Appointment["serviceCategory"]) => reportProfiles[category ?? "procedure"];
