import type { Appointment } from "./mock-data";

const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
  aStart < bEnd && bStart < aEnd;

export function appointmentError(candidate: Appointment, appointments: Appointment[]) {
  if (candidate.endTime <= candidate.startTime) return "La hora de término debe ser posterior al inicio.";

  const conflict = appointments.some(
    (item) =>
      item.id !== candidate.id &&
      item.date === candidate.date &&
      item.locationName === candidate.locationName &&
      item.status !== "cancelled" &&
      overlaps(candidate.startTime, candidate.endTime, item.startTime, item.endTime),
  );

  return conflict ? "Ese equipo o box ya tiene una cita en ese horario." : "";
}
