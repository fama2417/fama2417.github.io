-- Solo administradores pueden asignar informes; el asignado debe ser un radiólogo del mismo tenant.
create function private.protect_report_assignment() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.assigned_to is distinct from old.assigned_to then
    if (select private.current_role()) is distinct from 'admin' then
      raise exception 'Solo un administrador puede asignar informes';
    end if;
    if new.assigned_to is not null and not exists (
      select 1 from public.profiles p
      where p.id = new.assigned_to
        and p.tenant_id = new.tenant_id
        and p.role = 'radiologist'
    ) then
      raise exception 'El usuario asignado debe ser un radiólogo de la institución';
    end if;
  end if;
  return new;
end;
$$;

create trigger protect_report_assignment before update on public.appointments
for each row execute function private.protect_report_assignment();

revoke all on function private.protect_report_assignment() from public, anon, authenticated;
