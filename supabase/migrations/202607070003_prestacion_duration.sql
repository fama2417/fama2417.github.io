-- Duración por prestación: la agenda arma bloques de horario según cuánto dura el procedimiento.
alter table public.catalog_items add column if not exists duration_min integer;

-- Default razonable para prestaciones ya cargadas (minutos). Editable en Configuración.
update public.catalog_items set duration_min = 30 where category = 'prestacion' and duration_min is null;
