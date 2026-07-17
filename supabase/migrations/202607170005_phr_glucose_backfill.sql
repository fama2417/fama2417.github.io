-- Homologa datos históricos sólo cuando nombre, unidad y muestra hacen la
-- equivalencia inequívoca. "Glicemia media estimada" queda expresamente fuera.
update public.phr_lab_results r
set loinc_code = '2345-7',
    suggested_loinc_code = '',
    coding_confidence = 1,
    canonical_analyte = coalesce(
      (select d.display from public.terminology_designations d
       where d.system = 'LOINC' and d.code = '2345-7'
       order by case d.language_variant when 'esCL' then 0 when 'esMX' then 1 when 'esAR' then 2 when 'esES' then 3 else 4 end
       limit 1),
      'Glucosa'
    )
where r.loinc_code = ''
  and extensions.unaccent(lower(trim(r.analyte))) in ('glicemia', 'glucosa')
  and lower(replace(r.unit, ' ', '')) in ('mg/dl', 'mgr/dl')
  and extensions.unaccent(lower(r.source_sentence)) ~ 'muestra:\s*(suero|plasma|sangre|serum|blood)'
  and extensions.unaccent(lower(r.source_sentence)) !~ 'muestra:\s*(orina|urine)'
  and exists (select 1 from public.terminology_codes t where t.system = 'LOINC' and t.code = '2345-7');

notify pgrst, 'reload schema';
