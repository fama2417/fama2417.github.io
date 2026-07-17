-- Evita escanear todo el catálogo con word_similarity y favorece el LOINC general
-- de la muestra informada por sobre pruebas de desafío o métodos especializados.
create or replace function public.search_loinc_candidates(
  p_term text,
  p_specimen text default '',
  p_unit text default '',
  p_limit integer default 40
)
returns table(
  code text,
  display text,
  similarity_score real,
  component text,
  property text,
  specimen text,
  scale_type text,
  method_type text,
  class_name text,
  example_ucum_units text
)
language sql stable set search_path = '' as $$
  with query as (
    select
      trim(regexp_replace(extensions.unaccent(lower(coalesce(p_term, ''))), '[^a-z0-9]+', ' ', 'g')) as term,
      extensions.unaccent(lower(trim(coalesce(p_specimen, '')))) as specimen_text,
      case
        when extensions.unaccent(lower(coalesce(p_specimen, ''))) ~ '(urine|urina|orina|urin)' then 'urine'
        when extensions.unaccent(lower(coalesce(p_specimen, ''))) ~ '(ser|plas|bld|blood|sangre|suero)' then 'blood'
        else '' end as specimen_class,
      replace(replace(replace(lower(coalesce(p_unit, '')), ' ', ''), 'µ', 'u'), 'μ', 'u') as unit_key
  ), labels as (
    select t.code, t.display, t.display as search_text, 5 as language_priority
    from public.terminology_codes t cross join query q
    where t.system = 'LOINC' and length(q.term) >= 3 and (
      t.display operator(extensions.%) q.term or t.display ilike '%' || q.term || '%'
    )
    union all
    select d.code, d.display, d.search_text,
      case d.language_variant when 'esCL' then 0 when 'esMX' then 1 when 'esAR' then 2 when 'esES' then 3 else 4 end
    from public.terminology_designations d cross join query q
    where d.system = 'LOINC' and length(q.term) >= 3 and (
      d.search_text operator(extensions.%) q.term or d.search_text ilike '%' || q.term || '%'
    )
  ), scored as (
    select l.code, l.display, l.language_priority, m.component, m.property, m.specimen,
      m.scale_type, m.method_type, m.class_name, m.example_ucum_units,
      greatest(
        extensions.similarity(extensions.unaccent(lower(l.search_text)), q.term),
        extensions.word_similarity(q.term, extensions.unaccent(lower(l.search_text))),
        extensions.word_similarity(q.term, extensions.unaccent(lower(m.component)))
      ) as name_score,
      case when trim(regexp_replace(extensions.unaccent(lower(m.component)), '[^a-z0-9]+', ' ', 'g')) = q.term then .12 else 0 end as component_bonus,
      case
        when q.specimen_class = 'urine' and extensions.unaccent(lower(m.specimen)) ~ '(urine|urina|orina)' then .18
        when q.specimen_text ~ '(suero|serum|plasma|ser plas)' and extensions.unaccent(lower(m.specimen)) ~ '(ser|plas)' then .18
        when q.specimen_text ~ '(sangre total|whole blood|bld)' and extensions.unaccent(lower(m.specimen)) ~ '(bld|blood)' then .18
        when q.specimen_class = 'blood' and extensions.unaccent(lower(m.specimen)) ~ '(ser|plas|bld|blood)' then .10
        when q.specimen_class = '' then .05 else 0 end as specimen_score,
      case
        when q.unit_key <> '' and replace(replace(replace(lower(m.example_ucum_units), ' ', ''), 'µ', 'u'), 'μ', 'u') like '%' || q.unit_key || '%' then .14
        when q.unit_key ~ '^(m?g|u?g|ng|pg)/(dl|ml|l)$' and m.property = 'MCnc' then .10
        when q.unit_key = '%' and m.property in ('MFr', 'NFr', 'VFr', 'RatFr') then .10
        when q.unit_key = '' then .05 else 0 end as unit_score,
      case when m.status = 'ACTIVE' then .04 else 0 end as status_score,
      case when lower(l.display) like '%panel%' or m.class_name like 'PANEL.%' then .20 else 0 end
        + case when m.component like '%^%' then .18 else 0 end
        + case when m.method_type <> '' then .04 else 0 end as specificity_penalty
    from labels l
    join public.loinc_metadata m on m.code = l.code
    cross join query q
    where not (
      (q.specimen_class = 'blood' and extensions.unaccent(lower(m.specimen)) ~ '(urine|urina|orina)')
      or (q.specimen_class = 'urine' and extensions.unaccent(lower(m.specimen)) ~ '(ser|plas|bld|blood|sangre|suero)')
    )
  ), ranked as (
    select s.*,
      (s.name_score * .55 + s.component_bonus + s.specimen_score + s.unit_score + s.status_score - s.specificity_penalty) as ranking_score,
      row_number() over (
        partition by s.code
        order by (s.name_score * .55 + s.component_bonus + s.specimen_score + s.unit_score + s.status_score - s.specificity_penalty) desc, s.language_priority
      ) as position
    from scored s
  )
  select r.code, r.display, least(1, greatest(0, r.ranking_score))::real, r.component, r.property, r.specimen,
    r.scale_type, r.method_type, r.class_name, r.example_ucum_units
  from ranked r
  where r.position = 1
  order by r.ranking_score desc, length(r.display), r.code
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
$$;

notify pgrst, 'reload schema';
