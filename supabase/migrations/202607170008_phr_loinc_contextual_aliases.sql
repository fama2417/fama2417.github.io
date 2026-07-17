-- Homologa aliases sólo cuando las dimensiones observables identifican un término
-- LOINC inequívoco. Los resultados ya confirmados por la persona no se modifican.
with normalized as (
  select r.id,
    trim(regexp_replace(extensions.unaccent(lower(r.analyte)), '[^a-z0-9]+', ' ', 'g')) as analyte_key,
    replace(replace(replace(lower(regexp_replace(r.unit, '\s+', '', 'g')), 'gr/', 'g/'), 'µ', 'u'), 'μ', 'u') as unit_key,
    case when r.source_sentence ~* 'Muestra:\s*Orina' then 'urine' else 'blood' end as specimen_class,
    r.source_sentence
  from public.phr_lab_results r
  where r.review_status = 'suggested'
), mapped as (
  select n.id, case
    when n.specimen_class = 'urine' and n.analyte_key = 'ph' then '2756-5'
    when n.specimen_class = 'urine' and n.analyte_key = 'densidad' then '2965-2'
    when n.specimen_class = 'urine' and n.analyte_key = 'aspecto' then '5767-9'
    when n.specimen_class = 'urine' and n.analyte_key = 'color' then '5778-6'
    when n.specimen_class = 'urine' and n.analyte_key = 'urobilinogeno' then '13658-0'
    when n.specimen_class = 'urine' then null
    when n.analyte_key = 'colesterol ldl' and n.unit_key = 'mg/dl' then '2089-1'
    when n.analyte_key in ('ind col total col hdl', 'indice col total col hdl') and n.unit_key = '' then '9830-1'
    when n.analyte_key in ('r d w', 'rdw') and n.unit_key = '%' then '30385-9'
    when n.analyte_key in ('baciliformes', 'baciliformes neut') and n.unit_key = '%' then '26508-2'
    when n.analyte_key in ('mielocitos', 'mielocitos neut') and n.unit_key = '%' then '26498-6'
    when n.analyte_key = 'promielocitos' and n.unit_key = '%' then '26524-9'
    when n.analyte_key = 'vhs' and n.unit_key in ('mm/h', 'mm/hr') then '30341-2'
    when n.analyte_key = 'protrombina' and n.unit_key = '%' then '3289-6'
    when n.analyte_key = 'troponina i' and n.unit_key in ('ug/l', 'ng/ml') then '10839-9'
    when n.analyte_key = 'vfg mdrd idms raza blanca' then '48642-3'
    when n.analyte_key = 'vfg mdrd idms raza negra' then '48643-1'
    when n.analyte_key = 'vfg ckd epi raza blanca' then '88294-4'
    when n.analyte_key = 'vfg ckd epi raza negra' then '88293-6'
    when n.analyte_key = 'albumina' and n.unit_key = '%' then '35706-1'
    when n.analyte_key = 'alfa 1' and n.unit_key = '%' then '13978-2'
    when n.analyte_key = 'alfa 1' and n.unit_key = 'g/dl' then '2865-4'
    when n.analyte_key = 'alfa 2' and n.unit_key = '%' then '13981-6'
    when n.analyte_key = 'alfa 2' and n.unit_key = 'g/dl' then '2868-8'
    when n.analyte_key = 'beta 1' and n.unit_key = '%' then '32732-0'
    when n.analyte_key = 'beta 1' and n.unit_key = 'g/dl' then '32730-4'
    when n.analyte_key = 'beta 2' and n.unit_key = '%' then '32733-8'
    when n.analyte_key = 'beta 2' and n.unit_key = 'g/dl' then '32731-2'
    when n.analyte_key = 'gamma' and n.unit_key = '%' then '13983-2'
    when n.analyte_key = 'gamma' and n.unit_key = 'g/dl' then '2874-6'
    when n.analyte_key = 'ratio a g' and n.unit_key = '' then '1759-0'
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

-- Estos candidatos son incompatibles con el nombre o no declaran el método que
-- el código exige. Se conserva el resultado original y se retira sólo la sugerencia.
update public.phr_lab_results
set suggested_loinc_code = '', canonical_analyte = '', coding_confidence = null
where review_status = 'suggested' and (
  (extensions.unaccent(lower(analyte)) in ('globulos rojos', 'globulos blancos') and suggested_loinc_code = '18288-1')
  or (extensions.unaccent(lower(analyte)) = 'blastos' and suggested_loinc_code = '13841-2')
  or (extensions.unaccent(lower(analyte)) = 'leucocitos' and value_text ~ '[0-9]' and suggested_loinc_code = '33052-2')
  or (extensions.unaccent(lower(analyte)) = 'plaquetas' and value_text <> '' and suggested_loinc_code = '48705-8')
  or (extensions.unaccent(lower(analyte)) = 'cilindros' and suggested_loinc_code = '50231-0')
);

notify pgrst, 'reload schema';
