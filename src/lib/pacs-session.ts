import { supabase } from "@/lib/supabase-client";

/**
 * Deja la cookie `pacs_session` (firmada, 8 h) para que el proxy /ohif y el handoff a la VM
 * no pidan credenciales. Best-effort: devuelve false si la sesión de Supabase no es válida.
 */
export async function ensurePacsSession(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  const response = await fetch("/api/pacs/session", {
    method: "POST",
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
  });
  return response.ok;
}
