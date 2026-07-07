export type OrthancStudy = {
  ID: string;
  MainDicomTags?: Record<string, string>;
  PatientMainDicomTags?: Record<string, string>;
};

export type UnmatchedStudy = {
  id: string;
  studyInstanceUid: string;
  patientName: string;
  patientId: string;
  date: string;
  modality: string;
  description: string;
  institution: string;
  accessionNumber: string;
};

export const dicomDate = (value = "") => /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });

export function dicomTimeRange(value = "") {
  const hour = /^\d{4}/.test(value) ? Number(value.slice(0, 2)) : 0;
  const minute = /^\d{4}/.test(value) ? Number(value.slice(2, 4)) : 0;
  if (hour >= 23 && minute >= 30) return ["23:29", "23:59"] as const;
  const start = `${String(Math.min(hour, 23)).padStart(2, "0")}:${String(Math.min(minute, 59)).padStart(2, "0")}`;
  const total = Math.min(hour, 23) * 60 + Math.min(minute, 59) + 30;
  const end = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  return [start, end] as const;
}

export function mapOrthancStudy(study: OrthancStudy): UnmatchedStudy {
  const tags = study.MainDicomTags ?? {};
  const patient = study.PatientMainDicomTags ?? {};
  return {
    id: study.ID,
    studyInstanceUid: tags.StudyInstanceUID ?? "",
    patientName: (patient.PatientName ?? "Paciente sin nombre").replaceAll("^", " ").trim(),
    patientId: patient.PatientID ?? "",
    date: dicomDate(tags.StudyDate),
    modality: (tags.ModalitiesInStudy ?? tags.Modality ?? "OT").split("\\")[0],
    description: tags.StudyDescription ?? "Estudio recibido desde PACS",
    institution: tags.InstitutionName ?? "",
    accessionNumber: tags.AccessionNumber ?? "",
  };
}
