"use client";

import { FormEvent, useEffect, useState } from "react";
import { fetchMyTenant, updateTenant, uploadLogo, type Tenant } from "./repository";

export function InstitutionSettings() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => { fetchMyTenant().then(setTenant).catch(() => setError("No fue posible cargar la institución.")); }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenant) return;
    setError("");
    setNotice("");
    try {
      await updateTenant(tenant);
      setNotice("Datos de la institución guardados.");
    } catch {
      setError("No fue posible guardar. Solo administradores pueden editar la institución.");
    }
  }

  async function pickLogo(file: File | undefined) {
    if (!file || !tenant) return;
    setError("");
    try {
      const logoUrl = await uploadLogo(tenant.id, file);
      setTenant({ ...tenant, logoUrl });
      setNotice("Logo subido. Guarda para confirmar.");
    } catch {
      setError("No fue posible subir el logo.");
    }
  }

  if (!tenant) return null;

  return (
    <section className="card" aria-label="Datos de la institución">
      <div className="card-heading"><h3>Institución</h3>{tenant.logoUrl && <img src={tenant.logoUrl} alt="Logo institucional" style={{ height: 40 }} />}</div>
      <p>Estos datos encabezan el informe radiológico impreso.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}
      <form className="clinical-form" onSubmit={save}>
        <label>Nombre<input value={tenant.name} onChange={(event) => setTenant({ ...tenant, name: event.target.value })} required /></label>
        <label>RUT<input value={tenant.rut} onChange={(event) => setTenant({ ...tenant, rut: event.target.value })} /></label>
        <label>Dirección<input value={tenant.address} onChange={(event) => setTenant({ ...tenant, address: event.target.value })} /></label>
        <label>Teléfono<input value={tenant.phone} onChange={(event) => setTenant({ ...tenant, phone: event.target.value })} /></label>
        <label>Logo (PNG/JPG)<input type="file" accept="image/*" onChange={(event) => pickLogo(event.target.files?.[0])} /></label>
        <button className="button primary" type="submit">Guardar institución</button>
      </form>
    </section>
  );
}
