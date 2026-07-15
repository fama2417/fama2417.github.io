-- Las políticas RLS ya existían, pero faltaban los GRANT base que PostgREST exige
-- antes de evaluarlas. La ausencia hacía fallar la ficha completa al leer relaciones.
grant select, insert, update on public.report_follow_ups to authenticated;
grant select on public.finding_dictionary to authenticated;
