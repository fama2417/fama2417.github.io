"use client";

import { FormEvent, useEffect, useState } from "react";
import type { AuthError, Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "@/lib/supabase-client";

const roleLabels: Record<string, string> = { admin: "Administrador", operator: "Operador", radiologist: "Radiólogo" };

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
  const [profile, setProfile] = useState<{ role: string; tenant: string } | null>(null);

  useEffect(() => {
    if (!session?.user.id) return setProfile(null);
    supabase.from("profiles").select("role, tenant:tenants(name)").eq("id", session.user.id).single().then(({ data }) => {
      if (data) setProfile({ role: data.role, tenant: (data.tenant as unknown as { name: string } | null)?.name ?? "" });
    });
  }, [session?.user.id]);

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
    <span className="session-identity">
      <strong>{session.user.email}</strong>
      {profile && <span>{roleLabels[profile.role] ?? profile.role}{profile.tenant && ` · ${profile.tenant}`}</span>}
    </span>
    <button type="button" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
  </div>{children}</>;
}
