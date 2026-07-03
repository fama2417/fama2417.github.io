import { supabase } from "@/lib/supabase-client";

export type Tenant = { id: string; name: string; rut: string; address: string; phone: string; logoUrl: string };

type TenantRow = { id: string; name: string; rut: string; address: string; phone: string; logo_url: string };

const mapTenant = (row: TenantRow): Tenant => ({ id: row.id, name: row.name, rut: row.rut, address: row.address, phone: row.phone, logoUrl: row.logo_url });

export async function fetchMyTenant() {
  const { data, error } = await supabase.from("tenants").select("id, name, rut, address, phone, logo_url").single();
  if (error) throw error;
  return mapTenant(data as TenantRow);
}

export async function updateTenant(tenant: Tenant) {
  const { error } = await supabase.from("tenants").update({ name: tenant.name, rut: tenant.rut, address: tenant.address, phone: tenant.phone, logo_url: tenant.logoUrl }).eq("id", tenant.id);
  if (error) throw error;
}

export async function uploadLogo(tenantId: string, file: File) {
  const path = `${tenantId}/logo-${Date.now()}.${file.name.split(".").pop()}`;
  const { error } = await supabase.storage.from("branding").upload(path, file, { upsert: true });
  if (error) throw error;
  return supabase.storage.from("branding").getPublicUrl(path).data.publicUrl;
}
