-- Anamnesis registrada al agendar, visible en la ventana de informe
alter table public.appointments add column anamnesis text not null default '';
