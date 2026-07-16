import type { SupabaseClient } from "@supabase/supabase-js";

/** La telemetría nunca debe bloquear una operación clínica. No guarda texto ni resultados. */
export async function recordPhrEvent(db: SupabaseClient<any, "public", any>, ownerUserId: string, eventName: string, documentId?: string, properties: Record<string, string | number | boolean | null> = {}) {
  const result = await db.from("phr_product_events").insert({ owner_user_id: ownerUserId, document_id: documentId || null, event_name: eventName, properties });
  if (result.error) console.error("PHR product event failed", eventName, result.error.message);
}
