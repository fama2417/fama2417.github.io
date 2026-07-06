-- Radiólogo asignado para informar la cita
alter table public.appointments add column if not exists assigned_to uuid references public.profiles(id);

-- La auditoría ahora registra QUÉ cambió (Ley 19.628/21.719: trazabilidad de datos personales)
alter table public.audit_log add column if not exists details jsonb;

create or replace function private.audit_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare diff jsonb;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(entry.key, entry.value) into diff
    from jsonb_each(to_jsonb(new)) as entry
    where to_jsonb(old) -> entry.key is distinct from entry.value;
  elsif tg_op = 'INSERT' then
    diff := to_jsonb(new);
  end if;
  insert into public.audit_log (actor_id, table_name, row_id, action, details)
  values ((select auth.uid()), tg_table_name, coalesce(new.id, old.id), tg_op, diff);
  return coalesce(new, old);
end;
$$;
