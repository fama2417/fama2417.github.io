-- Motivo clínico de la cita codificado (FHIR Appointment.reasonCode): la hipótesis diagnóstica
-- sigue siendo texto libre, pero puede acompañarse de un código estándar (CIE-10/11 o SNOMED CT)
-- para derivaciones e integraciones. Mismo patrón opcional que los códigos del informe.
alter table public.appointments
  add column reason_code_system text not null default 'ICD-10',
  add column reason_code text not null default '',
  add column reason_code_display text not null default '',
  add constraint appointments_reason_code_system_check check (reason_code_system in ('LOCAL','LOINC','SNOMEDCT','ICD-10','ICD-11')),
  add constraint appointments_reason_optional_code_check check (
    (length(trim(reason_code)) = 0 and length(trim(reason_code_display)) = 0)
    or (length(trim(reason_code)) > 0 and length(trim(reason_code_display)) > 0)
  );

notify pgrst, 'reload schema';
