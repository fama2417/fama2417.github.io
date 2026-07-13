"use client";

import { FormEvent, useEffect, useState } from "react";
import { clinicalDocumentProfiles, clinicalProfileForCategory, type ReportSectionName } from "@/features/clinical-workspace/profiles";
import { DICOM_MODALITIES } from "@/features/scheduling/modalities";
import { createTemplate, fetchTemplates, updateTemplate, type ReportTemplate } from "./templates";

const categoryOptions = Object.entries(clinicalDocumentProfiles) as [ReportTemplate["category"], { title: string }][];
const templateFields = ["technique", "comparison", "findings", "impression"] as const satisfies readonly ReportSectionName[];
const emptyTemplate: Omit<ReportTemplate, "id"> = { name: "", category: "imaging", modality: "US", technique: "", comparison: "", findings: "", impression: "", active: true };

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
      setError("No fue posible guardar la plantilla. Verifica tus permisos y que el nombre sea único para ese tipo.");
    }
  }

  if (!allowed) return null;

  return (
    <section className="card" aria-label="Plantillas de documentos clínicos">
      <div className="card-heading"><h3>Plantillas de documentos clínicos</h3><button className="button primary" type="button" onClick={() => setDraft(draft ? null : { ...emptyTemplate })}>{draft ? "Cerrar" : "Nueva plantilla"}</button></div>
      <p>Precargan las secciones con los nombres propios de cada tipo de atención.</p>
      {error && <p className="form-error" role="alert">{error}</p>}

      {draft && (
        <form className="clinical-form" onSubmit={save}>
          <label>Nombre<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required placeholder="Ej.: Control normal" /></label>
          <label>Tipo<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as ReportTemplate["category"], modality: event.target.value === "imaging" ? draft.modality || "US" : "OT" })}>{categoryOptions.map(([value, profile]) => <option key={value} value={value}>{profile.title}</option>)}</select></label>
          <label>Modalidad<select value={draft.modality} onChange={(event) => setDraft({ ...draft, modality: event.target.value })} disabled={draft.category !== "imaging"}><option value="OT">No aplica</option>{DICOM_MODALITIES.map(([code, label]) => <option key={code} value={code}>{code} · {label}</option>)}</select></label>
          {templateFields.map((name) => { const section = clinicalProfileForCategory(draft.category).sections.find((item) => item.name === name); return (
            <label className="span-2" key={name}>{section?.label ?? name}
              {name === "findings" || name === "impression"
                ? <textarea value={draft[name]} placeholder={section?.hint} onChange={(event) => setDraft({ ...draft, [name]: event.target.value })} />
                : <input value={draft[name]} placeholder={section?.hint} onChange={(event) => setDraft({ ...draft, [name]: event.target.value })} />}
            </label>
          ); })}
          <button className="button primary" type="submit">Guardar plantilla</button>
        </form>
      )}

      <ul className="catalog-list">
        {templates.map((template) => (
          <li key={template.id} className={template.active ? "" : "inactive"}>
            <span>{template.category === "imaging" && <code>{template.modality}</code>} {clinicalProfileForCategory(template.category).title} · {template.name}</span>
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
