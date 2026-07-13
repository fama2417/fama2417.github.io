import type { Appointment } from "../appointments/mock-data.ts";

export type ReportSectionName = "clinicalIndication" | "technique" | "comparison" | "findings" | "impression";
export type ReportSection = { name: ReportSectionName; label: string; hint: string; required?: boolean };
export type ClinicalAiAnalysisProfile = "radiology" | Exclude<Appointment["serviceCategory"], "imaging"> | "none";

export type ClinicalDocumentProfile = {
  title: string;
  editor: string;
  confirmationLabel: string;
  criticalLabel: string;
  criticalTypeOptions?: readonly string[];
  sections: ReportSection[];
  layoutMode: "editor_viewer" | "editor_only" | "editor_attachments";
  viewerMode: "dicom" | "attachments" | "none";
  aiAnalysisProfile: ClinicalAiAnalysisProfile;
};

const radiologyCriticalTypes = [
  "Neumotórax a tensión", "Tromboembolismo pulmonar", "Disección o rotura aórtica", "Hemorragia intracraneal",
  "ACV isquémico agudo", "Neumoperitoneo / aire libre", "Isquemia mesentérica", "Fractura inestable de columna",
  "Torsión ovárica o testicular", "Embarazo ectópico", "Otro hallazgo crítico",
] as const;

export const clinicalDocumentProfiles: Record<Appointment["serviceCategory"], ClinicalDocumentProfile> = {
  imaging: {
    title: "Informe imagenológico",
    editor: "Informe estructurado imagenológico",
    confirmationLabel: "Confirmo que la impresión responde la pregunta clínica.",
    criticalLabel: "Hallazgo crítico",
    criticalTypeOptions: radiologyCriticalTypes,
    layoutMode: "editor_viewer",
    viewerMode: "dicom",
    aiAnalysisProfile: "radiology",
    sections: [
      { name: "clinicalIndication", label: "Indicación clínica", hint: "Motivo del examen, antecedentes relevantes." },
      { name: "comparison", label: "Comparación", hint: "Estudios previos utilizados." },
      { name: "technique", label: "Técnica", hint: "Protocolo, contraste, limitaciones." },
      { name: "findings", label: "Hallazgos", hint: "Descripción sistemática por órgano/región.", required: true },
      { name: "impression", label: "Impresión diagnóstica", hint: "Conclusión numerada y recomendaciones.", required: true },
    ],
  },
  consultation: {
    title: "Nota clínica",
    editor: "Consulta clínica estructurada",
    confirmationLabel: "Confirmo que la evaluación y el plan fueron revisados.",
    criticalLabel: "Situación clínica crítica",
    layoutMode: "editor_only",
    viewerMode: "none",
    aiAnalysisProfile: "consultation",
    sections: [
      { name: "clinicalIndication", label: "Motivo de consulta", hint: "Problema principal declarado por el paciente o derivante." },
      { name: "comparison", label: "Examen físico / controles", hint: "Examen, signos vitales o comparación con evolución previa." },
      { name: "technique", label: "Anamnesis", hint: "Historia actual y antecedentes relevantes." },
      { name: "findings", label: "Evaluación", hint: "Hallazgos clínicos y razonamiento.", required: true },
      { name: "impression", label: "Diagnóstico y plan", hint: "Diagnósticos, indicaciones, tratamiento y control.", required: true },
    ],
  },
  laboratory: {
    title: "Informe de laboratorio",
    editor: "Resultados estructurados de laboratorio",
    confirmationLabel: "Confirmo que los resultados fueron verificados.",
    criticalLabel: "Resultado crítico",
    layoutMode: "editor_only",
    viewerMode: "none",
    aiAnalysisProfile: "laboratory",
    sections: [
      { name: "clinicalIndication", label: "Solicitud / indicación", hint: "Motivo clínico o panel solicitado." },
      { name: "comparison", label: "Valores de referencia", hint: "Rangos relevantes o comparación con controles previos." },
      { name: "technique", label: "Muestra / método", hint: "Tipo de muestra, método, equipo o limitaciones preanalíticas." },
      { name: "findings", label: "Resultados", hint: "Resultados principales con unidades cuando corresponda.", required: true },
      { name: "impression", label: "Interpretación", hint: "Conclusión clínica, alertas o recomendación de control." },
    ],
  },
  pathology: {
    title: "Informe anatomopatológico",
    editor: "Informe estructurado de anatomía patológica",
    confirmationLabel: "Confirmo que el diagnóstico fue verificado.",
    criticalLabel: "Diagnóstico crítico",
    layoutMode: "editor_attachments",
    viewerMode: "attachments",
    aiAnalysisProfile: "pathology",
    sections: [
      { name: "clinicalIndication", label: "Antecedentes clínicos", hint: "Hipótesis, sitio anatómico y contexto." },
      { name: "comparison", label: "Procesamiento / técnicas", hint: "Tinciones, inmunohistoquímica o estudios complementarios." },
      { name: "technique", label: "Muestra / macroscopía", hint: "Tipo de muestra, cantidad, medidas y descripción macroscópica." },
      { name: "findings", label: "Microscopía", hint: "Descripción microscópica estructurada." },
      { name: "impression", label: "Diagnóstico", hint: "Diagnóstico anatomopatológico, grado, márgenes o recomendaciones.", required: true },
    ],
  },
  procedure: {
    title: "Reporte de procedimiento",
    editor: "Procedimiento estructurado",
    confirmationLabel: "Confirmo que la técnica y la conclusión o plan fueron revisados.",
    criticalLabel: "Evento o hallazgo crítico",
    layoutMode: "editor_attachments",
    viewerMode: "attachments",
    aiAnalysisProfile: "procedure",
    sections: [
      { name: "clinicalIndication", label: "Indicación", hint: "Motivo del procedimiento y antecedentes." },
      { name: "comparison", label: "Incidentes / limitaciones", hint: "Complicaciones, tolerancia o limitaciones." },
      { name: "technique", label: "Técnica / procedimiento", hint: "Descripción del procedimiento, materiales y sedación si aplica.", required: true },
      { name: "findings", label: "Hallazgos", hint: "Hallazgos observados durante el procedimiento." },
      { name: "impression", label: "Conclusión y plan", hint: "Conclusión, indicaciones post-procedimiento y seguimiento.", required: true },
    ],
  },
};

export const clinicalProfileForCategory = (category: Appointment["serviceCategory"] = "procedure") => clinicalDocumentProfiles[category];

export const supportsRadiologyAi = (category: Appointment["serviceCategory"]) =>
  clinicalProfileForCategory(category).aiAnalysisProfile === "radiology";

export const supportsClinicalAi = (category: Appointment["serviceCategory"]) =>
  clinicalProfileForCategory(category).aiAnalysisProfile !== "none";
