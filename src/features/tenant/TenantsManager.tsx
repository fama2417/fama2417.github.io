"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-client";

type TenantRow = { id: string; name: string; active: boolean; created_at: string };

async function api(method: string, body?: unknown) {
  const { data } = await supabase.auth.getSession();
  const response = await fetch("/api/admin/tenants", {
    method,
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "Error de servidor.");
  return payload;
}

export function TenantsManager() {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [visible, setVisible] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    api("GET").then((payload) => { setTenants(payload.tenants); setVisible(true); }).catch(() => setVisible(false));
  }, []);

  async function createTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setError("");
    setNotice("");
    try {
      await api("POST", { name: String(form.get("name")).trim(), adminEmail: String(form.get("adminEmail")).trim(), adminPassword: String(form.get("adminPassword")), adminName: String(form.get("adminName")).trim() });
      formElement.reset();
      setShowForm(false);
      setNotice("Institución creada con su administrador inicial.");
      setTenants((await api("GET")).tenants);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible crear la institución.");
    }
  }

  if (!visible) return null;

  return (
    <section className="card" aria-label="Instituciones">
      <div className="card-heading"><h3>Instituciones (plataforma)</h3><button className="button primary" type="button" onClick={() => setShowForm((current) => !current)}>{showForm ? "Cerrar" : "Nueva institución"}</button></div>
      <p>Cada institución opera aislada: sus usuarios, pacientes, citas, catálogos e informes no se cruzan con los demás tenants.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}

      {showForm && (
        <form className="clinical-form" onSubmit={createTenant}>
          <label>Nombre de la institución<input name="name" required /></label>
          <label>Nombre del administrador<input name="adminName" required /></label>
          <label>Correo del administrador<input name="adminEmail" type="email" required /></label>
          <label>Contraseña inicial<input name="adminPassword" type="password" minLength={12} required /></label>
          <button className="button primary" type="submit">Crear institución</button>
        </form>
      )}

      <ul className="catalog-list">
        {tenants.map((tenant) => <li key={tenant.id} className={tenant.active ? "" : "inactive"}><span>{tenant.name}</span><span className="empty-inline">{new Date(tenant.created_at).toLocaleDateString("es-CL")}</span></li>)}
      </ul>
    </section>
  );
}
