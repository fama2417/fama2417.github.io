import type { AppointmentStatus } from "./status";

export type Appointment = {
  id: string;
  patientId: string;
  patientName: string;
  practitionerName: string;
  locationName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  reason: string;
  modality: string;
  studyInstanceUid?: string;
  orthancStudyId?: string;
  branch: string;
  service: string;
  serviceTypeId?: string;
  serviceCategory: "consultation" | "imaging" | "laboratory" | "pathology" | "procedure";
  practitionerRequirement: "none" | "optional" | "required";
  specialty: string;
  procedureCode: string;
  treatingPhysician: string;
  orderDate: string;
  anesthesia: boolean;
  contrast: boolean;
  priority: "normal" | "urgente";
  paymentOrder: string;
  tags: string;
  anamnesis: string;
  diagnosticHypothesis: string;
  reasonCodeSystem: string;
  reasonCode: string;
  reasonCodeDisplay: string;
  comment: string;
  requesterType: "interno" | "externo";
  requesterName: string;
  requesterRun: string;
  requesterEmail: string;
  pickupName: string;
  pickupRun: string;
  pickupPhone: string;
  originType: "interna" | "externa";
  originDesc: string;
  statusReason: string;
  orderFile: string;
  reportStatus?: "draft" | "final";
  criticalFinding?: boolean;
  actionablePending?: boolean;
  assignedTo?: string;
  assigneeName?: string;
  patientIdentifier?: string;
  patientPrevision?: string;
  standardCodeSystem?: string;
  standardCode?: string;
  standardDisplay?: string;
};

export const emptyClinicalDetail = {
  branch: "",
  service: "", serviceCategory: "procedure" as const, practitionerRequirement: "optional" as const, specialty: "", procedureCode: "", treatingPhysician: "", orderDate: "",
  anesthesia: false, contrast: false, priority: "normal" as const, paymentOrder: "", tags: "", anamnesis: "", diagnosticHypothesis: "",
  reasonCodeSystem: "ICD-10", reasonCode: "", reasonCodeDisplay: "", comment: "",
  requesterType: "interno" as const, requesterName: "", requesterRun: "", requesterEmail: "",
  pickupName: "", pickupRun: "", pickupPhone: "",
  originType: "interna" as const, originDesc: "", statusReason: "", orderFile: "",
};

export const initialAppointments: Appointment[] = [
  {
    id: "apt-001",
    ...emptyClinicalDetail,
    patientId: "pat-001",
    patientName: "Paciente de prueba 01",
    practitionerName: "Dra. Imagenología",
    locationName: "Box 1",
    date: "2026-07-02",
    startTime: "09:00",
    endTime: "09:30",
    status: "confirmed",
    reason: "Ecografía abdominal",
    modality: "US",
  },
  {
    id: "apt-002",
    ...emptyClinicalDetail,
    patientId: "pat-002",
    patientName: "Paciente de prueba 02",
    practitionerName: "Dr. Radiología",
    locationName: "Sala RX",
    date: "2026-07-02",
    startTime: "10:00",
    endTime: "10:20",
    status: "scheduled",
    reason: "Radiografía de tórax",
    modality: "DX",
  },
  {
    id: "apt-003",
    ...emptyClinicalDetail,
    patientId: "pat-003",
    patientName: "Paciente de prueba 03",
    practitionerName: "Dra. Imagenología",
    locationName: "Box 2",
    date: "2026-07-02",
    startTime: "11:00",
    endTime: "11:45",
    status: "arrived",
    reason: "Control con imágenes previas",
    modality: "US",
  },
];
