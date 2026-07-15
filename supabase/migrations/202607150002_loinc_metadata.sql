-- Metadatos oficiales necesarios para agrupar y comparar resultados LOINC.
create table public.loinc_metadata (
  code text primary key,
  terminology_system text not null default 'LOINC' check (terminology_system = 'LOINC'),
  component text not null default '',
  property text not null default '',
  time_aspect text not null default '',
  specimen text not null default '',
  scale_type text not null default '',
  method_type text not null default '',
  class_name text not null default '',
  status text not null default '',
  example_ucum_units text not null default '',
  foreign key (terminology_system, code)
    references public.terminology_codes (system, code) on delete cascade
);

alter table public.loinc_metadata enable row level security;
create policy "authenticated read LOINC metadata" on public.loinc_metadata
  for select to authenticated using (true);

-- Inserta el término y sus metadatos en la misma transacción para no dejar filas huérfanas.
create or replace function public.import_loinc_terminology(p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if not (select private.is_platform()) then
    raise exception 'Solo el superadministrador puede cargar terminologías';
  end if;

  insert into public.terminology_codes (system, code, display)
  select 'LOINC', trim(r->>'code'), trim(r->>'display')
  from jsonb_array_elements(p_rows) r
  where length(trim(coalesce(r->>'code', ''))) > 0
    and length(trim(coalesce(r->>'display', ''))) > 0
  on conflict (system, code) do update set display = excluded.display;

  insert into public.loinc_metadata (
    code, component, property, time_aspect, specimen, scale_type,
    method_type, class_name, status, example_ucum_units
  )
  select
    trim(r->>'code'), trim(coalesce(r->>'component', '')),
    trim(coalesce(r->>'property', '')), trim(coalesce(r->>'timeAspect', '')),
    trim(coalesce(r->>'specimen', '')), trim(coalesce(r->>'scaleType', '')),
    trim(coalesce(r->>'methodType', '')), trim(coalesce(r->>'className', '')),
    trim(coalesce(r->>'status', '')), trim(coalesce(r->>'exampleUcumUnits', ''))
  from jsonb_array_elements(p_rows) r
  where length(trim(coalesce(r->>'code', ''))) > 0
    and length(trim(coalesce(r->>'display', ''))) > 0
  on conflict (code) do update set
    component = excluded.component,
    property = excluded.property,
    time_aspect = excluded.time_aspect,
    specimen = excluded.specimen,
    scale_type = excluded.scale_type,
    method_type = excluded.method_type,
    class_name = excluded.class_name,
    status = excluded.status,
    example_ucum_units = excluded.example_ucum_units;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

grant execute on function public.import_loinc_terminology(jsonb) to authenticated;
revoke all on function public.import_loinc_terminology(jsonb) from public, anon;

notify pgrst, 'reload schema';
