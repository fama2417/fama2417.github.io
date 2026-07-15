-- La carga de resultados pertenece a la atención de laboratorio, no a un informe narrativo.
-- Cada importación conserva la huella del PDF para idempotencia y enlaza sus observaciones sugeridas.
create table public.lab_result_imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant() references public.tenants(id),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  source_filename text not null default '',
  extraction_method text not null check (extraction_method in ('local', 'ai_text', 'ai_visual')),
  identity_verified boolean not null default false,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, appointment_id, file_sha256)
);

alter table public.lab_observations
  alter column report_id drop not null,
  add column import_id uuid references public.lab_result_imports(id) on delete cascade;

alter table public.lab_observations
  add constraint lab_observation_single_origin
    check (num_nonnulls(report_id, import_id) = 1);

create index lab_result_imports_appointment_idx on public.lab_result_imports (appointment_id, created_at desc);
create index lab_observations_appointment_idx on public.lab_observations (appointment_id, observed_at desc);
create index lab_observations_import_idx on public.lab_observations (import_id);

alter table public.lab_result_imports enable row level security;

create policy "tenant reads lab imports" on public.lab_result_imports for select to authenticated
  using (
    tenant_id = (select private.current_tenant())
    and ((select private.current_role()) = 'admin' or public.can_sign_report(appointment_id))
  );

create policy "lab staff insert imports" on public.lab_result_imports for insert to authenticated
  with check (
    tenant_id = (select private.current_tenant())
    and identity_verified
    and ((select private.current_role()) = 'admin' or public.can_sign_report(appointment_id))
    and exists (
      select 1 from public.appointments a
      where a.id = lab_result_imports.appointment_id
        and a.tenant_id = lab_result_imports.tenant_id
        and a.patient_id = lab_result_imports.patient_id
        and a.service_category = 'laboratory'
        and a.status = 'completed'
    )
  );

-- Permite limpiar una importación huérfana si la inserción posterior de filas falla.
create policy "lab staff delete empty imports" on public.lab_result_imports for delete to authenticated
  using (
    tenant_id = (select private.current_tenant())
    and ((select private.current_role()) = 'admin' or public.can_sign_report(appointment_id))
    and not exists (select 1 from public.lab_observations o where o.import_id = lab_result_imports.id)
  );

drop policy if exists "report authors manage lab observations" on public.lab_observations;
drop policy if exists "tenant reads lab observations" on public.lab_observations;

create policy "tenant reads reviewed lab observations" on public.lab_observations for select to authenticated
  using (
    tenant_id = (select private.current_tenant())
    and (
      review_status = 'confirmed'
      or (select private.current_role()) = 'admin'
      or public.can_sign_report(appointment_id)
    )
  );

create policy "lab staff insert observations" on public.lab_observations for insert to authenticated
  with check (
    tenant_id = (select private.current_tenant())
    and review_status = 'suggested'
    and ((select private.current_role()) = 'admin' or public.can_sign_report(appointment_id))
    and exists (
      select 1 from public.appointments a
      where a.id = lab_observations.appointment_id
        and a.tenant_id = lab_observations.tenant_id
        and a.patient_id = lab_observations.patient_id
        and a.service_category = 'laboratory'
        and a.status = 'completed'
    )
    and (
      exists (
        select 1 from public.lab_result_imports i
        where i.id = lab_observations.import_id
          and i.tenant_id = lab_observations.tenant_id
          and i.appointment_id = lab_observations.appointment_id
          and i.patient_id = lab_observations.patient_id
          and i.identity_verified
      )
      or exists (
        select 1 from public.radiology_reports r
        where r.id = lab_observations.report_id
          and r.tenant_id = lab_observations.tenant_id
          and r.appointment_id = lab_observations.appointment_id
          and r.status = 'draft'
      )
    )
  );

create policy "lab staff review suggested observations" on public.lab_observations for update to authenticated
  using (
    tenant_id = (select private.current_tenant())
    and review_status = 'suggested'
    and ((select private.current_role()) = 'admin' or public.can_sign_report(appointment_id))
  )
  with check (
    tenant_id = (select private.current_tenant())
    and ((select private.current_role()) = 'admin' or public.can_sign_report(appointment_id))
    and exists (
      select 1 from public.appointments a
      where a.id = lab_observations.appointment_id
        and a.tenant_id = lab_observations.tenant_id
        and a.patient_id = lab_observations.patient_id
        and a.service_category = 'laboratory'
        and a.status = 'completed'
    )
    and (
      exists (
        select 1 from public.lab_result_imports i
        where i.id = lab_observations.import_id
          and i.tenant_id = lab_observations.tenant_id
          and i.appointment_id = lab_observations.appointment_id
          and i.patient_id = lab_observations.patient_id
          and i.identity_verified
      )
      or exists (
        select 1 from public.radiology_reports r
        where r.id = lab_observations.report_id
          and r.tenant_id = lab_observations.tenant_id
          and r.appointment_id = lab_observations.appointment_id
          and r.status = 'draft'
      )
    )
  );

create policy "lab staff discard suggested observations" on public.lab_observations for delete to authenticated
  using (
    tenant_id = (select private.current_tenant())
    and review_status = 'suggested'
    and ((select private.current_role()) = 'admin' or public.can_sign_report(appointment_id))
  );

grant select, insert, delete on public.lab_result_imports to authenticated;

-- El consumo de IA de laboratorio también se atribuye directamente a la atención.
alter table public.ai_usage_log
  add column appointment_id uuid references public.appointments(id) on delete set null;
create index ai_usage_log_appointment_idx on public.ai_usage_log (appointment_id);

drop policy if exists "report staff insert ai usage log" on public.ai_usage_log;
create policy "report staff insert ai usage log" on public.ai_usage_log for insert to authenticated
with check (
  tenant_id = (select private.current_tenant())
  and (
    (select private.current_role()) = 'admin'
    or exists (
      select 1 from public.radiology_reports rr
      where rr.id = ai_usage_log.report_id
        and rr.tenant_id = ai_usage_log.tenant_id
        and public.can_sign_report(rr.appointment_id)
    )
    or exists (
      select 1 from public.appointments a
      where a.id = ai_usage_log.appointment_id
        and a.tenant_id = ai_usage_log.tenant_id
        and a.service_category = 'laboratory'
        and public.can_sign_report(a.id)
    )
  )
  and (service_type_id is null or exists (
    select 1 from public.service_types st
    where st.id = ai_usage_log.service_type_id and st.tenant_id = ai_usage_log.tenant_id
  ))
);

create trigger audit_lab_result_imports after insert or update or delete on public.lab_result_imports
  for each row execute function private.audit_change();

notify pgrst, 'reload schema';
