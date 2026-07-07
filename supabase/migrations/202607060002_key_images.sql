-- Imágenes clave (KIN / Key Object Selection): instancias del estudio destacadas que se incluyen en el informe.
create table if not exists public.report_key_images (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  appointment_id uuid not null references public.appointments(id),
  instance_id text not null,
  caption text not null default '',
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (appointment_id, instance_id)
);

create index if not exists report_key_images_appointment_idx on public.report_key_images (appointment_id, created_at);

alter table public.report_key_images enable row level security;

drop policy if exists "clinical users read key images" on public.report_key_images;
drop policy if exists "report staff manage key images" on public.report_key_images;
create policy "clinical users read key images" on public.report_key_images for select to authenticated
using (tenant_id = (select private.current_tenant()));
create policy "report staff manage key images" on public.report_key_images for all to authenticated
using (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'radiologist'))
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'radiologist')
  and exists (select 1 from public.appointments a where a.id = appointment_id and a.tenant_id = (select private.current_tenant())));

-- Tras firmar el informe definitivo, las imágenes clave quedan congeladas (el documento es inmutable).
create or replace function private.protect_key_images() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (
    select 1 from public.radiology_reports r
    where r.appointment_id = coalesce(new.appointment_id, old.appointment_id)
      and r.tenant_id = coalesce(new.tenant_id, old.tenant_id)
      and r.status = 'final'
  ) then
    raise exception 'El informe definitivo es inmutable; las imágenes clave no pueden cambiar';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists protect_key_images on public.report_key_images;
create trigger protect_key_images before insert or update or delete on public.report_key_images
for each row execute function private.protect_key_images();

drop trigger if exists audit_key_images on public.report_key_images;
create trigger audit_key_images after insert or update or delete on public.report_key_images
for each row execute function private.audit_change();

revoke all on function private.protect_key_images() from public, anon, authenticated;
