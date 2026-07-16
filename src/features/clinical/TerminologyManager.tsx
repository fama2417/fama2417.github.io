"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-client";
import { codeColumns, loincDesignationImportRow, loincImportRow, parseDelimited } from "./csv";

const SYSTEMS = [
  ["ICD-10", "CIE-10", "CSV con columnas código y descripción (DEIS/eCIEMaps)."],
  ["ICD-11", "CIE-11", "CSV exportado de la tabulación simple MMS de la OMS."],
  ["LOINC", "LOINC", "Loinc.csv del paquete oficial (usa LOINC_NUM y LONG_COMMON_NAME)."],
  ["LOINC-ES", "LOINC en español", "Archivo esES, esMX o esAR LinguisticVariant.csv del mismo paquete oficial."],
  ["SNOMEDCT", "SNOMED CT", "Archivo de descripciones RF2 (TSV; usa conceptId y term)."],
] as const;

const BATCH = 2000;

export function TerminologyManager() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [system, setSystem] = useState<string>("ICD-10");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(false);

  async function reloadCounts() {
    const next: Record<string, number> = {};
    for (const [sys] of SYSTEMS) {
      const { count } = sys === "LOINC-ES"
        ? await supabase.from("terminology_designations").select("code", { count: "exact", head: true }).eq("system", "LOINC")
        : await supabase.from("terminology_codes").select("code", { count: "exact", head: true }).eq("system", sys);
      next[sys] = count ?? 0;
    }
    setCounts(next);
  }
  useEffect(() => {
    // Visible solo para el superadmin de plataforma (mismo gate que la RPC de importación).
    supabase.auth.getUser()
      .then(({ data }) => supabase.from("profiles").select("platform").eq("id", data.user?.id ?? "").single())
      .then(({ data }) => {
        if ((data as { platform?: boolean } | null)?.platform) { setVisible(true); reloadCounts(); }
      })
      .catch(() => setVisible(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function importFile(file: File) {
    setError(""); setProgress("Leyendo archivo…");
    try {
      const text = await file.text();
      const rows = parseDelimited(text);
      if (rows.length < 2) throw new Error("El archivo no tiene filas de datos.");
      const { code, display } = codeColumns(rows[0]);
      const items = rows.slice(1)
        .map((row) => system === "LOINC" ? loincImportRow(rows[0], row)
          : system === "LOINC-ES" ? loincDesignationImportRow(rows[0], row, file.name)
          : ({ code: (row[code] ?? "").trim(), display: (row[display] ?? "").trim() }))
        .filter((item) => item.code && item.display);
      if (!items.length) throw new Error("No se reconocieron columnas de código y descripción.");
      let done = 0;
      for (let i = 0; i < items.length; i += BATCH) {
        const { error: rpcError } = system === "LOINC"
          ? await supabase.rpc("import_loinc_terminology", { p_rows: items.slice(i, i + BATCH) })
          : system === "LOINC-ES"
            ? await supabase.rpc("import_loinc_designations", { p_rows: items.slice(i, i + BATCH) })
            : await supabase.rpc("import_terminology", { p_system: system, p_rows: items.slice(i, i + BATCH) });
        if (rpcError) throw new Error(rpcError.message);
        done = Math.min(i + BATCH, items.length);
        setProgress(`Importando ${system}: ${done.toLocaleString()} / ${items.length.toLocaleString()}…`);
      }
      setProgress(`Listo: ${done.toLocaleString()} códigos de ${system} cargados.`);
      reloadCounts();
    } catch (cause) {
      setProgress("");
      setError(cause instanceof Error ? cause.message : "No fue posible importar el archivo.");
    }
  }

  if (!visible) return null;
  return (
    <section className="card" aria-label="Terminologías clínicas">
      <div className="card-heading"><h3>Terminologías clínicas</h3><span className="phase-state">Global</span></div>
      <p>Catálogos estándar para el typeahead de códigos (diagnóstico de la cita, informe y prestaciones). Se cargan una vez y sirven a todas las instituciones.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {progress && <p className="form-notice" role="status">{progress}</p>}
      <div className="catalog-form">
        <label>Sistema<select value={system} onChange={(e) => setSystem(e.target.value)}>{SYSTEMS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Archivo (CSV/TSV)<input type="file" accept=".csv,.tsv,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} /></label>
      </div>
      <p className="empty-inline">{SYSTEMS.find(([value]) => value === system)?.[2]}</p>
      <ul className="catalog-list">
        {SYSTEMS.map(([value, label]) => <li key={value} className={counts[value] ? "" : "inactive"}><span><strong>{label}</strong> · {counts[value]?.toLocaleString() ?? 0} códigos</span></li>)}
      </ul>
    </section>
  );
}
