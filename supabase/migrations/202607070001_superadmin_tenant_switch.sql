-- Superadmin (profiles.platform=true) puede operar sobre varios tenants y cambiar el activo.
-- Admin normal (platform=false) queda fijo a su tenant.

alter table public.profiles add column if not exists active_tenant_id uuid references public.tenants(id);

-- ¿El usuario actual es superadmin de plataforma?
create or replace function private.is_platform() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select platform from public.profiles where id = (select auth.uid())), false) $$;
grant execute on function private.is_platform() to authenticated;

-- El tenant efectivo: para el superadmin, el que tenga activo (o su base); para el resto, su tenant fijo.
create or replace function private.current_tenant() returns uuid
language sql stable security definer set search_path = ''
as $$
  select case when platform then coalesce(active_tenant_id, tenant_id) else tenant_id end
  from public.profiles where id = (select auth.uid())
$$;

-- El superadmin puede leer todas las instituciones (para el selector); el resto, solo la suya.
drop policy if exists "users read own tenant" on public.tenants;
create policy "users read own tenant" on public.tenants for select to authenticated
using (id = (select private.current_tenant()) or (select private.is_platform()));
