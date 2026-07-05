-- Detalle del hallazgo crítico notificado (lista ACR de resultados críticos)
alter table public.radiology_reports add column critical_finding_type text not null default '';
