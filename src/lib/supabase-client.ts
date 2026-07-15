"use client";

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(url && publishableKey);
export const supabase = createClient(url ?? "http://127.0.0.1:54321", publishableKey ?? "sb_publishable_missing");

export async function authenticatedFetch(path: string, init: RequestInit = {}) {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) throw new Error("La sesión expiró.");
  const response = await fetch(path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${session.access_token}` } });
  if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "No fue posible completar la acción.");
  return response;
}
