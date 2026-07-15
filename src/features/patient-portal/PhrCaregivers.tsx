"use client";

import { useEffect, useState, type FormEvent } from "react";
import { addPhrCaregiver, fetchPhrCaregivers, revokePhrCaregiver, type PhrCaregiver } from "./repository";

export function PhrCaregivers() {
  const [caregivers, setCaregivers] = useState<PhrCaregiver[]>([]), [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [error, setError] = useState("");
  async function reload() { setCaregivers(await fetchPhrCaregivers()); }
  useEffect(() => { reload().catch(() => setError("No fue posible cargar los accesos familiares.")); }, []);
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice(""); const form = event.currentTarget, data = new FormData(form);
    try { const response = await addPhrCaregiver(String(data.get("email")), String(data.get("relationship")) as PhrCaregiver["relationship"]); await reload(); form.reset(); setNotice(response.invited ? "Invitación enviada y acceso concedido." : "Acceso concedido a la cuenta existente."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible conceder el acceso."); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) { if (!window.confirm("¿Revocar el acceso de esta persona?")) return; await revokePhrCaregiver(id); await reload(); setNotice("Acceso revocado."); }
  return <section className="card portal-card"><p className="eyebrow">Familia y cuidadores</p><h2>Acceso de solo lectura</h2><p>La persona invitada podrá consultar tu PHR, pero no editar, compartir ni eliminar información.</p>{error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-notice" role="status">{notice}</p>}
    <form className="phr-caregiver-form" onSubmit={add}><label>Correo<input name="email" type="email" required /></label><label>Relación<select name="relationship" defaultValue="family"><option value="family">Familiar</option><option value="caregiver">Cuidador/a</option></select></label><button className="button primary" disabled={busy} type="submit">{busy ? "Guardando…" : "Conceder acceso"}</button></form>
    {caregivers.length > 0 && <ul className="portal-list">{caregivers.map((caregiver) => <li key={caregiver.id}><div className="portal-document-detail"><strong>{caregiver.email}</strong><span>{caregiver.relationship === "family" ? "Familiar" : "Cuidador/a"} · {caregiver.revokedAt ? "Revocado" : "Activo"}</span></div>{!caregiver.revokedAt && <button className="text-button danger-text" type="button" onClick={() => void revoke(caregiver.id)}>Revocar</button>}</li>)}</ul>}
  </section>;
}
