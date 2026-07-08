import type { RoomSchedule } from "./repository";

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

type Booked = { id: string; date: string; locationName: string; practitionerName?: string; startTime: string; endTime: string; status: string };

/** Bloques libres de una sala para una fecha, paso = duración de la prestación (min). Sala sin horario: 08:00–18:00. */
export function availableSlots(
  date: string,
  roomLabel: string,
  durationMin: number,
  schedules: RoomSchedule[],
  appointments: Booked[],
  options: { excludeId?: string; nowMin?: number; practitionerName?: string } = {},
): { start: string; end: string }[] {
  if (!roomLabel || !durationMin || durationMin <= 0) return [];
  const resourceSchedule = schedules.find((item) => item.targetKind === "resource" && item.roomLabel === roomLabel);
  const practitionerSchedule = schedules.find((item) => item.targetKind === "practitioner" && item.roomLabel === options.practitionerName);
  const weekday = String(((new Date(`${date}T12:00:00`).getDay() + 6) % 7) + 1);
  if ([resourceSchedule, practitionerSchedule].some((item) => item && !item.days.split(",").includes(weekday))) return [];
  const open = Math.max(toMin(resourceSchedule?.openTime ?? "08:00"), toMin(practitionerSchedule?.openTime ?? "08:00"));
  const close = Math.min(toMin(resourceSchedule?.closeTime ?? "18:00"), toMin(practitionerSchedule?.closeTime ?? "18:00"));
  const taken = appointments.filter((item) => item.date === date && (item.locationName === roomLabel || Boolean(options.practitionerName && item.practitionerName === options.practitionerName)) && item.status !== "cancelled" && item.id !== options.excludeId);
  const slots: { start: string; end: string }[] = [];
  for (let m = open; m + durationMin <= close; m += durationMin) {
    if (options.nowMin !== undefined && m < options.nowMin) continue;
    const start = toTime(m), end = toTime(m + durationMin);
    if (!taken.some((item) => item.startTime < end && start < item.endTime)) slots.push({ start, end });
  }
  return slots;
}
