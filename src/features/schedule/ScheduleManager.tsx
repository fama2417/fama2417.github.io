"use client";

import { FormEvent, useEffect, useState } from "react";
import { activeOptions, fetchCatalog } from "@/features/catalog/repository";
import { fetchResources } from "@/features/scheduling/repository";
import { addHoliday, deleteSchedule, fetchHolidays, fetchSchedules, removeHoliday, upsertSchedule, WEEKDAYS, type Holiday, type RoomSchedule } from "./repository";

const emptySchedule = { roomLabel: "", targetKind: "resource" as const, days: "1,2,3,4,5", openTime: "08:00", closeTime: "18:00" };

export function ScheduleManager() {
  const [schedules, setSchedules] = useState<RoomSchedule[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [targets, setTargets] = useState<{ kind: "resource" | "practitioner"; name: string }[]>([]);
  const [draft, setDraft] = useState<(Omit<RoomSchedule, "id"> & { id?: string }) | null>(null);
  const [error, setError] = useState("");
  const [allowed, setAllowed] = useState(true);

  useEffect(() => {
    Promise.all([fetchSchedules(), fetchHolidays(), fetchResources(), fetchCatalog()]).then(([nextSchedules, nextHolidays, resources, catalog]) => {
      setSchedules(nextSchedules);
      setHolidays(nextHolidays);
      setTargets([
        ...resources.filter((item) => item.active && ["location", "device", "composite"].includes(item.kind)).map((item) => ({ kind: "resource" as const, name: item.name })),
        ...activeOptions(catalog, "profesional").map((item) => ({ kind: "practitioner" as const, name: item.label })),
      ]);
    }).catch(() => setAllowed(false));
  }, []);

  useEffect(() => {
    const openTarget = (event: Event) => {
      const { kind, name } = (event as CustomEvent<{ kind: "resource" | "practitioner"; name: string }>).detail;
      setDraft({ ...emptySchedule, targetKind: kind, roomLabel: name });
      requestAnimationFrame(() => document.querySelector("#horarios")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    };
    window.addEventListener("schedule-target", openTarget);
    return () => window.removeEventListener("schedule-target", openTarget);
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
    <section className="card" id="horarios" aria-label="Horarios y feriados">
      <div className="card-heading"><h3>Horarios y feriados</h3><button className="button primary" type="button" onClick={() => setDraft(draft ? null : { ...emptySchedule })}>{draft ? "Cerrar" : "Nuevo horario"}</button></div>
      <p>Define la jornada semanal de cada sala, equipo o profesional. Ejemplo: lunes a viernes, 08:00–17:00.</p>
      {error && <p className="form-error" role="alert">{error}</p>}

      {draft && (
        <form className="clinical-form" onSubmit={saveSchedule}>
          <label>Agenda de<select required value={draft.roomLabel ? `${draft.targetKind}|${draft.roomLabel}` : ""} onChange={(event) => { const [targetKind, roomLabel] = event.target.value.split("|"); setDraft((current) => current ? { ...current, targetKind: targetKind as RoomSchedule["targetKind"], roomLabel } : current); }} disabled={Boolean(draft.id)}><option value="">Seleccionar…</option><optgroup label="Salas y equipos">{targets.filter((item) => item.kind === "resource").map((item) => <option key={`r-${item.name}`} value={`resource|${item.name}`}>{item.name}</option>)}</optgroup><optgroup label="Profesionales">{targets.filter((item) => item.kind === "practitioner").map((item) => <option key={`p-${item.name}`} value={`practitioner|${item.name}`}>{item.name}</option>)}</optgroup></select></label>
          <label>Abre<input type="time" value={draft.openTime} onChange={(event) => setDraft((current) => current ? { ...current, openTime: event.target.value } : current)} /></label>
          <label>Cierra<input type="time" value={draft.closeTime} onChange={(event) => setDraft((current) => current ? { ...current, closeTime: event.target.value } : current)} /></label>
          <div className="booking-tags"><span>Días de atención</span><div>{WEEKDAYS.map((day) => <button key={day.value} type="button" className={`tag ${draft.days.split(",").includes(day.value) ? "active" : ""}`} onClick={() => toggleDay(day.value)}>{day.label}</button>)}</div></div>
          <button className="button primary" type="submit">Guardar horario</button>
        </form>
      )}

      <ul className="catalog-list">
        {schedules.map((schedule) => (
          <li key={schedule.id}>
            <span><strong>{schedule.roomLabel}</strong> <small>{schedule.targetKind === "practitioner" ? "Profesional" : "Recurso"}</small> · {schedule.openTime}–{schedule.closeTime} · {dayNames(schedule.days)}</span>
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
