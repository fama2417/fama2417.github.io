-- Solicitante, retiro, procedencia, motivo de estado y orden escaneada
alter table public.appointments
  add column requester_type text not null default 'interno' check (requester_type in ('interno', 'externo')),
  add column requester_name text not null default '',
  add column requester_run text not null default '',
  add column requester_email text not null default '',
  add column pickup_name text not null default '',
  add column pickup_run text not null default '',
  add column pickup_phone text not null default '',
  add column origin_type text not null default 'interna' check (origin_type in ('interna', 'externa')),
  add column origin_desc text not null default '',
  add column status_reason text not null default '',
  add column order_file text not null default '';

-- Hallazgo crítico en el informe (comunicación obligatoria según ACR)
alter table public.radiology_reports
  add column critical_finding boolean not null default false;

-- Bucket para órdenes médicas escaneadas
insert into storage.buckets (id, name, public) values ('ordenes', 'ordenes', false)
on conflict (id) do nothing;

create policy "clinical users read orders" on storage.objects for select to authenticated
using (bucket_id = 'ordenes');
create policy "staff upload orders" on storage.objects for insert to authenticated
with check (bucket_id = 'ordenes' and (select private.current_role()) in ('admin', 'operator', 'radiologist'));
