create extension if not exists pgcrypto;

create type public.clinical_role as enum ('admin', 'operator', 'radiologist');
create type public.appointment_status as enum ('scheduled', 'confirmed', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_show');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role public.clinical_role not null default 'operator',
  created_at timestamptz not null default now()
);

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  identifier text not null,
  identifier_key text generated always as (lower(regexp_replace(identifier, '[^a-zA-Z0-9]', '', 'g'))) stored unique,
  full_name text not null,
  birth_date date not null,
  sex text not null check (sex in ('female', 'male', 'other', 'unknown')),
  phone text not null default '',
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  appointment_date date not null,
  start_time time not null,
  end_time time not null,
  practitioner_name text not null,
  location_name text not null,
  modality text not null check (modality in ('US', 'DX', 'CT', 'MR', 'MG')),
  reason text not null,
  status public.appointment_status not null default 'scheduled',
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time)
);

create index appointments_day_idx on public.appointments (appointment_date, start_time);

create table public.imaging_studies (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references public.appointments(id),
  orthanc_study_id text unique,
  study_instance_uid text unique,
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  table_name text not null,
  row_id uuid not null,
  action text not null,
  changed_at timestamptz not null default now()
);

create schema if not exists private;

create function private.current_role() returns public.clinical_role
language sql stable security definer set search_path = ''
as $$ select role from public.profiles where id = (select auth.uid()) $$;

create function private.audit_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.audit_log (actor_id, table_name, row_id, action)
  values ((select auth.uid()), tg_table_name, coalesce(new.id, old.id), tg_op);
  return coalesce(new, old);
end;
$$;

create trigger audit_patients after insert or update or delete on public.patients for each row execute function private.audit_change();
create trigger audit_appointments after insert or update or delete on public.appointments for each row execute function private.audit_change();
create trigger audit_studies after insert or update or delete on public.imaging_studies for each row execute function private.audit_change();

alter table public.profiles enable row level security;
alter table public.patients enable row level security;
alter table public.appointments enable row level security;
alter table public.imaging_studies enable row level security;
alter table public.audit_log enable row level security;

create policy "clinical users read profiles" on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select private.current_role()) = 'admin');
create policy "admins manage profiles" on public.profiles for all to authenticated
using ((select private.current_role()) = 'admin') with check ((select private.current_role()) = 'admin');

create policy "clinical users read patients" on public.patients for select to authenticated using (true);
create policy "staff create patients" on public.patients for insert to authenticated
with check ((select private.current_role()) in ('admin', 'operator', 'radiologist'));
create policy "staff update patients" on public.patients for update to authenticated
using ((select private.current_role()) in ('admin', 'operator', 'radiologist'))
with check ((select private.current_role()) in ('admin', 'operator', 'radiologist'));
create policy "admins delete patients" on public.patients for delete to authenticated
using ((select private.current_role()) = 'admin');

create policy "clinical users read appointments" on public.appointments for select to authenticated using (true);
create policy "staff create appointments" on public.appointments for insert to authenticated
with check ((select private.current_role()) in ('admin', 'operator', 'radiologist'));
create policy "staff update appointments" on public.appointments for update to authenticated
using ((select private.current_role()) in ('admin', 'operator', 'radiologist'))
with check ((select private.current_role()) in ('admin', 'operator', 'radiologist'));
create policy "admins delete appointments" on public.appointments for delete to authenticated
using ((select private.current_role()) = 'admin');

create policy "clinical users read studies" on public.imaging_studies for select to authenticated using (true);
create policy "radiology staff manage studies" on public.imaging_studies for all to authenticated
using ((select private.current_role()) in ('admin', 'radiologist'))
with check ((select private.current_role()) in ('admin', 'radiologist'));

create policy "admins read audit" on public.audit_log for select to authenticated
using ((select private.current_role()) = 'admin');

grant usage on schema private to authenticated;
grant execute on function private.current_role() to authenticated;
revoke all on function private.audit_change() from public, anon, authenticated;
