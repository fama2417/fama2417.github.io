-- Catálogos parametrizables de la agenda
create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('sucursal', 'servicio', 'especialidad', 'profesional', 'sala', 'prestacion', 'etiqueta')),
  code text not null default '',
  label text not null,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  unique (category, label)
);

create trigger audit_catalog after insert or update or delete on public.catalog_items for each row execute function private.audit_change();

alter table public.catalog_items enable row level security;
create policy "clinical users read catalog" on public.catalog_items for select to authenticated using (true);
create policy "staff manage catalog" on public.catalog_items for all to authenticated
using ((select private.current_role()) in ('admin', 'operator'))
with check ((select private.current_role()) in ('admin', 'operator'));

insert into public.catalog_items (category, code, label, sort) values
  ('sucursal', '', 'Sucursal principal', 1),
  ('servicio', '', 'Imagenología', 1),
  ('especialidad', '', 'Radiología general', 1),
  ('profesional', '', 'Dra. Imagenología', 1),
  ('profesional', '', 'Dr. Radiología', 2),
  ('sala', '', 'Box 1', 1),
  ('sala', '', 'Box 2', 2),
  ('sala', '', 'Sala RX', 3),
  ('sala', '', 'Scanner', 4),
  ('sala', '', 'Resonador', 5),
  ('prestacion', '04.04.001.101', 'ECOGRAFIA ABDOMINAL', 1),
  ('prestacion', '04.01.001.101', 'RADIOGRAFIA DE TORAX', 2),
  ('prestacion', '04.03.103.101', 'ANGIOTAC AORTA ABDOMEN - PELVIS', 3),
  ('etiqueta', '', 'Control', 1),
  ('etiqueta', '', 'Primera vez', 2),
  ('etiqueta', '', 'GES', 3);

-- Detalle clínico de la cita
alter table public.appointments
  add column branch text not null default '',
  add column service text not null default '',
  add column specialty text not null default '',
  add column procedure_code text not null default '',
  add column treating_physician text not null default '',
  add column order_date date,
  add column anesthesia boolean not null default false,
  add column contrast boolean not null default false,
  add column priority text not null default 'normal' check (priority in ('normal', 'urgente')),
  add column payment_order text not null default '',
  add column tags text not null default '',
  add column diagnostic_hypothesis text not null default '',
  add column comment text not null default '';

-- Ficha de paciente ampliada
alter table public.patients
  add column address text not null default '',
  add column comuna text not null default '',
  add column email text not null default '',
  add column allergies text not null default '',
  add column morbid_history text not null default '';
