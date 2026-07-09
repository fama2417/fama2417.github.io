-- Catálogo de terminologías clínicas (LOINC, CIE-10/11, SNOMED CT) cargado localmente:
-- el typeahead consulta esta tabla en vez de APIs externas (rápido, sin credenciales en el
-- navegador, disponible offline). Global (no por tenant): las terminologías son universales.
create extension if not exists pg_trgm with schema extensions;

create table public.terminology_codes (
  system text not null check (system in ('LOINC','SNOMEDCT','ICD-10','ICD-11')),
  code text not null,
  display text not null,
  primary key (system, code)
);

create index terminology_display_trgm_idx on public.terminology_codes
  using gin (display extensions.gin_trgm_ops);

alter table public.terminology_codes enable row level security;
create policy "authenticated read terminology" on public.terminology_codes for select to authenticated using (true);
-- Solo el superadmin de plataforma carga catálogos (son globales, cruzan tenants).
create policy "platform manages terminology" on public.terminology_codes for all to authenticated
  using ((select private.is_platform())) with check ((select private.is_platform()));

-- Búsqueda para typeahead: prioriza match de código por prefijo, luego nombre por substring.
create or replace function public.search_terminology(p_system text, p_term text)
returns setof public.terminology_codes language sql stable set search_path = '' as $$
  select * from public.terminology_codes
  where system = p_system
    and (code ilike p_term || '%' or display ilike '%' || p_term || '%')
  order by (code ilike p_term || '%') desc, length(display) asc
  limit 20;
$$;
grant execute on function public.search_terminology(text, text) to authenticated;

-- Importación por lotes desde la UI de administración (jsonb: [{code, display}, ...]).
create or replace function public.import_terminology(p_system text, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if not (select private.is_platform()) then
    raise exception 'Solo el superadministrador puede cargar terminologías';
  end if;
  if p_system not in ('LOINC','SNOMEDCT','ICD-10','ICD-11') then
    raise exception 'Sistema de terminología no soportado';
  end if;
  insert into public.terminology_codes (system, code, display)
  select p_system, trim(r->>'code'), trim(r->>'display')
  from jsonb_array_elements(p_rows) r
  where length(trim(coalesce(r->>'code',''))) > 0 and length(trim(coalesce(r->>'display',''))) > 0
  on conflict (system, code) do update set display = excluded.display;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
grant execute on function public.import_terminology(text, jsonb) to authenticated;
revoke all on function public.import_terminology(text, jsonb) from public, anon;
