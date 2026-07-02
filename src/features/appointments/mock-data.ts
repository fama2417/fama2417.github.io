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
  modality: "US" | "DX" | "CT" | "MR" | "MG";
};

export const initialAppointments: Appointment[] = [
  {
    id: "apt-001",
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
