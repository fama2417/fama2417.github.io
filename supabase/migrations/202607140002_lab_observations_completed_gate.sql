-- Endurece a nivel RLS la regla de flujo: los resultados de laboratorio solo pueden cargarse cuando
-- la cita está en estado 'completed' ("Atendida"). Complementa el gate de UI (LabObservationsPanel);
-- aquí queda no evitable por llamadas directas a la API. Sigue exigiendo informe en borrador y ámbito.
drop policy if exists "report authors manage lab observations" on public.lab_observations;
create policy "report authors manage lab observations" on public.lab_observations for all to authenticated
  using (
    tenant_id = (select private.current_tenant())
    and ((select private.current_role()) = 'admin' or public.can_sign_report(appointment_id))
    and exists (select 1 from public.radiology_reports r
                where r.id = lab_observations.report_id and r.tenant_id = lab_observations.tenant_id and r.status = 'draft')
    and exists (select 1 from public.appointments a
                where a.id = lab_observations.appointment_id and a.tenant_id = lab_observations.tenant_id and a.status = 'completed')
  )
  with check (
    tenant_id = (select private.current_tenant())
    and ((select private.current_role()) = 'admin' or public.can_sign_report(appointment_id))
    and exists (select 1 from public.radiology_reports r
                where r.id = lab_observations.report_id and r.tenant_id = lab_observations.tenant_id and r.status = 'draft')
    and exists (select 1 from public.appointments a
                where a.id = lab_observations.appointment_id and a.tenant_id = lab_observations.tenant_id and a.status = 'completed')
  );

notify pgrst, 'reload schema';
