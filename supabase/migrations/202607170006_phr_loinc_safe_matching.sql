-- Prioriza compatibilidad semántica antes de similitud textual. Un nombre parecido
-- no basta si propiedad, unidad, tiempo o muestra describen otra observación.
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
      replace(replace(replace(replace(replace(lower(regexp_replace(coalesce(p_unit, ''), '\s+', '', 'g')), 'gr/', 'g/'), 'µ', 'u'), 'μ', 'u'), 'meg/l', 'meq/l'), 'miiu/l', 'miu/l') as unit_key
  ), scored as (
    select b.code, b.display, b.component, b.property, b.specimen, b.scale_type,
      b.method_type, b.class_name, b.example_ucum_units,
      least(1, greatest(0,
        b.similarity_score
        + case
            when q.unit_key <> '' and replace(replace(replace(lower(b.example_ucum_units), ' ', ''), 'µ', 'u'), 'μ', 'u') like '%' || q.unit_key || '%' then .08
            when q.unit_key = '%' and trim(b.example_ucum_units) = '%' then .08
            else 0 end
        - case
            when q.unit_key ~ '^(mg|g|ug|ng|pg)/(dl|ml|l)$' and b.property not in ('MCnc', 'EntMCnc') then .30
            when q.unit_key ~ '^(u|ui|iu)/l$' and b.property <> 'CCnc' then .30
            when q.unit_key = '%' and b.property not in ('MFr', 'NFr', 'VFr', 'RatFr', 'RelTime') then .24
            when q.unit_key ~ '^(s|seg\.?|sec)$' and b.property not in ('Time', 'RelTime') then .30
            when q.unit_key = 'fl' and b.property not in ('EntVol', 'EntMeanVol') then .30
            when q.unit_key = 'pg' and b.property <> 'EntMass' then .30
            when q.unit_key ~ '^(m|k)/ul|^x?10([*^]?[0-9]+)?/?(ul|mm3)$' and b.property <> 'NCnc' then .30
            else 0 end
      ))::real as final_score
    from public.search_loinc_candidates_ranked_v1(p_term, p_specimen, p_unit, 100) b
    join public.loinc_metadata m on m.code = b.code
    cross join query q
    where m.status = 'ACTIVE'
      and (m.time_aspect in ('', 'Pt') or q.term ~ '(24|hora|maxim|minim|post|pre)')
  )
  select s.code, s.display, s.final_score, s.component, s.property, s.specimen,
    s.scale_type, s.method_type, s.class_name, s.example_ucum_units
  from scored s
  order by s.final_score desc, length(s.display), s.code
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
$$;

grant execute on function public.search_loinc_candidates(text, text, text, integer) to authenticated, service_role;

-- Retira sólo asignaciones automáticas todavía no confirmadas cuando contradicen
-- dimensiones LOINC observables. El texto y el resultado originales no se tocan.
update public.phr_lab_results r
set loinc_code = '', suggested_loinc_code = '', canonical_analyte = '', coding_confidence = null
from public.loinc_metadata m
where r.review_status = 'suggested'
  and r.loinc_code = m.code
  and (
    m.status <> 'ACTIVE'
    or m.time_aspect not in ('', 'Pt')
    or (r.source_sentence ~* 'Muestra:\s*Orina' and extensions.unaccent(lower(m.specimen)) !~ '(urine|urina|orina)')
    or (r.source_sentence ~* 'Muestra:\s*(Suero|Plasma|Sangre)' and extensions.unaccent(lower(m.specimen)) ~ '(urine|urina|orina)')
    or (extensions.unaccent(lower(r.analyte)) ~ '(desh.*lactica|\bldh\b)' and extensions.unaccent(lower(m.specimen)) ~ '(urine|urina|orina)')
    or (r.value_num is null and r.value_text !~ '[0-9]' and m.scale_type not in ('Ord', 'Nom', 'SemiQn'))
  );

