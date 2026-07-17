-- Observaciones morfológicas explícitas del hemograma: el valor textual evita
-- confundirlas con el recuento cuantitativo del mismo componente.
with mapped as (
  select r.id, case
    when extensions.unaccent(lower(r.analyte)) = 'blastos' and r.unit = '%' then '26446-5'
    when r.value_text ~* '^normales?\.?$' and extensions.unaccent(lower(r.analyte)) = 'globulos rojos' then '6742-1'
    when r.value_text ~* '^normales?\.?$' and extensions.unaccent(lower(r.analyte)) = 'globulos blancos' then '11156-7'
    when r.value_text ~* '^normales?\.?$' and extensions.unaccent(lower(r.analyte)) = 'plaquetas' then '11125-2'
    else null end as code
  from public.phr_lab_results r
  where r.review_status = 'suggested' and r.source_sentence ~* 'Muestra:\s*(Sangre|Suero|Plasma)'
)
update public.phr_lab_results r
set loinc_code = m.code, suggested_loinc_code = '',
  canonical_analyte = coalesce(
    (select d.display from public.terminology_designations d where d.system = 'LOINC' and d.code = m.code
      order by case d.language_variant when 'esCL' then 0 when 'esMX' then 1 when 'esAR' then 2 when 'esES' then 3 else 4 end limit 1),
    (select t.display from public.terminology_codes t where t.system = 'LOINC' and t.code = m.code), r.analyte),
  coding_confidence = 1
from mapped m
where r.id = m.id and m.code is not null
  and exists (select 1 from public.terminology_codes t where t.system = 'LOINC' and t.code = m.code);

-- Alias locales o unidades implícitas: se propone un código, pero queda amarillo
-- porque el documento no declara literalmente todas las dimensiones LOINC.
with reviewable as (
  select r.id, case
    when extensions.unaccent(lower(r.analyte)) = 'juveniles neut' and r.unit = '%' then '28541-1'
    when r.source_sentence ~* 'Muestra:\s*Orina' and r.value_text ~ '^\s*[0-9]+\s*-\s*[0-9]+'
      and extensions.unaccent(lower(r.analyte)) = 'leucocitos' then '105104-4'
    when r.source_sentence ~* 'Muestra:\s*Orina' and r.value_text ~ '^\s*[0-9]+\s*-\s*[0-9]+'
      and extensions.unaccent(lower(r.analyte)) in ('glob rojos', 'globulos rojos', 'eritrocitos') then '105107-7'
    else null end as code
  from public.phr_lab_results r
  where r.review_status = 'suggested' and trim(r.loinc_code) = ''
)
update public.phr_lab_results r
set suggested_loinc_code = q.code,
  canonical_analyte = coalesce(
    (select d.display from public.terminology_designations d where d.system = 'LOINC' and d.code = q.code
      order by case d.language_variant when 'esCL' then 0 when 'esMX' then 1 when 'esAR' then 2 when 'esES' then 3 else 4 end limit 1),
    (select t.display from public.terminology_codes t where t.system = 'LOINC' and t.code = q.code), r.analyte),
  coding_confidence = .82
from reviewable q
where r.id = q.id and q.code is not null
  and exists (select 1 from public.terminology_codes t where t.system = 'LOINC' and t.code = q.code);

update public.phr_lab_results
set suggested_loinc_code = '', canonical_analyte = '', coding_confidence = null
where review_status = 'suggested' and trim(loinc_code) = ''
  and extensions.unaccent(lower(analyte)) = 'cilindros';

notify pgrst, 'reload schema';
