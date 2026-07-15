"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase-client";
import {
  deletePatientDocument, deletePhrAccount, downloadFhirBundle, fetchPatientDocuments, fetchPhrProfile,
  savePhrProfile, uploadPatientDocument, type PhrProfile, type PortalDocument,
} from "./repository";
import { PhrLaboratories } from "./PhrLaboratories";

const tabs = [["inicio", "Inicio"], ["documentos", "Documentos"], ["laboratorios", "Laboratorios"], ["timeline", "Línea de tiempo"], ["perfil", "Perfil y seguridad"]] as const;
type Tab = (typeof tabs)[number][0];
const documentLabels: Record<PortalDocument["documentType"], string> = { imaging: "Imagenología", laboratory: "Laboratorio", prescription: "Receta u orden", other: "Otro" };
const fileSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const shownDate = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
const maxAdultBirthDate = () => { const date = new Date(); date.setFullYear(date.getFullYear() - 18); return date.toISOString().slice(0, 10); };

function ProfileFields({ profile }: { profile?: PhrProfile | null }) {
  return <>
    <label>Nombre completo<input name="fullName" defaultValue={profile?.fullName} maxLength={120} autoComplete="name" required /></label>
    <label>Fecha de nacimiento<input name="birthDate" type="date" defaultValue={profile?.birthDate} min="1900-01-01" max={maxAdultBirthDate()} required /></label>
    <label>RUN u otro identificador <span className="optional">Opcional</span><input name="identifier" defaultValue={profile?.identifier} maxLength={32} autoComplete="off" /></label>
  </>;
}

function Onboarding({ onReady }: { onReady: (profile: PhrProfile) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      await savePhrProfile({ fullName: String(form.get("fullName")), birthDate: String(form.get("birthDate")), identifier: String(form.get("identifier")), acceptedPrivacy: form.get("privacy") === "on" });
      const profile = await fetchPhrProfile();
      if (!profile) throw new Error("No fue posible abrir tu registro.");
      onReady(profile);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible crear tu registro."); }
    finally { setBusy(false); }
  }
  return <main className="portal-shell phr-onboarding"><section className="card portal-card">
    <p className="eyebrow">Bienvenido a Mi Salud</p><h1>Crea tu registro personal</h1>
    <p>Este registro es tuyo y no depende de una clínica. Comienza con tus datos básicos y luego podrás guardar exámenes de cualquier institución.</p>
    <form className="phr-profile-form" onSubmit={submit}><ProfileFields />
      <label className="phr-consent"><input name="privacy" type="checkbox" required /> <span>Confirmo que soy mayor de 18 años y acepto la <a href="/portal/privacidad" target="_blank" rel="noreferrer">política de privacidad</a>.</span></label>
      <button className="button primary" disabled={busy} type="submit">{busy ? "Creando…" : "Crear mi registro"}</button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  </section></main>;
}

