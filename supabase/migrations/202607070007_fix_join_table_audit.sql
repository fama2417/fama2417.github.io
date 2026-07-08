-- Fix: las tablas de unión no tienen columna id, pero el bucle de RLS les puso el trigger de
-- auditoría (private.audit_change usa new.id). Insertar una asociación fallaba con
-- 'record "new" has no field id' (error 400). Se quita la auditoría de esas dos tablas.
drop trigger if exists audit_resource_service_types on public.resource_service_types;
drop trigger if exists audit_schedulable_resource_components on public.schedulable_resource_components;
