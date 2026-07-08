"use client";

import { FormEvent, useEffect, useState } from "react";
import { DICOM_MODALITIES } from "@/features/scheduling/modalities";
import { reportProfiles } from "./profiles";
import { createTemplate, fetchTemplates, updateTemplate, type ReportTemplate } from "./templates";

const categoryOptions = Object.entries(reportProfiles) as [ReportTemplate["category"], { title: string }][];
const emptyTemplate: Omit<ReportTemplate, "id"> = { name: "", category: "imaging", modality: "US", technique: "", comparison: "Sin estudios previos disponibles.", findings: "", impression: "", active: true };

export function TemplatesManager() {
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [draft, setDraft] = useState<(ReportTemplate | (Omit<ReportTemplate, "id"> & { id?: string })) | null>(null);
  const [error, setError] = useState("");
  const [allowed, setAllowed] = useState(true);

  useEffect(() => { fetchTemplates().then(setTemplates).catch(() => setAllowed(false)); }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const payload = { ...draft, modality: draft.category === "imaging" ? draft.modality : "OT" };
    setError("");
    try {
      if (payload.id) {
        await updateTemplate(payload as ReportTemplate);
        setTemplates((current) => current.map((item) => item.id === payload.id ? (payload as ReportTemplate) : item));
      } else {
        const created = await createTemplate(payload);
        setTemplates((current) => [...current, created]);
      }
      setDraft(null);
    } catch {
      setError("No fue posible guardar la plantilla (perfil radiología/admin y nombre único por tipo).");
    }
  }

  if (!allowed) return null;

  return (
    <section className="card" aria-label="Plantillas de informe">
      <div className="card-heading"><h3>Plantillas de informe</h3><button className="button primary" type="button" onClick={() => setDraft(draft ? null : { ...emptyTemplate })}>{draft ? "Cerrar" : "Nueva plantilla"}</button></div>
      <p>Precargan secciones del reporte según tipo de atención y modalidad cuando aplica.</p>
      {error && <p className="form-error" role="alert">{error}</p>}

      {draft && (
        <form className="clinical-form" onSubmit={save}>
          <label>Nombre<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required placeholder="Ej: Ecografía abdominal normal" /></label>
          <label>Tipo<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as ReportTemplate["category"], modality: event.target.value === "imaging" ? draft.modality || "US" : "OT" })}>{categoryOptions.map(([value, profile]) => <option key={value} value={value}>{profile.title}</option>)}</select></label>
          <label>Modalidad<select value={draft.modality} onChange={(event) => setDraft({ ...draft, modality: event.target.value })} disabled={draft.category !== "imaging"}><option value="OT">No aplica</option>{DICOM_MODALITIES.map(([code, label]) => <option key={code} value={code}>{code} · {label}</option>)}</select></label>
          <label className="span-2">Técnica / sección 2<input value={draft.technique} onChange={(event) => setDraft({ ...draft, technique: event.target.value })} /></label>
          <label className="span-2">Comparación / sección 3<input value={draft.comparison} onChange={(event) => setDraft({ ...draft, comparison: event.target.value })} /></label>
          <label className="span-2">Hallazgos / resultados<textarea value={draft.findings} onChange={(event) => setDraft({ ...draft, findings: event.target.value })} /></label>
          <label className="span-2">Impresión / conclusión<textarea value={draft.impression} onChange={(event) => setDraft({ ...draft, impression: event.target.value })} /></label>
          <button className="button primary" type="submit">Guardar plantilla</button>
        </form>
      )}

      <ul className="catalog-list">
        {templates.map((template) => (
          <li key={template.id} className={template.active ? "" : "inactive"}>
            <span><code>{template.category === "imaging" ? template.modality : "OT"}</code> {reportProfiles[template.category].title} · {template.name}</span>
            <span>
              <button className="text-button" type="button" onClick={() => setDraft(template)}>Editar</button>
              <button className="text-button" type="button" onClick={async () => { const next = { ...template, active: !template.active }; await updateTemplate(next); setTemplates((current) => current.map((item) => item.id === template.id ? next : item)); }}>{template.active ? "Desactivar" : "Activar"}</button>
            </span>
          </li>
        ))}
        {!templates.length && <li className="inactive"><span>Sin plantillas. Crea la primera.</span></li>}
      </ul>
    </section>
  );
}
