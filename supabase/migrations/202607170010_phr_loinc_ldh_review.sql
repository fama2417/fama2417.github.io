-- Sin muestra ni dirección de reacción no existe una equivalencia sérica
-- inequívoca para LDH. Propone el término de espécimen no especificado y exige revisión.
update public.phr_lab_results r
set suggested_loinc_code = '32324-6',
  canonical_analyte = coalesce(
    (select d.display from public.terminology_designations d where d.system = 'LOINC' and d.code = '32324-6'
      order by case d.language_variant when 'esCL' then 0 when 'esMX' then 1 when 'esAR' then 2 when 'esES' then 3 else 4 end limit 1),
    (select t.display from public.terminology_codes t where t.system = 'LOINC' and t.code = '32324-6'), r.analyte),
  coding_confidence = .82
where r.review_status = 'suggested' and trim(r.loinc_code) = ''
  and trim(regexp_replace(extensions.unaccent(lower(r.analyte)), '[^a-z0-9]+', ' ', 'g')) in ('ldh', 'desh lactica total ldh')
  and replace(lower(regexp_replace(r.unit, '\s+', '', 'g')), 'ui/', 'u/') = 'u/l'
  and r.source_sentence !~* 'Muestra:\s*(Orina|Sangre|Suero|Plasma)'
  and exists (select 1 from public.terminology_codes t where t.system = 'LOINC' and t.code = '32324-6');

notify pgrst, 'reload schema';
