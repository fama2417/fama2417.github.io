-- Identificadores flexibles para pacientes y separación de estudios PACS por institución.
alter table public.patients add column if not exists identifier_type text not null default 'run'
  check (identifier_type in ('run', 'passport', 'other'));
drop index if exists public.patients_identifier_tenant_idx;
create unique index if not exists patients_identifier_type_tenant_idx on public.patients (tenant_id, identifier_type, identifier_key);

alter table public.tenants add column if not exists pacs_institution text not null default '';
create unique index if not exists tenants_pacs_institution_idx
  on public.tenants (lower(trim(pacs_institution))) where trim(pacs_institution) <> '';

-- Bootstrap único: si todavía no existe SuperAdmin, promueve al administrador más antiguo.
-- ponytail: la asignación posterior queda en la UI; reemplazar por invitaciones si la plataforma crece.
update public.profiles set platform = true
where id = (select id from public.profiles where role = 'admin' order by created_at limit 1)
  and not exists (select 1 from public.profiles where platform);
