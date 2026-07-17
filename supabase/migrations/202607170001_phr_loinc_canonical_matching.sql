-- Conserva el nombre informado por el laboratorio y guarda por separado la identidad canónica.
alter table public.phr_lab_results
  add column canonical_analyte text not null default '' check (length(canonical_analyte) <= 240),
  add column suggested_loinc_code text not null default '',
  add column coding_confidence numeric check (coding_confidence between 0 and 1);

create index phr_lab_results_suggested_loinc_idx
  on public.phr_lab_results (owner_user_id, suggested_loinc_code)
  where suggested_loinc_code <> '';

-- Búsqueda tolerante a abreviaciones y errores OCR sobre nombres oficiales en español e inglés.
create or replace function public.search_loinc_candidates(p_term text, p_limit integer default 10)
returns table(code text, display text, similarity_score real)
language sql stable set search_path = '' as $$
  with query as (
    select trim(regexp_replace(extensions.unaccent(lower(coalesce(p_term, ''))), '[^a-z0-9]+', ' ', 'g')) as term
  ), labels as (
    select t.code, t.display, t.display as search_text, 5 as language_priority
    from public.terminology_codes t, query q
    where t.system = 'LOINC' and length(q.term) >= 3
      and (t.display operator(extensions.%) q.term or lower(t.display) like '%' || q.term || '%')
    union all
    select d.code, d.display, d.search_text,
      case d.language_variant when 'esCL' then 0 when 'esES' then 1 when 'esMX' then 2 when 'esAR' then 3 else 4 end
    from public.terminology_designations d, query q
    where d.system = 'LOINC' and length(q.term) >= 3
      and (d.search_text operator(extensions.%) q.term or d.search_text like '%' || q.term || '%')
  ), ranked as (
    select labels.code, labels.display,
      extensions.similarity(extensions.unaccent(lower(labels.search_text)), query.term)::real as similarity_score,
      row_number() over (
        partition by labels.code
        order by extensions.similarity(extensions.unaccent(lower(labels.search_text)), query.term) desc, language_priority
      ) as position
    from labels cross join query
  )
  select ranked.code, ranked.display, ranked.similarity_score
  from ranked
  where ranked.position = 1
  order by ranked.similarity_score desc, length(ranked.display), ranked.code
  limit least(greatest(coalesce(p_limit, 10), 1), 20);
$$;

grant execute on function public.search_loinc_candidates(text, integer) to authenticated, service_role;

-- Los códigos ya confirmados reciben su nombre canónico sin alterar el texto fuente.
update public.phr_lab_results r
set canonical_analyte = coalesce(
      (select d.display from public.terminology_designations d
       where d.system = 'LOINC' and d.code = r.loinc_code
       order by case d.language_variant when 'esCL' then 0 when 'esES' then 1 when 'esMX' then 2 when 'esAR' then 3 else 4 end
       limit 1),
      (select t.display from public.terminology_codes t where t.system = 'LOINC' and t.code = r.loinc_code),
      r.analyte
    ),
    coding_confidence = 1
where r.loinc_code <> '';

notify pgrst, 'reload schema';
