"use client";

import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase-client";
import type { Patient } from "./types";
import { linkPatientAccount, unlinkPatientAccount } from "./portal-admin";

/** Gestión de la cuenta del portal (solo admin): vincular por email una cuenta auth existente o desvincularla. */
export function PatientAccountSection({ patient, onChanged }: { patient: Patient; onChanged: (userId: string | null) => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function link(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token ?? "";
      const response = await fetch(`/api/admin/users?email=${encodeURIComponent(email.trim())}`, { headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "No fue posible buscar la cuenta.");
      if (payload.isStaff) throw new Error("Esa cuenta pertenece al equipo clínico y no puede vincularse como paciente.");
      if (payload.linkedPatientId && payload.linkedPatientId !== patient.id) throw new Error(`Esa cuenta ya está vinculada a otro paciente (${payload.linkedPatientName ?? "sin nombre"}).`);
      await linkPatientAccount(patient.id, payload.userId);
      onChanged(payload.userId);
      setNotice("Cuenta vinculada. El paciente ya puede ingresar al portal.");
      setEmail("");
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : "No fue posible vincular la cuenta.");
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await unlinkPatientAccount(patient.id);
      onChanged(null);
      setConfirmUnlink(false);
      setNotice("Cuenta desvinculada: el acceso al portal quedó revocado.");
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : "No fue posible desvincular la cuenta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card patient-account" aria-label="Cuenta de paciente">
      <div className="card-heading"><h3>Cuenta de paciente</h3>
        {patient.userId
          ? <span className="status status-completed">Cuenta vinculada</span>
          : <span className="status status-muted">Sin cuenta vinculada</span>}
      </div>
      {patient.userId ? (
        <>
          <p>El paciente puede ingresar al portal con su cuenta. Desvincularla revoca su acceso de inmediato.</p>
          {!confirmUnlink && <button className="button secondary" type="button" disabled={busy} onClick={() => setConfirmUnlink(true)}>Desvincular cuenta</button>}
          {confirmUnlink && <div className="form-actions">
            <button className="button primary" type="button" disabled={busy} onClick={unlink}>{busy ? "Desvinculando…" : "Confirmar desvinculación"}</button>
            <button className="button secondary" type="button" disabled={busy} onClick={() => setConfirmUnlink(false)}>Cancelar</button>
          </div>}
        </>
      ) : (
        <form className="patient-account-form" onSubmit={link}>
          <label>Correo de la cuenta existente<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="paciente@correo.cl" /></label>
          <button className="button primary" type="submit" disabled={busy || !email.trim()}>{busy ? "Vinculando…" : "Vincular cuenta"}</button>
          <p className="empty-inline">La cuenta debe existir previamente (esta fase no crea usuarios ni envía invitaciones).</p>
        </form>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}
    </section>
  );
}
