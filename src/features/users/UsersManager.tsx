"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-client";
import { compressImageFile } from "@/lib/compress-image";

type ManagedUser = { id: string; email: string; full_name: string; role: string; tenant_id: string; professional_registration: string; signature_url: string; practitioner_id: string };
type TenantOption = { id: string; name: string };
type PractitionerOption = { id: string; profile_id: string | null; full_name: string; professional_registration: string; active: boolean; categories: string[] };

export const roleLabels: Record<string, string> = { superadmin: "SuperAdmin", admin: "Administrador", operator: "Operador / admisión", radiologist: "Radiólogo", clinician: "Profesional clínico" };
const sectionsByRole: Record<string, string> = {
  superadmin: "Todas las instituciones y configuraciones",
  admin: "Todas las secciones y configuración",
  operator: "Agenda, lista de trabajo e informes definitivos",
  radiologist: "Worklist e informes",
  clinician: "Worklist y documentos de sus servicios",
};

const categoryLabels: Record<string, string> = { consultation: "Consulta", imaging: "Imagenología", laboratory: "Laboratorio", pathology: "Patología", procedure: "Procedimiento" };

async function api(method: string, body?: unknown) {
  const { data } = await supabase.auth.getSession();
  const response = await fetch("/api/admin/users", {
    method,
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "Error de servidor.");
  return payload;
}

export function UsersManager() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [available, setAvailable] = useState(true);
  const [allowed, setAllowed] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [platform, setPlatform] = useState(false);
  const [tenantId, setTenantId] = useState("");
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [practitioners, setPractitioners] = useState<PractitionerOption[]>([]);

  const load = useCallback(() => api("GET")
    .then((payload) => { setUsers(payload.users); setPractitioners(payload.practitioners ?? []); setPlatform(!!payload.platform); setTenantId(payload.tenantId ?? ""); setTenants(payload.tenants ?? []); setAvailable(true); setAllowed(true); })
    .catch((cause: Error) => {
      if (cause.message.includes("SERVICE_ROLE")) setAvailable(false);
      else if (cause.message.includes("Solo administradores")) setAllowed(false);
      else setError(cause.message);
    }), []);
  useEffect(() => { load(); }, [load]);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setError("");
    setNotice("");
    try {
      await api("POST", { email: String(form.get("email")).trim(), password: String(form.get("password")), fullName: String(form.get("fullName")).trim(), role: String(form.get("role")), practitionerId: String(form.get("practitionerId") || ""), tenantId: String(form.get("tenantId") || tenantId), professionalRegistration: String(form.get("professionalRegistration")).trim() });
      formElement.reset();
      setShowForm(false);
      setNotice("Usuario creado. Puede ingresar de inmediato con su correo y contraseña.");
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible crear el usuario.");
    }
  }

  async function saveEditing() {
    if (!editing) return;
    setError(""); setNotice("");
    try {
      await api("PATCH", { userId: editing.id, role: editing.role, practitionerId: editing.practitioner_id, tenantId: editing.tenant_id, email: editing.email, professionalRegistration: editing.professional_registration, fullName: editing.full_name });
      if ((await supabase.auth.getUser()).data.user?.id === editing.id) await supabase.auth.refreshSession();
      await load();
      setEditing(null);
      setNotice("Cambios guardados (quedan en el registro de auditoría).");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible actualizar el usuario.");
    }
  }

  async function resetPassword(user: ManagedUser) {
    const password = window.prompt(`Nueva contraseña para ${user.email} (mínimo 12 caracteres):`)?.trim();
    if (!password) return;
    setError(""); setNotice("");
    try {
      await api("PATCH", { userId: user.id, role: user.role, practitionerId: user.practitioner_id, tenantId: user.tenant_id, professionalRegistration: user.professional_registration, password });
      setNotice(`Contraseña actualizada para ${user.email}. Ya puede ingresar con ella.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cambiar la contraseña.");
    }
  }

  async function uploadSignature(user: ManagedUser, file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      const image = await compressImageFile(file);
      const path = `${user.id}/firma-${Date.now()}.${image.name.split(".").pop()}`;
      const { error: uploadError } = await supabase.storage.from("firmas").upload(path, image, { upsert: true });
      if (uploadError) throw uploadError;
      await api("PATCH", { userId: user.id, role: user.role, practitionerId: user.practitioner_id, tenantId: user.tenant_id, professionalRegistration: user.professional_registration, signaturePath: path });
      setUsers((current) => current.map((item) => item.id === user.id ? { ...item, signature_url: path } : item));
      setNotice("Firma cargada. Aparecerá en los informes que firme este usuario.");
    } catch {
      setError("No fue posible subir la firma (JPG/PNG, requiere rol administrador).");
    }
  }

  if (!allowed) return null;

  return (
    <section className="card" aria-label="Usuarios y permisos">
      <div className="card-heading"><h3>Usuarios y permisos</h3><button className="button primary" type="button" onClick={() => setShowForm((visible) => !visible)}>{showForm ? "Cerrar" : "Nuevo usuario"}</button></div>
      <p>Cada usuario pertenece a una institución y su rol determina los permisos.{platform && ` Estás administrando: ${tenants.find((tenant) => tenant.id === tenantId)?.name ?? "institución activa"}.`}</p>
      {!available && <p className="notice">Para habilitar la creación de usuarios, agrega la variable <code>SUPABASE_SERVICE_ROLE_KEY</code> en Render (Environment) con la clave service_role de Supabase (Settings → API). Nunca la publiques en el navegador.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}

      {showForm && (
        <form className="clinical-form" onSubmit={createUser}>
          <label>Nombre completo<input name="fullName" required /></label>
          <label>Correo electrónico<input name="email" type="email" required /></label>
          <label>Contraseña inicial<input name="password" type="password" minLength={12} required placeholder="Mínimo 12 caracteres" /></label>
          <label>Rol<select name="role" defaultValue="operator">{Object.entries(roleLabels).filter(([value]) => platform || value !== "superadmin").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Profesional vinculado<select name="practitionerId" defaultValue=""><option value="">Sin vínculo clínico</option>{practitioners.filter((item) => item.active && !item.profile_id).map((item) => <option key={item.id} value={item.id}>{item.full_name} · {item.professional_registration || "sin registro"}</option>)}</select></label>
          {platform && <label>Institución<select name="tenantId" defaultValue={tenantId}>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label>}
          <label>Registro profesional<input name="professionalRegistration" placeholder="Ej.: RNPI 123456" /></label>
          <button className="button primary" type="submit">Crear usuario</button>
        </form>
      )}

      <div className="table-card" style={{ border: 0 }}>
        <table><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Profesional / ámbito</th>{platform && <th>Institución</th>}<th>Registro profesional</th><th>Firma</th><th>Contraseña</th><th>Acceso</th><th></th></tr></thead><tbody>
          {users.map((user) => { const row = editing?.id === user.id ? editing : user; const isEditing = editing?.id === user.id; return <tr key={user.id}>
            <td>{isEditing ? <input value={row.full_name} onChange={(event) => setEditing({ ...row, full_name: event.target.value })} aria-label="Nombre" /> : user.full_name}</td>
            <td>{isEditing ? <input type="email" value={row.email} onChange={(event) => setEditing({ ...row, email: event.target.value })} aria-label="Correo" /> : user.email}</td>
            <td>{isEditing ? <select value={row.role} onChange={(event) => setEditing({ ...row, role: event.target.value })} aria-label="Rol">{Object.entries(roleLabels).filter(([value]) => platform || value !== "superadmin").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : roleLabels[user.role] ?? user.role}</td>
            <td>{isEditing ? <select value={row.practitioner_id} onChange={(event) => setEditing({ ...row, practitioner_id: event.target.value })} aria-label="Profesional vinculado"><option value="">Sin vínculo clínico</option>{practitioners.filter((item) => item.active && (!item.profile_id || item.profile_id === row.id)).map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select> : (() => { const practitioner = practitioners.find((item) => item.id === user.practitioner_id); return practitioner ? <span>{practitioner.full_name}<small>{practitioner.categories.map((category) => categoryLabels[category] ?? category).join(" · ") || "Sin servicio habilitado"}</small></span> : "—"; })()}</td>
            {platform && <td>{isEditing ? <select value={row.tenant_id} onChange={(event) => setEditing({ ...row, tenant_id: event.target.value })} aria-label="Institución">{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select> : tenants.find((tenant) => tenant.id === user.tenant_id)?.name ?? "—"}</td>}
            <td>{isEditing ? <input value={row.professional_registration} onChange={(event) => setEditing({ ...row, professional_registration: event.target.value })} placeholder="Ej.: RNPI 123456" aria-label="Registro profesional" /> : (user.professional_registration || "—")}</td>
            <td className="signature-cell">{user.signature_url && <span title="Firma cargada">✒️</span>}<label className="text-button">{user.signature_url ? "Cambiar" : "Subir"}<input type="file" accept="image/png,image/jpeg" hidden onChange={(event) => uploadSignature(user, event.target.files?.[0])} /></label></td>
            <td><button className="text-button" type="button" onClick={() => resetPassword(user)}>Restablecer</button></td>
            <td>{sectionsByRole[user.role] ?? "—"}</td>
            <td>{isEditing
              ? <><button className="text-button" type="button" onClick={saveEditing}>Guardar</button><button className="text-button" type="button" onClick={() => setEditing(null)}>Cancelar</button></>
              : <button className="text-button" type="button" onClick={() => setEditing(user)}>Editar</button>}</td>
          </tr>; })}
        </tbody></table>
        {!users.length && available && <p className="empty-state">Cargando usuarios…</p>}
      </div>
    </section>
  );
}
