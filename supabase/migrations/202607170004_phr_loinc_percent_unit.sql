-- '%' es un comodín de LIKE: la versión anterior lo trataba por error como si
-- coincidiera con cualquier unidad. Repondera sólo la unidad porcentual real.
alter function public.search_loinc_candidates(text, text, text, integer)
  rename to search_loinc_candidates_ranked_v1;

create function public.search_loinc_candidates(
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
  select b.code, b.display,
    case when trim(p_unit) = '%' then
      least(1, greatest(0, b.similarity_score - .14
        + case when trim(b.example_ucum_units) = '%' then .14 else 0 end))::real
    else b.similarity_score end,
    b.component, b.property, b.specimen, b.scale_type, b.method_type,
    b.class_name, b.example_ucum_units
  from public.search_loinc_candidates_ranked_v1(p_term, p_specimen, p_unit, 100) b
  order by
    case when trim(p_unit) = '%' then
      b.similarity_score - .14 + case when trim(b.example_ucum_units) = '%' then .14 else 0 end
    else b.similarity_score end desc,
    length(b.display), b.code
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
$$;

grant execute on function public.search_loinc_candidates(text, text, text, integer) to authenticated, service_role;

-- Las designaciones ya cargadas pasan a ser el nombre canónico visible, sin
-- modificar jamás el nombre original leído desde el informe.
update public.phr_lab_results r
set canonical_analyte = coalesce(
  (select d.display from public.terminology_designations d
   where d.system = 'LOINC' and d.code = r.loinc_code
   order by case d.language_variant when 'esCL' then 0 when 'esMX' then 1 when 'esAR' then 2 when 'esES' then 3 else 4 end
   limit 1),
  (select t.display from public.terminology_codes t where t.system = 'LOINC' and t.code = r.loinc_code),
  r.analyte
)
where r.loinc_code <> '';

notify pgrst, 'reload schema';
