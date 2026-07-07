"use client";

import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase-client";

/** Oculta el contenido hasta conocer el rol y lo bloquea si no está permitido (defensa por URL). */
export function RequireRole({ roles, children }: { roles: string[]; children: ReactNode }) {
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser()
      .then(({ data }) => supabase.from("profiles").select("role").eq("id", data.user?.id ?? "").single())
      .then(({ data }) => setRole((data as { role?: string } | null)?.role ?? ""))
      .catch(() => setRole(""));
  }, []);

  if (role === null) return <p className="empty-state">Cargando…</p>;
  if (!roles.includes(role)) return <p className="notice" role="alert">Acceso reservado a tu institución. Tu perfil no tiene permiso para esta sección.</p>;
  return <>{children}</>;
}
