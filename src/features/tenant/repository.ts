import { supabase } from "@/lib/supabase-client";
import { effectiveTenantId } from "@/lib/tenant";

export type Tenant = { id: string; name: string; rut: string; address: string; phone: string; logoUrl: string; reportHeader: string; pacsInstitution: string };

type TenantRow = { id: string; name: string; rut: string; address: string; phone: string; logo_url: string; report_header: string; pacs_institution: string };

const mapTenant = (row: TenantRow): Tenant => ({ id: row.id, name: row.name, rut: row.rut, address: row.address, phone: row.phone, logoUrl: row.logo_url, reportHeader: row.report_header ?? "", pacsInstitution: row.pacs_institution ?? "" });

const tenantColumns = "id, name, rut, address, phone, logo_url, report_header, pacs_institution";

export async function fetchMyTenant() {
  const auth = await supabase.auth.getUser();
  const profile = await supabase.from("profiles").select("tenant_id, active_tenant_id, platform").eq("id", auth.data.user?.id ?? "").single();
  if (profile.error) throw profile.error;
  const tenantId = effectiveTenantId(profile.data);
  const result = await supabase.from("tenants").select(tenantColumns).eq("id", tenantId).single();
  if (!result.error) return mapTenant(result.data as TenantRow);
  // ponytail: fallback mientras la migración de pacs_institution no esté aplicada; quitar cuando esté en producción
  const fallback = await supabase.from("tenants").select(tenantColumns.replace(", pacs_institution", "")).eq("id", tenantId).single();
  if (fallback.error) throw fallback.error;
  return mapTenant(fallback.data as unknown as TenantRow);
}

export async function updateTenant(tenant: Tenant) {
  const base = { name: tenant.name, rut: tenant.rut, address: tenant.address, phone: tenant.phone, logo_url: tenant.logoUrl, report_header: tenant.reportHeader };
  const result = await supabase.from("tenants").update({ ...base, pacs_institution: tenant.pacsInstitution.trim() }).eq("id", tenant.id);
  if (!result.error) return;
  // ponytail: fallback si aún no existe la columna pacs_institution; quitar cuando la migración esté aplicada
  const { error } = await supabase.from("tenants").update(base).eq("id", tenant.id);
  if (error) throw error;
}

/** Variables disponibles en el encabezado del informe. */
export const HEADER_VARIABLES = ["paciente", "id", "medico", "examen", "fecha", "institucion"] as const;

export function renderHeader(template: string, values: Record<string, string>) {
  return template.replace(/{{\s*(\w+)\s*}}/g, (_, key: string) => values[key] ?? "");
}

export async function uploadLogo(tenantId: string, file: File) {
  const path = `${tenantId}/logo-${Date.now()}.${file.name.split(".").pop()}`;
  const { error } = await supabase.storage.from("branding").upload(path, file, { upsert: true });
  if (error) throw error;
  return supabase.storage.from("branding").getPublicUrl(path).data.publicUrl;
}
