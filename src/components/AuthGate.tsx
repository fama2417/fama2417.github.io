"use client";

import { FormEvent, useEffect, useState } from "react";
import type { AuthError, Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "@/lib/supabase-client";
import { effectiveTenantId } from "@/lib/tenant";

const roleLabels: Record<string, string> = { admin: "Administrador", operator: "Operador", radiologist: "Radiólogo", clinician: "Profesional clínico" };

type Tenant = { id: string; name: string; active: boolean };

const authMessage = (error: AuthError) => {
  if (error.code === "email_not_confirmed") return "El correo del usuario todavía no está confirmado.";
  if (error.code === "invalid_credentials") return "Correo o contraseña incorrectos.";
  if (error.code === "email_provider_disabled") return "El acceso por correo está deshabilitado en Supabase.";
  return "No fue posible completar la autenticación.";
};

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [profile, setProfile] = useState<{ name: string; role: string; tenant: string; platform: boolean; tenantId: string } | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);

  useEffect(() => {
    if (!session?.user.id) return setProfile(null);
    supabase.from("profiles").select("full_name, role, platform, tenant_id, active_tenant_id, tenant:tenants!profiles_tenant_id_fkey(name), activeTenant:tenants!profiles_active_tenant_id_fkey(name)").eq("id", session.user.id).single().then(({ data }) => {
      if (!data) return;
      const baseTenant = data.tenant as unknown as { name: string } | null;
      const activeTenant = data.activeTenant as unknown as { name: string } | null;
      setProfile({
        name: data.full_name ?? "",
        role: data.role,
        tenant: data.platform ? activeTenant?.name ?? baseTenant?.name ?? "" : baseTenant?.name ?? "",
        platform: !!data.platform,
        tenantId: effectiveTenantId(data),
      });
      // El superadmin ve todas las instituciones para cambiar entre ellas.
      if (data.platform) fetch("/api/admin/tenants", { headers: { Authorization: `Bearer ${session.access_token}` } })
        .then((response) => response.ok ? response.json() : { tenants: [] })
        .then((payload) => setTenants(payload.tenants ?? []))
        .catch(() => undefined);
    });
  }, [session?.user.id, session?.access_token]);

  async function switchTenant(tenantId: string) {
    setError("");
    const response = await fetch("/api/admin/switch-tenant", { method: "POST", headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, "Content-Type": "application/json" }, body: JSON.stringify({ tenantId }) });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      return setError(payload.error ?? "No fue posible cambiar de institución.");
    }
    window.location.reload();
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError("");
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password: String(form.get("password")) });
    setSubmitting(false);
    if (authError) setError(authMessage(authError));
  }

  async function requestRecovery() {
    if (!email) return setError("Ingresa primero tu correo electrónico.");
    setSubmitting(true);
    setError("");
    const { error: authError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    setSubmitting(false);
    if (authError) return setError(authMessage(authError));
    setNotice("Te enviamos un enlace para cambiar la contraseña.");
  }

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password"));
    setSubmitting(true);
    const { error: authError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (authError) return setError(authMessage(authError));
    setRecovering(false);
    setNotice("Contraseña actualizada.");
  }

  if (!isSupabaseConfigured) return <main className="login-page"><section className="login-card"><h1>Falta configurar Supabase</h1><p>Agrega la URL y la clave publicable al entorno.</p></section></main>;
  if (session === undefined) return <main className="login-page"><p>Cargando sesión…</p></main>;
  if (recovering) return (
    <main className="login-page"><form className="login-card" onSubmit={updatePassword}>
      <p className="eyebrow">Recuperación</p><h1>Nueva contraseña</h1>
      <label>Contraseña<input name="password" type="password" minLength={12} autoComplete="new-password" required /></label>
      <p>Usa al menos 12 caracteres, mayúsculas, minúsculas, números y símbolos.</p>
      <button className="button primary" disabled={submitting} type="submit">Guardar contraseña</button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form></main>
  );
  if (!session) return (
    <main className="login-page">
      <form className="login-card" onSubmit={login}>
        <p className="eyebrow">Acceso restringido</p><h1>Agenda + Imagenología</h1>
        <p>Ingresa con el usuario creado por el administrador.</p>
        <label>Correo electrónico<input value={email} onChange={(event) => setEmail(event.target.value)} name="email" type="email" autoComplete="username" required /></label>
        <label>Contraseña<input name="password" type="password" autoComplete="current-password" required /></label>
        <button className="button primary" disabled={submitting} type="submit">{submitting ? "Procesando…" : "Ingresar"}</button>
        <button className="text-button" disabled={submitting} type="button" onClick={requestRecovery}>Olvidé mi contraseña</button>
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="form-notice" role="status">{notice}</p>}
      </form>
    </main>
  );

  return <><div className="session-bar">
    {profile?.platform && tenants.some((tenant) => tenant.active) && <label className="tenant-switcher">Institución
      <select value={profile.tenantId} onChange={(event) => void switchTenant(event.target.value)}>
        {tenants.filter((tenant) => tenant.active).map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
      </select>
    </label>}
    <span className="session-identity">
      <strong>{profile?.name || session.user.email}</strong>
      {profile && <span>{session.user.email} · {profile.platform ? "SuperAdmin" : roleLabels[profile.role] ?? profile.role}{profile.tenant && ` · ${profile.tenant}`}</span>}
    </span>
    <button type="button" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
    {error && <span className="form-error" role="alert">{error}</span>}
  </div>{children}</>;
}
