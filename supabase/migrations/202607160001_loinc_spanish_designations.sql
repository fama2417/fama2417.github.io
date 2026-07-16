-- Variantes lingüísticas oficiales de LOINC. Son alias del código canónico, no copias del
-- catálogo: el inglés sigue siendo la fuente de metadatos y cada traducción mejora búsqueda/UI.
create table public.terminology_designations (
  system text not null,
  code text not null,
  language_variant text not null,
  display text not null,
  search_text text not null,
  primary key (system, code, language_variant),
  foreign key (system, code) references public.terminology_codes(system, code) on delete cascade
);

create index terminology_designations_search_trgm_idx on public.terminology_designations
  using gin (search_text extensions.gin_trgm_ops);

alter table public.terminology_designations enable row level security;
create policy "authenticated read terminology designations" on public.terminology_designations
  for select to authenticated using (true);
create policy "platform manages terminology designations" on public.terminology_designations
  for all to authenticated using ((select private.is_platform())) with check ((select private.is_platform()));
grant select on public.terminology_designations to authenticated;
grant all on public.terminology_designations to service_role;

create or replace function public.import_loinc_designations(p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if not (select private.is_platform()) then
    raise exception 'Solo el superadministrador puede cargar terminologías';
  end if;
  insert into public.terminology_designations (system, code, language_variant, display, search_text)
  select 'LOINC', trim(r->>'code'), trim(r->>'languageVariant'), trim(r->>'display'), trim(r->>'searchText')
  from jsonb_array_elements(p_rows) r
  where length(trim(coalesce(r->>'code',''))) > 0
    and length(trim(coalesce(r->>'languageVariant',''))) > 0
    and length(trim(coalesce(r->>'display',''))) > 0
    and exists (select 1 from public.terminology_codes t where t.system = 'LOINC' and t.code = trim(r->>'code'))
  on conflict (system, code, language_variant) do update
    set display = excluded.display, search_text = excluded.search_text;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
grant execute on function public.import_loinc_designations(jsonb) to authenticated;
revoke all on function public.import_loinc_designations(jsonb) from public, anon;

create or replace function public.search_terminology(p_system text, p_term text)
returns setof public.terminology_codes language sql stable set search_path = '' as $$
  select matched.system, matched.code, matched.display
  from (
    select t.system, t.code, coalesce(d.display, t.display) as display,
      (t.code ilike p_term || '%') as code_match
    from public.terminology_codes t
    left join lateral (
      select td.display
      from public.terminology_designations td
      where td.system = t.system and td.code = t.code
        and td.search_text ilike all (array(select '%' || w || '%' from regexp_split_to_table(trim(p_term), '\s+') as w))
      order by case td.language_variant when 'esCL' then 0 when 'esES' then 1 when 'esMX' then 2 when 'esAR' then 3 else 4 end
      limit 1
    ) d on true
    where t.system = p_system and (
      t.code ilike p_term || '%'
      or t.display ilike all (array(select '%' || w || '%' from regexp_split_to_table(trim(p_term), '\s+') as w))
      or d.display is not null
    )
  ) matched
  order by matched.code_match desc, length(matched.display) asc
  limit 20;
$$;

notify pgrst, 'reload schema';
