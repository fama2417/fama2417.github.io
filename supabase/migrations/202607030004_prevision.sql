-- Previsión de salud como catálogo parametrizable y campo del paciente
alter table public.catalog_items drop constraint catalog_items_category_check;
alter table public.catalog_items add constraint catalog_items_category_check
  check (category in ('sucursal', 'servicio', 'especialidad', 'profesional', 'sala', 'prestacion', 'etiqueta', 'prevision'));

insert into public.catalog_items (category, code, label, sort) values
  ('prevision', '', 'FONASA', 1),
  ('prevision', '', 'Isapre', 2),
  ('prevision', '', 'Particular', 3);

alter table public.patients add column prevision text not null default '';
