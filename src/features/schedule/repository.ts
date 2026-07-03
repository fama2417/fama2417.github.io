import { supabase } from "@/lib/supabase-client";

export type RoomSchedule = { id: string; roomLabel: string; days: string; openTime: string; closeTime: string };
export type Holiday = { id: string; date: string; label: string };

export const WEEKDAYS = [
  { value: "1", label: "Lun" }, { value: "2", label: "Mar" }, { value: "3", label: "Mié" },
  { value: "4", label: "Jue" }, { value: "5", label: "Vie" }, { value: "6", label: "Sáb" }, { value: "7", label: "Dom" },
];

export async function fetchSchedules() {
  const { data, error } = await supabase.from("room_schedules").select("id, room_label, days, open_time, close_time").order("room_label");
  if (error) throw error;
  return data.map((row) => ({ id: row.id, roomLabel: row.room_label, days: row.days, openTime: row.open_time.slice(0, 5), closeTime: row.close_time.slice(0, 5) })) as RoomSchedule[];
}

export async function upsertSchedule(schedule: Omit<RoomSchedule, "id"> & { id?: string }) {
  const row = { room_label: schedule.roomLabel, days: schedule.days, open_time: schedule.openTime, close_time: schedule.closeTime };
  const query = schedule.id
    ? supabase.from("room_schedules").update(row).eq("id", schedule.id)
    : supabase.from("room_schedules").insert(row);
  const { error } = await query;
  if (error) throw error;
}

export async function deleteSchedule(id: string) {
  const { error } = await supabase.from("room_schedules").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchHolidays() {
  const { data, error } = await supabase.from("holidays").select("id, holiday_date, label").order("holiday_date");
  if (error) throw error;
  return data.map((row) => ({ id: row.id, date: row.holiday_date, label: row.label })) as Holiday[];
}

export async function addHoliday(date: string, label: string) {
  const { data, error } = await supabase.from("holidays").insert({ holiday_date: date, label }).select("id, holiday_date, label").single();
  if (error) throw error;
  return { id: data.id, date: data.holiday_date, label: data.label } as Holiday;
}

export async function removeHoliday(id: string) {
  const { error } = await supabase.from("holidays").delete().eq("id", id);
  if (error) throw error;
}

/** Devuelve el motivo de bloqueo si la cita queda fuera de horario o cae en feriado; vacío si es válida. */
export function scheduleError(candidate: { date: string; startTime: string; endTime: string; locationName: string }, schedules: RoomSchedule[], holidays: Holiday[]) {
  const holiday = holidays.find((item) => item.date === candidate.date);
  if (holiday) return `La fecha corresponde a un feriado${holiday.label ? ` (${holiday.label})` : ""}.`;
  const schedule = schedules.find((item) => item.roomLabel === candidate.locationName);
  if (!schedule) return "";
  const weekday = String(((new Date(`${candidate.date}T12:00:00`).getDay() + 6) % 7) + 1);
  if (!schedule.days.split(",").includes(weekday)) return "La sala no atiende ese día de la semana.";
  if (candidate.startTime < schedule.openTime || candidate.endTime > schedule.closeTime) return `La sala atiende de ${schedule.openTime} a ${schedule.closeTime}.`;
  return "";
}
