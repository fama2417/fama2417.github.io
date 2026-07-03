-- Datos de la institución para encabezados de informe
alter table public.tenants
  add column rut text not null default '',
  add column address text not null default '',
  add column phone text not null default '',
  add column logo_url text not null default '';

create policy "admins update own tenant" on public.tenants for update to authenticated
using (id = (select private.current_tenant()) and (select private.current_role()) = 'admin')
with check (id = (select private.current_tenant()) and (select private.current_role()) = 'admin');

-- Administración de instituciones reservada a usuarios de plataforma (se asigna por SQL)
alter table public.profiles add column platform boolean not null default false;

-- Plantillas de informe por modalidad
create table public.report_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  name text not null,
  modality text not null check (modality in ('US', 'DX', 'CT', 'MR', 'MG')),
  technique text not null default '',
  comparison text not null default '',
  findings text not null default '',
  impression text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, modality, name)
);

create trigger audit_templates after insert or update or delete on public.report_templates for each row execute function private.audit_change();
alter table public.report_templates enable row level security;
create policy "clinical users read templates" on public.report_templates for select to authenticated
using (tenant_id = (select private.current_tenant()));
create policy "radiology staff manage templates" on public.report_templates for all to authenticated
using (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'radiologist'))
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'radiologist'));

-- Horarios de atención por sala y feriados
create table public.room_schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  room_label text not null,
  days text not null default '1,2,3,4,5',
  open_time time not null default '08:00',
  close_time time not null default '18:00',
  unique (tenant_id, room_label),
  check (close_time > open_time)
);

create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  holiday_date date not null,
  label text not null default '',
  unique (tenant_id, holiday_date)
);

alter table public.room_schedules enable row level security;
alter table public.holidays enable row level security;
create policy "clinical users read schedules" on public.room_schedules for select to authenticated
using (tenant_id = (select private.current_tenant()));
create policy "staff manage schedules" on public.room_schedules for all to authenticated
using (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'operator'))
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'operator'));
create policy "clinical users read holidays" on public.holidays for select to authenticated
using (tenant_id = (select private.current_tenant()));
create policy "staff manage holidays" on public.holidays for all to authenticated
using (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'operator'))
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'operator'));

-- Bucket público para logos institucionales
insert into storage.buckets (id, name, public) values ('branding', 'branding', true)
on conflict (id) do nothing;

create policy "public read branding" on storage.objects for select using (bucket_id = 'branding');
create policy "admins upload branding" on storage.objects for insert to authenticated
with check (bucket_id = 'branding' and (select private.current_role()) = 'admin');
create policy "admins replace branding" on storage.objects for update to authenticated
using (bucket_id = 'branding' and (select private.current_role()) = 'admin');
