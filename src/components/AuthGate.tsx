"use client";

import { FormEvent, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "@/lib/supabase-client";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError("");
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setSubmitting(false);
    if (authError) setError("No fue posible iniciar sesión. Revisa tus credenciales y la confirmación del usuario.");
  }

  if (!isSupabaseConfigured) return <main className="login-page"><section className="login-card"><h1>Falta configurar Supabase</h1><p>Agrega la URL y la clave publicable al entorno.</p></section></main>;
  if (session === undefined) return <main className="login-page"><p>Cargando sesión…</p></main>;
  if (!session) return (
    <main className="login-page">
      <form className="login-card" onSubmit={login}>
        <p className="eyebrow">Acceso restringido</p>
        <h1>Agenda + Imagenología</h1>
        <p>Ingresa con el usuario creado por el administrador.</p>
        <label>Correo electrónico<input name="email" type="email" autoComplete="username" required /></label>
        <label>Contraseña<input name="password" type="password" autoComplete="current-password" required /></label>
        <button className="button primary" disabled={submitting} type="submit">{submitting ? "Ingresando…" : "Ingresar"}</button>
        {error && <p className="form-error" role="alert">{error}</p>}
      </form>
    </main>
  );

  return <><div className="session-bar"><span>{session.user.email}</span><button type="button" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button></div>{children}</>;
}
