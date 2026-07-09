"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase-client";
import { codeHref } from "./coding";

type Match = { code: string; display: string };

export async function searchTerminology(system: string, term: string): Promise<Match[]> {
  const { data, error } = await supabase.rpc("search_terminology", { p_system: system, p_term: term.trim() });
  if (error) return [];
  return (data ?? []) as Match[];
}

/** Código + nombre estándar con typeahead sobre el catálogo local de terminologías.
 *  Si el catálogo del sistema no está cargado, funciona como entrada manual (sin dropdown). */
export function CodePicker({ system, code, display, disabled, onChange }: {
  system: string; code: string; display: string; disabled?: boolean;
  onChange: (code: string, display: string) => void;
}) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(null);

  function query(term: string) {
    if (timer.current) clearTimeout(timer.current);
    if (term.trim().length < 2 || system === "LOCAL") { setMatches([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      const found = await searchTerminology(system, term);
      setMatches(found); setOpen(found.length > 0);
    }, 250);
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  // Al cambiar de sistema, el dropdown anterior deja de tener sentido.
  useEffect(() => { setMatches([]); setOpen(false); }, [system]);

  const href = codeHref(system, code);
  return (
    <>
      <label className="patient-search">Código
        <input value={code} disabled={disabled} placeholder="Ej: R10.4" onChange={(e) => { onChange(e.target.value, display); query(e.target.value); }} onBlur={() => setTimeout(() => setOpen(false), 200)} />
        {open && <span className="patient-search-results">{matches.map((m) => <button type="button" key={m.code} onClick={() => { onChange(m.code, m.display); setOpen(false); }}><strong>{m.code}</strong><small>{m.display}</small></button>)}</span>}
      </label>
      <label className="patient-search">Nombre estándar{href && <a className="coding-link" href={href} target="_blank" rel="noreferrer">Ver código oficial ↗</a>}
        <input value={display} disabled={disabled} placeholder="Ej: Dolor abdominal" onChange={(e) => { onChange(code, e.target.value); query(e.target.value); }} onBlur={() => setTimeout(() => setOpen(false), 200)} />
      </label>
    </>
  );
}
