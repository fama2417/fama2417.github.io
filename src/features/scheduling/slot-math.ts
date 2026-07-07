// Lógica pura del agendamiento (sin Supabase) para poder testearla.

// ponytail: horarios de slot como wall-clock; suma en minutos con envoltura a 24h.
export const addMinutes = (hhmm: string, min: number) => {
  const t = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) + min;
  return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

/** Horas de inicio libres en TODOS los miembros (disponibilidad de un recurso compuesto). */
export function commonStarts(perMember: string[][]): Set<string> {
  if (!perMember.length) return new Set();
  const [first, ...rest] = perMember;
  return new Set(first.filter((start) => rest.every((member) => member.includes(start))));
}

export type SlotLite = { id: string; startsAt: string; endsAt: string };
const mins = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 60000;

/** Cupos consecutivos y contiguos, empezando en `startsAt`, que cubren `durationMin`.
 *  Devuelve los ids a ocupar, o null si hay un hueco o no alcanzan. `slots` va ordenado por inicio.
 *  Así un equipo con grilla base (ej. 15′) atiende prestaciones de distinta duración: una de 60′
 *  consume 4 cupos; una de 30′, 2. */
export function runCovering(slots: SlotLite[], startsAt: string, durationMin: number): string[] | null {
  const start = slots.findIndex((s) => s.startsAt === startsAt);
  if (start < 0) return null;
  const ids: string[] = [];
  let covered = 0;
  for (let i = start; i < slots.length && covered < durationMin; i++) {
    if (i > start && slots[i].startsAt !== slots[i - 1].endsAt) return null; // hueco: no es contiguo
    ids.push(slots[i].id);
    covered += mins(slots[i].startsAt, slots[i].endsAt);
  }
  return covered >= durationMin ? ids : null;
}

/** Inicios donde una prestación de `durationMin` cabe en cupos libres consecutivos. */
export const startsFittingDuration = (slots: SlotLite[], durationMin: number) =>
  slots.filter((s) => runCovering(slots, s.startsAt, durationMin) !== null);
