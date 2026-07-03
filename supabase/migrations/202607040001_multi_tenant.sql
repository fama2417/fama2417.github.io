-- Multi-tenant: cada institución aísla sus datos mediante RLS
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.tenants enable row level security;

insert into public.tenants (name) values ('Institución principal');

alter table public.profiles add column tenant_id uuid references public.tenants(id);
update public.profiles set tenant_id = (select id from public.tenants limit 1);
alter table public.profiles alter column tenant_id set not null;

create function private.current_tenant() returns uuid
language sql stable security definer set search_path = ''
as $$ select tenant_id from public.profiles where id = (select auth.uid()) $$;
grant execute on function private.current_tenant() to authenticated;

create policy "users read own tenant" on public.tenants for select to authenticated
using (id = (select private.current_tenant()));

-- tenant_id en todas las tablas clínicas (los inserts lo completan solos por default)
alter table public.patients add column tenant_id uuid default private.current_tenant() references public.tenants(id);
alter table public.appointments add column tenant_id uuid default private.current_tenant() references public.tenants(id);
alter table public.imaging_studies add column tenant_id uuid default private.current_tenant() references public.tenants(id);
alter table public.radiology_reports add column tenant_id uuid default private.current_tenant() references public.tenants(id);
alter table public.catalog_items add column tenant_id uuid default private.current_tenant() references public.tenants(id);

update public.patients set tenant_id = (select id from public.tenants limit 1) where tenant_id is null;
update public.appointments set tenant_id = (select id from public.tenants limit 1) where tenant_id is null;
update public.imaging_studies set tenant_id = (select id from public.tenants limit 1) where tenant_id is null;
update public.radiology_reports set tenant_id = (select id from public.tenants limit 1) where tenant_id is null;
update public.catalog_items set tenant_id = (select id from public.tenants limit 1) where tenant_id is null;

alter table public.patients alter column tenant_id set not null;
alter table public.appointments alter column tenant_id set not null;
alter table public.imaging_studies alter column tenant_id set not null;
alter table public.radiology_reports alter column tenant_id set not null;
alter table public.catalog_items alter column tenant_id set not null;

-- El identificador de paciente ahora es único por institución, no global
alter table public.patients drop constraint patients_identifier_key_key;
create unique index patients_identifier_tenant_idx on public.patients (tenant_id, identifier_key);

create index patients_tenant_idx on public.patients (tenant_id);
create index appointments_tenant_idx on public.appointments (tenant_id, appointment_date);
create index catalog_tenant_idx on public.catalog_items (tenant_id, category);

-- Políticas RLS: siempre dentro del tenant propio
drop policy "clinical users read profiles" on public.profiles;
drop policy "admins manage profiles" on public.profiles;
create policy "clinical users read profiles" on public.profiles for select to authenticated
using (id = (select auth.uid()) or ((select private.current_role()) = 'admin' and tenant_id = (select private.current_tenant())));
create policy "admins manage profiles" on public.profiles for all to authenticated
using ((select private.current_role()) = 'admin' and tenant_id = (select private.current_tenant()))
with check ((select private.current_role()) = 'admin' and tenant_id = (select private.current_tenant()));

drop policy "clinical users read patients" on public.patients;
drop policy "staff create patients" on public.patients;
drop policy "staff update patients" on public.patients;
drop policy "admins delete patients" on public.patients;
create policy "clinical users read patients" on public.patients for select to authenticated
using (tenant_id = (select private.current_tenant()));
create policy "staff create patients" on public.patients for insert to authenticated
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'operator', 'radiologist'));
create policy "staff update patients" on public.patients for update to authenticated
using (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'operator', 'radiologist'))
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'operator', 'radiologist'));
create policy "admins delete patients" on public.patients for delete to authenticated
using (tenant_id = (select private.current_tenant()) and (select private.current_role()) = 'admin');

drop policy "clinical users read appointments" on public.appointments;
drop policy "staff create appointments" on public.appointments;
drop policy "staff update appointments" on public.appointments;
drop policy "admins delete appointments" on public.appointments;
create policy "clinical users read appointments" on public.appointments for select to authenticated
using (tenant_id = (select private.current_tenant()));
create policy "staff create appointments" on public.appointments for insert to authenticated
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'operator', 'radiologist'));
create policy "staff update appointments" on public.appointments for update to authenticated
using (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'operator', 'radiologist'))
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'operator', 'radiologist'));
create policy "admins delete appointments" on public.appointments for delete to authenticated
using (tenant_id = (select private.current_tenant()) and (select private.current_role()) = 'admin');

drop policy "clinical users read studies" on public.imaging_studies;
drop policy "radiology staff manage studies" on public.imaging_studies;
create policy "clinical users read studies" on public.imaging_studies for select to authenticated
using (tenant_id = (select private.current_tenant()));
create policy "radiology staff manage studies" on public.imaging_studies for all to authenticated
using (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'radiologist'))
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'radiologist'));

drop policy "clinical users read reports" on public.radiology_reports;
drop policy "radiology staff manage reports" on public.radiology_reports;
create policy "clinical users read reports" on public.radiology_reports for select to authenticated
using (tenant_id = (select private.current_tenant()));
create policy "radiology staff manage reports" on public.radiology_reports for all to authenticated
using (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'radiologist'))
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'radiologist'));

drop policy "clinical users read catalog" on public.catalog_items;
drop policy "staff manage catalog" on public.catalog_items;
create policy "clinical users read catalog" on public.catalog_items for select to authenticated
using (tenant_id = (select private.current_tenant()));
create policy "staff manage catalog" on public.catalog_items for all to authenticated
using (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'operator'))
with check (tenant_id = (select private.current_tenant()) and (select private.current_role()) in ('admin', 'operator'));

-- El catálogo ahora es único por tenant
alter table public.catalog_items drop constraint catalog_items_category_label_key;
create unique index catalog_items_tenant_category_label_idx on public.catalog_items (tenant_id, category, label);