export function PersonalHealthRecord() {
  const [profile, setProfile] = useState<PhrProfile | null>();
  const [documents, setDocuments] = useState<PortalDocument[]>([]);
  const [tab, setTab] = useState<Tab>("inicio");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  useEffect(() => { (async () => {
    try {
      const nextProfile = await fetchPhrProfile(); setProfile(nextProfile);
      if (nextProfile) setDocuments(await fetchPatientDocuments());
    } catch { setError("No fue posible cargar tu registro personal."); setProfile(null); }
  })(); }, []);

  const timeline = useMemo(() => [...documents].sort((a, b) => (b.documentDate ?? b.createdAt).localeCompare(a.documentDate ?? a.createdAt)), [documents]);
  const labs = documents.filter((document) => document.documentType === "laboratory");
  const sourceCenters = new Set(documents.map((document) => document.sourceInstitution)).size;

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const form = event.currentTarget, data = new FormData(form), file = data.get("file");
    try {
      if (!(file instanceof File) || !file.name) throw new Error("Selecciona un archivo.");
      await uploadPatientDocument({ file, documentDate: String(data.get("documentDate")), documentType: String(data.get("documentType")) as PortalDocument["documentType"], sourceInstitution: String(data.get("sourceInstitution")) });
      setDocuments(await fetchPatientDocuments()); form.reset(); setNotice("Documento guardado en tu registro personal.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible guardar el documento."); }
    finally { setBusy(false); }
  }

  async function remove(document: PortalDocument) {
    if (!window.confirm(`¿Eliminar ${document.filename}?`)) return;
    setBusy(true); setError("");
    try { await deletePatientDocument(document.id); setDocuments(await fetchPatientDocuments()); setNotice("Documento eliminado."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible eliminar el documento."); }
    finally { setBusy(false); }
  }

  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      await savePhrProfile({ fullName: String(data.get("fullName")), birthDate: String(data.get("birthDate")), identifier: String(data.get("identifier")) }, true);
      setProfile(await fetchPhrProfile()); setNotice("Perfil actualizado.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible actualizar el perfil."); }
    finally { setBusy(false); }
  }

  async function deleteAccount() {
    if (deleteConfirmation !== "ELIMINAR" || !window.confirm("Se eliminarán tu cuenta y todos tus documentos personales. Esta acción es irreversible.")) return;
    setBusy(true); setError("");
    try { await deletePhrAccount(deleteConfirmation); await supabase.auth.signOut({ scope: "local" }); window.location.assign("/portal"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible eliminar la cuenta."); setBusy(false); }
  }

  if (profile === undefined) return <main className="portal-shell"><p className="empty-state">Abriendo tu registro…</p></main>;
  if (!profile) return <Onboarding onReady={(next) => { setProfile(next); setNotice("Tu registro está listo. Sube tu primer examen."); }} />;
  const firstName = profile.fullName.split(/\s+/)[0];

  const documentList = (items: PortalDocument[]) => items.length ? <ul className="portal-list">{items.map((document) => <li key={document.id}>
    <div className="portal-document-detail"><strong>{document.filename}</strong><span>{documentLabels[document.documentType]} · {document.sourceInstitution} · {fileSize(document.sizeBytes)}</span><span>{shownDate(document.documentDate ?? document.createdAt)}</span></div>
    <div className="portal-document-actions"><a className="button secondary" href={document.url} target="_blank" rel="noreferrer">Abrir</a><button className="text-button danger-text" disabled={busy} type="button" onClick={() => void remove(document)}>Eliminar</button></div>
  </li>)}</ul> : <p className="empty-state">Todavía no tienes documentos.</p>;

  return <div className="portal-shell">
    <header className="portal-header"><div><p className="eyebrow">Mi Salud</p><strong>{profile.fullName}</strong></div><button className="text-button" type="button" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button></header>
    <nav className="tab-nav" role="tablist" aria-label="Secciones del registro personal">{tabs.map(([id, label]) => <button key={id} className={`tab-button${tab === id ? " active" : ""}`} role="tab" aria-selected={tab === id} type="button" onClick={() => { setTab(id); setNotice(""); setError(""); }}>{label}</button>)}</nav>
    {error && <p className="notice danger-text" role="alert">{error}</p>}{notice && <p className="form-notice" role="status">{notice}</p>}

    {tab === "inicio" && <><section className="card portal-card phr-hero"><div><p className="eyebrow">Tu registro personal</p><h2>Hola, {firstName}</h2><p>Reúne aquí tus exámenes aunque provengan de instituciones diferentes.</p></div><button className="button primary" type="button" onClick={() => setTab("documentos")}>Subir un examen</button></section>
      <section className="stats-grid portal-tiles"><article className="stat-card"><strong>{documents.length}</strong><span>Documentos</span></article><article className="stat-card"><strong>{labs.length}</strong><span>Laboratorios</span></article><article className="stat-card"><strong>{sourceCenters}</strong><span>Centros de origen</span></article><article className="stat-card"><strong>{timeline[0] ? shownDate(timeline[0].documentDate ?? timeline[0].createdAt) : "—"}</strong><span>Último registro</span></article></section>
      <section className="card portal-card"><div className="card-heading"><div><h3>Documentos recientes</h3><p>Los originales permanecen privados.</p></div></div>{documentList(timeline.slice(0, 3))}</section></>}

    {tab === "documentos" && <><section className="card portal-card"><div><p className="eyebrow">Biblioteca personal</p><h2>Subir documento</h2></div><form className="portal-document-form" onSubmit={upload}>
      <label className="wide-field">Archivo<input name="file" type="file" accept="application/pdf,image/jpeg,image/png,application/dicom,.dcm" required /></label>
      <label>Fecha del documento<input name="documentDate" type="date" /></label><label>Tipo<select name="documentType" defaultValue="laboratory"><option value="laboratory">Laboratorio</option><option value="imaging">Imagenología</option><option value="prescription">Receta u orden</option><option value="other">Otro</option></select></label>
      <label>Institución de origen<input name="sourceInstitution" maxLength={160} placeholder="Ej. RedSalud" required /></label><button className="button primary" disabled={busy} type="submit">{busy ? "Guardando…" : "Guardar documento"}</button>
    </form></section><section className="card portal-card"><h2>Mis documentos</h2>{documentList(documents)}</section></>}

    {tab === "laboratorios" && <PhrLaboratories documents={documents} onUpload={() => setTab("documentos")} />}
    {tab === "timeline" && <section className="card portal-card"><div><p className="eyebrow">Historial</p><h2>Línea de tiempo</h2><p>Documentos ordenados por la fecha indicada al cargarlos.</p></div>{documentList(timeline)}</section>}

    {tab === "perfil" && <><section className="card portal-card"><div><p className="eyebrow">Datos personales</p><h2>Mi perfil</h2></div><form className="phr-profile-form" onSubmit={updateProfile}><ProfileFields profile={profile} /><button className="button primary" disabled={busy} type="submit">Guardar cambios</button></form></section>
      <section className="card portal-card"><h2>Seguridad y portabilidad</h2><p>Puedes descargar una copia estructurada de tu registro o cerrar todas tus sesiones.</p><div className="phr-actions"><button className="button secondary" type="button" onClick={() => downloadFhirBundle().catch((cause) => setError(cause instanceof Error ? cause.message : "No fue posible exportar."))}>Exportar FHIR</button><button className="button secondary" type="button" onClick={() => supabase.auth.signOut({ scope: "global" })}>Cerrar todas las sesiones</button></div></section>
      <section className="card portal-card phr-danger"><h2>Eliminar mi cuenta</h2><p>Elimina tu perfil y documentos personales. Las copias que alguna institución haya incorporado legalmente a su ficha no se alteran.</p><label>Escribe ELIMINAR para confirmar<input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} /></label><button className="button danger" disabled={busy || deleteConfirmation !== "ELIMINAR"} type="button" onClick={() => void deleteAccount()}>Eliminar cuenta definitivamente</button></section></>}
  </div>;
}
