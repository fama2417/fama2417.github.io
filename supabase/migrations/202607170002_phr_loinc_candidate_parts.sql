-- El nombre por sí solo no identifica un LOINC. Esta búsqueda pondera las partes
-- principales (componente, muestra, propiedad/unidad, escala y método) y descarta
-- incompatibilidades obvias de muestra antes de entregar candidatos a revisión.
drop function if exists public.search_loinc_candidates(text, integer);

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
      lower(trim(coalesce(p_specimen, ''))) as specimen_class,
      replace(replace(replace(lower(coalesce(p_unit, '')), ' ', ''), 'µ', 'u'), 'μ', 'u') as unit_key
  ), labels as (
    select t.code, t.display, t.display as search_text, 5 as language_priority
    from public.terminology_codes t cross join query q
    where t.system = 'LOINC' and length(q.term) >= 3 and (
      t.display operator(extensions.%) q.term
      or extensions.word_similarity(q.term, extensions.unaccent(lower(t.display))) >= .55
      or lower(t.display) like '%' || q.term || '%'
    )
    union all
    select d.code, d.display, d.search_text,
      case d.language_variant when 'esCL' then 0 when 'esMX' then 1 when 'esAR' then 2 when 'esES' then 3 else 4 end
    from public.terminology_designations d cross join query q
    where d.system = 'LOINC' and length(q.term) >= 3 and (
      d.search_text operator(extensions.%) q.term
      or extensions.word_similarity(q.term, lower(d.search_text)) >= .55
      or lower(d.search_text) like '%' || q.term || '%'
    )
  ), scored as (
    select l.code, l.display, l.language_priority, m.component, m.property, m.specimen,
      m.scale_type, m.method_type, m.class_name, m.example_ucum_units,
      greatest(
        extensions.similarity(extensions.unaccent(lower(l.search_text)), q.term),
        extensions.word_similarity(q.term, extensions.unaccent(lower(l.search_text))),
        extensions.word_similarity(q.term, extensions.unaccent(lower(m.component)))
      ) as name_score,
      case
        when q.specimen_class = 'blood' and extensions.unaccent(lower(m.specimen)) ~ '(ser|plas|bld|blood|sangre|suero)' then .15
        when q.specimen_class = 'urine' and extensions.unaccent(lower(m.specimen)) ~ '(urine|urina|orina)' then .15
        when q.specimen_class = '' then .07 else 0 end as specimen_score,
      case
        when q.unit_key <> '' and replace(replace(replace(lower(m.example_ucum_units), ' ', ''), 'µ', 'u'), 'μ', 'u') like '%' || q.unit_key || '%' then .15
        when q.unit_key ~ '^(m?g|u?g|ng|pg)/(dl|ml|l)$' and m.property = 'MCnc' then .11
        when q.unit_key = '%' and m.property in ('MFr', 'NFr', 'VFr', 'RatFr') then .11
        when q.unit_key = '' then .07 else 0 end as unit_score,
      case when m.status = 'ACTIVE' then .05 else 0 end as status_score,
      case when lower(l.display) like '%panel%' or m.class_name like 'PANEL.%' then .2 else 0 end as panel_penalty
    from labels l
    join public.loinc_metadata m on m.code = l.code
    cross join query q
    where not (
      (q.specimen_class = 'blood' and extensions.unaccent(lower(m.specimen)) ~ '(urine|urina|orina)')
      or (q.specimen_class = 'urine' and extensions.unaccent(lower(m.specimen)) ~ '(ser|plas|bld|blood|sangre|suero)')
    )
  ), ranked as (
    select s.*,
      least(1, greatest(0, s.name_score * .65 + s.specimen_score + s.unit_score + s.status_score - s.panel_penalty))::real as final_score,
      row_number() over (
        partition by s.code
        order by (s.name_score * .65 + s.specimen_score + s.unit_score + s.status_score - s.panel_penalty) desc, s.language_priority
      ) as position
    from scored s
  )
  select r.code, r.display, r.final_score, r.component, r.property, r.specimen,
    r.scale_type, r.method_type, r.class_name, r.example_ucum_units
  from ranked r
  where r.position = 1
  order by r.final_score desc, length(r.display), r.code
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
$$;

grant execute on function public.search_loinc_candidates(text, text, text, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
