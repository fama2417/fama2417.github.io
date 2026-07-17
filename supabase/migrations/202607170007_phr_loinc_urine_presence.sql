-- Una presencia cualitativa en orina no es una concentración cuantitativa. Usa
-- términos LOINC sin método cuando el informe no declara tira o automatización.
with normalized as (
  select r.id, r.analyte,
    trim(regexp_replace(extensions.unaccent(lower(r.analyte)), '[^a-z0-9]+', ' ', 'g')) as analyte_key,
    trim(regexp_replace(extensions.unaccent(lower(r.value_text)), '[^a-z0-9]+', ' ', 'g')) as value_key
  from public.phr_lab_results r
  where r.review_status = 'suggested'
    and r.source_sentence ~* 'Muestra:\s*Orina'
    and trim(r.unit) = ''
), mapped as (
  select n.id, case
    when n.value_key not in ('negativo', 'positivo', 'indicio', 'traza', 'trazas', 'ausente', 'presente') then null
    when n.analyte_key in ('proteina', 'proteinas') then '2887-8'
    when n.analyte_key = 'glucosa' then '2349-9'
    when n.analyte_key in ('nitrito', 'nitritos') then '32710-6'
    when n.analyte_key = 'cetonas' then '33903-6'
    when n.analyte_key = 'bilirrubina' then '1977-8'
    when n.analyte_key = 'hemoglobina' then '725-2'
    when n.analyte_key = 'leucocitos' then '33052-2'
    else null end as code
  from normalized n
)
update public.phr_lab_results r
set loinc_code = m.code,
  suggested_loinc_code = '',
  canonical_analyte = coalesce(
    (select d.display from public.terminology_designations d where d.system = 'LOINC' and d.code = m.code
      order by case d.language_variant when 'esCL' then 0 when 'esMX' then 1 when 'esAR' then 2 when 'esES' then 3 else 4 end limit 1),
    (select t.display from public.terminology_codes t where t.system = 'LOINC' and t.code = m.code),
    r.analyte
  ),
  coding_confidence = 1
from mapped m
where r.id = m.id and m.code is not null
  and exists (select 1 from public.terminology_codes t where t.system = 'LOINC' and t.code = m.code);

notify pgrst, 'reload schema';