-- Corrige equivalencias inequívocas frecuentes en informes chilenos. Sólo afecta
-- resultados sugeridos; una selección ya confirmada por la persona se conserva.
with normalized as (
  select r.id,
    trim(regexp_replace(extensions.unaccent(lower(r.analyte)), '[^a-z0-9]+', ' ', 'g')) as analyte_key,
    replace(replace(replace(replace(lower(regexp_replace(r.unit, '\s+', '', 'g')), 'gr/', 'g/'), 'µ', 'u'), 'μ', 'u'), 'meg/l', 'meq/l') as unit_key,
    case when r.source_sentence ~* 'Muestra:\s*Orina' then 'urine' else 'blood' end as specimen_class
  from public.phr_lab_results r
  where r.review_status = 'suggested'
), mapped as (
  select n.id, case
    when n.specimen_class = 'urine' then null
    when n.analyte_key in ('glicemia', 'glucosa') and n.unit_key in ('mg/dl', 'g/l') then '2345-7'
    when n.analyte_key in ('acido urico', 'uricemia') and n.unit_key = 'mg/dl' then '3084-1'
    when n.analyte_key = 'bilirrubina total' and n.unit_key = 'mg/dl' then '1975-2'
    when n.analyte_key = 'bilirrubina directa' and n.unit_key = 'mg/dl' then '1968-7'
    when n.analyte_key = 'calcio' and n.unit_key = 'mg/dl' then '17861-6'
    when n.analyte_key = 'colesterol total' and n.unit_key = 'mg/dl' then '2093-3'
    when n.analyte_key = 'colesterol hdl' and n.unit_key = 'mg/dl' then '2085-9'
    when n.analyte_key = 'colesterol vldl' and n.unit_key = 'mg/dl' then '13458-5'
    when n.analyte_key = 'trigliceridos' and n.unit_key = 'mg/dl' then '2571-8'
    when n.analyte_key in ('fosforo', 'fosfato') and n.unit_key = 'mg/dl' then '2777-1'
    when n.analyte_key in ('nitrogeno ureico', 'n ureico') and n.unit_key = 'mg/dl' then '3094-0'
    when n.analyte_key in ('urea', 'uremia', 'urenia') and n.unit_key = 'mg/dl' then '3091-6'
    when n.analyte_key in ('proteinas totales', 'total proteinas') and n.unit_key = 'g/dl' then '2885-2'
    when n.analyte_key = 'albumina' and n.unit_key = 'g/dl' then '1751-7'
    when n.analyte_key in ('fosfatasa alcalina', 'f alcalinas') and n.unit_key = 'u/l' then '6768-6'
    when n.analyte_key in ('transaminasa got', 'got', 'ast') and n.unit_key = 'u/l' then '1920-8'
    when n.analyte_key in ('transaminasa gpt', 'gpt', 'alt') and n.unit_key = 'u/l' then '1742-6'
    when n.analyte_key in ('gamma gt', 'ggt') and n.unit_key = 'u/l' then '2324-2'
    when n.analyte_key in ('creatinina', 'creatininemia') and n.unit_key = 'mg/dl' then '2160-0'
    when n.analyte_key in ('beta 2 microglobulina', 'beta 2 microglobulinas') and n.unit_key = 'mg/l' then '1952-1'
    when n.analyte_key = 'sodio' and n.unit_key in ('meq/l', 'mmol/l') then '2951-2'
    when n.analyte_key = 'potasio' and n.unit_key in ('meq/l', 'mmol/l') then '2823-3'
    when n.analyte_key in ('cloro', 'cloruro') and n.unit_key in ('meq/l', 'mmol/l') then '2075-0'
    when n.analyte_key in ('eritrocitos', 'erimrocitos', 'eritrofocitos', 'eritrocpto') and n.unit_key ~ '^(m/ul|x?10([*^]?6)?/?ul)$' then '789-8'
    when n.analyte_key = 'hemoglobina' and n.unit_key = 'g/dl' then '718-7'
    when n.analyte_key = 'hematocrito' and n.unit_key = '%' then '4544-3'
    when n.analyte_key in ('v c m', 'vcm') and n.unit_key = 'fl' then '787-2'
    when n.analyte_key in ('h c m', 'hcm') and n.unit_key = 'pg' then '785-6'
    when n.analyte_key in ('c h c m', 'chcm') and n.unit_key = 'g/dl' then '786-4'
    when n.analyte_key = 'leucocitos' and n.unit_key ~ '^(k/ul|x?10([*^]?3)?/?ul)$' then '6690-2'
    when n.analyte_key in ('rcto de plaquetas', 'plaquetas') and n.unit_key ~ '^(k/ul|x?10([*^]?3)?/?ul)$' then '777-3'
    when n.analyte_key in ('segmentados', 'segmentados neut', 'neutrofilos') and n.unit_key = '%' then '770-8'
    when n.analyte_key = 'linfocitos' and n.unit_key = '%' then '736-9'
    when n.analyte_key = 'monocitos' and n.unit_key = '%' then '5905-5'
    when n.analyte_key = 'eosinofilos' and n.unit_key = '%' then '713-8'
    when n.analyte_key = 'basofilos' and n.unit_key = '%' then '706-2'
    when n.analyte_key in ('r a n', 'r a n rcto absoluto de neu') then '751-8'
    when n.analyte_key = 'rcto absoluto de eosinofilo' then '711-2'
    when n.analyte_key in ('t de tromboplastina parcial', 'tiempo de tromboplastina parcial', 'ptt', 'ttpa') then '14979-9'
    when n.analyte_key = 'tiempo protrombina' and n.unit_key in ('s', 'seg', 'seg.') then '5902-2'
    when n.analyte_key = 'inr' and n.unit_key = '' then '6301-6'
    when n.analyte_key in ('porcentaje saturacion de transferrin', 'saturacion transferrina', 'saturacion de transferrina') and n.unit_key = '%' then '2502-3'
    when n.analyte_key in ('25 oh vitamina d', '25 hidroxivitamina d', '25 hidroxivitamina d total', 'vitamina d total') and n.unit_key = 'ng/ml' then '62292-8'
    when n.analyte_key in ('hemoglobina glicosilada', 'hemoglobina glicada', 'hba1c') and n.unit_key = '%' then '4548-4'
    when n.analyte_key in ('glicemia media estimada', 'glucosa media estimada') and n.unit_key = 'mg/dl' then '27353-2'
    when n.analyte_key in ('tsh', 'tsh ultrasensible') and n.unit_key in ('miu/l', 'miiu/l', 'uiu/ml', 'uui/ml') then '3016-3'
    when n.analyte_key in ('t4 libre', 'tiroxina libre t4l') and n.unit_key = 'ng/dl' then '3024-7'
    when n.analyte_key = 'insulina' and n.unit_key in ('uiu/ml', 'uu/ml') then '20448-7'
    when n.analyte_key = 'prolactina' and n.unit_key = 'ng/ml' then '2842-3'
    when n.analyte_key = 'ferritina' and n.unit_key = 'ng/ml' then '2276-4'
    when n.analyte_key in ('ferremia', 'hierro') and n.unit_key = 'ug/dl' then '2498-4'
    when n.analyte_key ~ '^capacidad (total de )?fijacion (del |de )?(fierro|hierro|fe)$' and n.unit_key = 'ug/dl' then '2500-7'
    when n.analyte_key = 'transferrina' and n.unit_key = 'mg/dl' then '3034-6'
    when n.analyte_key in ('vitamina b 12', 'vitamina b12') and n.unit_key = 'pg/ml' then '2132-9'
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
