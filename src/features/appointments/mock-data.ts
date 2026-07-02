import type { AppointmentStatus } from "./status";

export type Appointment = {
  id: string;
  patientName: string;
  practitionerName: string;
  locationName: string;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  reason: string;
};

export const todayAppointments: Appointment[] = [
  {
    id: "apt-001",
    patientName: "Paciente de prueba 01",
    practitionerName: "Dra. Imagenología",
    locationName: "Box 1",
    startTime: "09:00",
    endTime: "09:30",
    status: "confirmed",
    reason: "Ecografía abdominal",
  },
  {
    id: "apt-002",
    patientName: "Paciente de prueba 02",
    practitionerName: "Dr. Radiología",
    locationName: "Sala RX",
    startTime: "10:00",
    endTime: "10:20",
    status: "scheduled",
    reason: "Radiografía de tórax",
  },
  {
    id: "apt-003",
    patientName: "Paciente de prueba 03",
    practitionerName: "Dra. Imagenología",
    locationName: "Box 2",
    startTime: "11:00",
    endTime: "11:45",
    status: "arrived",
    reason: "Control con imágenes previas",
  },
];
