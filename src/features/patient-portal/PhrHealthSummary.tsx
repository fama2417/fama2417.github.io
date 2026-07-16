"use client";

import { useState } from "react";
import { healthItemKindLabels, healthItemKinds, healthItemStatusLabels, validatePhrHealthItem, type PhrHealthItem, type PhrHealthItemDraft } from "./health-summary";
import { deletePhrHealthItem, downloadFhirBundle, downloadPhrFile, savePhrHealthItem, type PhrProfile, type PortalDocument } from "./repository";

const emptyDraft = (): PhrHealthItemDraft => ({ kind: "condition", label: "", status: "active", eventDate: "", source: "patient", sourceDocumentId: "", notes: "" });

export function PhrHealthSummary({ profile, items, documents, readOnly, onChanged }: { profile: PhrProfile; items: PhrHealthItem[]; documents: PortalDocument[]; readOnly: boolean; onChanged: () => Promise<void> }) {
  const [draft, setDraft] = useState<PhrHealthItemDraft>(emptyDraft), [editingId, setEditingId] = useState(""), [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const change = (patch: Partial<PhrHealthItemDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const edit = (item?: PhrHealthItem) => { setDraft(item ? { kind: item.kind, label: item.label, status: item.status, eventDate: item.eventDate, source: item.source, sourceDocumentId: item.sourceDocumentId, notes: item.notes } : emptyDraft()); setEditingId(item?.id ?? ""); setOpen(true); setError(""); setNotice(""); };
  async function save() {
    const validated = validatePhrHealthItem(draft); if ("error" in validated) { setError(validated.error); return; }
    setBusy(true); setError("");
    try { await savePhrHealthItem(validated.value, editingId || undefined); await onChanged(); setOpen(false); setNotice(editingId ? "Antecedente actualizado." : "Antecedente agregado."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible guardar el antecedente."); }
    finally { setBusy(false); }
  }
  async function remove(item: PhrHealthItem) {
    if (!window.confirm(`¿Eliminar «${item.label}» del resumen?`)) return;
    setBusy(true); setError("");
    try { await deletePhrHealthItem(item.id); await onChanged(); setNotice("Antecedente eliminado."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible eliminar el antecedente."); }
    finally { setBusy(false); }
  }
  const legacy = [profile.allergies && !items.some((item) => item.kind === "allergy") && `Alergias: ${profile.allergies}`, profile.conditions && !items.some((item) => item.kind === "condition") && `Condiciones: ${profile.conditions}`, profile.medications && !items.some((item) => item.kind === "medication") && `Medicamentos: ${profile.medications}`].filter((value): value is string => !!value);

  return <div className="phr-health-summary-stack">
    {error && <p className="notice danger-text" role="alert">{error}</p>}{notice && <p className="form-notice" role="status">{notice}</p>}
    <section className="card portal-card"><div className="card-heading"><div><p className="eyebrow">Resumen portable</p><h2>Mi resumen de salud</h2><p>Información declarada por la persona o vinculada a un documento. No reemplaza la evaluación de un profesional.</p></div>{!readOnly && <div className="phr-actions"><button className="button secondary" type="button" onClick={() => void downloadPhrFile("/api/portal/summary", "resumen-para-consulta.pdf")}>Descargar PDF</button><button className="button secondary" type="button" onClick={() => void downloadFhirBundle()}>Exportar FHIR</button><button className="button primary" type="button" onClick={() => edit()}>Agregar antecedente</button></div>}</div>
      <div className="phr-emergency-summary"><div><small>Grupo sanguíneo declarado</small><strong>{profile.bloodType || "No informado"}</strong></div><div><small>Contacto de emergencia</small><strong>{[profile.emergencyContactName, profile.emergencyContactPhone].filter(Boolean).join(" · ") || "No informado"}</strong></div></div>
      {legacy.length > 0 && <details className="phr-legacy-health"><summary>Información general declarada anteriormente</summary>{legacy.map((line) => <p key={line}>{line}</p>)}</details>}
    </section>

    {open && !readOnly && <section className="card portal-card phr-health-editor"><div className="card-heading"><div><p className="eyebrow">{editingId ? "Editar" : "Nuevo"}</p><h2>{editingId ? "Actualizar antecedente" : "Agregar al resumen"}</h2></div><button className="text-button" type="button" disabled={busy} onClick={() => setOpen(false)}>Cerrar</button></div><div className="phr-health-form">
      <label>Tipo<select value={draft.kind} onChange={(event) => { const kind = event.target.value as PhrHealthItemDraft["kind"]; change({ kind, status: kind === "immunization" || kind === "procedure" ? "completed" : draft.status }); }}>{healthItemKinds.map((kind) => <option value={kind} key={kind}>{healthItemKindLabels[kind]}</option>)}</select></label>
      <label className="wide-field">Nombre<input value={draft.label} maxLength={1000} required onChange={(event) => change({ label: event.target.value })} /></label>
      <label>Estado<select value={draft.status} onChange={(event) => change({ status: event.target.value as PhrHealthItemDraft["status"] })}>{Object.entries(healthItemStatusLabels).map(([status, label]) => <option value={status} key={status}>{label}</option>)}</select></label>
      <label>Fecha <span className="optional">Opcional</span><input type="date" value={draft.eventDate} onChange={(event) => change({ eventDate: event.target.value })} /></label>
      <label>Origen<select value={draft.source} onChange={(event) => change({ source: event.target.value as PhrHealthItemDraft["source"], sourceDocumentId: "" })}><option value="patient">Declarado por mí</option><option value="document" disabled={!documents.length}>Documento de mi registro</option></select></label>
      {draft.source === "document" && <label className="wide-field">Documento<select value={draft.sourceDocumentId} required onChange={(event) => change({ sourceDocumentId: event.target.value })}><option value="">Seleccionar…</option>{documents.map((document) => <option value={document.id} key={document.id}>{document.filename} · {document.sourceInstitution}</option>)}</select></label>}
      <label className="wide-field">Notas <span className="optional">Opcional</span><textarea value={draft.notes} maxLength={1000} onChange={(event) => change({ notes: event.target.value })} /></label>
    </div><button className="button primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? "Guardando…" : "Guardar antecedente"}</button></section>}

    <section className="phr-health-groups">{healthItemKinds.map((kind) => { const group = items.filter((item) => item.kind === kind); return <article className="card portal-card" key={kind}><div className="phr-app-section-heading"><h2>{healthItemKindLabels[kind]}</h2><span>{group.length}</span></div>{group.length ? <ul className="phr-health-list">{group.map((item) => <li key={item.id}><div><strong>{item.label}</strong><span>{healthItemStatusLabels[item.status]}{item.eventDate && ` · ${item.eventDate}`}{` · ${item.source === "patient" ? "Declarado por la persona" : "Vinculado a documento"}`}</span>{item.notes && <p>{item.notes}</p>}</div>{!readOnly && <div className="phr-actions"><button className="text-button" type="button" disabled={busy} onClick={() => edit(item)}>Editar</button><button className="text-button danger-text" type="button" disabled={busy} onClick={() => void remove(item)}>Eliminar</button></div>}</li>)}</ul> : <p className="empty-state">Sin información declarada.</p>}</article>; })}</section>
  </div>;
}
