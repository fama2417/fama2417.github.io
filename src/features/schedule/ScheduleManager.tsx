"use client";

import { FormEvent, useEffect, useState } from "react";
import { fetchResources } from "@/features/scheduling/repository";
import { addHoliday, deleteSchedule, fetchHolidays, fetchSchedules, removeHoliday, upsertSchedule, WEEKDAYS, type Holiday, type RoomSchedule } from "./repository";

const emptySchedule = { roomLabel: "", days: "1,2,3,4,5", openTime: "08:00", closeTime: "18:00" };

export function ScheduleManager() {
  const [schedules, setSchedules] = useState<RoomSchedule[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [rooms, setRooms] = useState<string[]>([]);
  const [draft, setDraft] = useState<(Omit<RoomSchedule, "id"> & { id?: string }) | null>(null);
  const [error, setError] = useState("");
  const [allowed, setAllowed] = useState(true);

  useEffect(() => {
    Promise.all([fetchSchedules(), fetchHolidays(), fetchResources()]).then(([nextSchedules, nextHolidays, resources]) => {
      setSchedules(nextSchedules);
      setHolidays(nextHolidays);
      setRooms(resources.filter((item) => item.active && ["location", "device", "composite"].includes(item.kind)).map((item) => item.name));
    }).catch(() => setAllowed(false));
  }, []);

  async function saveSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !draft.roomLabel) return;
    setError("");
    try {
      await upsertSchedule(draft);
      setSchedules(await fetchSchedules());
      setDraft(null);
    } catch {
      setError("No fue posible guardar el horario (una regla por sala).");
    }
  }

  async function saveHoliday(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setError("");
    try {
      const holiday = await addHoliday(String(form.get("date")), String(form.get("label")).trim());
      setHolidays((current) => [...current, holiday].sort((a, b) => a.date.localeCompare(b.date)));
      formElement.reset();
    } catch {
      setError("No fue posible agregar el feriado (fecha única).");
    }
  }

  function toggleDay(value: string) {
    setDraft((current) => {
      if (!current) return current;
      const days = current.days ? current.days.split(",") : [];
      const next = days.includes(value) ? days.filter((day) => day !== value) : [...days, value].sort();
      return { ...current, days: next.join(",") };
    });
  }

  if (!allowed) return null;
  const dayNames = (days: string) => WEEKDAYS.filter((day) => days.split(",").includes(day.value)).map((day) => day.label).join(" · ");

  return (
    <section className="card" aria-label="Horarios y feriados">
      <div className="card-heading"><h3>Horarios y feriados</h3><button className="button primary" type="button" onClick={() => setDraft(draft ? null : { ...emptySchedule })}>{draft ? "Cerrar" : "Nuevo horario"}</button></div>
      <p>Las salas sin regla atienden sin restricción. La agenda bloquea reservas fuera de horario o en feriados.</p>
      {error && <p className="form-error" role="alert">{error}</p>}

      {draft && (
        <form className="clinical-form" onSubmit={saveSchedule}>
          <label>Sala / equipo<select required value={draft.roomLabel} onChange={(event) => setDraft((current) => current ? { ...current, roomLabel: event.target.value } : current)} disabled={Boolean(draft.id)}><option value="">Seleccionar…</option>{rooms.map((room) => <option key={room} value={room}>{room}</option>)}</select></label>
          <label>Abre<input type="time" value={draft.openTime} onChange={(event) => setDraft((current) => current ? { ...current, openTime: event.target.value } : current)} /></label>
          <label>Cierra<input type="time" value={draft.closeTime} onChange={(event) => setDraft((current) => current ? { ...current, closeTime: event.target.value } : current)} /></label>
          <div className="booking-tags"><span>Días de atención</span><div>{WEEKDAYS.map((day) => <button key={day.value} type="button" className={`tag ${draft.days.split(",").includes(day.value) ? "active" : ""}`} onClick={() => toggleDay(day.value)}>{day.label}</button>)}</div></div>
          <button className="button primary" type="submit">Guardar horario</button>
        </form>
      )}

      <ul className="catalog-list">
        {schedules.map((schedule) => (
          <li key={schedule.id}>
            <span><strong>{schedule.roomLabel}</strong> · {schedule.openTime}–{schedule.closeTime} · {dayNames(schedule.days)}</span>
            <span>
              <button className="text-button" type="button" onClick={() => setDraft(schedule)}>Editar</button>
              <button className="text-button" type="button" onClick={async () => { await deleteSchedule(schedule.id); setSchedules((current) => current.filter((item) => item.id !== schedule.id)); }}>Quitar</button>
            </span>
          </li>
        ))}
        {!schedules.length && <li className="inactive"><span>Sin horarios definidos: todas las salas atienden sin restricción.</span></li>}
      </ul>

      <form className="catalog-form" onSubmit={saveHoliday} style={{ marginTop: 16 }}>
        <label>Feriado<input name="date" type="date" required /></label>
        <label>Descripción<input name="label" placeholder="Ej: Fiestas Patrias" /></label>
        <button className="button secondary" type="submit">Agregar feriado</button>
      </form>
      <ul className="catalog-list">
        {holidays.map((holiday) => <li key={holiday.id}><span>{holiday.date} {holiday.label && `· ${holiday.label}`}</span><button className="text-button" type="button" onClick={async () => { await removeHoliday(holiday.id); setHolidays((current) => current.filter((item) => item.id !== holiday.id)); }}>Quitar</button></li>)}
      </ul>
    </section>
  );
}
