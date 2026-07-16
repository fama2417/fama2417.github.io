create extension if not exists unaccent with schema extensions;

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
        and td.search_text ilike all (array(select '%' || extensions.unaccent(w) || '%' from regexp_split_to_table(trim(p_term), '\s+') as w))
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
