"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-client";
import { releaseReportToPatient, revokeReportRelease } from "@/features/patients/portal-admin";

/**
 * Liberación del informe al portal de paciente (solo admin, solo informes finales).
 * Autocontenido: lee released_to_patient_at por su cuenta y usa los RPCs con defensa en BD.
 */
export function ReportReleasePanel({ appointmentId, reportStatus, role }: { appointmentId: string; reportStatus: string; role: string }) {
  const [releasedAt, setReleasedAt] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [confirming, setConfirming] = useState<"release" | "revoke" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (role !== "admin" || reportStatus !== "final") { setLoaded(true); setReleasedAt(null); return; }
    supabase.from("radiology_reports").select("released_to_patient_at").eq("appointment_id", appointmentId).maybeSingle()
      .then(({ data }) => { setReleasedAt(data?.released_to_patient_at ?? null); setLoaded(true); });
  }, [appointmentId, reportStatus, role]);

  if (role !== "admin" || reportStatus !== "final" || !loaded) return null;

  async function run(kind: "release" | "revoke") {
    setBusy(true); setError("");
    try {
      if (kind === "release") { await releaseReportToPatient(appointmentId); setReleasedAt(new Date().toISOString()); }
      else { await revokeReportRelease(appointmentId); setReleasedAt(null); }
      setConfirming(null);
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : "No fue posible completar la acción.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="report-release" aria-label="Acceso del paciente al informe">
      {releasedAt
        ? <><span className="status status-completed">Visible para el paciente</span><span className="report-release-date">Liberado el {new Date(releasedAt).toLocaleString("es-CL")}</span>
            <button className="button secondary" type="button" disabled={busy} onClick={() => setConfirming("revoke")}>Revocar acceso</button></>
        : <><span className="status status-muted">No visible para el paciente</span>
            <button className="button secondary" type="button" disabled={busy} onClick={() => setConfirming("release")}>Liberar al paciente</button></>}
      {error && <span className="form-error" role="alert">{error}</span>}

      {confirming && <div className="appointment-info-backdrop" role="dialog" aria-modal="true" aria-label="Confirmar acceso del paciente" onClick={(event) => { if (event.target === event.currentTarget && !busy) setConfirming(null); }}>
        <div className="appointment-info status-change-dialog">
          <div className="card-heading"><div><p className="eyebrow">Portal de paciente</p><h3>{confirming === "release" ? "Liberar informe" : "Revocar acceso"}</h3></div><button className="text-button" type="button" disabled={busy} onClick={() => setConfirming(null)}>Cerrar ✕</button></div>
          <p>{confirming === "release"
            ? "El paciente podrá leer este informe definitivo desde su portal. La acción queda auditada."
            : "El informe dejará de estar visible en el portal del paciente. La acción queda auditada."}</p>
          <div className="form-actions">
            <button className="button primary" type="button" disabled={busy} onClick={() => run(confirming)}>{busy ? "Procesando…" : confirming === "release" ? "Liberar" : "Revocar"}</button>
            <button className="button secondary" type="button" disabled={busy} onClick={() => setConfirming(null)}>Cancelar</button>
          </div>
        </div>
      </div>}
    </div>
  );
}
