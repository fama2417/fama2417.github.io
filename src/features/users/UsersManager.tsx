"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-client";

type ManagedUser = { id: string; email: string; full_name: string; role: string };

export const roleLabels: Record<string, string> = { admin: "Administrador", operator: "Operador / admisión", radiologist: "Radiólogo" };
const sectionsByRole: Record<string, string> = {
  admin: "Todas las secciones y configuración",
  operator: "Agenda, pacientes, worklist y parámetros",
  radiologist: "Worklist e informes",
};

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
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(() => api("GET")
    .then((payload) => { setUsers(payload.users); setAvailable(true); setAllowed(true); })
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
      await api("POST", { email: String(form.get("email")).trim(), password: String(form.get("password")), fullName: String(form.get("fullName")).trim(), role: String(form.get("role")) });
      formElement.reset();
      setShowForm(false);
      setNotice("Usuario creado. Puede ingresar de inmediato con su correo y contraseña.");
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible crear el usuario.");
    }
  }

  async function changeRole(userId: string, role: string) {
    setError("");
    try {
      await api("PATCH", { userId, role });
      setUsers((current) => current.map((user) => user.id === userId ? { ...user, role } : user));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cambiar el rol.");
    }
  }

  if (!allowed) return null;

  return (
    <section className="card" aria-label="Usuarios y permisos">
      <div className="card-heading"><h3>Usuarios y permisos</h3><button className="button primary" type="button" onClick={() => setShowForm((visible) => !visible)}>{showForm ? "Cerrar" : "Nuevo usuario"}</button></div>
      <p>Cada usuario pertenece a esta institución y su rol determina las secciones visibles y los permisos en la base de datos.</p>
      {!available && <p className="notice">Para habilitar la creación de usuarios, agrega la variable <code>SUPABASE_SERVICE_ROLE_KEY</code> en Render (Environment) con la clave service_role de Supabase (Settings → API). Nunca la publiques en el navegador.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}

      {showForm && (
        <form className="clinical-form" onSubmit={createUser}>
          <label>Nombre completo<input name="fullName" required /></label>
          <label>Correo electrónico<input name="email" type="email" required /></label>
          <label>Contraseña inicial<input name="password" type="password" minLength={12} required placeholder="Mínimo 12 caracteres" /></label>
          <label>Rol<select name="role" defaultValue="operator">{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <button className="button primary" type="submit">Crear usuario</button>
        </form>
      )}

      <div className="table-card" style={{ border: 0 }}>
        <table><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Acceso</th></tr></thead><tbody>
          {users.map((user) => <tr key={user.id}>
            <td>{user.full_name}</td>
            <td>{user.email}</td>
            <td><select value={user.role} onChange={(event) => changeRole(user.id, event.target.value)} aria-label={`Rol de ${user.full_name}`}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
            <td>{sectionsByRole[user.role] ?? "—"}</td>
          </tr>)}
        </tbody></table>
        {!users.length && available && <p className="empty-state">Cargando usuarios…</p>}
      </div>
    </section>
  );
}
