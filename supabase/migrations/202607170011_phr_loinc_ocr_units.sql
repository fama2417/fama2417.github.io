-- Corrige sólo resultados no confirmados cuyas unidades fueron truncadas por OCR.
update public.phr_lab_results
set unit = case
  when lower(unit) = 'nmol/' then 'nmol/L'
  when lower(unit) = 'meqg/l' then 'mEq/L'
  else unit end
where review_status = 'suggested' and lower(unit) in ('nmol/', 'meqg/l');

with mapped as (
  select r.id, case
    when extensions.unaccent(lower(r.analyte)) = 'testosterona total' and lower(r.unit) = 'nmol/l' then '14913-8'
    when extensions.unaccent(lower(r.analyte)) = 'cortisol' and lower(r.unit) = 'nmol/l' then '14675-3'
    when extensions.unaccent(lower(r.analyte)) = 'sodio' and lower(r.unit) = 'meq/l' then '2951-2'
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

-- LDH total sin dirección de reacción se mantiene como propuesta genérica;
-- nunca se confunde con una isoenzima LDH 1, 2, 3, 4 o 5.
update public.phr_lab_results r
set loinc_code = '', suggested_loinc_code = '32324-6',
  canonical_analyte = coalesce(
    (select d.display from public.terminology_designations d where d.system = 'LOINC' and d.code = '32324-6'
      order by case d.language_variant when 'esCL' then 0 when 'esMX' then 1 when 'esAR' then 2 when 'esES' then 3 else 4 end limit 1),
    (select t.display from public.terminology_codes t where t.system = 'LOINC' and t.code = '32324-6'), r.analyte),
  coding_confidence = .82
where r.review_status = 'suggested'
  and trim(regexp_replace(extensions.unaccent(lower(r.analyte)), '[^a-z0-9]+', ' ', 'g')) in ('ldh', 'desh lactica total ldh')
  and lower(regexp_replace(r.unit, '\s+', '', 'g')) = 'u/l'
  and r.source_sentence !~* 'Muestra:\s*Orina'
  and exists (select 1 from public.terminology_codes t where t.system = 'LOINC' and t.code = '32324-6');

notify pgrst, 'reload schema';
