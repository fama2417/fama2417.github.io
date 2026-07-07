type TenantProfile = { tenant_id?: string | null; active_tenant_id?: string | null; platform?: boolean };

export const effectiveTenantId = (profile: TenantProfile) => profile.platform ? profile.active_tenant_id ?? profile.tenant_id ?? "" : profile.tenant_id ?? "";
