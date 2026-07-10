export type ClinicalDocumentProfile = {
  id: "radiology" | "consultation" | "pathology" | "endoscopy" | "laboratory" | "procedure";
  resourceType: "radiology_report" | "medical_consultation" | "pathology_report" | "endoscopy_report" | "laboratory_report" | "procedure_note";
  label: string;
  sections: string[];
  layoutMode: "editor_viewer" | "editor_only" | "editor_attachments";
  viewerMode: "dicom" | "attachments" | "none";
  aiAnalysisProfile: "radiology" | "consultation" | "pathology" | "endoscopy" | "generic_clinical_note" | "none";
  availableActions: string[];
};

export const clinicalDocumentProfiles: Record<ClinicalDocumentProfile["id"], ClinicalDocumentProfile> = {
  radiology: {
    id: "radiology", resourceType: "radiology_report", label: "Informe radiológico",
    sections: ["clinicalIndication", "technique", "comparison", "findings", "impression"],
    layoutMode: "editor_viewer", viewerMode: "dicom", aiAnalysisProfile: "radiology",
    availableActions: ["save", "sign", "print", "fullscreen"],
  },
  consultation: {
    id: "consultation", resourceType: "medical_consultation", label: "Consulta médica",
    sections: ["reason", "history", "physicalExam", "assessment", "plan"],
    layoutMode: "editor_only", viewerMode: "none", aiAnalysisProfile: "consultation",
    availableActions: ["save", "sign", "print"],
  },
  pathology: {
    id: "pathology", resourceType: "pathology_report", label: "Anatomía patológica",
    sections: ["specimen", "macroscopy", "microscopy", "diagnosis"],
    layoutMode: "editor_attachments", viewerMode: "attachments", aiAnalysisProfile: "pathology",
    availableActions: ["save", "sign", "print"],
  },
  endoscopy: {
    id: "endoscopy", resourceType: "endoscopy_report", label: "Endoscopia",
    sections: ["indication", "preparation", "sedation", "findings", "intervention", "impression", "recommendations"],
    layoutMode: "editor_attachments", viewerMode: "attachments", aiAnalysisProfile: "endoscopy",
    availableActions: ["save", "sign", "print"],
  },
  laboratory: {
    id: "laboratory", resourceType: "laboratory_report", label: "Informe de laboratorio",
    sections: ["request", "sample", "results", "interpretation"],
    layoutMode: "editor_only", viewerMode: "none", aiAnalysisProfile: "none",
    availableActions: ["save", "sign", "print"],
  },
  procedure: {
    id: "procedure", resourceType: "procedure_note", label: "Nota de procedimiento",
    sections: ["indication", "technique", "incidents", "findings", "plan"],
    layoutMode: "editor_attachments", viewerMode: "attachments", aiAnalysisProfile: "generic_clinical_note",
    availableActions: ["save", "sign", "print"],
  },
};

export const clinicalProfileForCategory = (category: "imaging" | "laboratory" | "pathology" | "consultation" | "procedure") => ({
  imaging: clinicalDocumentProfiles.radiology,
  laboratory: clinicalDocumentProfiles.laboratory,
  pathology: clinicalDocumentProfiles.pathology,
  consultation: clinicalDocumentProfiles.consultation,
  procedure: clinicalDocumentProfiles.procedure,
})[category];
