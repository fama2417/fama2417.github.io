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
