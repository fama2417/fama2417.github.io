"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase-client";
import {
  deletePatientDocument, deletePhrAccount, downloadFhirBundle, fetchAccessiblePhrProfiles, fetchPatientDocuments,
  fetchPhrProfile, savePhrProfile, uploadPatientDocument, type PhrProfile, type PortalDocument,
} from "./repository";
import { PhrCaregivers } from "./PhrCaregivers";
import { PhrDashboard, PhrTimeline } from "./PhrLongitudinal";
import { PhrLaboratories } from "./PhrLaboratories";
import { PhrSharing } from "./PhrSharing";

const tabs = [["inicio", "Inicio"], ["documentos", "Documentos"], ["laboratorios", "Laboratorios"], ["timeline", "Línea de tiempo"], ["compartir", "Compartir"], ["perfil", "Perfil y seguridad"]] as const;
type Tab = (typeof tabs)[number][0];
const documentLabels: Record<PortalDocument["documentType"], string> = { imaging: "Imagenología", laboratory: "Laboratorio", prescription: "Receta u orden", other: "Otro" };
const fileSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const shownDate = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
const maxAdultBirthDate = () => { const date = new Date(); date.setFullYear(date.getFullYear() - 18); return date.toISOString().slice(0, 10); };

function ProfileFields({ profile }: { profile?: PhrProfile | null }) {
  return <><label>Nombre completo<input name="fullName" defaultValue={profile?.fullName} maxLength={120} autoComplete="name" required /></label><label>Fecha de nacimiento<input name="birthDate" type="date" defaultValue={profile?.birthDate} min="1900-01-01" max={maxAdultBirthDate()} required /></label><label>RUN u otro identificador <span className="optional">Opcional</span><input name="identifier" defaultValue={profile?.identifier} maxLength={32} autoComplete="off" /></label></>;
}

