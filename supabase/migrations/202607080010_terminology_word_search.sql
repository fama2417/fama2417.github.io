-- Búsqueda multi-palabra: "abdomen ultrasound" debe encontrar "US Abdomen…" aunque las palabras
-- no estén contiguas. Cada palabra del término debe aparecer en el display (AND), o el término
-- completo ser prefijo del código.
create or replace function public.search_terminology(p_system text, p_term text)
returns setof public.terminology_codes language sql stable set search_path = '' as $$
  select t.* from public.terminology_codes t
  where t.system = p_system
    and (
      t.code ilike p_term || '%'
      or t.display ilike all (array(
        select '%' || w || '%'
        from regexp_split_to_table(trim(p_term), '\s+') as w
      ))
    )
  order by (t.code ilike p_term || '%') desc, length(t.display) asc
  limit 20;
$$;

notify pgrst, 'reload schema';
