-- Memoria terminológica sin datos clínicos: una corrección humana se reutiliza sólo
-- para la misma institución, etiqueta, unidad y tipo de muestra.
create table public.phr_lab_term_mappings (
  source_institution text not null default '',
  analyte_key text not null,
  unit_key text not null default '',
  specimen_class text not null default '' check (specimen_class in ('', 'blood', 'urine')),
  terminology_system text not null default 'LOINC' check (terminology_system = 'LOINC'),
  loinc_code text not null,
  updated_at timestamptz not null default now(),
  primary key (source_institution, analyte_key, unit_key, specimen_class),
  foreign key (terminology_system, loinc_code)
    references public.terminology_codes(system, code) on delete cascade
);

alter table public.phr_lab_term_mappings enable row level security;
grant all on public.phr_lab_term_mappings to service_role;
grant select on public.loinc_metadata to authenticated, service_role;

-- Corrige homologaciones inequívocamente incompatibles observadas en datos ya confirmados.
with normalized as (
  select id, unit, extensions.unaccent(lower(trim(analyte))) as analyte_key
  from public.phr_lab_results
), corrected as (
  select id, case
    when analyte_key = 'tsh' then '3016-3'
    when analyte_key = 't4 libre' then '3024-7'
    when analyte_key in ('hemoglobina glicosilada', 'hemoglobina glicada', 'hba1c') then '4548-4'
    when analyte_key in ('glicemia media estimada', 'glucosa media estimada') then '27353-2'
    when analyte_key like '%saturacion%transferr%' then '2502-3'
    when analyte_key in ('25 oh vitamina d', '25 hidroxivitamina d', 'vitamina d total') then '62292-8'
    when analyte_key = 'hemoglobina' and lower(unit) in ('g/dl', 'gr/dl') then '718-7'
    when analyte_key = 'eritrocitos' and lower(unit) in ('m/ul', 'm/µl') then '789-8'
    else null end as loinc_code
  from normalized
)
update public.phr_lab_results r set loinc_code = c.loinc_code
from corrected c
where r.id = c.id and c.loinc_code is not null
  and exists (select 1 from public.terminology_codes t where t.system = 'LOINC' and t.code = c.loinc_code);

notify pgrst, 'reload schema';