function EmergencyFields({ profile }: { profile: PhrProfile }) {
  return <div className="phr-emergency-fields"><label>Grupo sanguíneo<select name="bloodType" defaultValue={profile.bloodType}><option value="">No informado</option>{["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((type) => <option key={type}>{type}</option>)}</select></label><label>Alergias declaradas<textarea name="allergies" defaultValue={profile.allergies} maxLength={1000} /></label><label>Condiciones declaradas<textarea name="conditions" defaultValue={profile.conditions} maxLength={1000} /></label><label>Medicamentos declarados<textarea name="medications" defaultValue={profile.medications} maxLength={1000} /></label><label>Contacto de emergencia<input name="emergencyContactName" defaultValue={profile.emergencyContactName} maxLength={120} /></label><label>Teléfono de emergencia<input name="emergencyContactPhone" defaultValue={profile.emergencyContactPhone} maxLength={40} /></label><label className="wide-field">Notas de emergencia<textarea name="emergencyNotes" defaultValue={profile.emergencyNotes} maxLength={1000} /></label></div>;
}

function Onboarding({ onReady }: { onReady: (profile: PhrProfile) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); const form = new FormData(event.currentTarget);
    try { await savePhrProfile({ fullName: String(form.get("fullName")), birthDate: String(form.get("birthDate")), identifier: String(form.get("identifier")), acceptedPrivacy: form.get("privacy") === "on" }); const profile = await fetchPhrProfile(); if (!profile) throw new Error("No fue posible abrir tu registro."); onReady(profile); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible crear tu registro."); } finally { setBusy(false); }
  }
  return <main className="portal-shell phr-onboarding"><section className="card portal-card"><p className="eyebrow">Bienvenido a Mi Salud</p><h1>Crea tu registro personal</h1><p>Este registro es tuyo y no depende de una clínica.</p><form className="phr-profile-form" onSubmit={submit}><ProfileFields /><label className="phr-consent"><input name="privacy" type="checkbox" required /> <span>Confirmo que soy mayor de 18 años y acepto la <a href="/portal/privacidad" target="_blank" rel="noreferrer">política de privacidad</a>.</span></label><button className="button primary" disabled={busy} type="submit">{busy ? "Creando…" : "Crear mi registro"}</button>{error && <p className="form-error" role="alert">{error}</p>}</form></section></main>;
}

export function PersonalHealthRecord() {
  const [profiles, setProfiles] = useState<PhrProfile[]>(), [currentUserId, setCurrentUserId] = useState(""), [ownerUserId, setOwnerUserId] = useState("");
  const [documents, setDocuments] = useState<PortalDocument[]>([]), [tab, setTab] = useState<Tab>("inicio");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [deleteConfirmation, setDeleteConfirmation] = useState("");

  useEffect(() => { (async () => {
    try { const userId = (await supabase.auth.getUser()).data.user?.id ?? "", nextProfiles = await fetchAccessiblePhrProfiles(); const selected = nextProfiles.find((profile) => profile.userId === userId) ?? nextProfiles[0]; setCurrentUserId(userId); setProfiles(nextProfiles); setOwnerUserId(selected?.userId ?? userId); }
    catch { setError("No fue posible cargar tu registro personal."); setProfiles([]); }
  })(); }, []);
  useEffect(() => { if (ownerUserId && profiles?.some((profile) => profile.userId === ownerUserId)) fetchPatientDocuments(ownerUserId).then(setDocuments).catch(() => setError("No fue posible cargar los documentos.")); }, [ownerUserId, profiles?.length]);

  const profile = profiles?.find((item) => item.userId === ownerUserId), readOnly = !!profile && profile.userId !== currentUserId;
  const timeline = useMemo(() => [...documents].sort((a, b) => (b.documentDate ?? b.createdAt).localeCompare(a.documentDate ?? a.createdAt)), [documents]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice(""); const form = event.currentTarget, data = new FormData(form), file = data.get("file");
    try { if (!(file instanceof File) || !file.name) throw new Error("Selecciona un archivo."); await uploadPatientDocument({ file, documentDate: String(data.get("documentDate")), documentType: String(data.get("documentType")) as PortalDocument["documentType"], sourceInstitution: String(data.get("sourceInstitution")) }); setDocuments(await fetchPatientDocuments(ownerUserId)); form.reset(); setNotice("Documento guardado en tu registro personal."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible guardar el documento."); } finally { setBusy(false); }
  }
  async function remove(document: PortalDocument) { if (!window.confirm(`¿Eliminar ${document.filename}?`)) return; setBusy(true); try { await deletePatientDocument(document.id); setDocuments(await fetchPatientDocuments(ownerUserId)); setNotice("Documento eliminado."); } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible eliminar el documento."); } finally { setBusy(false); } }
  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); const data = new FormData(event.currentTarget);
    try { await savePhrProfile({ fullName: String(data.get("fullName")), birthDate: String(data.get("birthDate")), identifier: String(data.get("identifier")), bloodType: String(data.get("bloodType")), allergies: String(data.get("allergies")), conditions: String(data.get("conditions")), medications: String(data.get("medications")), emergencyContactName: String(data.get("emergencyContactName")), emergencyContactPhone: String(data.get("emergencyContactPhone")), emergencyNotes: String(data.get("emergencyNotes")) }, true); setProfiles(await fetchAccessiblePhrProfiles()); setNotice("Perfil actualizado."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible actualizar el perfil."); } finally { setBusy(false); }
  }
  async function deleteAccount() { if (deleteConfirmation !== "ELIMINAR" || !window.confirm("Se eliminarán tu cuenta y todos tus documentos personales. Esta acción es irreversible.")) return; setBusy(true); try { await deletePhrAccount(deleteConfirmation); await supabase.auth.signOut({ scope: "local" }); window.location.assign("/portal"); } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible eliminar la cuenta."); setBusy(false); } }

  if (profiles === undefined) return <main className="portal-shell"><p className="empty-state">Abriendo tu registro…</p></main>;
  if (!profiles.length) return <Onboarding onReady={(next) => { setProfiles([next]); setOwnerUserId(next.userId); setNotice("Tu registro está listo. Sube tu primer examen."); }} />;
  if (!profile) return <main className="portal-shell"><p className="empty-state">No fue posible abrir el perfil seleccionado.</p></main>;
  const availableTabs = readOnly ? tabs.filter(([id]) => !["compartir"].includes(id)) : tabs;
  const documentList = (items: PortalDocument[]) => items.length ? <ul className="portal-list">{items.map((document) => <li key={document.id}><div className="portal-document-detail"><strong>{document.filename}</strong><span>{documentLabels[document.documentType]} · {document.sourceInstitution} · {fileSize(document.sizeBytes)}</span><span>{shownDate(document.documentDate ?? document.createdAt)}</span></div><div className="portal-document-actions"><a className="button secondary" href={document.url} target="_blank" rel="noreferrer">Abrir</a>{!readOnly && <button className="text-button danger-text" disabled={busy} type="button" onClick={() => void remove(document)}>Eliminar</button>}</div></li>)}</ul> : <p className="empty-state">Todavía no tienes documentos.</p>;

  return <div className="portal-shell"><header className="portal-header"><div><p className="eyebrow">Mi Salud{readOnly ? " · Acceso de solo lectura" : ""}</p><strong>{profile.fullName}</strong></div>{profiles.length > 1 && <label>Perfil<select value={ownerUserId} onChange={(event) => { setOwnerUserId(event.target.value); setTab("inicio"); }}>{profiles.map((item) => <option key={item.userId} value={item.userId}>{item.fullName}{item.userId === currentUserId ? " (yo)" : ""}</option>)}</select></label>}<button className="text-button" type="button" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button></header>
    <nav className="tab-nav" role="tablist" aria-label="Secciones del registro personal">{availableTabs.map(([id, label]) => <button key={id} className={`tab-button${tab === id ? " active" : ""}`} role="tab" aria-selected={tab === id} type="button" onClick={() => { setTab(id); setNotice(""); setError(""); }}>{label}</button>)}</nav>
    {error && <p className="notice danger-text" role="alert">{error}</p>}{notice && <p className="form-notice" role="status">{notice}</p>}
    {tab === "inicio" && <><section className="card portal-card phr-hero"><div><p className="eyebrow">Experiencia longitudinal</p><h1>Hola, {profile.fullName.split(/\s+/)[0]}</h1><p>Observa tu historia en el tiempo sin convertir resultados en diagnósticos.</p></div>{!readOnly && <button className="button primary" type="button" onClick={() => setTab("documentos")}>Subir un examen</button>}</section><PhrDashboard ownerUserId={ownerUserId} documents={documents} /></>}
    {tab === "documentos" && <>{!readOnly && <section className="card portal-card"><p className="eyebrow">Biblioteca personal</p><h2>Subir documento</h2><form className="portal-document-form" onSubmit={upload}><label className="wide-field">Archivo<input name="file" type="file" accept="application/pdf,image/jpeg,image/png,application/dicom,.dcm" required /></label><label>Fecha del documento<input name="documentDate" type="date" /></label><label>Tipo<select name="documentType" defaultValue="laboratory"><option value="laboratory">Laboratorio</option><option value="imaging">Imagenología</option><option value="prescription">Receta u orden</option><option value="other">Otro</option></select></label><label>Institución de origen<input name="sourceInstitution" maxLength={160} required /></label><button className="button primary" disabled={busy} type="submit">{busy ? "Guardando…" : "Guardar documento"}</button></form></section>}<section className="card portal-card"><h2>Mis documentos</h2>{documentList(documents)}</section></>}
    {tab === "laboratorios" && <PhrLaboratories documents={documents} ownerUserId={ownerUserId} readOnly={readOnly} onUpload={() => setTab("documentos")} />}
    {tab === "timeline" && <PhrTimeline ownerUserId={ownerUserId} documents={timeline} />}
    {tab === "compartir" && !readOnly && <PhrSharing ownerUserId={ownerUserId} documents={documents} />}
    {tab === "perfil" && <>{readOnly ? <section className="card portal-card"><p className="eyebrow">Perfil de emergencia</p><h2>Información declarada por {profile.fullName}</h2><p>Grupo sanguíneo: {profile.bloodType || "No informado"}</p><p>Alergias: {profile.allergies || "No informadas"}</p><p>Condiciones: {profile.conditions || "No informadas"}</p><p>Medicamentos: {profile.medications || "No informados"}</p></section> : <><section className="card portal-card"><p className="eyebrow">Datos personales y de emergencia</p><h2>Mi perfil</h2><p>Estos datos son declarados por ti y no constituyen una validación clínica.</p><form className="phr-profile-form" onSubmit={updateProfile}><ProfileFields profile={profile} /><EmergencyFields profile={profile} /><button className="button primary" disabled={busy} type="submit">Guardar cambios</button></form></section><PhrCaregivers /><section className="card portal-card"><h2>Seguridad y portabilidad</h2><div className="phr-actions"><button className="button secondary" type="button" onClick={() => downloadFhirBundle().catch((cause) => setError(cause instanceof Error ? cause.message : "No fue posible exportar."))}>Exportar FHIR</button><button className="button secondary" type="button" onClick={() => supabase.auth.signOut({ scope: "global" })}>Cerrar todas las sesiones</button></div></section><section className="card portal-card"><p className="eyebrow">Conectores móviles</p><h2>Apple Health y Health Connect</h2><p>La conexión directa requiere una aplicación nativa y credenciales de cada plataforma. Esta PWA mantiene FHIR como formato interoperable hasta disponer de esas aplicaciones.</p></section><section className="card portal-card phr-danger"><h2>Eliminar mi cuenta</h2><label>Escribe ELIMINAR para confirmar<input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} /></label><button className="button danger" disabled={busy || deleteConfirmation !== "ELIMINAR"} type="button" onClick={() => void deleteAccount()}>Eliminar cuenta definitivamente</button></section></>}</>}
  </div>;
}
